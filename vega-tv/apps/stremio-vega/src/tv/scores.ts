// Is it really live? TV listings flag re-runs as "live" (last night's match shown
// again this afternoon, with this afternoon's times), so Live Now checks events
// against live scores: ESPN's public scoreboards say whether a match is in
// progress ("in"), finished ("post") or not started ("pre").
import {requestJson} from '../../../../shared/src/net';
import {EARLY_SEC, SportEvent} from './events';

export type ScoreState = 'pre' | 'in' | 'post';

export interface Scores {
  events: ScoreEvent[];
  /** Sports whose scoreboard for today loaded. */
  covered: Set<string>;
}

export interface ScoreEvent {
  sport: string;
  /** Searchable words: team, fighter or event names. */
  words: string[];
  /** Team abbreviations ("sa", "ban"), matched whole. */
  abbrs: string[];
  state: ScoreState;
  /** Status in words, e.g. "Halftime", "Stumps", "Rain Delay". */
  detail: string;
  start: number;
}

/** In progress on paper, but nothing is being played: the channel shows something else. */
const NOT_PLAYING = /stumps|close of play|abandon|suspend|delay|postpon|cancel|no result/i;

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
/** Scoreboards per app sport; the soccer one is asked for several days to recognise re-runs. */
const BOARDS: {sport: string; path: string; days: number; utcToday?: boolean}[] = [
  {sport: 'Football', path: 'soccer/all', days: 5, utcToday: true},
  {sport: 'Basketball', path: 'basketball/nba', days: 3},
  {sport: 'NFL', path: 'football/nfl', days: 0},
  {sport: 'UFC & MMA', path: 'mma/ufc', days: 0},
  {sport: 'Formula 1', path: 'racing/f1', days: 0},
  {sport: 'Tennis', path: 'tennis/atp', days: 0},
  {sport: 'Tennis', path: 'tennis/wta', days: 0},
];
/** All-league "header" feeds, for sports whose per-league boards are not enough. */
const HEADERS: {sport: string; query: string}[] = [
  {sport: 'Cricket', query: 'cricket'},
  {sport: 'Rugby', query: 'rugby'},
];
/** Sports where a fixture ESPN does not list at all is not trusted as live. */
const STRICT = new Set(['Football', 'NFL', 'Formula 1', 'Cricket', 'Rugby']);

const GENERIC = new Set([
  'the', 'and', 'fc', 'afc', 'cf', 'sc', 'ac', 'united', 'city', 'town', 'county', 'club', 'real', 'sporting', 'athletic', 'rovers',
  'grand', 'prix', 'open', 'final', 'finals', 'cup', 'league', 'championship', 'international', 'world', 'tour', 'series', 'night',
  'fight', 'live', 'men', 'women', 'womens', 'mens', 'round', 'match', 'game', 'session', 'main', 'card', 'event', 'vs',
]);
const ALIAS: Record<string, string> = {utd: 'united', man: 'manchester', spurs: 'tottenham', wolves: 'wolverhampton', psg: 'paris'};

// Matching compares each listing with every score of its sport, so the same names are
// split thousands of times per refresh; results are remembered (callers do not modify them).
const wordCache = new Map<string, string[]>();
export function words(text: string): string[] {
  const key = String(text || '');
  let hit = wordCache.get(key);
  if (!hit) {
    hit = splitWords(key);
    if (wordCache.size > 20000) {
      wordCache.clear();
    }
    wordCache.set(key, hit);
  }
  return hit;
}

function splitWords(text: string): string[] {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => ALIAS[w] || w)
    .filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
const hits = (side: string[], pool: string[]) => side.some((w) => pool.some((p) => near(w, p)));

/** Does this scoreboard entry describe the listed event? */
export function sameEvent(e: Pick<SportEvent, 'title' | 'competition'>, s: ScoreEvent): boolean {
  const rawSides = e.title.split(/\s+(?:v|vs\.?|at|@)\s+/i).map((t) => t.trim()).filter(Boolean);
  if (rawSides.length >= 2) {
    // A side matches by name ("Bangladesh") or by its abbreviation ("BAN", "SA").
    return rawSides.every((side) => hits(words(side), s.words) || s.abbrs.includes(side.toLowerCase()));
  }
  const all = words(`${e.title} ${e.competition}`);
  return all.filter((w) => s.words.some((p) => near(w, p))).length >= 2;
}

/** Re-run and highlights signs that need no scores: an old year in the title, a too-short slot. */
const MIN_SLOT_MIN: Record<string, number> = {Football: 95, Rugby: 75, Cricket: 150, Basketball: 100, NFL: 150};
export function looksLikeReplay(e: Pick<SportEvent, 'title' | 'competition' | 'sport' | 'start' | 'end'>, now = Date.now() / 1000): boolean {
  const thisYear = new Date(now * 1000).getUTCFullYear();
  const text = `${e.title} ${e.competition}`;
  const years = [...text.matchAll(/\b((?:19|20)\d{2})(?:\s*\/\s*((?:19|20)?\d{2}))?\b/g)].map((m) => {
    const second = m[2] ? Number(m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2]) : 0;
    return Math.max(Number(m[1]), second);
  });
  if (years.length && Math.max(...years) < thisYear) {
    return true;
  }
  const minimum = MIN_SLOT_MIN[e.sport];
  return !!(minimum && e.start && e.end && e.end > e.start && (e.end - e.start) / 60 < minimum);
}

export type Verdict = 'live' | 'finished' | 'not-started' | 'unknown';

export type ProgrammeTag = 'LIVE' | 'REPLAY' | null;
const REPLAY_WORDS = /highlights|replay|classic|rewind|\bretro\b|flashback|greatest|best of|\byears\b|review|preview|magazine|documentary|\bstor(?:y|ies)\b|reloaded|encore/i;

/**
 * Tags a channel's current programme for the guide: LIVE when live scores say the match
 * in the title is in progress (or the listing says "Live"), REPLAY when the match finished
 * earlier, the title names an old year, or it is highlights/classics; otherwise nothing.
 */
export function programmeTag(title: string, scores: Scores | null, now = Date.now() / 1000): ProgrammeTag {
  const text = String(title || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return null;
  }
  if (REPLAY_WORDS.test(text) || looksLikeReplay({title: text, competition: '', sport: '', start: 0}, now)) {
    return 'REPLAY';
  }
  const saysLive = /^\s*live\b|\blive\s*[:|-]/i.test(text);
  const fixture = text.replace(/^\s*live\s*[:|-]?\s*/i, '').replace(/^[^:]{2,40}:\s*/, '');
  if (scores && /\s(?:v|vs\.?|at|@)\s/i.test(fixture)) {
    const mine = scores.events.filter((s) => sameEvent({title: fixture, competition: ''}, s));
    if (mine.some((s) => s.state === 'in' && !NOT_PLAYING.test(s.detail))) {
      return 'LIVE';
    }
    if (mine.length && mine.every((s) => s.state === 'post' || NOT_PLAYING.test(s.detail))) {
      return 'REPLAY';
    }
  }
  return saysLive ? 'LIVE' : null;
}

function judge(e: SportEvent, scores: Scores | null, now: number): {verdict: Verdict; start?: number} {
  if (looksLikeReplay(e, now)) {
    return {verdict: 'finished'};
  }
  if (!scores) {
    return {verdict: 'unknown'};
  }
  const mine = scores.events.filter((s) => s.sport === e.sport && sameEvent(e, s));
  const inPlay = mine.filter((s) => s.state === 'in');
  if (inPlay.length) {
    // "Stumps", rain delay, suspended: on paper live, but nothing is being played.
    return inPlay.some((s) => !NOT_PLAYING.test(s.detail)) ? {verdict: 'live'} : {verdict: 'finished'};
  }
  if (mine.length) {
    // The nearest listing decides: finished earlier, or not started yet (with its real start time).
    const nearest = [...mine].sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))[0];
    return nearest.state === 'post' ? {verdict: 'finished'} : {verdict: 'not-started', start: nearest.start || undefined};
  }
  return {verdict: scores.covered.has(e.sport) && STRICT.has(e.sport) ? 'finished' : 'unknown'};
}

export function verdictFor(e: SportEvent, scores: Scores | null, now = Date.now() / 1000): Verdict {
  return judge(e, scores, now).verdict;
}

/**
 * Applies live scores to what is live or about to start: confirmed matches stay
 * live, re-runs go, and not-started ones wait for their real kick-off.
 */
export function applyScores(events: SportEvent[], scores: Scores | null, now = Date.now() / 1000): SportEvent[] {
  const out: SportEvent[] = [];
  for (const e of events) {
    const soon = !!e.start && e.start - now <= EARLY_SEC + 5 * 60;
    if (!e.live && !soon) {
      out.push(e);
      continue;
    }
    const {verdict, start} = judge(e, scores, now);
    if (verdict === 'live') {
      out.push({...e, live: true, verified: true, endsBy: Math.max(e.endsBy, now + 20 * 60)});
    } else if (verdict === 'not-started') {
      const realStart = start && start > now ? start : e.start;
      out.push({...e, live: false, scheduled: true, start: realStart, endsBy: Math.max(e.endsBy, realStart + 3600)});
    } else if (verdict === 'unknown') {
      // Strict sports that the scores service names "not on today" are dropped above;
      // here only sports it does not cover remain, judged by the listing alone.
      out.push(e);
    }
  }
  return out;
}

export function parseBoard(sport: string, data: any): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (const ev of data?.events || []) {
    const state = ev?.status?.type?.state;
    if (state !== 'pre' && state !== 'in' && state !== 'post') {
      continue;
    }
    const names: string[] = [ev.name, ev.shortName];
    const abbrs: string[] = [];
    for (const comp of ev.competitions || []) {
      for (const c of comp.competitors || []) {
        names.push(c?.team?.displayName, c?.team?.shortDisplayName, c?.team?.name, c?.team?.location, c?.athlete?.displayName, c?.athlete?.shortName);
        abbrs.push(c?.team?.abbreviation);
      }
    }
    out.push({
      sport,
      words: words(names.filter(Boolean).join(' ')),
      abbrs: abbrs.filter(Boolean).map((a) => String(a).toLowerCase()),
      state,
      detail: String(ev?.status?.type?.description || ''),
      start: Date.parse(ev.date) / 1000 || 0,
    });
  }
  return out;
}

/** The all-league header feed (cricket, rugby): events sit under sports[0].leagues[]. */
export function parseHeader(sport: string, data: any): ScoreEvent[] {
  const out: ScoreEvent[] = [];
  for (const league of data?.sports?.[0]?.leagues || []) {
    for (const ev of league?.events || []) {
      const state = ev?.fullStatus?.type?.state || ev?.status;
      if (state !== 'pre' && state !== 'in' && state !== 'post') {
        continue;
      }
      const competitors: any[] = ev.competitors || [];
      out.push({
        sport,
        words: words([ev.name, ev.shortName, ...competitors.flatMap((c) => [c?.displayName, c?.location])].filter(Boolean).join(' ')),
        abbrs: competitors.flatMap((c) => [c?.abbreviation, c?.name]).filter((a) => a && String(a).length <= 5).map((a) => String(a).toLowerCase()),
        state,
        detail: String(ev?.fullStatus?.type?.description || ''),
        start: Date.parse(ev.date) / 1000 || 0,
      });
    }
  }
  return out;
}

const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const boardCache = new Map<string, {at: number; value: ScoreEvent[]}>();

async function board(sport: string, path: string, date: string | null, ttlMs: number): Promise<ScoreEvent[]> {
  const url = `${BASE}${path}/scoreboard${date ? `?dates=${date}` : ''}`;
  const hit = boardCache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.value;
  }
  const value = parseBoard(sport, await requestJson(url, {timeoutMs: 6000}));
  boardCache.set(url, {at: Date.now(), value});
  return value;
}

async function header(sport: string, query: string): Promise<ScoreEvent[]> {
  const url = `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${query}&lang=en&region=gb`;
  const hit = boardCache.get(url);
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) {
    return hit.value;
  }
  const value = parseHeader(sport, await requestJson(url, {timeoutMs: 6000}));
  boardCache.set(url, {at: Date.now(), value});
  return value;
}

/**
 * Today's scoreboards plus recent days for soccer and NBA (cached for hours: they
 * do not change). Null when the scores service cannot be reached at all.
 */
export async function fetchScores(now = Date.now()): Promise<Scores | null> {
  const covered = new Set<string>();
  const jobs: Promise<ScoreEvent[]>[] = [];
  for (const b of BOARDS) {
    // A sport counts as covered only when its board for today loaded (strict checks depend on it).
    jobs.push(
      board(b.sport, b.path, b.utcToday ? ymd(new Date(now)) : null, 2 * 60 * 1000).then((v) => {
        covered.add(b.sport);
        return v;
      }),
    );
    for (let d = 1; d < b.days; d++) {
      jobs.push(board(b.sport, b.path, ymd(new Date(now - d * 86400000)), 6 * 3600 * 1000));
    }
  }
  for (const h of HEADERS) {
    jobs.push(
      header(h.sport, h.query).then((v) => {
        covered.add(h.sport);
        return v;
      }),
    );
  }
  const results = await Promise.allSettled(jobs);
  if (!covered.size) {
    return null;
  }
  return {events: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])), covered};
}
