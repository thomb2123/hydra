// "Live sport" row: football, boxing, UFC/MMA, F1 and other big events that
// are on now or soon, shown only when an English (UK/US) channel carries
// them. Each event plays through the merged channel (best source + failover)
// or, for pay-per-view slots, through the UK/US event feed itself.
import {parseChannelName} from './normalize';
import {channelIndex} from './lineup';
import {MergedChannel, Source} from './channels';

export interface SportEvent {
  key: string;
  /** The match itself, e.g. "Spain v England". */
  title: string;
  /** Competition or round, e.g. "UEFA Nations League". */
  competition: string;
  sport: string;
  live: boolean;
  start: number;
  /** Curated channel showing it (preferred). */
  channelId?: string;
  channelName?: string;
  /** Direct UK/US event feeds when no curated channel carries it. */
  feeds: Source[];
  /** 0 = headline (Premier League, Champions League, UK teams, UFC, boxing, F1), 2 = minor. */
  tier: number;
}

const SPORTS: Record<string, string> = {
  soccer: 'Football',
  football: 'Football',
  boxing: 'Boxing',
  mma: 'UFC & MMA',
  'formula 1': 'Formula 1',
  motorsport: 'Motorsport',
  rugby: 'Rugby',
  'rugby union': 'Rugby',
  'rugby league': 'Rugby',
  cricket: 'Cricket',
  darts: 'Darts',
  snooker: 'Snooker',
  tennis: 'Tennis',
  golf: 'Golf',
  'american football': 'NFL',
  basketball: 'Basketball',
};

const FOREIGN = /\b(?:sessie|halve|fu(?:ss|ß)ball|boksning|partido|spiel|spieltag|kampf|fodbold|fotboll|calcio|jalkapallo|halbfinale|rückspiel|jornada|journée|journee|giornata|kolejka|dvouhra|compacto|resumen|wedstrijd|partita|mecz|rennen|mexiko|openul|irlandei|finala)\b/i;
// What a real live fixture or event looks like (and what a filler programme does not).
const FIXTURE = /\s(?:v|vs\.?|at)\s|\bUFC\b|Fight Night|\bBoxing\b|Grand Prix|Formula 1|\bF1\b|MotoGP|Qualifying|Practice|Sprint|Darts|Snooker|\bOpen\b|Masters|\bFinal\b|\bCup\b|League|Test Match|\bATP\b|\bWTA\b|\bPGA\b|Six Nations/i;
const NOT_LIVE =
  /^next event|^tbc\b|\byears\b|^\d{4}\s|highlights|replay|classic|rewind|preview|review|\bmagazine\b|\bshow\b|\bretro\b|flashback|\bstories\b|\bstory\b|the art of|evolution|documentary|\bgreatest\b|\bnews\b|first alert|\bat \d{1,2}(?::\d\d)?\s*(?:[ap]\.?m?\.?)?$|\bG League\b/i;
// Team sports need an actual match-up ("A v B", "A at B", "A @ B"); a bare
// "FA Cup Football" slot is usually filler around the real match.
const MATCHUP = /\s(?:v|vs\.?|at|@)\s/i;
const TEAM_SPORTS = new Set(['Football', 'NFL', 'Basketball', 'Rugby', 'Cricket']);
const HEADLINE =
  /Premier League|Champions League|Europa|Conference League|FA Cup|Carabao|EFL Cup|\bEngland\b|\bScotland\b|\bWales\b|Northern Ireland|Republic of Ireland|Man(?:chester)? (?:Utd|United|City)|Liverpool|Arsenal|Chelsea|Tottenham|Newcastle|\bUFC\b|Boxing|Fight Night|Grand Prix|Formula 1|\bF1\b|Six Nations|Ashes/i;
const MINOR = /CONCACAF|AFCON|College|NCAA|\bWNBA\b|Women's Super League U|Youth|U-?\d{2}\b|Qualifier/i;
const SPORT_WORDS = /^(?:snooker|darts|tennis|golf|football|soccer|boxing|mma|rugby|cricket|basketball|world snooker tour)$/i;
const PERSON = /^[A-Z][\w.'’-]*(?: [A-Z][\w.'’-]*){0,3}$/;
const NOT_PERSON = /\b(?:Open|League|Final|Finals|Tour|Cup|Masters|Championship|Series|Round|Session|Grand Prix)\b/i;
const SPORTY_FEED = /SPORT|EPL|PPV|DAZN|TNT|BEIN|PREMIER|UFC|BOX|\bF1\b|NFL|NBA|ESPN|EVENT|LALIGA|EUROSPORT|FIGHT/i;
const SPORT_CATEGORIES = new Set(['uk-sport', 'us-sport']);
const UKUS_PREFIX = /^\s*\|?\s*(?:UK|US|USA)(?:-[A-Z]+)?\s*[|:\-]/i;

function englishTitle(title: string): boolean {
  return /^[\x20-\x7E–—’·]+$/.test(title) && !FOREIGN.test(title);
}

export function cleanEventTitle(title: string): string {
  return String(title || '')
    .replace(/\s*[-|]\s*(?:MD|Matchday|Round|Week)\s*\d+\s*$/i, '')
    .replace(/\s+vs\.?\s+/gi, ' v ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits a listing such as "Spain v England - UEFA Nations League 2026/2027" or
 * "FA Cup: Peterborough v Reading" into the match and its competition, the way a
 * TV guide shows it. Seasons, country codes and duplicated sport names are dropped.
 */
export function splitEvent(raw: string): {title: string; competition: string} {
  let text = cleanEventTitle(raw)
    .replace(/\s\([A-Z]{3}\)/g, '')
    .replace(/[,:]\s*Finale\b/gi, ', Final')
    .replace(/\s*-?\s*(?:Season\s*-?\s*)?\b(?:(?:19|20)\d{2}(?:\/(?:19|20)?\d{2})?|\d{2}\/\d{2})\s*$/i, '')
    .replace(/\s*-\s*$/, '')
    .trim();
  let competition = '';
  // "Competition: rest" (only when the rest holds the match).
  const colon = /^([^:]{2,40}):\s+(.+)$/.exec(text);
  if (colon && (MATCHUP.test(colon[2]) || / - /.test(colon[2]))) {
    competition = colon[1].trim();
    text = colon[2].trim();
  }
  const parts = text.split(/\s+-\s*|,\s+/).map((p) => p.trim()).filter((p) => p && !SPORT_WORDS.test(p));
  let titleIndex = parts.findIndex((p) => MATCHUP.test(p));
  if (titleIndex < 0) {
    // Individual sports: "Kyren Wilson - Jak Jones - Northern Ireland Open - Final".
    const i = parts.findIndex((p, k) => k + 1 < parts.length && PERSON.test(p) && PERSON.test(parts[k + 1]) && !NOT_PERSON.test(p) && !NOT_PERSON.test(parts[k + 1]));
    if (i >= 0) {
      parts.splice(i, 2, `${parts[i]} v ${parts[i + 1]}`);
      titleIndex = i;
    }
  }
  if (titleIndex < 0) {
    return {title: [competition, ...parts].filter(Boolean).join(' · ') || text, competition: ''};
  }
  // "Semi-Final: Saracens v Wasps" -> the round joins the competition.
  const round = /^([^:]{2,30}):\s+(.+)$/.exec(parts[titleIndex]);
  if (round && MATCHUP.test(round[2])) {
    parts.splice(titleIndex, 1, round[2]);
    parts.push(round[1]);
  }
  const initials = (p: string) => p.split(/\s+/).map((w) => w[0] || '').join('').toUpperCase();
  const rest = parts
    .filter((_, k) => k !== titleIndex)
    // "NFL - National Football League": drop the spelled-out duplicate.
    .filter((p, k, all) => !all.some((o, j) => j !== k && o.length <= 5 && o.toUpperCase() === initials(p)));
  // "NFL -National Football League" style tails keep only their first word group.
  const comp = [competition, ...rest].filter(Boolean).join(' · ').replace(/\s+-\S.*$/, '');
  return {title: parts[titleIndex], competition: comp};
}

/** "|UK| beIN Sports ᴴᴰ EN 1" -> "beIN Sports 1" (for event feeds shown by name). */
export function feedLabel(rawName: string): string {
  const key = parseChannelName(rawName).key.replace(/\b(?:english|en|d)\b/g, '').replace(/\s+/g, ' ').trim();
  const fix: Record<string, string> = {bein: 'beIN', tnt: 'TNT', nfl: 'NFL', nba: 'NBA', espn: 'ESPN', cbs: 'CBS', fox: 'Fox', sny: 'SNY', nbc: 'NBC', abc: 'ABC', bt: 'BT', uk: 'UK', us: 'US', tv: 'TV'};
  return key
    .split(' ')
    .map((w) => fix[w] || (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function tierOf(text: string): number {
  const t = text.replace(/New England/gi, '');
  return HEADLINE.test(t) ? 0 : MINOR.test(t) ? 2 : 1;
}

export function buildEvents(raw: any[], channels: MergedChannel[], horizonSec = 3 * 3600): SportEvent[] {
  const index = channelIndex();
  const merged = new Map(channels.map((c) => [c.id, c]));
  const now = Date.now() / 1000;
  const out = new Map<string, SportEvent>();
  for (const item of raw || []) {
    const sport = SPORTS[String(item?.sport || '').toLowerCase()];
    const title = cleanEventTitle(String(item?.name || ''));
    const start = Number(item?.start) || 0;
    const live = item?.status === 'live';
    if (!sport || !title || !englishTitle(title) || NOT_LIVE.test(title) || !FIXTURE.test(title) || (!live && (start < now || start - now > horizonSec))) {
      continue;
    }
    if (TEAM_SPORTS.has(sport) && !MATCHUP.test(title)) {
      continue;
    }
    let channelId: string | undefined;
    const feeds: Source[] = [];
    for (const b of item.broadcasts || []) {
      const rawName = String(b?.name || '').replace(/\s+·\s+[^·]+$/, '');
      const parsed = parseChannelName(rawName);
      const curated = index.get(`UK|${parsed.key}`) || index.get(`US|${parsed.key}`);
      if (curated && merged.has(curated.id) && SPORT_CATEGORIES.has(curated.category)) {
        channelId = channelId || curated.id;
      } else if (UKUS_PREFIX.test(rawName) && SPORTY_FEED.test(rawName) && b?.id) {
        feeds.push({provider: String(b.id).split(':')[0], id: String(b.id), rawName, quality: parsed.quality, fps60: parsed.fps60, hevc: parsed.hevc, epgId: '', logo: ''});
      }
    }
    if (!channelId && !feeds.length) {
      continue;
    }
    const key = title.replace(/^[A-Za-z ]{2,20}:\s*/, '').replace(/^(?:NBA|NFL|PL|EPL)\s*-\s*/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const existing = out.get(key);
    if (existing) {
      existing.channelId = existing.channelId || channelId;
      existing.feeds.push(...feeds);
      continue;
    }
    const split = splitEvent(title);
    out.set(key, {
      key,
      title: split.title,
      competition: split.competition,
      sport,
      live,
      start,
      channelId,
      channelName: channelId ? merged.get(channelId)?.name : undefined,
      feeds,
      tier: tierOf(title),
    });
  }
  let list = [...out.values()];
  for (const e of list) {
    e.feeds.sort((a, b) => b.quality - a.quality);
    e.feeds = e.feeds.slice(0, 6);
    if (!e.channelName && e.feeds.length) {
      e.channelName = feedLabel(e.feeds[0].rawName);
    }
  }
  // One live listing per channel: providers often send the same match twice
  // under different names; keep the clearest (a real match-up, then the longest).
  const byChannel = new Map<string, SportEvent>();
  const clarity = (e: SportEvent) => (MATCHUP.test(e.title) ? 100 : 0) + e.title.length;
  for (const e of list) {
    if (!e.live || !e.channelId) {
      continue;
    }
    const seen = byChannel.get(e.channelId);
    if (!seen || clarity(e) > clarity(seen)) {
      byChannel.set(e.channelId, e);
    }
  }
  list = list.filter((e) => !e.live || !e.channelId || byChannel.get(e.channelId) === e);
  // Live first (headline events at the top), then what's coming up; minor events last.
  const rank = (e: SportEvent) => (e.tier === 2 ? 1e12 : 0) + (e.live ? 0 : 1e11) + e.tier * 1e10 + e.start;
  return list.sort((a, b) => rank(a) - rank(b)).slice(0, 40);
}
