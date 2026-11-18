// Matroska -> fragmented MP4 repackaging (no re-encoding). Video keeps its
// HEVC/AVC bitstream and HDR; audio keeps E-AC-3 (Atmos), AC-3 or AAC.
import {EncodedConfig, audioConfig, videoConfig} from './codecs';
import {Sample, initSegment, mediaSegment} from './fmp4';
import {Frame, Track} from './matroska';

export interface RemuxTrack {
  track: Track;
  config: EncodedConfig;
  init: Uint8Array;
  trackId: number;
}

export class MkvRemuxer {
  readonly video: RemuxTrack | null;
  audio: RemuxTrack | null = null;
  private readonly audioTrack: Track | null;
  private sequence = 1;
  private lastVideoDts = -Infinity;
  /** How far decode runs ahead of display (B-frame reordering), in timescale ticks. */
  private reorderDelay = 0;

  constructor(videoTrack: Track | null, audioTrack: Track | null) {
    const vc = videoTrack ? videoConfig(videoTrack) : null;
    this.video = videoTrack && vc ? {track: videoTrack, config: vc, init: initSegment({id: 1, kind: 'video', timescale: vc.timescale, sampleEntry: vc.sampleEntry, width: videoTrack.width, height: videoTrack.height}), trackId: 1} : null;
    this.audioTrack = audioTrack;
  }

  /** Audio needs its first frame to describe Dolby streams; call with the first frames seen. */
  prepareAudio(frames: Frame[]): RemuxTrack | null {
    if (this.audio || !this.audioTrack) {
      return this.audio;
    }
    const first = frames.find((f) => f.track === this.audioTrack!.number);
    if (!first && !this.audioTrack.codecId.startsWith('A_AAC')) {
      return null;
    }
    const ac = audioConfig(this.audioTrack, first?.data);
    if (ac) {
      this.audio = {track: this.audioTrack, config: ac, init: initSegment({id: 2, kind: 'audio', timescale: ac.timescale, sampleEntry: ac.sampleEntry}), trackId: 2};
    }
    return this.audio;
  }

  /** Call after a seek: timestamps restart from wherever the new data begins. */
  reset(): void {
    this.lastVideoDts = -Infinity;
  }

  /** Builds media segments for the frames of one cluster (in file order). */
  fragment(frames: Frame[]): {video?: Uint8Array; audio?: Uint8Array; start?: number; end?: number} {
    const out: {video?: Uint8Array; audio?: Uint8Array; start?: number; end?: number} = {};
    if (this.video) {
      const vf = frames.filter((f) => f.track === this.video!.track.number);
      if (vf.length) {
        const seg = this.videoSegment(vf);
        out.video = seg.data;
        out.start = seg.start;
        out.end = seg.end;
      }
    }
    if (this.audio) {
      const af = frames.filter((f) => f.track === this.audio!.track.number);
      if (af.length) {
        out.audio = this.audioSegment(af);
      }
    }
    return out;
  }

  private videoSegment(frames: Frame[]): {data: Uint8Array; start: number; end: number} {
    const v = this.video as RemuxTrack;
    const ts = v.config.timescale;
    const frameTicks = Math.round(v.config.frameDuration * ts);
    // Matroska stores times in whole milliseconds, so 23.976 fps frames arrive 41, 42, 42 ms
    // apart instead of 41.708: against a display refreshing at exactly the film's rate that
    // jitter repeats or drops a frame now and then (micro-stutter). Snap every frame to the
    // exact frame grid from the track's declared frame duration, as proper demuxers do.
    const grid = v.config.frameDuration;
    const pts = frames.map((f) => Math.round((grid > 0 ? Math.round(f.pts / grid) * grid : f.pts) * ts));
    // Frames are stored in decode order with presentation times. Decode times are the
    // sorted presentation times moved earlier by the reorder delay, so no frame is due for
    // decoding after it should be on screen (B-frames otherwise arrive late and are shown
    // unevenly - a "slideshow" with no buffering). Kept strictly increasing across fragments.
    const sorted = [...pts].sort((a, b) => a - b);
    let delay = 0;
    for (let i = 0; i < sorted.length; i++) {
      delay = Math.max(delay, sorted[i] - pts[i]);
    }
    this.reorderDelay = Math.max(this.reorderDelay, delay);
    const dts: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const prev = i === 0 ? this.lastVideoDts : dts[i - 1];
      dts.push(Math.max(sorted[i] - this.reorderDelay, prev + 1, 0));
    }
    this.lastVideoDts = dts[dts.length - 1];
    const samples: Sample[] = frames.map((f, i) => ({
      data: f.data,
      prefix: v.track.strippedHeader,
      duration: i + 1 < dts.length ? dts[i + 1] - dts[i] : frameTicks,
      cto: pts[i] - dts[i],
      keyframe: f.keyframe,
    }));
    const data = mediaSegment(v.trackId, this.sequence++, Math.max(0, dts[0]), samples, true);
    return {data, start: sorted[0] / ts, end: (sorted[sorted.length - 1] + frameTicks) / ts};
  }

  private audioSegment(frames: Frame[]): Uint8Array {
    const a = this.audio as RemuxTrack;
    const ts = a.config.timescale;
    const frameTicks = Math.round(a.config.frameDuration * ts);
    const times = frames.map((f) => Math.round(f.pts * ts));
    // Laced frames share a timestamp: spread them one frame apart.
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        times[i] = times[i - 1] + frameTicks;
      }
    }
    const samples: Sample[] = frames.map((f, i) => ({
      data: f.data,
      prefix: a.track.strippedHeader,
      duration: i + 1 < times.length ? times[i + 1] - times[i] : frameTicks,
      cto: 0,
      keyframe: true,
    }));
    return mediaSegment(a.trackId, this.sequence++, Math.max(0, times[0]), samples, false);
  }
}

/** Picks the audio track: preferred language, then a codec MSE can take, then the default. */
export function chooseAudioTrack(tracks: Track[], preferred: string[] = ['eng', 'en']): Track | null {
  const audio = tracks.filter((t) => t.kind === 'audio');
  const supported = (t: Track) => t.codecId === 'A_EAC3' || t.codecId === 'A_AC3' || t.codecId.startsWith('A_AAC');
  const rank = (t: Track) =>
    (preferred.includes(t.language.toLowerCase()) ? 0 : t.language === 'und' ? 1 : 2) * 10 +
    (supported(t) ? 0 : 5) +
    (t.codecId === 'A_EAC3' ? 0 : t.codecId === 'A_AC3' ? 1 : 2) +
    (t.isDefault ? 0 : 0.5) +
    (/commentary|description/i.test(t.name || '') ? 20 : 0);
  return audio.filter(supported).sort((a, b) => rank(a) - rank(b))[0] || null;
}

export function chooseVideoTrack(tracks: Track[]): Track | null {
  return tracks.find((t) => t.kind === 'video' && (t.codecId === 'V_MPEGH/ISO/HEVC' || t.codecId === 'V_MPEG4/ISO/AVC')) || null;
}
