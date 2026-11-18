// The official Sky UK listings: what a Sky box says each channel is showing.
// IPTV providers attach their own (often wrong) guides to streams, so for every
// channel Sky carries, this is the reference for "what should be on", whether it
// is live (Sky titles live shows "Live …"), and the synopsis.
import {requestJson} from '../../../../shared/src/net';
import {Programme} from './flixnest';

/** App channel id → Sky service id (from awk.epgsky.com/hawk/linear/services/4101/1, checked 18 Nov 2026). */
export const SKY_SID: Record<string, string> = {
  // Entertainment (Sky One replaced Sky Max and Sky Showcase)
  'uk-bbc1': '3000', 'uk-bbc2': '2075', 'uk-itv1': '6504', 'uk-ch4': '4075', 'uk-ch5': '4058',
  'uk-showcase': '4061', 'uk-skymax': '4061', 'uk-itv2': '6532', 'uk-e4': '4076', 'uk-dave': '3809',
  'uk-comedycentral': '4056', 'uk-skycomedy': '1143', 'uk-itv4': '6534', 'uk-w': '2617', 'uk-gold': '6513',
  'uk-itvbe': '3026', // ITVBe is now ITV Quiz
  'uk-bbc3': '2080', 'uk-bbc4': '2086', 'uk-quest': '1128', 'uk-really': '2325', 'uk-5star': '3023',
  // Drama & crime
  'uk-atlantic': '4053', 'uk-witness': '4066', 'uk-skycrime': '1212', 'uk-itv3': '6533', 'uk-alibi': '3825',
  'uk-drama': '2612', 'uk-5usa': '3022', 'uk-more4': '4043', 'uk-ci': '4088',
  // Sport
  'uk-ss-main': '4002', 'uk-ss-pl': '4010', 'uk-ss-football': '3939', 'uk-ss-f1': '3835', 'uk-ss-cricket': '4081',
  'uk-ss-golf': '4026', 'uk-ss-tennis': '1284', 'uk-ss-nfl': '4022', 'uk-ss-mix': '4090', 'uk-ss-racing': '4032',
  'uk-ss-arena': '3940', // Sky Sports Arena is now Sky Sports+
  'uk-ss-news': '4049', 'uk-tnt1': '3625', 'uk-tnt2': '3627', 'uk-tnt3': '3629', 'uk-tnt4': '4040',
  'uk-premier1': '1289', 'uk-premier2': '1290', 'uk-racingtv': '5272', 'uk-mutv': '1003', 'uk-lfctv': '3845',
  // Films
  // Provider "Sky Cinema Hits" / "Select" streams carry Sky's seasonal pop-ups (checked by frame, 18 Nov 2026).
  'uk-sc-hits': '4033', 'uk-sc-select': '4020',
  'uk-sc-premiere': '4021', 'uk-sc-greats': '4015', 'uk-sc-action': '4014', 'uk-sc-thriller': '4062',
  'uk-sc-comedy': '4019', 'uk-sc-drama': '4016', 'uk-sc-scifi': '4017', 'uk-sc-family': '4018', 'uk-film4': '4044',
  // News
  'uk-bbcnews': '2085', 'uk-skynews': '4050', 'uk-gbnews': '1196', 'uk-cnn': '1019', 'uk-cnbc': '1088',
  'uk-bloomberg': '1074', 'uk-aljazeera': '1023',
  // Documentaries
  'uk-skydocs': '1136', 'uk-skynature': '1165', 'uk-skyhistory': '4086', 'uk-discovery': '4003',
  'uk-natgeo': '4031', 'uk-natgeowild': '4025', 'uk-animalplanet': '2402',
};

export interface SkyProgramme extends Programme {
  title: string;
  start: number;
  end: number;
  /** Sky lists it as live ("Live …"). */
  live: boolean;
}

const BASE = 'https://awk.epgsky.com/hawk/linear/schedule';
const TTL_MS = 30 * 60 * 1000;
const FAIL_TTL_MS = 2 * 60 * 1000;
const days = new Map<string, {at: number; ok: boolean; list: SkyProgramme[]}>();
const inflight = new Map<string, Promise<SkyProgramme[]>>();

export function parseSchedule(json: any): SkyProgramme[] {
  const events = json?.schedule?.[0]?.events || [];
  const out: SkyProgramme[] = [];
  for (const e of events) {
    const start = Number(e?.st);
    const length = Number(e?.d);
    const title = String(e?.t || '').trim();
    if (!title || !Number.isFinite(start) || !(length > 0)) {
      continue;
    }
    out.push({title, description: String(e?.sy || '').trim() || undefined, start, end: start + length, live: /^live\b/i.test(title)});
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Sky's schedule is filed by UK day (YYYYMMDD); the stick runs on UK time. */
function dayKey(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchDay(sid: string, date: string): Promise<SkyProgramme[]> {
  const key = `${sid}|${date}`;
  const hit = days.get(key);
  if (hit && Date.now() - hit.at < (hit.ok ? TTL_MS : FAIL_TTL_MS)) {
    return hit.list;
  }
  const running = inflight.get(key);
  if (running) {
    return running;
  }
  const task = (async () => {
    try {
      const list = parseSchedule(await requestJson(`${BASE}/${date}/${sid}`, {timeoutMs: 6000}));
      days.set(key, {at: Date.now(), ok: true, list});
      return list;
    } catch {
      days.set(key, {at: Date.now(), ok: false, list: hit?.list || []});
      return hit?.list || [];
    }
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export function pickNowNext(list: SkyProgramme[], now: number): {now: SkyProgramme | null; next: SkyProgramme | null; prev: SkyProgramme | null} {
  const i = list.findIndex((p) => p.start <= now && now < p.end);
  if (i >= 0) {
    return {now: list[i], next: list[i + 1] || null, prev: list[i - 1] || null};
  }
  return {now: null, next: list.find((p) => p.start > now) || null, prev: null};
}

/** What Sky's guide says is on this channel now and next; null when Sky does not carry it or cannot be reached. */
export async function skyNowNext(channelId: string, now = Date.now() / 1000): Promise<{now: SkyProgramme | null; next: SkyProgramme | null; prev: SkyProgramme | null} | null> {
  const sid = SKY_SID[channelId];
  if (!sid) {
    return null;
  }
  let list = await fetchDay(sid, dayKey(now));
  // Around midnight (or Sky's day boundary) the programme on now, or the next one, sits in the next or previous day's file.
  if (!list.length || list[0].start > now) {
    list = [...(await fetchDay(sid, dayKey(now - 86400))), ...list];
  }
  if (!list.length || list[list.length - 1].end - now < 3 * 3600) {
    list = [...list, ...(await fetchDay(sid, dayKey(now + 86400)))];
  }
  const seen = new Set<number>();
  list = list.filter((p) => !seen.has(p.start) && !!seen.add(p.start)).sort((a, b) => a.start - b.start);
  const pick = pickNowNext(list, now);
  return pick.now || pick.next ? pick : null;
}

/** For tests. */
export function clearSkyCache(): void {
  days.clear();
  inflight.clear();
}
