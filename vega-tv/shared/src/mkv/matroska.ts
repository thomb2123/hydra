// Matroska structure: segment header (SeekHead, Info, Tracks), the Cues seek
// index and frames inside Clusters. Only what streaming playback needs.
import {UNKNOWN_SIZE, children, readFloat, readHeader, readSignedVint, readString, readUint, readUtf8, readVint} from './ebml';

export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  FlagDefault: 0x88,
  FlagForced: 0x55aa,
  DefaultDuration: 0x23e383,
  Name: 0x536e,
  Language: 0x22b59c,
  LanguageBCP47: 0x22b59d,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  ContentEncodings: 0x6d80,
  ContentEncoding: 0x6240,
  ContentCompression: 0x5034,
  ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Colour: 0x55b0,
  MatrixCoefficients: 0x55b1,
  Range: 0x55b9,
  TransferCharacteristics: 0x55ba,
  Primaries: 0x55bb,
  MaxCLL: 0x55bc,
  MaxFALL: 0x55bd,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  ReferenceBlock: 0xfb,
};

export type TrackKind = 'video' | 'audio' | 'subtitle' | 'other';

export interface Colour {
  matrix?: number;
  transfer?: number;
  primaries?: number;
  range?: number;
  maxCLL?: number;
  maxFALL?: number;
}

export interface Track {
  number: number;
  kind: TrackKind;
  codecId: string;
  codecPrivate?: Uint8Array;
  language: string;
  name?: string;
  isDefault: boolean;
  isForced: boolean;
  /** Nanoseconds per frame, when declared. */
  defaultDurationNs?: number;
  /** Bytes stripped from the start of every frame (header-stripping compression). */
  strippedHeader?: Uint8Array;
  width?: number;
  height?: number;
  colour?: Colour;
  sampleRate?: number;
  channels?: number;
}

export interface CuePoint {
  /** Seconds. */
  time: number;
  /** Absolute byte offset of the cluster in the file. */
  offset: number;
}

export interface SegmentInfo {
  /** Absolute file offset where the Segment payload starts (positions are relative to this). */
  segmentStart: number;
  timecodeScale: number; // ns per timecode unit
  duration: number; // seconds
  tracks: Track[];
  /** Absolute offset of the Cues element, when listed in the SeekHead. */
  cuesOffset?: number;
  /** Absolute offset of the first Cluster seen in the header bytes. */
  firstClusterOffset?: number;
}

function trackKind(type: number): TrackKind {
  return type === 1 ? 'video' : type === 2 ? 'audio' : type === 17 ? 'subtitle' : 'other';
}

function parseColour(buf: Uint8Array, start: number, end: number): Colour {
  const colour: Colour = {};
  for (const el of children(buf, start, end)) {
    const v = readUint(buf, el.dataStart, el.size);
    switch (el.id) {
      case ID.MatrixCoefficients:
        colour.matrix = v;
        break;
      case ID.TransferCharacteristics:
        colour.transfer = v;
        break;
      case ID.Primaries:
        colour.primaries = v;
        break;
      case ID.Range:
        colour.range = v;
        break;
      case ID.MaxCLL:
        colour.maxCLL = v;
        break;
      case ID.MaxFALL:
        colour.maxFALL = v;
        break;
    }
  }
  return colour;
}

function parseTrack(buf: Uint8Array, start: number, end: number): Track {
  const track: Track = {number: 0, kind: 'other', codecId: '', language: 'eng', isDefault: true, isForced: false};
  for (const el of children(buf, start, end)) {
    const s = el.dataStart;
    switch (el.id) {
      case ID.TrackNumber:
        track.number = readUint(buf, s, el.size);
        break;
      case ID.TrackType:
        track.kind = trackKind(readUint(buf, s, el.size));
        break;
      case ID.FlagDefault:
        track.isDefault = readUint(buf, s, el.size) === 1;
        break;
      case ID.FlagForced:
        track.isForced = readUint(buf, s, el.size) === 1;
        break;
      case ID.DefaultDuration:
        track.defaultDurationNs = readUint(buf, s, el.size);
        break;
      case ID.Name:
        track.name = readUtf8(buf, s, el.size);
        break;
      case ID.Language:
        track.language = readString(buf, s, el.size) || 'und';
        break;
      case ID.LanguageBCP47:
        track.language = readString(buf, s, el.size).split('-')[0] || track.language;
        break;
      case ID.CodecID:
        track.codecId = readString(buf, s, el.size);
        break;
      case ID.CodecPrivate:
        track.codecPrivate = buf.slice(s, s + el.size);
        break;
      case ID.ContentEncodings:
        for (const enc of children(buf, s, s + el.size)) {
          for (const comp of children(buf, enc.dataStart, enc.dataStart + enc.size)) {
            if (comp.id !== ID.ContentCompression) {
              continue;
            }
            let algo = 0;
            let settings: Uint8Array | undefined;
            for (const c of children(buf, comp.dataStart, comp.dataStart + comp.size)) {
              if (c.id === ID.ContentCompAlgo) {
                algo = readUint(buf, c.dataStart, c.size);
              } else if (c.id === ID.ContentCompSettings) {
                settings = buf.slice(c.dataStart, c.dataStart + c.size);
              }
            }
            if (algo === 3 && settings) {
              track.strippedHeader = settings;
            }
          }
        }
        break;
      case ID.Video:
        for (const v of children(buf, s, s + el.size)) {
          if (v.id === ID.PixelWidth) {
            track.width = readUint(buf, v.dataStart, v.size);
          } else if (v.id === ID.PixelHeight) {
            track.height = readUint(buf, v.dataStart, v.size);
          } else if (v.id === ID.Colour) {
            track.colour = parseColour(buf, v.dataStart, v.dataStart + v.size);
          }
        }
        break;
      case ID.Audio:
        for (const a of children(buf, s, s + el.size)) {
          if (a.id === ID.SamplingFrequency) {
            track.sampleRate = readFloat(buf, a.dataStart, a.size);
          } else if (a.id === ID.Channels) {
            track.channels = readUint(buf, a.dataStart, a.size);
          }
        }
        break;
    }
  }
  return track;
}

/**
 * Parses the file start (EBML header + Segment header elements) from `buf`,
 * which holds the file from byte 0. Returns null if `buf` is not Matroska/WebM.
 * `tracks` may be empty if the Tracks element lies beyond `buf`; then
 * `tracksOffset` says where to read it.
 */
export function parseHead(buf: Uint8Array): (SegmentInfo & {tracksOffset?: number; infoOffset?: number}) | null {
  const ebml = readHeader(buf, 0);
  if (!ebml || ebml.id !== ID.EBML) {
    return null;
  }
  const seg = readHeader(buf, ebml.dataStart + ebml.size);
  if (!seg || seg.id !== ID.Segment) {
    return null;
  }
  const segmentStart = seg.dataStart;
  const info: SegmentInfo & {tracksOffset?: number; infoOffset?: number} = {segmentStart, timecodeScale: 1000000, duration: 0, tracks: []};
  let pos = segmentStart;
  while (pos < buf.length) {
    const el = readHeader(buf, pos);
    if (!el) {
      break;
    }
    if (el.id === ID.Cluster) {
      info.firstClusterOffset = pos;
      break;
    }
    if (el.size === UNKNOWN_SIZE) {
      break;
    }
    const end = el.dataStart + el.size;
    const complete = end <= buf.length;
    if (el.id === ID.SeekHead && complete) {
      for (const seek of children(buf, el.dataStart, end)) {
        if (seek.id !== ID.Seek) {
          continue;
        }
        let target = 0;
        let position = -1;
        for (const f of children(buf, seek.dataStart, seek.dataStart + seek.size)) {
          if (f.id === ID.SeekID) {
            target = readUint(buf, f.dataStart, f.size);
          } else if (f.id === ID.SeekPosition) {
            position = readUint(buf, f.dataStart, f.size);
          }
        }
        if (position >= 0) {
          if (target === ID.Cues) {
            info.cuesOffset = segmentStart + position;
          } else if (target === ID.Tracks) {
            info.tracksOffset = segmentStart + position;
          } else if (target === ID.Info) {
            info.infoOffset = segmentStart + position;
          }
        }
      }
    } else if (el.id === ID.Info && complete) {
      parseInfoInto(buf, el.dataStart, end, info);
    } else if (el.id === ID.Tracks && complete) {
      info.tracks = parseTracks(buf, el.dataStart, end);
    }
    if (!complete) {
      break;
    }
    pos = end;
  }
  return info;
}

export function parseInfoInto(buf: Uint8Array, start: number, end: number, info: SegmentInfo): void {
  let rawDuration = 0;
  for (const f of children(buf, start, end)) {
    if (f.id === ID.TimecodeScale) {
      info.timecodeScale = readUint(buf, f.dataStart, f.size);
    } else if (f.id === ID.Duration) {
      rawDuration = readFloat(buf, f.dataStart, f.size);
    }
  }
  info.duration = (rawDuration * info.timecodeScale) / 1e9;
}

export function parseTracks(buf: Uint8Array, start: number, end: number): Track[] {
  return children(buf, start, end)
    .filter((el) => el.id === ID.TrackEntry)
    .map((el) => parseTrack(buf, el.dataStart, el.dataStart + el.size));
}

/** Parses a complete Cues element (buf starts at its header). */
export function parseCues(buf: Uint8Array, segmentStart: number, timecodeScale: number, videoTrack?: number): CuePoint[] {
  const cues = readHeader(buf, 0);
  if (!cues || cues.id !== ID.Cues) {
    return [];
  }
  const out: CuePoint[] = [];
  for (const point of children(buf, cues.dataStart, Math.min(buf.length, cues.dataStart + cues.size))) {
    if (point.id !== ID.CuePoint) {
      continue;
    }
    let time = 0;
    let offset = -1;
    let track = 0;
    for (const f of children(buf, point.dataStart, point.dataStart + point.size)) {
      if (f.id === ID.CueTime) {
        time = readUint(buf, f.dataStart, f.size);
      } else if (f.id === ID.CueTrackPositions && offset < 0) {
        for (const p of children(buf, f.dataStart, f.dataStart + f.size)) {
          if (p.id === ID.CueClusterPosition) {
            offset = readUint(buf, p.dataStart, p.size);
          } else if (p.id === ID.CueTrack) {
            track = readUint(buf, p.dataStart, p.size);
          }
        }
      }
    }
    if (offset >= 0 && (!videoTrack || !track || track === videoTrack)) {
      out.push({time: (time * timecodeScale) / 1e9, offset: segmentStart + offset});
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export interface Frame {
  track: number;
  /** Presentation time in seconds. */
  pts: number;
  /** Seconds, when the block says (BlockDuration). */
  duration?: number;
  keyframe: boolean;
  data: Uint8Array;
}

export interface ParsedCluster {
  /** Absolute file offset of the cluster. */
  offset: number;
  /** Absolute offset just past the cluster. */
  end: number;
  frames: Frame[];
}

function framesFromBlock(
  buf: Uint8Array,
  start: number,
  size: number,
  clusterTime: number,
  scale: number,
  isSimple: boolean,
  keyHint: boolean,
  duration: number | undefined,
  wanted: Set<number>,
  out: Frame[],
): void {
  const tn = readVint(buf, start);
  if (!tn) {
    return;
  }
  const track = tn.value;
  if (!wanted.has(track)) {
    return;
  }
  let p = start + tn.length;
  const rel = (buf[p] << 8) | buf[p + 1];
  const relSigned = rel & 0x8000 ? rel - 0x10000 : rel;
  const flags = buf[p + 2];
  p += 3;
  const end = start + size;
  const keyframe = isSimple ? (flags & 0x80) !== 0 : keyHint;
  const pts = ((clusterTime + relSigned) * scale) / 1e9;
  const lacing = (flags >> 1) & 3;
  if (lacing === 0) {
    out.push({track, pts, duration, keyframe, data: buf.subarray(p, end)});
    return;
  }
  // Laced block: several frames share one timestamp; durations are spread by the caller.
  const count = buf[p] + 1;
  p += 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph lacing
    for (let i = 0; i < count - 1; i++) {
      let s = 0;
      let b: number;
      do {
        b = buf[p++];
        s += b;
      } while (b === 255);
      sizes.push(s);
    }
  } else if (lacing === 3) {
    // EBML lacing
    const first = readVint(buf, p);
    if (!first) {
      return;
    }
    p += first.length;
    sizes.push(first.value);
    for (let i = 1; i < count - 1; i++) {
      const d = readSignedVint(buf, p);
      if (!d) {
        return;
      }
      p += d.length;
      sizes.push(sizes[i - 1] + d.value);
    }
  } else {
    // Fixed-size lacing
    const each = Math.floor((end - p) / count);
    for (let i = 0; i < count - 1; i++) {
      sizes.push(each);
    }
  }
  const used = sizes.reduce((a, b) => a + b, 0);
  sizes.push(end - p - used);
  for (let i = 0; i < count; i++) {
    out.push({track, pts, keyframe, data: buf.subarray(p, p + sizes[i])});
    p += sizes[i];
  }
}

/**
 * Parses one complete Cluster starting at `pos` in `buf` (`base` = absolute file
 * offset of buf[0]). Returns null if the cluster is not complete in `buf`.
 */
export function parseCluster(buf: Uint8Array, pos: number, base: number, scale: number, wanted: Set<number>): ParsedCluster | null {
  const h = readHeader(buf, pos);
  if (!h || h.id !== ID.Cluster) {
    return null;
  }
  let end: number;
  if (h.size === UNKNOWN_SIZE) {
    // Unknown size: the cluster ends where the next top-level element begins.
    end = findNextCluster(buf, h.dataStart);
    if (end < 0) {
      return null;
    }
  } else {
    end = h.dataStart + h.size;
    if (end > buf.length) {
      return null;
    }
  }
  const frames: Frame[] = [];
  let clusterTime = 0;
  let p = h.dataStart;
  while (p < end) {
    const el = readHeader(buf, p);
    if (!el || el.size === UNKNOWN_SIZE) {
      break;
    }
    const elEnd = el.dataStart + el.size;
    if (el.id === ID.Timecode) {
      clusterTime = readUint(buf, el.dataStart, el.size);
    } else if (el.id === ID.SimpleBlock) {
      framesFromBlock(buf, el.dataStart, el.size, clusterTime, scale, true, false, undefined, wanted, frames);
    } else if (el.id === ID.BlockGroup) {
      let blockStart = -1;
      let blockSize = 0;
      let duration: number | undefined;
      let hasReference = false;
      for (const g of children(buf, el.dataStart, elEnd)) {
        if (g.id === ID.Block) {
          blockStart = g.dataStart;
          blockSize = g.size;
        } else if (g.id === ID.BlockDuration) {
          duration = (readUint(buf, g.dataStart, g.size) * scale) / 1e9;
        } else if (g.id === ID.ReferenceBlock) {
          hasReference = true;
        }
      }
      if (blockStart >= 0) {
        framesFromBlock(buf, blockStart, blockSize, clusterTime, scale, false, !hasReference, duration, wanted, frames);
      }
    } else if (el.id === ID.Cluster) {
      break;
    }
    p = elEnd;
  }
  return {offset: base + pos, end: base + end, frames};
}

/** Offset of the next Cluster ID at or after `from`, or -1. */
export function findNextCluster(buf: Uint8Array, from: number): number {
  for (let i = from; i + 3 < buf.length; i++) {
    if (buf[i] === 0x1f && buf[i + 1] === 0x43 && buf[i + 2] === 0xb6 && buf[i + 3] === 0x75) {
      return i;
    }
  }
  return -1;
}
