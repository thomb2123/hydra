// Merges the same channel from several IPTV providers into one curated entry
// with a ranked list of sources (best first). Pure logic: no network.
import {parseChannelName} from './normalize';
import {CHANNELS, Channel, Country, EXCLUDE_CATEGORY, EXCLUDE_NAME, channelIndex} from './lineup';

export interface ProviderEntry {
  id: string;
  name: string;
  category?: string;
  epg_id?: string;
  image?: string;
}

export interface Source {
  provider: string;
  id: string;
  rawName: string;
  quality: number;
  fps60: boolean;
  hevc: boolean;
  epgId: string;
  logo: string;
}

export interface MergedChannel extends Channel {
  sources: Source[];
  logo: string;
  /** Picture quality to advertise: UHD only once this stick has actually played it. */
  badge: 'UHD' | 'HD' | '';
}

export function categoryUseful(category: string): boolean {
  return !EXCLUDE_CATEGORY.test(category || '');
}

/** Collects every usable provider entry under the curated channel it belongs to. */
export function collectSources(
  lists: {provider: string; country: Country; entries: ProviderEntry[]}[],
): Map<string, Source[]> {
  const index = channelIndex();
  const out = new Map<string, Source[]>();
  for (const list of lists) {
    for (const entry of list.entries) {
      if (!entry || !entry.id || !entry.name || EXCLUDE_NAME.test(entry.name) || !categoryUseful(entry.category || '')) {
        continue;
      }
      const parsed = parseChannelName(entry.name);
      if (parsed.timeshift) {
        continue;
      }
      const channel = index.get(`${list.country}|${parsed.key}`);
      if (!channel) {
        continue;
      }
      const sources = out.get(channel.id) || [];
      if (!sources.some((s) => s.provider === list.provider && s.id === entry.id)) {
        sources.push({
          provider: list.provider,
          id: String(entry.id),
          rawName: entry.name,
          quality: parsed.quality,
          fps60: parsed.fps60,
          hevc: parsed.hevc,
          epgId: String(entry.epg_id || ''),
          logo: String(entry.image || ''),
        });
      }
      out.set(channel.id, sources);
    }
  }
  return out;
}

export interface Reliability {
  /** provider -> recent success ratio 0..1 (default 0.7). */
  provider: Record<string, number>;
  /** "provider|id" -> failures recorded on this stick. */
  failures: Record<string, number>;
  /** "provider|id" -> when it last failed (ms); old failures count for less. */
  failedAt?: Record<string, number>;
  /** "provider|id" -> when it last played properly (ms). */
  good?: Record<string, number>;
  /** "provider|id" -> picture height measured when it played (e.g. 2160). */
  height?: Record<string, number>;
}

const HOUR = 3600 * 1000;
const FAILURE_HALF_LIFE = 12 * HOUR;
const GOOD_FOR = 3 * 24 * HOUR;

export const sourceKey = (s: Pick<Source, 'provider' | 'id'>) => `${s.provider}|${s.id}`;

/** Failures fade with time, so a channel that was off air last night is tried again today. */
export function effectiveFailures(rel: Reliability | undefined, key: string, now = Date.now()): number {
  const n = rel?.failures[key] || 0;
  if (!n) {
    return 0;
  }
  const at = rel?.failedAt?.[key];
  return at ? n * Math.pow(0.5, Math.max(0, now - at) / FAILURE_HALF_LIFE) : n;
}

export function rankSources(sources: Source[], reliability?: Reliability, now = Date.now()): Source[] {
  const score = (s: Source) => {
    const key = sourceKey(s);
    const providerOk = reliability?.provider[s.provider] ?? 0.7;
    const failed = Math.min(effectiveFailures(reliability, key, now), 5);
    const recentGood = now - (reliability?.good?.[key] || 0) < GOOD_FOR ? 1 : 0;
    const height = reliability?.height?.[key] || 0;
    // Real picture size beats the provider's label once we have measured it.
    const quality = height >= 2000 ? 4 : height >= 1000 ? Math.max(3, Math.min(s.quality, 3)) : height > 0 ? 2 : s.quality;
    // Quality dominates; a source that played recently gets a boost, and two
    // recent failures push a source below a working one of the next quality down.
    return quality * 10 + (s.fps60 ? 1 : 0) + providerOk * 4 + recentGood * 6 - failed * 12;
  };
  return [...sources].sort((a, b) => score(b) - score(a));
}

export function badgeFor(sources: Source[], reliability?: Reliability): MergedChannel['badge'] {
  const top = sources.slice(0, 3);
  if (top.some((s) => (reliability?.height?.[sourceKey(s)] || 0) >= 2000)) {
    return 'UHD';
  }
  return top.some((s) => s.quality >= 2) ? 'HD' : '';
}

export function mergeChannels(found: Map<string, Source[]>, reliability?: Reliability): MergedChannel[] {
  const out: MergedChannel[] = [];
  for (const channel of CHANNELS) {
    const sources = found.get(channel.id);
    if (!sources || !sources.length) {
      continue;
    }
    const ranked = rankSources(sources, reliability).slice(0, 8);
    out.push({
      ...channel,
      sources: ranked,
      logo: (ranked.find((s) => /^https:/.test(s.logo)) || {logo: ''}).logo,
      badge: badgeFor(ranked, reliability),
    });
  }
  return out;
}
