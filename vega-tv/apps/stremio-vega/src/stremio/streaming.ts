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
