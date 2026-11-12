// Minimal EBML (Matroska container) reading: variable-length integers, element
// headers and typed values. Works on Uint8Array views with absolute offsets.

export const UNKNOWN_SIZE = -1;

export interface ElementHeader {
  id: number;
  /** Payload size in bytes, or UNKNOWN_SIZE (live/unfinished elements). */
  size: number;
  /** Offset of the first payload byte. */
  dataStart: number;
  /** Total header length (ID + size). */
  headerLength: number;
}

/** Reads an element ID (keeps the length marker bits, as Matroska IDs are written). */
export function readId(buf: Uint8Array, pos: number): {value: number; length: number} | null {
  if (pos >= buf.length) {
    return null;
  }
  const first = buf[pos];
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 4 || pos + length > buf.length) {
    return null;
  }
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + buf[pos + i];
  }
  return {value, length};
}

/** Reads a size/vint (length marker removed). Returns UNKNOWN_SIZE for the all-ones value. */
export function readVint(buf: Uint8Array, pos: number): {value: number; length: number} | null {
  if (pos >= buf.length) {
    return null;
  }
  const first = buf[pos];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (length > 8 || pos + length > buf.length) {
    return null;
  }
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[pos + i];
    if (b !== 0xff) {
      allOnes = false;
    }
    value = value * 256 + b;
  }
  return {value: allOnes ? UNKNOWN_SIZE : value, length};
}

/** Signed vint as used by EBML lacing (value minus the bias for its length). */
export function readSignedVint(buf: Uint8Array, pos: number): {value: number; length: number} | null {
  const v = readVint(buf, pos);
  if (!v) {
    return null;
  }
  const bias = Math.pow(2, 7 * v.length - 1) - 1;
  return {value: v.value - bias, length: v.length};
}

export function readHeader(buf: Uint8Array, pos: number): ElementHeader | null {
  const id = readId(buf, pos);
  if (!id) {
    return null;
  }
  const size = readVint(buf, pos + id.length);
  if (!size) {
    return null;
  }
  const headerLength = id.length + size.length;
  return {id: id.value, size: size.value, dataStart: pos + headerLength, headerLength};
}

export function readUint(buf: Uint8Array, start: number, size: number): number {
  let value = 0;
  for (let i = 0; i < size; i++) {
    value = value * 256 + buf[start + i];
  }
  return value;
}

export function readFloat(buf: Uint8Array, start: number, size: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + start, size);
  return size === 4 ? view.getFloat32(0) : size === 8 ? view.getFloat64(0) : 0;
}

export function readString(buf: Uint8Array, start: number, size: number): string {
  let out = '';
  for (let i = 0; i < size; i++) {
    const c = buf[start + i];
    if (c === 0) {
      break;
    }
    out += String.fromCharCode(c);
  }
  return out;
}

/** UTF-8 decode (subtitle text, titles). */
export function readUtf8(buf: Uint8Array, start: number, size: number): string {
  let out = '';
  let i = start;
  const end = start + size;
  while (i < end) {
    const c = buf[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (buf[i++] & 0x3f));
    } else if (c >= 0xe0 && c < 0xf0) {
      out += String.fromCharCode(((c & 0x0f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f));
    } else if (c >= 0xf0) {
      const cp = ((c & 0x07) << 18) | ((buf[i++] & 0x3f) << 12) | ((buf[i++] & 0x3f) << 6) | (buf[i++] & 0x3f);
      const s = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (s >> 10), 0xdc00 + (s & 0x3ff));
    }
  }
  return out;
}

/** The child elements fully contained in [start, end). */
export function children(buf: Uint8Array, start: number, end: number): ElementHeader[] {
  const out: ElementHeader[] = [];
  let pos = start;
  while (pos < end) {
    const header = readHeader(buf, pos);
    if (!header || header.size === UNKNOWN_SIZE || header.dataStart + header.size > end) {
      break;
    }
    out.push(header);
    pos = header.dataStart + header.size;
  }
  return out;
}
