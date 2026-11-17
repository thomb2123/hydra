// "Live sport" row: football, boxing, UFC/MMA, F1 and other big events that
// are on now or soon, shown only when an English (UK/US) channel carries
// them. Each event plays through the merged channel (best source + failover)
// or, for pay-per-view slots, through the UK/US event feed itself.
import {parseChannelName} from './normalize';
import {channelIndex} from './lineup';
import {MergedChannel, Source} from './channels';

export interface SportEvent {
  key: string;
  title: string;
  sport: string;
  live: boolean;
  start: number;
  /** Curated channel showing it (preferred). */
  channelId?: string;
  channelName?: string;
  /** Direct UK/US event feeds when no curated channel carries it. */
  feeds: Source[];
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

const FOREIGN = /\b(?:fu(?:ss|ß)ball|boksning|partido|spiel|spieltag|kampf|fodbold|fotboll|calcio|jalkapallo|halbfinale|rückspiel|jornada|journée|journee|giornata|kolejka|dvouhra|compacto|resumen|wedstrijd|partita|mecz|rennen|mexiko|openul|irlandei|finala)\b/i;
// What a real live fixture or event looks like (and what a filler programme does not).
const FIXTURE = /\s(?:v|vs\.?|at)\s|\bUFC\b|Fight Night|\bBoxing\b|Grand Prix|Formula 1|\bF1\b|MotoGP|Qualifying|Practice|Sprint|Darts|Snooker|\bOpen\b|Masters|\bFinal\b|\bCup\b|League|Test Match|\bATP\b|\bWTA\b|\bPGA\b|Six Nations/i;
const NOT_LIVE = /^next event|^tbc\b|\byears\b|^\d{4}\s|highlights|replay|classic|rewind|preview|review|\bmagazine\b|\bshow\b/i;
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
    out.set(key, {key, title, sport, live, start, channelId, channelName: channelId ? merged.get(channelId)?.name : undefined, feeds});
  }
  const list = [...out.values()];
  for (const e of list) {
    e.feeds.sort((a, b) => b.quality - a.quality);
    e.feeds = e.feeds.slice(0, 6);
  }
  const rank = (e: SportEvent) => (e.live ? 0 : 1) * 1e10 + e.start;
  return list.sort((a, b) => rank(a) - rank(b)).slice(0, 40);
}
