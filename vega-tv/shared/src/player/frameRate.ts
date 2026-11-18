// Frame-rate matching: films are 23.976 fps, and shown at the TV's default 60 Hz each
// frame is held for alternately 2 and 3 refreshes - visible judder ("not smooth", no
// spinner). Before playback starts we read the real frame rate from the file header
// and ask the platform to switch the display to match; it is reset on exit.
import {W3CMediaTurboModule} from '@amazon-devices/react-native-w3cmedia';
import {parseHead} from '../mkv/matroska';

type Log = (line: string) => void;

function fetchHead(url: string, bytes: number, timeoutMs: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const timer = setTimeout(() => {
      try {
        xhr.abort();
      } catch {
        // finished already
      }
      resolve(null);
    }, timeoutMs);
    xhr.onload = () => {
      clearTimeout(timer);
      resolve(xhr.status === 206 || xhr.status === 200 ? new Uint8Array(xhr.response as ArrayBuffer).subarray(0, bytes) : null);
    };
    xhr.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    try {
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.setRequestHeader('Range', `bytes=0-${bytes - 1}`);
      xhr.send();
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** Video frame rate of an MP4 whose 'moov' sits at the start (streaming-friendly files). */
export function mp4FrameRate(buf: Uint8Array): number | undefined {
  const boxes = (from: number, to: number): {type: string; start: number; end: number}[] => {
    const out: {type: string; start: number; end: number}[] = [];
    let o = from;
    while (o + 8 <= to) {
      let size = u32(buf, o);
      const type = tag(buf, o + 4);
      let header = 8;
      if (size === 1 && o + 16 <= to) {
        size = u32(buf, o + 8) * 2 ** 32 + u32(buf, o + 12);
        header = 16;
      } else if (size === 0) {
        size = to - o;
      }
      if (size < header) {
        break;
      }
      out.push({type, start: o + header, end: Math.min(o + size, to)});
      o += size;
    }
    return out;
  };
  const moov = boxes(0, buf.length).find((b) => b.type === 'moov');
  if (!moov) {
    return undefined;
  }
  for (const trak of boxes(moov.start, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = boxes(trak.start, trak.end).find((b) => b.type === 'mdia');
    if (!mdia) {
      continue;
    }
    const inner = boxes(mdia.start, mdia.end);
    const hdlr = inner.find((b) => b.type === 'hdlr');
    if (!hdlr || tag(buf, hdlr.start + 8) !== 'vide') {
      continue;
    }
    const mdhd = inner.find((b) => b.type === 'mdhd');
    const minf = inner.find((b) => b.type === 'minf');
    const stbl = minf && boxes(minf.start, minf.end).find((b) => b.type === 'stbl');
    const stts = stbl && boxes(stbl.start, stbl.end).find((b) => b.type === 'stts');
    if (!mdhd || !stts) {
      return undefined;
    }
    const version = buf[mdhd.start];
    const timescale = u32(buf, mdhd.start + (version === 1 ? 20 : 12));
    // First stts entry: sample count, sample delta.
    const delta = u32(buf, stts.start + 12);
    return timescale && delta ? timescale / delta : undefined;
  }
  return undefined;
}

/** Reads the video frame rate from the file header (MKV or MP4), within `timeoutMs`. */
export async function detectFrameRate(url: string, timeoutMs = 1500): Promise<number | undefined> {
  const head = await fetchHead(url, 512 * 1024, timeoutMs);
  if (!head) {
    return undefined;
  }
  try {
    const mkv = parseHead(head);
    const video = mkv?.tracks.find((t) => t.kind === 'video');
    if (video?.defaultDurationNs) {
      return 1e9 / video.defaultDurationNs;
    }
  } catch {
    // not Matroska
  }
  try {
    return mp4FrameRate(head);
  } catch {
    return undefined;
  }
}

/** Snaps a measured rate to the standard one (23.976, 24, 25, 29.97, 30, 50, 59.94, 60). */
export function standardRate(fps: number): number {
  const rates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  return rates.reduce((best, r) => (Math.abs(r - fps) < Math.abs(best - fps) ? r : best), rates[0]);
}

export function matchDisplayTo(fps: number, log: Log): boolean {
  try {
    (W3CMediaTurboModule as any).setRefreshRate(fps);
    log(`display refresh rate matched to ${fps} fps`);
    return true;
  } catch (e: any) {
    log(`display refresh rate not changed: ${e?.message || e}`);
    return false;
  }
}

export function resetDisplay(log: Log): void {
  try {
    (W3CMediaTurboModule as any).resetDisplayMode();
    log('display mode reset');
  } catch {
    // older platform: nothing was changed
  }
}
