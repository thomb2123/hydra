// Picks the stream to play, fast:
// - streams are fetched and ranked as soon as a title page opens (prefetch),
// - the leading candidates are checked in parallel (reachable, then English
//   first audio track / no DV-only / no TrueHD via the PC server),
// - the best-ranked candidate that passes wins.
import {fetchStreams} from './addons';
import {badHosts, isBadHost, markBadHost, strikeHost} from './badHosts';
import {videoIdOf} from './playback';
import {preflightStream, probeMedia, probeVerdict, resolveStream} from './streaming';
import {RankedStream, rankStreams} from './streamPicker';
import {MetaDetail, Video} from './types';
import {StremioState} from '../state';
import {hostOf} from '../../../../shared/src/net';

export interface Pick {
  ranked: RankedStream[];
  index: number;
  url: string;
  frameRate?: number;
}

type Log = (line: string) => void;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const rankCache = new Map<string, {at: number; promise: Promise<RankedStream[]>}>();
const pickCache = new Map<string, {at: number; promise: Promise<Pick | null>}>();
const FRESH_MS = 4 * 60 * 1000; // stream links (debrid) stay valid for minutes, not hours

function keyOf(meta: MetaDetail, video: Video | null): string {
  return `${meta.type}|${videoIdOf(meta, video)}`;
}

export function rankedStreams(state: StremioState, meta: MetaDetail, video: Video | null, log: Log): Promise<RankedStream[]> {
  const key = keyOf(meta, video);
  const cached = rankCache.get(key);
  if (cached && Date.now() - cached.at < FRESH_MS) {
    return cached.promise;
  }
  const promise = (async () => {
    const [groups, bad] = await Promise.all([fetchStreams(state.addons, meta.type, videoIdOf(meta, video)), badHosts()]);
    const all = rankStreams(
      groups.map((g) => ({addonName: g.addon.manifest.name, streams: g.streams})),
      {hasServer: !!state.server},
    ).filter((r) => r.playable);
    // Hosts that failed before (e.g. blocked by the ISP) go to the back.
    const ranked = [...all.filter((r) => !isBadHost(r.stream.url, bad)), ...all.filter((r) => isBadHost(r.stream.url, bad))];
    log(`ranked ${ranked.length} streams (${bad.size} bad hosts); top: ${ranked.slice(0, 4).map((r) => `${r.score}:${r.summary || '?'}`).join(' | ')}`);
    return ranked;
  })();
  rankCache.set(key, {at: Date.now(), promise});
  promise.catch(() => rankCache.delete(key));
  return promise;
}

interface Check {
  ok: boolean;
  url: string;
  frameRate?: number;
}

async function checkCandidate(state: StremioState, video: Video | null, candidate: RankedStream, index: number, log: Log): Promise<Check> {
  let url: string;
  try {
    url = (await resolveStream(candidate.stream, state.server, video ? {season: video.season, episode: video.episode} : undefined)).url;
  } catch (e: any) {
    log(`#${index} resolve failed: ${e?.message || e}`);
    return {ok: false, url: ''};
  }
  if (!candidate.traits.torrent) {
    const pre = await preflightStream(url, 3500);
    if (!pre.ok) {
      // Unreachable hosts are skipped for a few days; slow ones after a second timeout.
      log(`#${index} unreachable (${pre.reason}): ${hostOf(url)}`);
      const hostUrl = candidate.stream.url || url;
      (pre.reason === 'timed out' ? strikeHost(hostUrl) : markBadHost(hostUrl)).catch(() => undefined);
      return {ok: false, url};
    }
    url = pre.finalUrl;
  }
  if (!state.server) {
    return {ok: true, url};
  }
  const probe = await probeMedia(state.server, url, candidate.traits.torrent ? 12000 : 6000);
  if (!probe) {
    return {ok: true, url}; // Could not inspect: trust the ranking.
  }
  const verdict = probeVerdict(probe);
  log(`#${index} ${candidate.summary}: ${verdict.ok ? 'ok' : verdict.reason} fps=${verdict.frameRate} audio=${verdict.audioLanguage}`);
  return {ok: verdict.ok, url, frameRate: verdict.frameRate};
}

/** Checks candidates `parallel` at a time; returns the best-ranked one that passes. */
export async function pickStream(
  state: StremioState,
  meta: MetaDetail,
  video: Video | null,
  log: Log,
  startIndex = 0,
  parallel = 4,
): Promise<Pick | null> {
  const ranked = await rankedStreams(state, meta, video, log);
  for (let from = startIndex; from < ranked.length && from < startIndex + 12; from += parallel) {
    const batch = ranked.slice(from, from + parallel);
    const results: (Check | undefined)[] = new Array(batch.length).fill(undefined);
    const checks = batch.map((candidate, i) =>
      checkCandidate(state, video, candidate, from + i, log).then((r) => {
        results[i] = r;
        return r;
      }),
    );
    // Prefer the best-ranked passing candidate, but once any candidate has passed, give
    // higher-ranked ones that are still checking only a short grace period.
    const firstPass = new Promise<void>((resolve) => checks.forEach((c) => c.then((r) => r.ok && resolve())));
    const allDone = Promise.all(checks).then(() => undefined);
    await Promise.race([allDone, firstPass.then(() => Promise.race([allDone, delay(1200)]))]);
    const best = results.findIndex((r) => r?.ok);
    if (best >= 0) {
      const result = results[best] as Check;
      return {ranked, index: from + best, url: result.url, frameRate: result.frameRate};
    }
  }
  // Nothing passed the checks: fall back to the best-ranked remaining stream.
  if (startIndex < ranked.length) {
    const candidate = ranked[startIndex];
    try {
      const url = (await resolveStream(candidate.stream, state.server, video ? {season: video.season, episode: video.episode} : undefined)).url;
      return {ranked, index: startIndex, url};
    } catch {
      return null;
    }
  }
  return null;
}

/** Starts choosing in the background (title page opened); Play then usually has the answer ready. */
export function prefetchPick(state: StremioState, meta: MetaDetail, video: Video | null, log: Log): Promise<Pick | null> {
  const key = keyOf(meta, video);
  const cached = pickCache.get(key);
  if (cached && Date.now() - cached.at < FRESH_MS) {
    return cached.promise;
  }
  const promise = pickStream(state, meta, video, log);
  pickCache.set(key, {at: Date.now(), promise});
  promise.catch(() => pickCache.delete(key));
  return promise;
}

/** Forget a pick that failed in the player so the next attempt re-checks. */
export function forgetPick(meta: MetaDetail, video: Video | null): void {
  pickCache.delete(keyOf(meta, video));
}
