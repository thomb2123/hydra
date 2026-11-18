// Turns a Stremio stream object into something the Vega player can open.
// Mirrors stremio-core (types/resource/stream.rs) and stremio-video
// (withStreamingServer/createTorrent.js):
//   torrent  -> POST {server}/{infoHash}/create, then {server}/{infoHash}/{fileIdx}?tr=...
//   proxied  -> {server}/proxy/d=<origin>&h=<k:v>/<path>?<query>
//   YouTube  -> {server}/yt/<id>
//   subtitle -> {server}/subtitles.vtt?from=<url> (re-encodes to UTF-8 WebVTT)
import {requestJson} from '../../../../shared/src/net';
import {Stream} from './types';

export class StreamError extends Error {}

export interface ResolvedStream {
  url: string;
  kind: 'http' | 'torrent' | 'youtube';
  needsServer: boolean;
  note?: string;
}

/**
 * Debrid only: torrent / magnet streams are never played. Playing one makes the PC's
 * streaming server join the torrent swarm, where every peer sees this home's IP
 * address; debrid links (Real-Debrid via AIOStreams / Comet) are plain HTTPS downloads.
 */
export const DEBRID_ONLY = true;

/** A stream that would need a torrent swarm (info hash or magnet link). */
export function isTorrentStream(stream: {infoHash?: string; url?: string}): boolean {
  return !!stream.infoHash || /^magnet:/i.test(stream.url || '');
}

export function normaliseServerUrl(input: string): string {
  let value = input.trim();
  if (!value) {
    return '';
  }
  if (!/^https?:\/\//i.test(value)) {
    value = 'http://' + value;
  }
  value = value.replace(/\/+$/, '');
  if (!/:\d+$/.test(value.replace(/^https?:\/\//i, ''))) {
    value += ':11470';
  }
  return value;
}

export function parseMagnet(url: string): {infoHash: string; trackers: string[]} | null {
  if (!/^magnet:\?/i.test(url)) {
    return null;
  }
  const query = url.slice(url.indexOf('?') + 1);
  let infoHash = '';
  const trackers: string[] = [];
  for (const part of query.split('&')) {
    const [rawKey, rawValue = ''] = part.split('=');
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    if (key === 'xt' && /^urn:btih:/i.test(value)) {
      infoHash = value.slice(9).toLowerCase();
    } else if (key === 'tr') {
      trackers.push(value);
    }
  }
  return /^[0-9a-f]{40}$/.test(infoHash) ? {infoHash, trackers} : null;
}

function query(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export function torrentUrl(server: string, infoHash: string, fileIdx: number, sources: string[]): string {
  const base = `${server}/${encodeURIComponent(infoHash)}/${encodeURIComponent(String(fileIdx))}`;
  return sources.length ? `${base}?${query(sources.map((s) => ['tr', s] as [string, string]))}` : base;
}

export function proxyUrl(server: string, target: string, request: Record<string, string> = {}, response: Record<string, string> = {}): string {
  const match = /^(https?:\/\/[^/?#]+)(\/[^?#]*)?(\?[^#]*)?/i.exec(target);
  if (!match) {
    throw new StreamError('Invalid stream address.');
  }
  const origin = match[1];
  const path = (match[2] || '/').replace(/^\//, '');
  const pairs: [string, string][] = [['d', origin]];
  Object.entries(request).forEach(([k, v]) => pairs.push(['h', `${k}:${v}`]));
  Object.entries(response).forEach(([k, v]) => pairs.push(['r', `${k}:${v}`]));
  return `${server}/proxy/${query(pairs)}/${path}${match[3] || ''}`;
}

export function subtitleViaServer(server: string, url: string): string {
  return `${server}/subtitles.vtt?${query([['from', url]])}`;
}

async function createTorrent(
  server: string,
  infoHash: string,
  fileIdx: number | undefined,
  sources: string[],
  episode?: {season?: number; episode?: number},
): Promise<string> {
  const hasIdx = typeof fileIdx === 'number' && Number.isFinite(fileIdx);
  if (!sources.length && hasIdx) {
    return torrentUrl(server, infoHash, fileIdx as number, []);
  }
  const peerSources = ['dht:' + infoHash]
    .concat(sources.map((s) => (s.startsWith('tracker:') || s.startsWith('dht:') ? s : 'tracker:' + s)))
    .filter((s, i, all) => all.indexOf(s) === i);
  const body: any = {torrent: {infoHash}};
  if (sources.length) {
    body.peerSearch = {sources: peerSources, min: 40, max: 200};
  }
  if (hasIdx) {
    body.guessFileIdx = false;
  } else {
    body.guessFileIdx = {};
    if (episode?.season != null) {
      body.guessFileIdx.season = episode.season;
    }
    if (episode?.episode != null) {
      body.guessFileIdx.episode = episode.episode;
    }
  }
  const result = await requestJson<{guessedFileIdx?: number}>(`${server}/${encodeURIComponent(infoHash)}/create`, {
    method: 'POST',
    body,
    timeoutMs: 60000,
  });
  const idx = hasIdx ? (fileIdx as number) : typeof result.guessedFileIdx === 'number' ? result.guessedFileIdx : -1;
  return torrentUrl(server, infoHash, idx, body.peerSearch ? body.peerSearch.sources : []);
}

export async function resolveStream(
  stream: Stream,
  server: string,
  episode?: {season?: number; episode?: number},
): Promise<ResolvedStream> {
  const magnet = stream.url ? parseMagnet(stream.url) : null;
  const infoHash = stream.infoHash ? stream.infoHash.toLowerCase() : magnet?.infoHash;
  if (infoHash) {
    if (DEBRID_ONLY) {
      // Never join a torrent swarm (peers would see this home's IP address).
      throw new StreamError('Torrent streams are switched off in this app (debrid only). Choose another version.');
    }
    if (!server) {
      throw new StreamError(
        'This is a torrent stream. Set up the Stremio streaming server on your PC (Settings → Streaming server) to play it.',
      );
    }
    const sources = (stream.sources || []).concat(magnet?.trackers.map((t) => 'tracker:' + t) || []);
    const url = await createTorrent(server, infoHash, stream.fileIdx, sources, episode);
    return {url, kind: 'torrent', needsServer: true};
  }
  if (stream.ytId) {
    if (!server) {
      throw new StreamError('YouTube streams are played through the Stremio streaming server. Set it up in Settings.');
    }
    return {url: `${server}/yt/${encodeURIComponent(stream.ytId)}`, kind: 'youtube', needsServer: true};
  }
  if (stream.url && /^https?:\/\//i.test(stream.url)) {
    const headers = stream.behaviorHints?.proxyHeaders;
    if (headers && (Object.keys(headers.request || {}).length || Object.keys(headers.response || {}).length)) {
      if (server) {
        return {url: proxyUrl(server, stream.url, headers.request, headers.response), kind: 'http', needsServer: true};
      }
      return {
        url: stream.url,
        kind: 'http',
        needsServer: false,
        note: 'This stream asks for special request headers; without the streaming server it may be refused.',
      };
    }
    return {url: stream.url, kind: 'http', needsServer: false};
  }
  if (stream.externalUrl) {
    throw new StreamError('This stream opens in an external app or website, which Vega cannot launch from here.');
  }
  throw new StreamError('Unsupported stream type.');
}

export function describeStream(stream: Stream): {title: string; detail: string} {
  const name = (stream.name || '').replace(/\s+/g, ' ').trim();
  const body = (stream.title || stream.description || '').trim();
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const kind = stream.infoHash || (stream.url || '').startsWith('magnet:') ? 'Torrent' : stream.ytId ? 'YouTube' : stream.externalUrl ? 'External' : 'Direct';
  return {
    title: name ? `${name}${lines[0] ? ' · ' + lines[0] : ''}` : lines[0] || kind,
    detail: [kind, ...lines.slice(name ? 1 : 1)].join(' · '),
  };
}

export interface ProbeTrack {
  track: 'video' | 'audio' | 'subtitle' | string;
  codec?: string;
  language?: string | null;
  title?: string | null;
  frameRate?: number;
  width?: number;
  height?: number;
  isHdr?: boolean;
  isDoVi?: boolean;
  channels?: number;
}

export interface ProbeResult {
  duration?: number;
  streams: ProbeTrack[];
}

/** Asks the PC's Stremio server to inspect a media URL (ffprobe): tracks, languages, frame rate, HDR. */
export async function probeMedia(server: string, mediaUrl: string, timeoutMs = 10000): Promise<ProbeResult | null> {
  if (!server || !/^https?:\/\//i.test(mediaUrl)) {
    return null;
  }
  try {
    const data = await requestJson<{format?: {duration?: number}; streams?: ProbeTrack[]}>(
      `${server}/hlsv2/probe?${query([['mediaURL', mediaUrl]])}`,
      {timeoutMs},
    );
    return {duration: data.format?.duration, streams: Array.isArray(data.streams) ? data.streams : []};
  } catch {
    return null;
  }
}

const ENGLISH_CODES = new Set(['eng', 'en', 'english']);

/** Judges a probed file for this device: default audio language/codec and Dolby Vision without HDR10. */
export function probeVerdict(probe: ProbeResult): {ok: boolean; reason?: string; frameRate?: number; audioLanguage?: string} {
  const video = probe.streams.find((s) => s.track === 'video');
  const audio = probe.streams.filter((s) => s.track === 'audio');
  const first = audio[0];
  const language = (first?.language || '').toLowerCase();
  const frameRate = video?.frameRate && video.frameRate > 1 ? video.frameRate : undefined;
  if (video?.isDoVi && !video.isHdr) {
    return {ok: false, reason: 'Dolby Vision only', frameRate, audioLanguage: language};
  }
  if (first && /truehd|mlp/i.test(first.codec || '')) {
    return {ok: false, reason: 'TrueHD audio', frameRate, audioLanguage: language};
  }
  // Vega plays the first audio track and cannot switch, so it must be English (or unlabelled).
  if (first && language && language !== 'und' && !ENGLISH_CODES.has(language)) {
    return {ok: false, reason: `${language} audio first`, frameRate, audioLanguage: language};
  }
  return {ok: true, frameRate, audioLanguage: language};
}

// ---------------------------------------------------------------------------
// Finding the PC and checking streams before playback.

/** True when `url` answers like a Stremio streaming server's /settings. */
async function isStremioServer(base: string, timeoutMs: number): Promise<boolean> {
  try {
    const data = await requestJson<any>(`${base}/settings`, {timeoutMs});
    return !!data && (Array.isArray(data.options) || typeof data.values === 'object');
  } catch {
    return false;
  }
}

/**
 * Looks for a Stremio streaming server (port 11470) on common home subnets.
 * Checks hosts in parallel batches; returns e.g. "http://192.168.1.242:11470".
 */
export async function discoverServer(log: (line: string) => void = () => undefined, subnets = ['192.168.1', '192.168.0', '10.0.0']): Promise<string> {
  for (const subnet of subnets) {
    log(`looking for Stremio on ${subnet}.x`);
    const hosts = Array.from({length: 254}, (_, i) => `http://${subnet}.${i + 1}:11470`);
    for (let i = 0; i < hosts.length; i += 48) {
      const batch = hosts.slice(i, i + 48);
      const results = await Promise.all(batch.map(async (base) => ((await isStremioServer(base, 1800)) ? base : '')));
      const found = results.find(Boolean);
      if (found) {
        log(`found Stremio server at ${found}`);
        return found;
      }
    }
  }
  log('no Stremio server found on the network');
  return '';
}

export interface Preflight {
  ok: boolean;
  /** Address after redirects (handing this to the player avoids redirect-related seek failures). */
  finalUrl: string;
  reason?: string;
}

/**
 * Asks for the first byte of a stream: fails fast on DNS/connection problems
 * and returns the address after any redirects.
 */
export function preflightStream(url: string, timeoutMs = 5000): Promise<Preflight> {
  // XMLHttpRequest rather than fetch: on Vega, fetch only resolves after the whole body
  // arrives, while XHR reports status and the post-redirect URL as soon as headers land.
  return new Promise((resolve) => {
    let settled = false;
    const xhr = new XMLHttpRequest();
    const finish = (result: Preflight) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        xhr.abort();
      } catch {
        // Already closed.
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ok: false, finalUrl: url, reason: 'timed out'}), timeoutMs);
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2 && xhr.status > 0) {
        const finalUrl = (xhr as any).responseURL || url;
        finish(xhr.status >= 400 ? {ok: false, finalUrl, reason: `HTTP ${xhr.status}`} : {ok: true, finalUrl});
      }
    };
    xhr.onerror = () => finish({ok: false, finalUrl: url, reason: 'network error'});
    try {
      xhr.open('GET', url);
      xhr.setRequestHeader('Range', 'bytes=0-0');
      xhr.send();
    } catch (e: any) {
      finish({ok: false, finalUrl: url, reason: String(e?.message || e)});
    }
  });
}
