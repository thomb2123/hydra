// Codec configuration for MP4 sample entries and MSE codec strings, built from
// Matroska CodecPrivate data or (for Dolby audio) the first audio frame.
import {audioSampleEntry, colrBox, rawBox, visualSampleEntry} from './fmp4';
import {Track} from './matroska';

class BitReader {
  private pos = 0;
  constructor(private readonly data: Uint8Array) {}
  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.data[this.pos >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v >>> 0;
  }
  skip(bits: number): void {
    this.pos += bits;
  }
}

class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private n = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >> i) & 1);
      this.n++;
      if (this.n === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.n = 0;
      }
    }
  }
  done(): Uint8Array {
    if (this.n > 0) {
      this.bytes.push(this.cur << (8 - this.n));
    }
    return new Uint8Array(this.bytes);
  }
}

function hex(n: number, width = 2): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

function reverseBits32(v: number): number {
  let r = 0;
  for (let i = 0; i < 32; i++) {
    r = (r << 1) | ((v >>> i) & 1);
  }
  return r >>> 0;
}

/** RFC 6381 codec string for HEVC from an hvcC record, e.g. "hvc1.2.4.L150.B0". */
export function hevcCodecString(hvcC: Uint8Array): string {
  const space = hvcC[1] >> 6;
  const tier = (hvcC[1] >> 5) & 1;
  const profile = hvcC[1] & 0x1f;
  const compat = ((hvcC[2] << 24) | (hvcC[3] << 16) | (hvcC[4] << 8) | hvcC[5]) >>> 0;
  const constraints: number[] = [hvcC[6], hvcC[7], hvcC[8], hvcC[9], hvcC[10], hvcC[11]];
  while (constraints.length && constraints[constraints.length - 1] === 0) {
    constraints.pop();
  }
  const level = hvcC[12];
  const spaceLetter = ['', 'A', 'B', 'C'][space];
  return [
    'hvc1',
    `${spaceLetter}${profile}`,
    reverseBits32(compat).toString(16).toUpperCase(),
    `${tier ? 'H' : 'L'}${level}`,
    ...constraints.map((c) => hex(c)),
  ].join('.');
}

export function avcCodecString(avcC: Uint8Array): string {
  return `avc1.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`;
}

export interface EncodedConfig {
  /** MSE type, e.g. 'video/mp4; codecs="hvc1.2.4.L150.B0"'. */
  mime: string;
  sampleEntry: Uint8Array;
  timescale: number;
  /** Seconds per frame, for the last sample of a fragment. */
  frameDuration: number;
  /** Short label for logs and the quality badge. */
  label: string;
}

const PRIMARIES_BT2020 = 9;
const TRANSFER_PQ = 16;
const TRANSFER_HLG = 18;

/** Video config, or null if the codec cannot go through MSE. */
export function videoConfig(track: Track): EncodedConfig | null {
  const width = track.width || 1920;
  const height = track.height || 1080;
  const frameDuration = track.defaultDurationNs ? track.defaultDurationNs / 1e9 : 1 / 23.976;
  const colour = track.colour;
  const extras: Uint8Array[] = [];
  if (colour && (colour.primaries || colour.transfer || colour.matrix)) {
    extras.push(colrBox(colour.primaries || 1, colour.transfer || 1, colour.matrix || 1, colour.range === 2));
  }
  const hdr = colour?.transfer === TRANSFER_PQ ? 'HDR10' : colour?.transfer === TRANSFER_HLG ? 'HLG' : colour?.primaries === PRIMARIES_BT2020 ? 'WCG' : 'SDR';
  if (track.codecId === 'V_MPEGH/ISO/HEVC' && track.codecPrivate && track.codecPrivate.length > 22) {
    const hvcC = track.codecPrivate;
    return {
      mime: `video/mp4; codecs="${hevcCodecString(hvcC)}"`,
      sampleEntry: visualSampleEntry('hvc1', width, height, rawBox('hvcC', hvcC), ...extras),
      timescale: 90000,
      frameDuration,
      label: `HEVC ${width}x${height} ${hdr}`,
    };
  }
  if (track.codecId === 'V_MPEG4/ISO/AVC' && track.codecPrivate && track.codecPrivate.length > 6) {
    const avcC = track.codecPrivate;
    return {
      mime: `video/mp4; codecs="${avcCodecString(avcC)}"`,
      sampleEntry: visualSampleEntry('avc1', width, height, rawBox('avcC', avcC), ...extras),
      timescale: 90000,
      frameDuration,
      label: `AVC ${width}x${height} ${hdr}`,
    };
  }
  return null;
}

const AC3_RATES = [48000, 44100, 32000];
const AC3_CHANNELS = [2, 1, 2, 3, 3, 4, 4, 5];

/** dac3 box payload from an AC-3 syncframe. */
function dac3From(frame: Uint8Array): {payload: Uint8Array; sampleRate: number; channels: number} | null {
  if (frame[0] !== 0x0b || frame[1] !== 0x77) {
    return null;
  }
  const r = new BitReader(frame);
  r.skip(32); // syncword + crc1
  const fscod = r.read(2);
  const frmsizecod = r.read(6);
  const bsid = r.read(5);
  const bsmod = r.read(3);
  const acmod = r.read(3);
  if ((acmod & 1) && acmod !== 1) {
    r.skip(2); // cmixlev
  }
  if (acmod & 4) {
    r.skip(2); // surmixlev
  }
  if (acmod === 2) {
    r.skip(2); // dsurmod
  }
  const lfeon = r.read(1);
  const w = new BitWriter();
  w.write(fscod, 2);
  w.write(bsid, 5);
  w.write(bsmod, 3);
  w.write(acmod, 3);
  w.write(lfeon, 1);
  w.write(frmsizecod >> 1, 5);
  w.write(0, 5);
  return {payload: w.done(), sampleRate: AC3_RATES[fscod] || 48000, channels: AC3_CHANNELS[acmod] + lfeon};
}

/** dec3 box payload from an E-AC-3 access unit (independent frame + any dependent substreams). */
function dec3From(unit: Uint8Array): {payload: Uint8Array; sampleRate: number; channels: number; frameDuration: number} | null {
  let pos = 0;
  let independent: {fscod: number; bsid: number; acmod: number; lfeon: number; frameBytes: number; sampleRate: number; blocks: number} | null = null;
  let dependents = 0;
  let chanLoc = 0;
  while (pos + 6 < unit.length && unit[pos] === 0x0b && unit[pos + 1] === 0x77) {
    const r = new BitReader(unit.subarray(pos));
    r.skip(16);
    const strmtyp = r.read(2);
    r.skip(3); // substreamid
    const frmsiz = r.read(11);
    const frameBytes = (frmsiz + 1) * 2;
    let fscod = r.read(2);
    let blocks = 6;
    let sampleRate: number;
    if (fscod === 3) {
      const fscod2 = r.read(2);
      sampleRate = [24000, 22050, 16000][fscod2] || 24000;
      fscod = 3;
    } else {
      blocks = [1, 2, 3, 6][r.read(2)];
      sampleRate = AC3_RATES[fscod] || 48000;
    }
    const acmod = r.read(3);
    const lfeon = r.read(1);
    const bsid = r.read(5);
    if (strmtyp === 1 && independent) {
      dependents++;
      // chanmap (if present) sits after dialnorm/compression fields; keep a sensible default.
      chanLoc = chanLoc || 0x2; // Lrs/Rrs pair (7.1 extension)
    } else if (!independent) {
      independent = {fscod, bsid, acmod, lfeon, frameBytes, sampleRate, blocks};
    }
    pos += frameBytes;
  }
  if (!independent) {
    return null;
  }
  const frameDuration = (independent.blocks * 256) / independent.sampleRate;
  const dataRateKbps = Math.round((independent.frameBytes * 8) / frameDuration / 1000);
  const w = new BitWriter();
  w.write(dataRateKbps, 13);
  w.write(0, 3); // num_ind_sub - 1
  w.write(independent.fscod, 2);
  w.write(independent.bsid, 5);
  w.write(0, 1); // reserved
  w.write(0, 1); // asvc
  w.write(0, 3); // bsmod
  w.write(independent.acmod, 3);
  w.write(independent.lfeon, 1);
  w.write(0, 3); // reserved
  w.write(dependents, 4);
  if (dependents > 0) {
    w.write(chanLoc, 9);
  } else {
    w.write(0, 1);
  }
  const channels = AC3_CHANNELS[independent.acmod] + independent.lfeon + (dependents ? 2 : 0);
  return {payload: w.done(), sampleRate: independent.sampleRate, channels, frameDuration};
}

/** MPEG-4 esds box payload wrapping an AudioSpecificConfig. */
function esdsPayload(asc: Uint8Array): Uint8Array {
  const dsi = [0x05, asc.length, ...asc];
  const dcd = [0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...dsi];
  const sl = [0x06, 1, 0x02];
  const es = [0x03, 3 + dcd.length + sl.length, 0, 1, 0, ...dcd, ...sl];
  return new Uint8Array([0, 0, 0, 0, ...es]);
}

/** Audio config from the track and its first frame, or null if MSE cannot take it. */
export function audioConfig(track: Track, firstFrame: Uint8Array | undefined): EncodedConfig | null {
  const prefix = track.strippedHeader;
  const frame = firstFrame && prefix ? new Uint8Array([...prefix, ...firstFrame]) : firstFrame;
  if (track.codecId === 'A_EAC3' && frame) {
    const d = dec3From(frame);
    if (!d) {
      return null;
    }
    return {
      mime: 'audio/mp4; codecs="ec-3"',
      sampleEntry: audioSampleEntry('ec-3', d.channels, d.sampleRate, rawBox('dec3', d.payload)),
      timescale: d.sampleRate,
      frameDuration: d.frameDuration,
      label: `E-AC-3 ${d.channels}ch`,
    };
  }
  if (track.codecId === 'A_AC3' && frame) {
    const d = dac3From(frame);
    if (!d) {
      return null;
    }
    return {
      mime: 'audio/mp4; codecs="ac-3"',
      sampleEntry: audioSampleEntry('ac-3', d.channels, d.sampleRate, rawBox('dac3', d.payload)),
      timescale: d.sampleRate,
      frameDuration: 1536 / d.sampleRate,
      label: `AC-3 ${d.channels}ch`,
    };
  }
  if (track.codecId.startsWith('A_AAC') && track.codecPrivate && track.codecPrivate.length >= 2) {
    const asc = track.codecPrivate;
    const objectType = asc[0] >> 3;
    const sampleRate = track.sampleRate || 48000;
    const channels = track.channels || 2;
    return {
      mime: `audio/mp4; codecs="mp4a.40.${objectType}"`,
      sampleEntry: audioSampleEntry('mp4a', channels, sampleRate, rawBox('esds', esdsPayload(asc))),
      timescale: Math.round(sampleRate),
      frameDuration: 1024 / sampleRate,
      label: `AAC ${channels}ch`,
    };
  }
  return null;
}
