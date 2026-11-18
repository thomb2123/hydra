// "What should be on" for every channel, from a real broadcaster/operator guide,
// never from the IPTV providers' own (often wrong) guides:
// - UK: Sky's listings (skyGuide.ts); Virgin Media's for the few Sky does not carry.
// - US: TV Guide's national listings (one request covers every US channel).
// Channels with no official listing anywhere say so (OFFICIAL_NONE) instead of
// quietly showing the stream's own guide as if it were real.
import {requestJson} from '../../../../shared/src/net';
import {Programme} from './flixnest';
import {SKY_SID, skyNowNext} from './skyGuide';

export type GuideName = 'Sky' | 'Virgin Media' | 'TV Guide';

export interface OfficialNowNext {
  now: Programme | null;
  next: Programme | null;
  /** The programme before (provider guides often run one behind). */
  prev?: Programme | null;
  guide: GuideName;
}

/** App channel id → TV Guide source id (backend.tvguide.com national grid, checked 18 Nov 2026). */
export const TVGUIDE_ID: Record<string, number> = {
  // Networks
  'us-abc': 9233011874, 'us-cbs': 9200018514, 'us-nbc': 9233009876, 'us-fox': 9233002271, 'us-cw': 9233011398, 'us-pbs': 9233004141,
  // Entertainment & drama
  'us-amc': 9233011832, 'us-fx': 9200006932, 'us-fxx': 9200018644, 'us-usa': 9233004106, 'us-tnt': 9233011830, 'us-tbs': 9233000403,
  'us-paramount': 9233013810, 'us-bravo': 9200002886, 'us-ae': 9200004889, 'us-syfy': 9200004316, 'us-comedycentral': 9200000657,
  'us-hallmark': 9200016034, 'us-lifetime': 9200020452, 'us-freeform': 9200006942, 'us-e': 9200012343, 'us-tlc': 9233004112,
  'us-hgtv': 9233004104, 'us-food': 9233009448, 'us-discovery': 9233004102, 'us-history': 9233008002, 'us-natgeo': 9233002310,
  // Sport
  'us-espn': 9200006937, 'us-espn2': 9200012351, 'us-espnu': 9233011350, 'us-espnews': 9200006950, 'us-fs1': 9233008440,
  'us-fs2': 9200009884, 'us-cbssn': 9233013235, 'us-nflnet': 9200004330, 'us-nbatv': 9200000070, 'us-mlbnet': 9200009223,
  'us-nhlnet': 9233009455, 'us-golf': 9233005443, 'us-tennis': 9200017917,
  // Films
  'us-hbo': 9200004886, 'us-hbo2': 9233003524, 'us-hbosig': 9233008160, 'us-hbocomedy': 9200006981, 'us-showtime': 9200016599,
  'us-starz': 9233013809, 'us-cinemax': 9233009829, 'us-tcm': 9200017928,
  // News
  'us-cnn': 9233013812, 'us-foxnews': 9233000410, 'us-msnbc': 9233006803, 'us-cnbc': 9200009413, 'us-foxbusiness': 9200009124,
  'us-bloomberg': 9233015798,
};

/** App channel id → Virgin Media channel id (UK channels Sky does not list). */
export const VIRGIN_ID: Record<string, string> = {
  'uk-tntultimate': '1954',
};

/** Channels no official guide lists, and why (shown instead of a made-up listing). */
export const OFFICIAL_NONE: Record<string, string> = {
  'uk-sc-animation': 'Sky no longer has this channel',
  'uk-skyreplay': 'Sky no longer has this channel',
  'uk-euro1': 'Eurosport 1 is not in the Sky or Virgin guides',
  'uk-euro2': 'Eurosport 2 is not in the Sky or Virgin guides',
  'uk-laliga': 'LaLiga TV is not in the Sky or Virgin guides',
  'us-redzone': 'RedZone has no fixed schedule (it follows Sunday NFL games)',
  'us-abcnews': 'A streaming-only channel with no TV listing',
  'us-cbsnews': 'A streaming-only channel with no TV listing',
  'us-nbcnewsnow': 'A streaming-only channel with no TV listing',
};

/** "Sky guide", "Virgin Media guide", "TV Guide". */
export function guideLabel(guide?: GuideName): string {
  return guide === 'TV Guide' ? 'TV Guide' : `${guide || 'Sky'} guide`;
}

export function guideFor(channelId: string): GuideName | null {
  return SKY_SID[channelId] ? 'Sky' : VIRGIN_ID[channelId] ? 'Virgin Media' : TVGUIDE_ID[channelId] ? 'TV Guide' : null;
}

function pick(list: Programme[], now: number): {now: Programme | null; next: Programme | null; prev: Programme | null} {
  const sorted = [...list].sort((a, b) => (a.start || 0) - (b.start || 0));
  const i = sorted.findIndex((p) => (p.start || 0) <= now && now < (p.end || 0));
  return i >= 0
    ? {now: sorted[i], next: sorted[i + 1] || null, prev: sorted[i - 1] || null}
    : {now: null, next: sorted.find((p) => (p.start || 0) > now) || null, prev: null};
}

// ---- TV Guide (US) ----

const TVG = 'https://backend.tvguide.com/tvschedules/tvguide';
const TVG_PROVIDER = '9100001138';
const TVG_HEADERS = {Referer: 'https://www.tvguide.com/'};
const TVG_LIVE = 1; // airingAttrib bit: live

interface TvgProgramme extends Programme {
  programId?: number;
}

let tvgGrid: {bucket: number; at: number; ok: boolean; byId: Map<number, TvgProgramme[]>} | null = null;
let tvgInflight: Promise<Map<number, TvgProgramme[]>> | null = null;

export function parseTvGuide(json: any): Map<number, TvgProgramme[]> {
  const byId = new Map<number, TvgProgramme[]>();
  for (const item of json?.data?.items || []) {
    const id = Number(item?.channel?.sourceId);
    const list: TvgProgramme[] = [];
    for (const p of item?.programSchedules || []) {
      const start = Number(p?.startTime);
      const end = Number(p?.endTime);
      const title = String(p?.title || '').trim();
      if (title && end > start) {
        list.push({title, start, end, live: (Number(p?.airingAttrib) & TVG_LIVE) === TVG_LIVE, programId: Number(p?.programId) || undefined});
      }
    }
    if (id) {
      byId.set(id, list);
    }
  }
  return byId;
}

/** The national grid from the current half hour, 4 hours ahead (about 200 KB for ~150 channels). */
async function tvGuideGrid(now: number): Promise<Map<number, TvgProgramme[]>> {
  const bucket = Math.floor(now / 1800) * 1800;
  if (tvgGrid && tvgGrid.bucket === bucket && (tvgGrid.ok || Date.now() - tvgGrid.at < 60000)) {
    return tvgGrid.byId;
  }
  if (tvgInflight) {
    return tvgInflight;
  }
  tvgInflight = (async () => {
    try {
      const byId = parseTvGuide(await requestJson(`${TVG}/${TVG_PROVIDER}/web?start=${bucket}&duration=240`, {timeoutMs: 8000, headers: TVG_HEADERS}));
      tvgGrid = {bucket, at: Date.now(), ok: true, byId};
      return byId;
    } catch {
      const old = tvgGrid?.byId || new Map();
      tvgGrid = {bucket, at: Date.now(), ok: false, byId: old};
      return old;
    }
  })().finally(() => {
    tvgInflight = null;
  });
  return tvgInflight;
}

const tvgDetails = new Map<number, string>();

export function tvGuideDescription(json: any): string {
  const item = json?.data?.item || {};
  const episode = String(item.episodeTitle || '').trim();
  const text = String(item.description || '').trim();
  return [episode, text].filter(Boolean).join(' — ');
}

/** Adds TV Guide's description to a programme (cached; on failure the programme comes back as it was). */
export async function describe<T extends Programme>(p: T | null): Promise<T | null> {
  if (!p || !p.programId || p.description) {
    return p;
  }
  if (!tvgDetails.has(p.programId)) {
    try {
      tvgDetails.set(p.programId, tvGuideDescription(await requestJson(`${TVG}/programdetails/${p.programId}/web`, {timeoutMs: 12000, headers: TVG_HEADERS})));
    } catch {
      return p;
    }
    if (tvgDetails.size > 400) {
      tvgDetails.delete(tvgDetails.keys().next().value as number);
    }
  }
  const description = tvgDetails.get(p.programId);
  return description ? {...p, description} : p;
}

// ---- Virgin Media (UK channels Sky does not list) ----

const VM = 'https://staticqbr-prod-gb.gnp.cloud.virgintvgo.virginmedia.com/eng/web/epg-service-lite/gb/en/events/segments';
const vmSegments = new Map<string, {at: number; byId: Map<string, Programme[]>}>();

export function parseVirgin(json: any): Map<string, Programme[]> {
  const byId = new Map<string, Programme[]>();
  for (const entry of json?.entries || []) {
    const list: Programme[] = [];
    for (const e of entry?.events || []) {
      const start = Number(e?.startTime);
      const end = Number(e?.endTime);
      const title = String(e?.title || '').trim();
      if (title && end > start) {
        list.push({title, start, end, live: !!e?.isLive});
      }
    }
    byId.set(String(entry?.channelId), list);
  }
  return byId;
}

/** Virgin files its guide in 6-hour UTC segments (YYYYMMDD + 00/06/12/18). */
async function virginSegment(sec: number): Promise<Map<string, Programme[]>> {
  const d = new Date(sec * 1000);
  const key = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(Math.floor(d.getUTCHours() / 6) * 6).padStart(2, '0')}0000`;
  const hit = vmSegments.get(key);
  if (hit && Date.now() - hit.at < 2 * 3600 * 1000) {
    return hit.byId;
  }
  try {
    const byId = parseVirgin(await requestJson(`${VM}/${key}`, {timeoutMs: 8000}));
    // Only the channels the app uses are kept (a segment lists ~300 channels).
    const wanted = new Set(Object.values(VIRGIN_ID));
    const kept = new Map([...byId].filter(([id]) => wanted.has(id)));
    vmSegments.set(key, {at: Date.now(), byId: kept});
    if (vmSegments.size > 4) {
      vmSegments.delete(vmSegments.keys().next().value as string);
    }
    return kept;
  } catch {
    return hit?.byId || new Map();
  }
}

// ---- One entry point ----

export async function officialNowNext(channelId: string, now = Date.now() / 1000): Promise<OfficialNowNext | null> {
  if (SKY_SID[channelId]) {
    const sky = await skyNowNext(channelId, now);
    return sky ? {now: sky.now, next: sky.next, prev: sky.prev, guide: 'Sky'} : null;
  }
  const vmId = VIRGIN_ID[channelId];
  if (vmId) {
    let list = (await virginSegment(now)).get(vmId) || [];
    let found = pick(list, now);
    if (!found.next) {
      list = [...list, ...((await virginSegment(now + 6 * 3600)).get(vmId) || [])];
      found = pick(list, now);
    }
    return found.now || found.next ? {...found, guide: 'Virgin Media'} : null;
  }
  const tvgId = TVGUIDE_ID[channelId];
  if (tvgId) {
    const found = pick((await tvGuideGrid(now)).get(tvgId) || [], now);
    if (!found.now && !found.next) {
      return null;
    }
    return {now: await describe(found.now as TvgProgramme | null), next: found.next, prev: found.prev, guide: 'TV Guide'};
  }
  return null;
}

/** For tests. */
export function clearOfficialCache(): void {
  tvgGrid = null;
  tvgDetails.clear();
  vmSegments.clear();
}
