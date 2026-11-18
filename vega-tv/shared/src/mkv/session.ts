// Streams a Matroska file over HTTP into the platform's Media Source Extensions:
// byte ranges -> clusters -> fragmented MP4 -> SourceBuffers. Gives seeking,
// resume and audio-language choice on players whose URL mode cannot seek MKV.
import {CuePoint, SegmentInfo, Track, findNextCluster, parseCluster, parseCues, parseHead, parseInfoInto, parseTracks} from './matroska';
import {readHeader, readUtf8} from './ebml';
import {MkvRemuxer, chooseAudioTrack, chooseVideoTrack} from './remux';

type Log = (line: string) => void;

export interface EmbeddedCue {
  start: number;
  end: number;
  text: string;
}

export interface EmbeddedSubtitleTrack {
  number: number;
  language: string;
  name?: string;
  forced: boolean;
  /** Filled progressively as the file is read; kept sorted by start time. */
  cues: EmbeddedCue[];
}

export interface MkvSessionInfo {
  duration: number;
  videoLabel: string;
  audioLabel: string;
  audioLanguage: string;
  subtitles: EmbeddedSubtitleTrack[];
}

export interface MkvSession {
  info: MkvSessionInfo;
  seek(time: number): void;
  unload(): void;
}

export interface MkvOptions {
  startAt?: number;
  log: Log;
  preferredAudio?: string[];
  /** Called when new subtitle cues arrive (to refresh what is on screen). */
  onSubtitles?: () => void;
}

const CHUNK = 4 * 1024 * 1024;
// Small first read so the picture appears quickly; later reads are larger.
const FIRST_CHUNK = 2 * 1024 * 1024;
// How much to keep buffered. The stick's media buffer is small, so the look-ahead is
// limited by bytes as well as seconds (a 4K remux can be 60+ Mbit/s), and played
// data is removed steadily, cut at cluster (keyframe) boundaries.
const AHEAD_SECONDS = 20;
const MIN_AHEAD_SECONDS = 6;
const AHEAD_BYTES = 64 * 1024 * 1024;
const BEHIND_SECONDS = 8;
// Watchdog: how long the clock may stand still while playing before it steps in.
const STALL_GAP_MS = 2500;
const STALL_RESTART_MS = 8000;

interface Appended {
  start: number;
  end: number;
  bytes: number;
  /** Starts with a keyframe: a safe place to cut. */
  key: boolean;
}

/** End of the buffered range that contains `t` (or t itself if none does). */
export function bufferedEndAt(ranges: {start: number; end: number}[], t: number): number {
  for (const r of ranges) {
    if (r.start <= t + 0.25 && r.end > t) {
      return r.end;
    }
  }
  return t;
}

/** Start of the next buffered range just after `t` (a gap the player cannot cross on its own). */
export function nextRangeAfter(ranges: {start: number; end: number}[], t: number, within = 3): number | null {
  for (const r of ranges) {
    if (r.start > t + 0.05 && r.start - t <= within && r.end > r.start) {
      return r.start;
    }
  }
  return null;
}

/** Latest cut point (a fragment start, i.e. a keyframe) at or before `limit`. */
export function trimPoint(appended: Appended[], limit: number): number {
  let cut = 0;
  for (const a of appended) {
    if (a.key && a.start <= limit && a.start > cut) {
      cut = a.start;
    }
  }
  return cut;
}

function rangesOf(sb: any): {start: number; end: number}[] {
  try {
    const b = sb?.buffered;
    if (!b || typeof b.length !== 'number') {
      return [];
    }
    const out: {start: number; end: number}[] = [];
    for (let i = 0; i < b.length; i++) {
      out.push({start: b.start(i), end: b.end(i)});
    }
    return out;
  } catch {
    return [];
  }
}

/** Ranges buffered in both the video and audio buffers (playback needs both). */
function intersect(a: {start: number; end: number}[], b: {start: number; end: number}[] | null): {start: number; end: number}[] {
  if (!b) {
    return a;
  }
  const out: {start: number; end: number}[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) {
        out.push({start, end});
      }
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

interface RangeRequest {
  promise: Promise<Uint8Array>;
  abort: () => void;
}

/** Byte range over XHR (Vega's fetch buffers whole bodies; XHR gives binary ranges). */
function fetchRange(url: string, start: number, end: number, timeoutMs = 20000): RangeRequest {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    const timer = setTimeout(() => {
      xhr.abort();
      reject(new Error('range request timed out'));
    }, timeoutMs);
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('Range', `bytes=${start}-${end}`);
    xhr.onload = () => {
      clearTimeout(timer);
      if (xhr.status === 206 || xhr.status === 200) {
        const body = new Uint8Array(xhr.response as ArrayBuffer);
        // A 200 means the server ignored the range: keep only what was asked for.
        resolve(xhr.status === 200 ? body.subarray(start, end + 1) : body);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      reject(new Error('network error'));
    };
    xhr.onabort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    xhr.send();
  });
  return {promise, abort: () => xhr.abort()};
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) {
    return b;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function waitFor(target: any, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${event} timed out`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`${event} failed`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent);
    target.addEventListener('error', onError);
  });
}

function cleanSubtitle(text: string): string {
  return text
    .replace(/<\/?(?:i|b|u|font)[^>]*>/gi, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, '\n')
    .trim();
}

function insertCue(list: EmbeddedCue[], cue: EmbeddedCue): void {
  // Usually appended in order; handle out-of-order (after seeks) with a short scan.
  let i = list.length;
  while (i > 0 && list[i - 1].start > cue.start) {
    i--;
  }
  if (i > 0 && list[i - 1].start === cue.start && list[i - 1].text === cue.text) {
    return; // duplicate (re-read after a seek)
  }
  list.splice(i, 0, cue);
}

/**
 * Opens `url` as Matroska through MSE on `player`. Resolves to null when the file
 * is not Matroska or its codecs cannot go through MSE (the caller then uses URL mode).
 */
export async function openMkv(player: any, url: string, options: MkvOptions, deps: {MediaSource: any}): Promise<MkvSession | null> {
  const {log} = options;
  const began = Date.now();
  let head = await fetchRange(url, 0, 512 * 1024 - 1).promise;
  const parsed = parseHead(head);
  if (!parsed) {
    log('mkv: not a Matroska file');
    return null;
  }
  const info: SegmentInfo = parsed;
  // Tracks/Info can sit beyond the first bytes; fetch them via the SeekHead positions.
  const readElementAt = async (offset: number): Promise<Uint8Array> => {
    const first = await fetchRange(url, offset, offset + 64 * 1024 - 1).promise;
    const h = readHeader(first, 0);
    if (!h) {
      return first;
    }
    const total = h.headerLength + h.size;
    return total <= first.length ? first : fetchRange(url, offset, offset + total - 1).promise;
  };
  if (!info.tracks.length && parsed.tracksOffset) {
    const el = await readElementAt(parsed.tracksOffset);
    const h = readHeader(el, 0);
    if (h) {
      info.tracks = parseTracks(el, h.dataStart, h.dataStart + h.size);
    }
  }
  if (!info.duration && parsed.infoOffset) {
    const el = await readElementAt(parsed.infoOffset);
    const h = readHeader(el, 0);
    if (h) {
      parseInfoInto(el, h.dataStart, h.dataStart + h.size, info);
    }
  }
  const videoTrack = chooseVideoTrack(info.tracks);
  const audioTrack = chooseAudioTrack(info.tracks, options.preferredAudio);
  const remux = new MkvRemuxer(videoTrack, audioTrack);
  if (!remux.video) {
    log(`mkv: video codec not supported via MSE (${info.tracks.map((t) => t.codecId).join(',')})`);
    return null;
  }
  const MS = deps.MediaSource;
  if (MS.isTypeSupported && !MS.isTypeSupported(remux.video.config.mime)) {
    log(`mkv: platform rejects ${remux.video.config.mime}`);
    return null;
  }

  // The seek index and (when starting from the beginning) the first video are fetched
  // in parallel, so playback can begin after roughly one round trip.
  const startAtRequested = options.startAt && options.startAt > 1 ? options.startAt : 0;
  const earlyStart = !startAtRequested && info.firstClusterOffset != null ? info.firstClusterOffset : null;
  const earlyChunk = earlyStart != null ? fetchRange(url, earlyStart, earlyStart + FIRST_CHUNK - 1).promise : null;
  earlyChunk?.catch(() => undefined);
  let cues: CuePoint[] = [];
  if (info.cuesOffset) {
    try {
      cues = parseCues(await readElementAt(info.cuesOffset), info.segmentStart, info.timecodeScale, videoTrack?.number);
    } catch (e: any) {
      log(`mkv: cues unavailable (${e?.message || e})`);
    }
  }
  const firstCluster = info.firstClusterOffset ?? (cues.length ? cues[0].offset : findNextCluster(head, 0));
  const fileEnd = info.cuesOffset && info.cuesOffset > firstCluster ? info.cuesOffset : Infinity;
  head = new Uint8Array(0);

  const subtitleTracks: EmbeddedSubtitleTrack[] = info.tracks
    .filter((t: Track) => t.kind === 'subtitle' && t.codecId === 'S_TEXT/UTF8')
    .map((t) => ({number: t.number, language: t.language, name: t.name, forced: t.isForced, cues: []}));
  const wanted = new Set<number>([remux.video.track.number, ...(audioTrack ? [audioTrack.number] : []), ...subtitleTracks.map((s) => s.number)]);

  const clusterAt = (time: number): number => {
    if (!cues.length) {
      return firstCluster;
    }
    let best = cues[0].offset;
    for (const c of cues) {
      if (c.time <= time + 0.01) {
        best = c.offset;
      } else {
        break;
      }
    }
    return best;
  };

  // MediaSource setup: the audio description needs a real frame, so read the first cluster first.
  const startAt = startAtRequested;
  let offset = clusterAt(startAt);
  let pending = new Uint8Array(0);
  let pendingBase = offset;
  let firstChunk = earlyChunk && offset === earlyStart ? await earlyChunk : await fetchRange(url, offset, offset + FIRST_CHUNK - 1).promise;
  let first = parseCluster(firstChunk, 0, pendingBase, info.timecodeScale, wanted);
  // A large first cluster may need one more read before the audio can be described.
  for (let extra = 0; !first && extra < 3; extra++) {
    const more = await fetchRange(url, offset + firstChunk.length, offset + firstChunk.length + CHUNK - 1).promise;
    firstChunk = concatBytes(firstChunk, more);
    first = parseCluster(firstChunk, 0, pendingBase, info.timecodeScale, wanted);
  }
  pending = firstChunk;
  if (first) {
    remux.prepareAudio(first.frames);
  }
  if (audioTrack && !remux.audio) {
    log(`mkv: audio codec not supported via MSE (${audioTrack.codecId})`);
    return null;
  }
  if (remux.audio && MS.isTypeSupported && !MS.isTypeSupported(remux.audio.config.mime)) {
    log(`mkv: platform rejects ${remux.audio.config.mime}`);
    return null;
  }

  const ms = new MS();
  // Vega fires "sourceopen" synchronously while attaching, so listen first and
  // also accept an already-open source.
  const opened = waitFor(ms, 'sourceopen');
  opened.catch(() => undefined);
  player.srcObject = ms;
  if (ms.readyState !== 'open') {
    await opened;
  }
  try {
    ms.duration = info.duration || 0;
  } catch {
    // Some players set duration from the media.
  }
  const vsb = ms.addSourceBuffer(remux.video.config.mime);
  const asb = remux.audio ? ms.addSourceBuffer(remux.audio.config.mime) : null;

  // Appends one piece, retrying the same bytes: when the buffer is full, wait for
  // playback to use some of it (trimming what has been watched); other errors get a
  // few quick retries. Throws only if the piece cannot be written at all.
  const append = async (sb: any, data: Uint8Array) => {
    let errors = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        if (sb.updating) {
          await waitFor(sb, 'updateend');
        }
        sb.appendBuffer(data);
        await waitFor(sb, 'updateend');
        return;
      } catch (e: any) {
        if (closed) {
          throw e;
        }
        if (/quota/i.test(String(e?.name || e?.message || e))) {
          learnQuota();
          // Trimming has not made room and the picture is about to run dry: the
          // platform is holding on to watched video. Start fresh at this spot (what
          // skipping did by hand) instead of letting the picture freeze.
          const left = bufferedEnd - (Number(player.currentTime) || 0);
          if (attempt >= 40 || (attempt >= 2 && left < 4)) {
            const full = new Error(`buffer full with ${left.toFixed(1)} s left`);
            full.name = 'BufferStuck';
            throw full;
          }
          await trimBehind(true);
          await delay(500);
          continue;
        }
        if (++errors >= 3) {
          throw e;
        }
        await delay(300);
      }
    }
  };
  const removeRange = async (sb: any, start: number, end: number) => {
    if (!sb || end <= start) {
      return;
    }
    try {
      if (sb.updating) {
        await waitFor(sb, 'updateend');
      }
      sb.remove(start, end);
      await waitFor(sb, 'updateend');
    } catch {
      // Nothing to remove.
    }
  };
  let trimmedTo = 0;
  let appended: Appended[] = [];
  const trimBehind = async (force = false) => {
    const now = Number(player.currentTime) || 0;
    // Cut at a fragment start so no frame the picture still depends on is removed.
    const cut = trimPoint(appended, now - (force ? 1.5 : BEHIND_SECONDS));
    if (cut > trimmedTo + (force ? 0 : 4)) {
      await removeRange(vsb, 0, cut);
      await removeRange(asb, 0, cut);
      trimmedTo = cut;
      appended = appended.filter((a) => a.end > cut);
    }
  };
  // The look-ahead budget shrinks to what the platform really accepts: after a
  // "buffer full" error it is set a little under the amount that was buffered.
  let aheadBytes = AHEAD_BYTES;
  const learnQuota = () => {
    const held = appended.reduce((sum, a) => sum + a.bytes, 0);
    const next = Math.max(1024 * 1024, Math.floor(held * 0.6));
    if (next < aheadBytes) {
      aheadBytes = next;
      log(`mkv: buffer limit reached at ${(held / 1048576).toFixed(1)} MB; keeping about ${(next / 1048576).toFixed(1)} MB ahead from now on`);
    }
  };
  const bytesAhead = (now: number) => appended.reduce((sum, a) => (a.end > now ? sum + a.bytes : sum), 0);
  const playable = () => intersect(rangesOf(vsb), asb ? rangesOf(asb) : null);

  await append(vsb, remux.video.init);
  if (asb && remux.audio) {
    await append(asb, remux.audio.init);
  }

  let generation = 0;
  let current: RangeRequest | null = null;
  let bufferedEnd = 0;
  let closed = false;
  let pumping = false;
  let ended = false;
  let restartedAt = 0;

  const handleFrames = (frames: {track: number; pts: number; duration?: number; data: Uint8Array}[]) => {
    let added = false;
    for (const f of frames) {
      const sub = subtitleTracks.find((s) => s.number === f.track);
      if (sub) {
        const text = cleanSubtitle(readUtf8(f.data, 0, f.data.length));
        if (text) {
          insertCue(sub.cues, {start: f.pts, end: f.pts + (f.duration || 3), text});
          added = true;
        }
      }
    }
    if (added) {
      options.onSubtitles?.();
    }
  };

  const pump = async (gen: number) => {
    pumping = true;
    let failures = 0;
    try {
      while (!closed && gen === generation) {
        try {
          const done = await pumpOnce(gen);
          failures = 0;
          if (done) {
            return;
          }
        } catch (e: any) {
          if (closed || gen !== generation) {
            return;
          }
          // A failed append used to stop reading for good (the picture froze once the
          // buffer ran dry, until the viewer skipped). Now: free space and carry on.
          if (e?.name === 'BufferStuck') {
            log(`mkv: the player did not free watched video (${e.message}); refreshing at the current position`);
            restart();
            return;
          }
          failures++;
          log(`mkv: buffer write failed (${e?.message || e}); recovering (${failures})`);
          await trimBehind(true).catch(() => undefined);
          await delay(Math.min(4000, 500 * failures));
          if (failures >= 4) {
            log('mkv: restarting the stream at the current position');
            restart();
            return;
          }
        }
      }
    } finally {
      if (gen === generation) {
        pumping = false;
      }
    }
  };

  /** One step of reading: returns true at the end of the file. */
  const pumpOnce = async (gen: number): Promise<boolean> => {
    {
      // Back-pressure: keep up to AHEAD_SECONDS (and at most AHEAD_BYTES) buffered,
      // but always at least a few seconds so high-bitrate files never starve.
      const now = Number(player.currentTime) || 0;
      await trimBehind();
      const ahead = bufferedEnd - now;
      if (ahead > MIN_AHEAD_SECONDS && (ahead > AHEAD_SECONDS || bytesAhead(now) > aheadBytes)) {
        await delay(400);
        return false;
      }
      // Parse the complete clusters we already have, one at a time, checking for room
      // before each. Each cluster is converted once and marked as read before it is
      // written, so a retry never feeds the same frames through the converter twice.
      let parsed = 0;
      for (;;) {
        const t = Number(player.currentTime) || 0;
        const room = bufferedEnd - t;
        if (parsed > 0 && room > MIN_AHEAD_SECONDS && (room > AHEAD_SECONDS || bytesAhead(t) > aheadBytes)) {
          return false;
        }
        const cluster = parseCluster(pending, 0, pendingBase, info.timecodeScale, wanted);
        if (!cluster) {
          break;
        }
        parsed++;
        pending = pending.subarray(cluster.end - pendingBase);
        pendingBase = cluster.end;
        handleFrames(cluster.frames);
        const seg = remux.fragment(cluster.frames);
        if (gen !== generation) {
          return true;
        }
        try {
          if (seg.video) {
            await append(vsb, seg.video);
          }
          if (seg.audio && asb) {
            await append(asb, seg.audio);
          }
        } catch (e: any) {
          if (gen !== generation || closed) {
            return true;
          }
          // This piece could not be written: skip it (the watchdog steps over the small
          // gap) rather than stopping or re-converting it.
          log(`mkv: skipped a piece at ${(seg.start ?? 0).toFixed(1)} s (${e?.message || e})`);
          throw e;
        }
        if (seg.end) {
          bufferedEnd = Math.max(bufferedEnd, seg.end);
          const firstVideo = cluster.frames.find((f) => f.track === remux.video!.track.number);
          appended.push({start: seg.start ?? seg.end, end: seg.end, bytes: (seg.video?.length || 0) + (seg.audio?.length || 0), key: !!firstVideo?.keyframe});
        }
      }
      if (parsed > 0) {
        pending = pending.slice(0);
      } else if (pending.length > 0 && readHeader(pending, 0)?.id !== 0x1f43b675) {
        // Not at a cluster boundary (e.g. Void/Tags between clusters): skip to the next one.
        const next = findNextCluster(pending, 1);
        if (next > 0) {
          pending = pending.slice(next);
          pendingBase += next;
          return false;
        }
      }
      if (offset >= fileEnd) {
        // Everything up to the Cues (end of the clusters) has been read and parsed.
        try {
          if (asb?.updating || vsb.updating) {
            await delay(200);
          }
          ms.endOfStream();
        } catch {
          // Already ended.
        }
        ended = true;
        log('mkv: reached end of file');
        return true;
      }
      const next = Math.min(offset + CHUNK - 1, Number.isFinite(fileEnd) ? fileEnd - 1 : offset + CHUNK - 1);
      current = fetchRange(url, offset, next);
      let chunk: Uint8Array;
      try {
        chunk = await current.promise;
      } catch (e: any) {
        if (gen !== generation || closed) {
          return true;
        }
        log(`mkv: read failed at ${offset} (${e?.message || e}), retrying`);
        await delay(1000);
        return false;
      }
      if (gen !== generation) {
        return true;
      }
      pending = concatBytes(pending, chunk);
      offset += chunk.length;
      if (chunk.length === 0) {
        offset = fileEnd;
      }
      return false;
    }
  };

  const start = async (time: number, preloaded?: Uint8Array, base?: number) => {
    const gen = ++generation;
    current?.abort();
    remux.reset();
    offset = base ?? clusterAt(time);
    if (preloaded) {
      pending = preloaded;
      pendingBase = offset;
      offset += preloaded.length;
    } else {
      pending = new Uint8Array(0);
      pendingBase = offset;
    }
    bufferedEnd = 0;
    ended = false;
    pump(gen).catch((e: any) => log(`mkv: pump stopped (${e?.message || e})`));
  };

  /** Drop everything buffered and refill from the cluster before `time`. */
  const reload = async (time: number) => {
    generation++;
    current?.abort();
    const all = (info.duration || 0) + 3600;
    await removeRange(vsb, 0, all);
    await removeRange(asb, 0, all);
    trimmedTo = 0;
    appended = [];
    try {
      player.currentTime = time;
    } catch {
      // Ignore.
    }
    await start(time);
  };
  /**
   * Starts fresh at the current spot with as little interruption as possible: the
   * next part of the film is downloaded while the old buffer is still playing,
   * and only then is the buffer cleared and refilled, without stepping back.
   */
  const refreshInPlace = async () => {
    const gen = ++generation;
    current?.abort();
    restartedAt = Date.now();
    seekingUntil = restartedAt + 6000;
    const base = clusterAt(Number(player.currentTime) || 0);
    let chunk: Uint8Array | null = null;
    for (let attempt = 0; attempt < 3 && !chunk && !closed; attempt++) {
      try {
        current = fetchRange(url, base, base + FIRST_CHUNK - 1);
        chunk = await current.promise;
      } catch {
        await delay(300);
      }
    }
    if (closed || gen !== generation) {
      return;
    }
    const all = (info.duration || 0) + 3600;
    await removeRange(vsb, 0, all);
    await removeRange(asb, 0, all);
    trimmedTo = 0;
    appended = [];
    const t = Number(player.currentTime) || 0;
    try {
      player.currentTime = t;
    } catch {
      // Ignore.
    }
    await start(t, chunk || undefined, chunk ? base : undefined);
  };
  const restart = () => {
    refreshInPlace().catch((e: any) => log(`mkv: restart failed (${e?.message || e})`));
  };

  // Stall watchdog: if the clock stands still while playing, first jump any small gap
  // in the buffer, then restart reading if it stopped, then reload at the current
  // position (what skipping back and forth used to fix by hand).
  let lastTime = -1;
  let stillSince = 0;
  let seekingUntil = 0;
  // Only once the picture has actually moved: the first start has its own timeout.
  let progressed = false;
  const watchdog = setInterval(() => {
    if (closed) {
      return;
    }
    const t = Number(player.currentTime) || 0;
    const nowMs = Date.now();
    // Look ahead while playing: a hole in what is buffered (a piece the platform
    // dropped) is re-read before playback reaches it, so the picture never stops.
    if (progressed && !player.paused && nowMs >= seekingUntil && nowMs - restartedAt > 10000) {
      const ranges = playable();
      const end = bufferedEndAt(ranges, t);
      const after = nextRangeAfter(ranges, end, 60);
      if (after != null && after - end > 0.3 && end - t < 10) {
        log(`mkv: hole in the buffer at ${end.toFixed(1)} s (${(after - end).toFixed(1)} s); re-reading it before playback gets there`);
        restart();
        return;
      }
    }
    // A sliver missing right where playback is: step over it at once.
    if (!player.paused && nowMs >= seekingUntil && Math.abs(t - lastTime) <= 0.05 && nowMs - stillSince >= 600) {
      const tiny = nextRangeAfter(playable(), t, 1);
      if (tiny != null) {
        log(`mkv: stepping over a ${(tiny - t).toFixed(2)} s gap at ${t.toFixed(2)}`);
        try {
          player.currentTime = tiny + 0.05;
        } catch {
          // Ignore.
        }
        stillSince = nowMs;
        return;
      }
    }
    if (player.paused || nowMs < seekingUntil || Math.abs(t - lastTime) > 0.05 || !progressed) {
      if (lastTime >= 0 && Math.abs(t - lastTime) > 0.05 && !player.paused) {
        progressed = true;
      }
      lastTime = t;
      stillSince = nowMs;
      return;
    }
    const still = nowMs - stillSince;
    if (still < STALL_GAP_MS || (ended && info.duration && t > info.duration - 2)) {
      return;
    }
    const ranges = playable();
    const gap = nextRangeAfter(ranges, t, 30);
    if (gap != null && gap - t <= 1) {
      // A sliver missing: step over it (unnoticeable).
      log(`mkv: stalled at ${t.toFixed(2)}; skipping a ${(gap - t).toFixed(2)} s gap`);
      try {
        player.currentTime = gap + 0.05;
      } catch {
        // Ignore.
      }
      stillSince = nowMs;
      return;
    }
    if (gap != null && nowMs - restartedAt > 10000) {
      // A larger hole: re-read from here so nothing is skipped.
      log(`mkv: stalled at ${t.toFixed(2)} before a ${(gap - t).toFixed(1)} s hole; re-reading from here`);
      stillSince = nowMs;
      restart();
      return;
    }
    if (!pumping && !ended) {
      log(`mkv: stalled at ${t.toFixed(2)} and reading had stopped; restarting`);
      stillSince = nowMs;
      restart();
      return;
    }
    if (still >= STALL_RESTART_MS && nowMs - restartedAt > 20000) {
      log(`mkv: stalled at ${t.toFixed(2)} for ${Math.round(still / 1000)} s (buffered to ${bufferedEndAt(ranges, t).toFixed(1)}); reloading here`);
      stillSince = nowMs;
      restart();
    }
  }, 500);

  log(`mkv: ready in ${Date.now() - began} ms: ${remux.video.config.label} + ${remux.audio?.config.label || 'no audio'} (${audioTrack?.language}); ${cues.length} cues; ${subtitleTracks.length} subtitle tracks`);
  offset = clusterAt(startAt);
  await start(startAt, firstChunk);
  if (startAt > 0) {
    try {
      player.currentTime = startAt;
    } catch {
      // Will start at the first buffered frame.
    }
  }

  return {
    info: {
      duration: info.duration,
      videoLabel: remux.video.config.label,
      audioLabel: remux.audio?.config.label || '',
      audioLanguage: audioTrack?.language || '',
      subtitles: subtitleTracks,
    },
    seek(time: number) {
      const t = Math.max(0, Math.min(time, (info.duration || time) - 1));
      seekingUntil = Date.now() + 6000;
      reload(t)
        .then(() => log(`mkv: seek to ${t.toFixed(1)} (cluster at byte ${offset})`))
        .catch((e: any) => log(`mkv: seek failed (${e?.message || e})`));
    },
    unload() {
      closed = true;
      generation++;
      clearInterval(watchdog);
      current?.abort();
    },
  };
}
