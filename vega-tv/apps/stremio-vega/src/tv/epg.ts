// Now/next programme info per merged channel. Providers sometimes attach the
// wrong guide to a channel (e.g. Sky Sports News programmes on "Main Event"),
// so up to three sources are asked and the majority title wins.
// Official listings (Sky / Virgin Media / TV Guide, see officialGuide.ts) come first.
import * as fx from './flixnest';
import {MergedChannel} from './channels';
import {GuideName, OFFICIAL_NONE, guideFor, officialNowNext} from './officialGuide';
import type {ProgrammeTag} from './scores';

export interface NowNext {
  now?: fx.Programme | null;
  next?: fx.Programme | null;
  /** Source ids whose guide disagreed with the majority, or with the official guide (possible mislabels). */
  outliers: string[];
  /** now/next come from an official guide (named in `guide`). */
  official?: boolean;
  guide?: GuideName;
  /** Why there is no official listing (now/next are then the streams' own guide). */
  noGuide?: string;
  /** What the streams' own guide says is on, when it is not what the official guide says. */
  streamSays?: string;
  /** Each checked source's own guide title for now, by source id. */
  sourceNow?: Record<string, string>;
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

const STOP = new Set(['live', 'with', 'from', 'the', 'and', 'sky', 'sports', 'sport', 'news', 'tnt', 'new', 'episode', 'series', 'season']);
const words = (t?: string) => new Set(cleanTitle(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Two listings name the same programme (wording differs between guides: "Live Grand Slam Of Darts" / "Grand Slam of Darts: Day 4"). */
export function sameProgramme(a?: string, b?: string): boolean {
  const na = norm(a).replace(/^live/, '');
  const nb = norm(b).replace(/^live/, '');
  if (!na || !nb) {
    return false;
  }
  if (na === nb || na.includes(nb) || nb.includes(na)) {
    return true;
  }
  const wa = words(a);
  const wb = words(b);
  let shared = 0;
  wa.forEach((w) => wb.has(w) && shared++);
  return shared >= Math.min(2, wa.size, wb.size) && shared > 0;
}

/**
 * A stream's own label agrees with the official guide when it names the programme on now,
 * or the one just before/after (provider guides often run a slot behind), or is the series
 * name the official description gives ("Premiership Women's Rugby" for "Exeter Women v …").
 */
export function agreesWithOfficial(title: string, official: {now: fx.Programme | null; next?: fx.Programme | null; prev?: fx.Programme | null}): boolean {
  if ([official.now, official.prev, official.next].some((p) => p?.title && sameProgramme(title, p.title))) {
    return true;
  }
  const mine = [...words(title)];
  const desc = String(official.now?.description || '').toLowerCase();
  return mine.length >= 2 && mine.every((w) => desc.includes(w));
}

/**
 * The official guide (Sky) is what the channel should be showing; the stream
 * providers' own guides are kept only to point out a stream that is labelled
 * as something else (a different feed, or the provider's guide is wrong).
 */
export function withOfficial(
  fromStreams: NowNext,
  sky: {now: fx.Programme | null; next: fx.Programme | null; prev?: fx.Programme | null; guide?: GuideName} | null,
  results: {id: string; epg: fx.Epg}[],
  noGuide?: string,
): NowNext {
  const sourceNow: Record<string, string> = {};
  for (const r of results) {
    if (r.epg?.now?.title) {
      sourceNow[r.id] = cleanTitle(r.epg.now.title);
    }
  }
  if (!sky || !sky.now) {
    return {...fromStreams, sourceNow, noGuide};
  }
  const streamTitle = fromStreams.now?.title;
  const differs = !!streamTitle && !agreesWithOfficial(streamTitle, sky);
  return {
    now: sky.now,
    next: sky.next,
    official: true,
    guide: sky.guide || 'Sky',
    outliers: Object.entries(sourceNow).filter(([, t]) => !agreesWithOfficial(t, sky)).map(([id]) => id),
    streamSays: differs ? cleanTitle(streamTitle) : undefined,
    sourceNow,
  };
}

/** Title for display: a live programme loses its "Live" prefix (the LIVE tag says it). */
export function displayTitle(p?: fx.Programme | null): string {
  const t = cleanTitle(p?.title);
  return p?.live ? t.replace(/^live\s+(?:[:|-]\s*)?/i, '') : t;
}

// Coverage of a match, race or fight (not a studio or magazine show).
const FIXTURE = /\s(?:v|vs\.?|@)\s|grand prix|qualifying|\bsprint\b|\brace\b|\bfinal\b|-final\b|\btest\b|\bmatch\b|\bgame \d|\bround \d|fight night|\bufc \d|\bboxing\b/i;

/**
 * LIVE / REPLAY for what is on now. With the official guide, Sky's own "Live"
 * label decides; a match on a sports channel that Sky does not list as live is a
 * re-run. Without it, the title and live scores are judged (tagFor).
 */
export function nowTag(info: NowNext | null | undefined, sportChannel: boolean, tagFor?: (title: string) => ProgrammeTag): ProgrammeTag {
  const p = info?.now;
  if (!p?.title) {
    return null;
  }
  const judged = tagFor ? tagFor(p.title) : null;
  if (!info!.official) {
    return judged;
  }
  if (p.live) {
    return 'LIVE';
  }
  if (judged === 'REPLAY' || (sportChannel && FIXTURE.test(p.title))) {
    return 'REPLAY';
  }
  return null;
}

/** A cached listing; `compare` asks for one that also checked the streams' own labels. */
export function cachedNowNext(channel: MergedChannel, compare = false): NowNext | null {
  for (const key of compare ? [`${channel.id}|full`] : [`${channel.id}|full`, `${channel.id}|basic`]) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return hit.value;
    }
  }
  return null;
}

/**
 * Now/next for a channel. Guide rows use the plain form: the official listing only
 * (one cached request), so scrolling stays light. `compare` (the channel the viewer
 * rests on, the player's Sources list) also reads up to three streams' own guides to
 * spot a stream labelled as something else. Without an official listing the streams'
 * guides are always read, since they are all there is.
 */
export async function nowNext(access: fx.Access, channel: MergedChannel, compare = false): Promise<NowNext> {
  const hit = cachedNowNext(channel, compare);
  if (hit) {
    return hit;
  }
  const key = `${channel.id}|${compare ? 'full' : 'basic'}`;
  const running = inflight.get(key);
  if (running) {
    return running;
  }
  const task = (async () => {
    const noGuide = OFFICIAL_NONE[channel.id] || (guideFor(channel.id) ? 'The TV guide has no listing for this channel right now' : 'No TV guide lists this channel');
    const official = await officialNowNext(channel.id).catch(() => null);
    let value: NowNext;
    if (official?.now && !compare) {
      value = withOfficial({now: null, next: null, outliers: []}, official, [], noGuide);
    } else {
      const withGuide = channel.sources.filter((s) => s.epgId).slice(0, 3);
      const candidates = withGuide.length ? withGuide : channel.sources.slice(0, 2);
      const results = await Promise.all(candidates.map(async (s) => ({id: s.id, epg: await fx.epg(access, s.id).catch(() => ({}) as fx.Epg)})));
      value = withOfficial(pickConsensus(results), official, results, noGuide);
    }
    cache.set(official?.now && !compare ? `${channel.id}|basic` : `${channel.id}|full`, {at: Date.now(), value});
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
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
