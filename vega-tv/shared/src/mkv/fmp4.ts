// Fragmented MP4 (ISO BMFF) writer: one init segment per track and moof+mdat
// media segments, as Media Source Extensions expect.

function str4(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}

function u16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function u64(v: number): number[] {
  const hi = Math.floor(v / 4294967296);
  return [...u32(hi), ...u32(v >>> 0)];
}

type Part = Uint8Array | number[];

function concat(parts: Part[]): Uint8Array {
  let length = 0;
  for (const p of parts) {
    length += p.length;
  }
  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function box(type: string, ...parts: Part[]): Uint8Array {
  const body = concat(parts);
  return concat([u32(body.length + 8), str4(type), body]);
}

function fullBox(type: string, version: number, flags: number, ...parts: Part[]): Uint8Array {
  return box(type, [version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff], ...parts);
}

const MATRIX = [...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x00010000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

export interface InitTrack {
  id: number;
  kind: 'video' | 'audio';
  timescale: number;
  /** Complete sample entry box (hvc1/avc1/ec-3/ac-3/mp4a). */
  sampleEntry: Uint8Array;
  width?: number;
  height?: number;
}

/** Init segment (ftyp + moov) for a single track. */
export function initSegment(track: InitTrack): Uint8Array {
  const ftyp = box('ftyp', str4('isom'), u32(0x200), str4('isom'), str4('iso6'), str4('mp41'));
  const mvhd = fullBox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Array(24).fill(0), u32(track.id + 1));
  const isVideo = track.kind === 'video';
  const tkhd = fullBox(
    'tkhd',
    0,
    0x3,
    u32(0),
    u32(0),
    u32(track.id),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u16(0),
    u16(0),
    u16(isVideo ? 0 : 0x0100),
    u16(0),
    MATRIX,
    u32(((track.width || 0) & 0xffff) << 16),
    u32(((track.height || 0) & 0xffff) << 16),
  );
  const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(track.timescale), u32(0), u16(0x55c4) /* 'und' */, u16(0));
  const hdlr = fullBox('hdlr', 0, 0, u32(0), str4(isVideo ? 'vide' : 'soun'), u32(0), u32(0), u32(0), [...str4(isVideo ? 'Vide' : 'Soun'), 0]);
  const mediaHeader = isVideo ? fullBox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)) : fullBox('smhd', 0, 0, u16(0), u16(0));
  const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)));
  const stbl = box(
    'stbl',
    fullBox('stsd', 0, 0, u32(1), track.sampleEntry),
    fullBox('stts', 0, 0, u32(0)),
    fullBox('stsc', 0, 0, u32(0)),
    fullBox('stsz', 0, 0, u32(0), u32(0)),
    fullBox('stco', 0, 0, u32(0)),
  );
  const minf = box('minf', mediaHeader, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const mvex = box('mvex', fullBox('trex', 0, 0, u32(track.id), u32(1), u32(0), u32(0), u32(0)));
  return concat([ftyp, box('moov', mvhd, trak, mvex)]);
}

export function visualSampleEntry(type: 'hvc1' | 'avc1', width: number, height: number, ...children: Uint8Array[]): Uint8Array {
  return box(
    type,
    [0, 0, 0, 0, 0, 0],
    u16(1), // data reference index
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(width),
    u16(height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1), // frame count
    new Array(32).fill(0), // compressor name
    u16(0x0018),
    u16(0xffff),
    ...children,
  );
}

export function audioSampleEntry(type: 'ec-3' | 'ac-3' | 'mp4a', channels: number, sampleRate: number, ...children: Uint8Array[]): Uint8Array {
  return box(type, [0, 0, 0, 0, 0, 0], u16(1), u32(0), u32(0), u16(channels), u16(16), u16(0), u16(0), u32((Math.round(sampleRate) & 0xffff) << 16), ...children);
}

/** 'colr' nclx box (colour primaries, transfer, matrix, range). */
export function colrBox(primaries: number, transfer: number, matrix: number, fullRange: boolean): Uint8Array {
  return box('colr', str4('nclx'), u16(primaries), u16(transfer), u16(matrix), [fullRange ? 0x80 : 0]);
}

export function rawBox(type: string, payload: Uint8Array): Uint8Array {
  return box(type, payload);
}

export interface Sample {
  data: Uint8Array;
  /** Prefix bytes added before data (header-stripping compression). */
  prefix?: Uint8Array;
  duration: number; // timescale units
  cto: number; // composition offset (signed)
  keyframe: boolean;
}

/** One media segment (moof + mdat) for `samples` of a track. */
export function mediaSegment(trackId: number, sequence: number, baseDecodeTime: number, samples: Sample[], isVideo: boolean): Uint8Array {
  const trunFlags = 0x000001 | 0x000100 | 0x000200 | 0x000400 | (isVideo ? 0x000800 : 0);
  const entryBytes = isVideo ? 16 : 12;
  const trunSize = 8 + 4 + 4 + 4 + samples.length * entryBytes;
  const tfhd = fullBox('tfhd', 0, 0x020000, u32(trackId));
  const tfdt = fullBox('tfdt', 1, 0, u64(baseDecodeTime));
  const mfhd = fullBox('mfhd', 0, 0, u32(sequence));
  const trafSize = 8 + tfhd.length + tfdt.length + trunSize;
  const moofSize = 8 + mfhd.length + trafSize;
  let mdatLength = 0;
  for (const s of samples) {
    mdatLength += s.data.length + (s.prefix ? s.prefix.length : 0);
  }
  const out = new Uint8Array(moofSize + 8 + mdatLength);
  const view = new DataView(out.buffer);
  let o = 0;
  const w32 = (v: number) => {
    view.setUint32(o, v >>> 0);
    o += 4;
  };
  const wType = (t: string) => {
    out.set(str4(t), o);
    o += 4;
  };
  w32(moofSize);
  wType('moof');
  out.set(mfhd, o);
  o += mfhd.length;
  w32(trafSize);
  wType('traf');
  out.set(tfhd, o);
  o += tfhd.length;
  out.set(tfdt, o);
  o += tfdt.length;
  w32(trunSize);
  wType('trun');
  w32((1 << 24) | trunFlags); // version 1: signed composition offsets
  w32(samples.length);
  w32(moofSize + 8); // data offset: first byte of mdat payload
  for (const s of samples) {
    w32(s.duration);
    w32(s.data.length + (s.prefix ? s.prefix.length : 0));
    w32(s.keyframe ? 0x02000000 : 0x01010000);
    if (isVideo) {
      view.setInt32(o, s.cto);
      o += 4;
    }
  }
  w32(mdatLength + 8);
  wType('mdat');
  for (const s of samples) {
    if (s.prefix) {
      out.set(s.prefix, o);
      o += s.prefix.length;
    }
    out.set(s.data, o);
    o += s.data.length;
  }
  return out;
}
