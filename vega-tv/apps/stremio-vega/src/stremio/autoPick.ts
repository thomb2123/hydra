// Picks the stream to play, fast:
// - streams are fetched and ranked as soon as a title page opens (prefetch),
// - the leading candidates are checked in parallel (reachable, then English
//   first audio track / no DV-only / no TrueHD via the PC server),
// - the best-ranked candidate that passes wins.
import {StreamGroup, fetchStreams} from './addons';
import {badHosts, isBadHost, markBadHost, strikeHost} from './badHosts';
import {videoIdOf} from './playback';
import {preflightStream, probeMedia, probeVerdict, resolveStream} from './streaming';
import {RankedStream, rankStreams} from './streamPicker';
import {MetaDetail, Video} from './types';
import {StremioState} from '../state';
import {hostOf, requestJson} from '../../../../shared/src/net';
import {DEFAULT_BUDGET_MBPS, playableBudget} from '../../../../shared/src/netSpeed';

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
  const began = Date.now();
  const promise = (async () => {
    // Started together: the server check and bad-host list are ready long before the add-ons.
    const serverPromise = serverUp(state.server);
    const badPromise = badHosts().catch(() => new Set<string>());
    const arrived: {position: number; group: StreamGroup}[] = [];
    let total = 0;
    let onArrive = () => {};
    const everything = fetchStreams(state.addons, meta.type, videoIdOf(meta, video), (group, position, count) => {
      total = count;
      arrived.push({position, group});
      onArrive();
    });
    const [hasServer, bad, maxMbps] = await Promise.all([serverPromise, badPromise, playableBudget().catch(() => DEFAULT_BUDGET_MBPS)]);
    // Prefer versions this connection carries without stalling (file size over running time).
    const runtimeMin = runtimeMinutes(meta, video);
    const rankNow = (): RankedStream[] => {
      const groups = [...arrived].sort((a, b) => a.position - b.position).map((a) => a.group);
      const all = rankStreams(
        groups.map((g) => ({addonName: g.addon.manifest.name, streams: g.streams})),
        {hasServer},
      ).filter((r) => r.playable);
      // Hosts that failed before (e.g. blocked by the ISP) go to the back.
      return [...all.filter((r) => !isBadHost(r.stream.url, bad)), ...all.filter((r) => isBadHost(r.stream.url, bad))];
    };
    // Do not wait for the slowest add-on: once one has answered with something playable,
    // give the rest a short grace (shorter still when a top-quality stream is already in hand).
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let deadline = Infinity;
      const finish = () => {
        if (timer) {
          clearTimeout(timer);
        }
        resolve();
      };
      everything.then(finish, finish);
      onArrive = () => {
        const ranked = rankNow();
        if (!ranked.length) {
          return;
        }
        const wait = ranked.some((r) => isTopQuality(r)) ? STRONG_GRACE_MS : FIRST_RESULT_GRACE_MS;
        const next = Date.now() + wait;
        if (next < deadline) {
          deadline = next;
          if (timer) {
            clearTimeout(timer);
          }
          timer = setTimeout(finish, wait);
        }
      };
      onArrive(); // add-ons that answered while the server check ran
    });
    const ranked = rankNow();
    const waitingFor = total - arrived.length;
    log(
      `ranked ${ranked.length} streams in ${Date.now() - began} ms from ${arrived.length}/${total || arrived.length} add-ons` +
        `${waitingFor > 0 ? ` (not waiting for ${waitingFor})` : ''}; server ${hasServer ? 'up' : 'off'}; ${bad.size} bad hosts; ` +
        `top: ${ranked.slice(0, 4).map((r) => `${r.score}:${r.summary || '?'}`).join(' | ')}`,
    );
    if (waitingFor > 0) {
      // Late add-ons still count for the next attempt (fallbacks, re-picks).
      everything
        .then(() => {
          const complete = rankNow();
          rankCache.set(key, {at: began, promise: Promise.resolve(complete)});
        })
        .catch(() => undefined);
    }
    return ranked;
  })();
  rankCache.set(key, {at: began, promise});
  promise.catch(() => rankCache.delete(key));
  return promise;
}

/** Once one add-on has playable streams, how long the others get. */
const FIRST_RESULT_GRACE_MS = 2500;
/** As above, when a 4K HDR stream is already among them. */
const STRONG_GRACE_MS = 900;

function isTopQuality(r: RankedStream): boolean {
  return r.traits.resolution >= 2160 && (r.traits.hdr || r.traits.hdr10plus) && !r.traits.dolbyVisionOnly && !r.traits.torrent;
}

/**
 * Whether the optional PC streaming server answers (cached briefly). When it is off,
 * playback must not wait for probes through it, and torrents cannot play.
 */
const serverCache = new Map<string, {at: number; promise: Promise<boolean>}>();
export function serverUp(server: string | null | undefined): Promise<boolean> {
  if (!server) {
    return Promise.resolve(false);
  }
  const cached = serverCache.get(server);
  if (cached && Date.now() - cached.at < 60 * 1000) {
    return cached.promise;
  }
  const promise = requestJson(`${server.replace(/\/+$/, '')}/settings`, {timeoutMs: 1500})
    .then(() => true)
    .catch(() => false);
  serverCache.set(server, {at: Date.now(), promise});
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
      // A slow answer while other links start says nothing about the host; only a definite
      // refusal (DNS, connection, HTTP error) puts it on the bad list.
      if (pre.reason !== 'timed out') {
        markBadHost(hostUrl).catch(() => undefined);
      }
      return {ok: false, url};
    }
    url = pre.finalUrl;
  }
  if (!state.server || !(await serverUp(state.server))) {
    return {ok: true, url}; // No server to inspect with: trust the ranking.
  }
  const probe = await probeMedia(state.server, url, candidate.traits.torrent ? 12000 : 4000);
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
  // Add-ons whose links just failed to play are skipped (unless nothing else is left).
  const all: number[] = [];
  for (let i = startIndex; i < ranked.length; i++) {
    all.push(i);
  }
  const usable = all.filter((i) => !isAvoided(ranked[i].addonName));
  const order = (usable.length ? usable : all).slice(0, 12);
  if (usable.length < all.length) {
    log(`skipping ${all.length - usable.length} links from add-ons that just failed (${[...avoided.keys()].join(', ')})`);
  }
  for (let from = 0; from < order.length; from += parallel) {
    const batch = order.slice(from, from + parallel);
    const results: (Check | undefined)[] = new Array(batch.length).fill(undefined);
    const checks = batch.map((index, i) =>
      checkCandidate(state, video, ranked[index], index, log).then((r) => {
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
      return {ranked, index: batch[best], url: result.url, frameRate: result.frameRate};
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

/**
 * Add-ons whose links just failed in the player with a network-type error (server
 * name not found, connection refused, 5xx). Their other links usually fail the same
 * way, so the next attempt goes to a different add-on instead of looping through them.
 */
const avoided = new Map<string, number>();
const AVOID_MS = 30 * 60 * 1000;
const NETWORK_FAILURE = /resolve server name|network|connect|refused|timed out|timeout|HTTP [45]\d\d|\b5\d\d\b|not found|forbidden|could not open resource|internal data stream/i;

export function isAvoided(addonName: string): boolean {
  const until = avoided.get(addonName);
  if (until && until > Date.now()) {
    return true;
  }
  avoided.delete(addonName);
  return false;
}

/** Called when a chosen link failed to play; returns true when its add-on is now skipped. */
export function noteFailure(stream: RankedStream | undefined, reason: string): boolean {
  // A slow start is about that one link; only an unreachable or refusing server makes the
  // whole add-on wait (its other links go to the same server).
  if (!stream || !NETWORK_FAILURE.test(reason) || /timed out starting/i.test(reason)) {
    return false;
  }
  avoided.set(stream.addonName, Date.now() + AVOID_MS);
  if (stream.stream.url) {
    // A server name this network cannot resolve will not start resolving: one strike is enough
    // (kept across restarts). Other failures may be passing, so they take two.
    (/resolve server name|could not open resource/i.test(reason) ? markBadHost(stream.stream.url) : strikeHost(stream.stream.url)).catch(() => undefined);
  }
  return true;
}

/** Forget a pick that failed in the player so the next attempt re-checks. */
export function forgetPick(meta: MetaDetail, video: Video | null): void {
  pickCache.delete(keyOf(meta, video));
}

/** Forget the ranking too (e.g. the connection limit changed), so the next pick re-ranks. */
export function forgetRanking(meta: MetaDetail, video: Video | null): void {
  rankCache.delete(keyOf(meta, video));
}

/** Running time in minutes (from the listing, else a typical length). */
export function runtimeMinutes(meta: MetaDetail, video: Video | null): number {
  const text = String((video as any)?.runtime || meta.runtime || '');
  const hours = /(\d+)\s*h/i.exec(text);
  const mins = /(\d+)\s*m/i.exec(text);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0) || Number(text) || 0;
  return total > 0 ? total : meta.type === 'movie' ? 120 : 45;
}
