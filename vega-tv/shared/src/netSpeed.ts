// How much bitrate this device's connection really carries for films, learned from
// playback: the stream picker prefers versions under it (like Netflix choosing a
// quality that fits), and repeated stalls lower it. Remembered across launches.
import {loadJson, saveJson} from './storage';

const KEY = 'net.budget.v1';
/** Starting point: most 4K HDR web releases average 15-25 Mbit/s. */
export const DEFAULT_BUDGET_MBPS = 22;
const FLOOR_MBPS = 6;

export interface NetBudget {
  /** Average film bitrate (Mbit/s) that plays here without stalling. */
  mbps: number;
  at: number;
}

let cached: NetBudget | null = null;

export async function playableBudget(): Promise<number> {
  if (!cached) {
    cached = await loadJson<NetBudget | null>(KEY, null);
  }
  if (!cached) {
    return DEFAULT_BUDGET_MBPS;
  }
  // Recover slowly (the Wi-Fi may have improved): back towards the default over a day.
  const hours = (Date.now() - cached.at) / 3600000;
  return Math.min(DEFAULT_BUDGET_MBPS, cached.mbps + hours * 0.5);
}

/** A film of `bitrateMbps` kept stalling here: aim below it from now on. */
export async function recordTooSlow(bitrateMbps: number): Promise<number> {
  const current = await playableBudget();
  const next = Math.max(FLOOR_MBPS, Math.min(current, bitrateMbps * 0.7));
  cached = {mbps: next, at: Date.now()};
  await saveJson(KEY, cached);
  return next;
}
