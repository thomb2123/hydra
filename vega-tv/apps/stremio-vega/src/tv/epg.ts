// Now/next programme info per merged channel. Providers sometimes attach the
// wrong guide to a channel (e.g. Sky Sports News programmes on "Main Event"),
// so up to three sources are asked and the majority title wins.
import * as fx from './flixnest';
import {MergedChannel} from './channels';

export interface NowNext {
  now?: fx.Programme | null;
  next?: fx.Programme | null;
  /** Source ids whose guide disagreed with the majority (possible mislabels). */
  outliers: string[];
}

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, {at: number; value: NowNext}>();
const inflight = new Map<string, Promise<NowNext>>();

export function cleanTitle(title?: string): string {
  return String(title || '')
    .replace(/\s*\((?:HD|SD|UHD|4K|S\d+\s*E\d+|\d{4})\)\s*$/i, '')
    .replace(/^\s*(?:LIVE|NEW)\s*[:|-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const norm = (t?: string) => cleanTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, '');

export function pickConsensus(results: {id: string; epg: fx.Epg}[]): NowNext {
  const usable = results.filter((r) => r.epg && r.epg.now && r.epg.now.title);
  if (!usable.length) {
    return {now: null, next: null, outliers: []};
  }
  const votes = new Map<string, number>();
  for (const r of usable) {
    const k = norm(r.epg.now!.title);
    votes.set(k, (votes.get(k) || 0) + 1);
  }
  const [winner] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  const chosen = usable.find((r) => norm(r.epg.now!.title) === winner)!;
  const outliers = usable.length >= 2 ? usable.filter((r) => norm(r.epg.now!.title) !== winner).map((r) => r.id) : [];
  return {now: chosen.epg.now, next: chosen.epg.next, outliers};
}

export function cachedNowNext(channel: MergedChannel): NowNext | null {
  const hit = cache.get(channel.id);
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}

export async function nowNext(access: fx.Access, channel: MergedChannel): Promise<NowNext> {
  const hit = cachedNowNext(channel);
  if (hit) {
    return hit;
  }
  const running = inflight.get(channel.id);
  if (running) {
    return running;
  }
  const task = (async () => {
    const withGuide = channel.sources.filter((s) => s.epgId).slice(0, 3);
    const candidates = withGuide.length ? withGuide : channel.sources.slice(0, 2);
    const results = await Promise.all(
      candidates.map(async (s) => ({id: s.id, epg: await fx.epg(access, s.id).catch(() => ({}) as fx.Epg)})),
    );
    const value = pickConsensus(results);
    cache.set(channel.id, {at: Date.now(), value});
    return value;
  })().finally(() => inflight.delete(channel.id));
  inflight.set(channel.id, task);
  return task;
}

export function progressOf(p?: fx.Programme | null): number {
  if (!p || !p.start || !p.end || p.end <= p.start) {
    return 0;
  }
  const now = Date.now() / 1000;
  return Math.max(0, Math.min(1, (now - p.start) / (p.end - p.start)));
}

export function timeRange(p?: fx.Programme | null): string {
  if (!p || !p.start) {
    return '';
  }
  const fmt = (s: number) => {
    const d = new Date(s * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return p.end ? `${fmt(p.start)}–${fmt(p.end)}` : fmt(p.start);
}
