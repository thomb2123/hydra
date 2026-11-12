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
const AHEAD_SECONDS = 30;
const BEHIND_SECONDS = 20;

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

  const append = async (sb: any, data: Uint8Array) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (sb.updating) {
          await waitFor(sb, 'updateend');
        }
        sb.appendBuffer(data);
        await waitFor(sb, 'updateend');
        return;
      } catch (e: any) {
        if (/quota/i.test(String(e?.name || e?.message || e)) && attempt < 2) {
          await trimBehind(true);
          continue;
        }
        throw e;
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
  const trimBehind = async (force = false) => {
    const now = Number(player.currentTime) || 0;
    const cut = now - (force ? 5 : BEHIND_SECONDS);
    if (cut > trimmedTo + (force ? 0 : 10)) {
      await removeRange(vsb, 0, cut);
      await removeRange(asb, 0, cut);
      trimmedTo = cut;
    }
  };

  await append(vsb, remux.video.init);
  if (asb && remux.audio) {
    await append(asb, remux.audio.init);
  }

  let generation = 0;
  let current: RangeRequest | null = null;
  let bufferedEnd = 0;
  let closed = false;

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
    while (!closed && gen === generation) {
      // Back-pressure: keep about AHEAD_SECONDS buffered.
      const now = Number(player.currentTime) || 0;
      if (bufferedEnd - now > AHEAD_SECONDS) {
        await trimBehind();
        await delay(500);
        continue;
      }
      // Parse every complete cluster we already have.
      let pos = 0;
      for (;;) {
        const cluster = parseCluster(pending, pos, pendingBase, info.timecodeScale, wanted);
        if (!cluster) {
          break;
        }
        handleFrames(cluster.frames);
        const seg = remux.fragment(cluster.frames);
        if (gen !== generation) {
          return;
        }
        if (seg.video) {
          await append(vsb, seg.video);
        }
        if (seg.audio && asb) {
          await append(asb, seg.audio);
        }
        if (seg.end) {
          bufferedEnd = Math.max(bufferedEnd, seg.end);
        }
        pos = cluster.end - pendingBase;
      }
      if (pos > 0) {
        pending = pending.slice(pos);
        pendingBase += pos;
      } else if (pending.length > 0 && readHeader(pending, 0)?.id !== 0x1f43b675) {
        // Not at a cluster boundary (e.g. Void/Tags between clusters): skip to the next one.
        const next = findNextCluster(pending, 1);
        if (next > 0) {
          pending = pending.slice(next);
          pendingBase += next;
          continue;
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
        log('mkv: reached end of file');
        return;
      }
      const next = Math.min(offset + CHUNK - 1, Number.isFinite(fileEnd) ? fileEnd - 1 : offset + CHUNK - 1);
      current = fetchRange(url, offset, next);
      let chunk: Uint8Array;
      try {
        chunk = await current.promise;
      } catch (e: any) {
        if (gen !== generation || closed) {
          return;
        }
        log(`mkv: read failed at ${offset} (${e?.message || e}), retrying`);
        await delay(1000);
        continue;
      }
      if (gen !== generation) {
        return;
      }
      pending = concatBytes(pending, chunk);
      offset += chunk.length;
      if (chunk.length === 0) {
        offset = fileEnd;
      }
    }
  };

  const start = async (time: number, preloaded?: Uint8Array) => {
    const gen = ++generation;
    current?.abort();
    remux.reset();
    offset = clusterAt(time);
    if (preloaded) {
      pending = preloaded;
      pendingBase = offset;
      offset += preloaded.length;
    } else {
      pending = new Uint8Array(0);
      pendingBase = offset;
    }
    bufferedEnd = 0;
    pump(gen).catch((e: any) => log(`mkv: pump stopped (${e?.message || e})`));
  };

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
      // Drop everything buffered and refill from the cluster before `t`.
      (async () => {
        generation++;
        current?.abort();
        const all = (info.duration || 0) + 3600;
        await removeRange(vsb, 0, all);
        await removeRange(asb, 0, all);
        trimmedTo = 0;
        try {
          player.currentTime = t;
        } catch {
          // Ignore.
        }
        await start(t);
        log(`mkv: seek to ${t.toFixed(1)} (cluster at byte ${offset})`);
      })().catch((e: any) => log(`mkv: seek failed (${e?.message || e})`));
    },
    unload() {
      closed = true;
      generation++;
      current?.abort();
    },
  };
}
