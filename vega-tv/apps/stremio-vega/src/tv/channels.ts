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
  /** source id -> failures recorded on this stick. */
  failures: Record<string, number>;
}

export function rankSources(sources: Source[], reliability?: Reliability): Source[] {
  const score = (s: Source) => {
    const providerOk = reliability?.provider[s.provider] ?? 0.7;
    const failed = reliability?.failures[`${s.provider}|${s.id}`] || 0;
    // Quality dominates; reliability breaks ties, and two failures on this stick push
    // a source below a working one of the next quality down.
    return s.quality * 10 + (s.fps60 ? 1 : 0) + providerOk * 4 - Math.min(failed, 5) * 12;
  };
  return [...sources].sort((a, b) => score(b) - score(a));
}

export function mergeChannels(found: Map<string, Source[]>, reliability?: Reliability): MergedChannel[] {
  const out: MergedChannel[] = [];
  for (const channel of CHANNELS) {
    const sources = found.get(channel.id);
    if (!sources || !sources.length) {
      continue;
    }
    const ranked = rankSources(sources, reliability).slice(0, 8);
    out.push({...channel, sources: ranked, logo: (ranked.find((s) => /^https:/.test(s.logo)) || {logo: ''}).logo});
  }
  return out;
}
