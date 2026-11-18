// Quick pre-flight check of a live HLS source, run while tuning. A sweep of the
// real providers (17 Nov) found that a third of sport sources were placeholders:
// a one-segment, finished playlist pointing at "Maintenance2024.mp4" or
// "black.ts". Those, and dead links, are skipped before playback starts.
import {request} from '../../../../shared/src/net';

export type StreamState = 'live' | 'placeholder' | 'dead';

export interface ProbeResult {
  state: StreamState;
  /** Highest declared variant resolution, when the playlist lists variants. */
  resolution?: string;
  why?: string;
}

const PLACEHOLDER_NAME = /maintenance|black\.ts|offline|no[_-]?signal|unavailable|novideo|blank/i;

function firstUri(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#')) || '';
}

function resolve(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) {
    return ref;
  }
  const origin = /^(https?:\/\/[^/]+)/i.exec(base)?.[1] || '';
  if (ref.startsWith('/')) {
    return origin + ref;
  }
  return base.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + ref;
}

export function classifyMediaPlaylist(text: string): ProbeResult {
  if (!text.startsWith('#EXTM3U')) {
    return {state: 'dead', why: 'not a playlist'};
  }
  const segments = (text.match(/#EXTINF/g) || []).length;
  if (!segments) {
    return {state: 'dead', why: 'no segments'};
  }
  const uri = firstUri(text);
  if (text.includes('#EXT-X-ENDLIST') || PLACEHOLDER_NAME.test(uri.split('?')[0])) {
    return {state: 'placeholder', why: uri.split('?')[0].split('/').pop()};
  }
  return {state: 'live'};
}

export async function probeStream(url: string, timeoutMs = 6000): Promise<ProbeResult> {
  try {
    const first = await request(url, {timeoutMs, headers: {Accept: '*/*'}});
    if (!first.ok) {
      return {state: 'dead', why: `HTTP ${first.status}`};
    }
    if (!first.text.includes('#EXT-X-STREAM-INF')) {
      return classifyMediaPlaylist(first.text);
    }
    // Master playlist: check the best variant.
    const lines = first.text.split('\n');
    let best = {bw: -1, uri: '', res: ''};
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
        const res = /RESOLUTION=(\d+x\d+)/.exec(lines[i])?.[1] || '';
        const uri = (lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#')) || '').trim();
        if (uri && bw > best.bw) {
          best = {bw, uri, res};
        }
      }
    }
    if (!best.uri) {
      return {state: 'dead', why: 'empty master playlist'};
    }
    const media = await request(resolve(url, best.uri), {timeoutMs, headers: {Accept: '*/*'}});
    if (!media.ok) {
      return {state: 'dead', why: `variant HTTP ${media.status}`};
    }
    return {...classifyMediaPlaylist(media.text), resolution: best.res || undefined};
  } catch (e: any) {
    return {state: 'dead', why: String(e?.message || e)};
  }
}
