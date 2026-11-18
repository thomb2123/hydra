// Channel tuning, shared by the guide and the player. A source is "checked" by
// asking FlixNest for its stream and reading the playlist (placeholders such as
// "Maintenance" clips or black screens and dead links are rejected). Results are
// cached briefly, so a channel the viewer hovered over in the guide, or the
// channels either side of the one being watched, start straight away.
import * as fx from './flixnest';
import {MergedChannel, Source, sourceKey} from './channels';
import {recordResult} from './guide';
import {probeStream} from './probe';

export type CheckState = 'checking' | 'live' | 'placeholder' | 'dead' | 'refused' | 'failed';

export interface Status {
  state: CheckState;
  url?: string;
  mime?: string;
  /** Declared picture size of the best variant, e.g. "3840x2160". */
  resolution?: string;
}

export interface Tuned {
  source: Source;
  status: Status;
}

const LIVE_TTL_MS = 45 * 1000;
const BAD_TTL_MS = 90 * 1000;
const WINDOW = 3;
const GRACE_MS = 1500;

const cache = new Map<string, {at: number; status: Status}>();
const inflight = new Map<string, Promise<Status>>();

export function cachedStatus(s: Source): Status | null {
  const hit = cache.get(sourceKey(s));
  if (!hit) {
    return null;
  }
  const ttl = hit.status.state === 'live' ? LIVE_TTL_MS : BAD_TTL_MS;
  return Date.now() - hit.at < ttl ? hit.status : null;
}

/** Forgets a source's cached result (e.g. it stalled while playing). */
export function markFailed(s: Source): void {
  cache.set(sourceKey(s), {at: Date.now(), status: {state: 'failed'}});
}

/** Resolves one source and checks that it is really live. Throws only when sign-in is needed. */
export function checkSource(access: fx.Access, s: Source, log?: (line: string) => void): Promise<Status> {
  const key = sourceKey(s);
  const hit = cachedStatus(s);
  if (hit) {
    return Promise.resolve(hit);
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }
  const task = (async (): Promise<Status> => {
    let status: Status;
    try {
      const stream = await fx.play(access, s.id);
      const probe = await probeStream(stream.url);
      status = {state: probe.state, url: stream.url, mime: stream.mime, resolution: probe.resolution};
      if (probe.state !== 'live') {
        log?.(`tv ${s.provider} ${s.rawName}: ${probe.state} (${probe.why || ''})`);
      }
    } catch (e: any) {
      if (fx.needsSignIn(e)) {
        throw e;
      }
      status = {state: 'refused'};
    }
    if (status.state !== 'live') {
      recordResult(s, false).catch(() => undefined);
    }
    cache.set(key, {at: Date.now(), status});
    return status;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export interface FirstLiveOptions {
  onStatus?: (s: Source, status: Status) => void;
  /** Return false to stop starting new checks (the viewer moved on). */
  alive?: () => boolean;
  log?: (line: string) => void;
}

/**
 * The best-ranked source that is live. Checks run a few at a time in ranking
 * order; a lower-ranked live source wins only if the better ones are still
 * undecided after a short grace period, so a slow server never holds up the picture.
 */
export function firstLive(access: fx.Access, sources: Source[], opts: FirstLiveOptions = {}): Promise<Tuned | null> {
  return new Promise((resolve, reject) => {
    const results: (Status | undefined)[] = new Array(sources.length);
    let next = 0;
    let running = 0;
    let done = false;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const finish = (i: number) => {
      if (done) {
        return;
      }
      done = true;
      if (grace) {
        clearTimeout(grace);
      }
      resolve(i >= 0 ? {source: sources[i], status: results[i]!} : null);
    };
    const firstLiveIndex = () => results.findIndex((r) => r?.state === 'live');
    const settle = () => {
      if (done) {
        return;
      }
      const i = firstLiveIndex();
      if (i >= 0) {
        const betterPending = results.slice(0, i).some((r) => r === undefined);
        if (!betterPending) {
          finish(i);
        } else if (!grace) {
          grace = setTimeout(() => finish(firstLiveIndex()), GRACE_MS);
        }
        return;
      }
      if (next >= sources.length && running === 0) {
        finish(-1);
      }
    };
    const launch = () => {
      while (!done && running < WINDOW && next < sources.length) {
        if (opts.alive && !opts.alive()) {
          finish(-1);
          return;
        }
        const i = next++;
        running++;
        const s = sources[i];
        if (!cachedStatus(s)) {
          opts.onStatus?.(s, {state: 'checking'});
        }
        checkSource(access, s, opts.log)
          .then((status) => {
            running--;
            results[i] = status;
            opts.onStatus?.(s, status);
            settle();
            launch();
          })
          .catch((e) => {
            done = true;
            reject(e);
          });
      }
      settle();
    };
    if (!sources.length) {
      finish(-1);
      return;
    }
    launch();
  });
}

const prefetching = new Map<string, Promise<Tuned | null>>();

/** Quietly finds a channel's live source ahead of time; the result is cached for the player. */
export function prefetchChannel(access: fx.Access, channel: MergedChannel): Promise<Tuned | null> {
  const running = prefetching.get(channel.id);
  if (running) {
    return running;
  }
  const task = firstLive(access, channel.sources.slice(0, 4))
    .catch(() => null)
    .finally(() => prefetching.delete(channel.id));
  prefetching.set(channel.id, task);
  return task;
}

export function heightOf(resolution?: string): number {
  const m = /x(\d+)/.exec(resolution || '');
  return m ? Number(m[1]) : 0;
}
