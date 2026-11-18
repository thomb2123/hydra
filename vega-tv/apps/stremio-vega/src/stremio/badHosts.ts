// Remembers stream hosts that failed to connect (e.g. blocked by the ISP's DNS)
// so the automatic picker stops choosing them. Entries expire after 3 days.
import {loadJson, saveJson} from '../../../../shared/src/storage';
import {hostOf} from '../../../../shared/src/net';

// v2: cleared on 18 Nov (timeouts during testing had wrongly listed working debrid hosts).
const KEY = 'stremio.badhosts.v3';
const TTL = 3 * 24 * 3600 * 1000;

let cache: Record<string, number> | null = null;

async function load(): Promise<Record<string, number>> {
  if (!cache) {
    const stored = await loadJson<Record<string, number>>(KEY, {});
    const now = Date.now();
    cache = Object.fromEntries(Object.entries(stored).filter(([, at]) => now - at < TTL));
  }
  return cache;
}

export async function badHosts(): Promise<Set<string>> {
  return new Set(Object.keys(await load()));
}

export async function markBadHost(url: string): Promise<void> {
  const map = await load();
  map[hostOf(url).toLowerCase()] = Date.now();
  await saveJson(KEY, map);
}

export function isBadHost(url: string | undefined, hosts: Set<string>): boolean {
  return !!url && /^https?:/i.test(url) && hosts.has(hostOf(url).toLowerCase());
}

// Hosts whose links the Fire TV player cannot seek directly (seen with redirected
// debrid links). Playback for these goes through the PC server route from the start.
const NO_SEEK_KEY = 'stremio.noseekhosts.v1';
let noSeek: Record<string, number> | null = null;

async function loadNoSeek(): Promise<Record<string, number>> {
  if (!noSeek) {
    noSeek = await loadJson<Record<string, number>>(NO_SEEK_KEY, {});
  }
  return noSeek;
}

export async function markNoSeekHost(url: string): Promise<void> {
  const map = await loadNoSeek();
  map[hostOf(url).toLowerCase()] = Date.now();
  await saveJson(NO_SEEK_KEY, map);
}

export async function isNoSeekHost(url: string): Promise<boolean> {
  return /^https?:/i.test(url) && !!(await loadNoSeek())[hostOf(url).toLowerCase()];
}

// Timeouts can be a one-off (some add-ons resolve the debrid link on first request),
// so a host is only marked bad after timing out twice.
const STRIKES_KEY = 'stremio.hoststrikes.v3';
let strikes: Record<string, number> | null = null;

export async function strikeHost(url: string): Promise<boolean> {
  if (!strikes) {
    strikes = await loadJson<Record<string, number>>(STRIKES_KEY, {});
  }
  const host = hostOf(url).toLowerCase();
  strikes[host] = (strikes[host] || 0) + 1;
  await saveJson(STRIKES_KEY, strikes);
  if (strikes[host] >= 2) {
    await markBadHost(url);
    return true;
  }
  return false;
}
