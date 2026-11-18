// Builds the merged UK/US channel guide from every provider on the account and
// caches it on the stick (rebuilt in the background once a day).
import {loadJson, saveJson} from '../../../../shared/src/storage';
import * as fx from './flixnest';
import {MergedChannel, ProviderEntry, Reliability, Source, collectSources, categoryUseful, mergeChannels, sourceKey} from './channels';
import {Country} from './lineup';

const GUIDE_KEY = 'tv.guide.v1';
const RELIABILITY_KEY = 'tv.reliability.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const COUNTRIES: {country: Country; name: string; pattern: RegExp}[] = [
  {country: 'UK', name: 'United Kingdom', pattern: /(^|[:|\s(])\|?\s*UK\b|\bUNITED KINGDOM\b|\bBRITISH\b/i},
  {country: 'US', name: 'United States', pattern: /(^|[:|\s(])\|?\s*(?:US|USA)\b|\bUNITED STATES\b|\bAMERICA\b/i},
];

export interface GuideData {
  builtAt: number;
  channels: MergedChannel[];
  sources: Record<string, Source[]>;
}

export type Progress = (done: number, total: number, label: string) => void;

export async function loadCachedGuide(): Promise<GuideData | null> {
  const cached = await loadJson<GuideData | null>(GUIDE_KEY, null);
  return cached && Array.isArray(cached.channels) && cached.channels.length ? cached : null;
}

export function isStale(guide: GuideData | null): boolean {
  return !guide || Date.now() - guide.builtAt > MAX_AGE_MS;
}

export async function resetReliability(): Promise<void> {
  await saveJson(RELIABILITY_KEY, {provider: {}, failures: {}, failedAt: {}, good: {}, height: {}});
}

export async function loadReliability(): Promise<Reliability> {
  return loadJson<Reliability>(RELIABILITY_KEY, {provider: {}, failures: {}});
}

/**
 * Records how a source behaved, so failing providers/sources sink in the ranking
 * and ones that really played (at a measured picture height) rise.
 */
export async function recordResult(source: Source, ok: boolean, height?: number): Promise<Reliability> {
  const rel = await loadReliability();
  rel.failedAt = rel.failedAt || {};
  rel.good = rel.good || {};
  rel.height = rel.height || {};
  const prev = rel.provider[source.provider] ?? 0.7;
  rel.provider[source.provider] = Math.max(0, Math.min(1, prev * 0.8 + (ok ? 1 : 0) * 0.2));
  const key = sourceKey(source);
  if (ok) {
    delete rel.failures[key];
    delete rel.failedAt[key];
    rel.good[key] = Date.now();
    if (height && height > 0) {
      rel.height[key] = height;
    }
  } else {
    rel.failures[key] = (rel.failures[key] || 0) + 1;
    rel.failedAt[key] = Date.now();
  }
  await saveJson(RELIABILITY_KEY, rel);
  return rel;
}

async function fetchCountry(access: fx.Access, country: (typeof COUNTRIES)[number], onPage: () => void): Promise<ProviderEntry[]> {
  const first = await fx.catalog(access, country.name, [], 0);
  const categories = (first.categories || []).filter((c) => country.pattern.test(c) && categoryUseful(c));
  if (!categories.length) {
    return [];
  }
  const entries: ProviderEntry[] = [];
  let offset = 0;
  for (let page = 0; page < 60; page++) {
    let result: fx.CatalogPage | null = null;
    for (let attempt = 0; attempt < 3 && !result; attempt++) {
      try {
        result = await fx.catalog(access, country.name, categories, offset);
      } catch (e) {
        if (attempt === 2) {
          throw e;
        }
      }
    }
    onPage();
    const items = result?.items || [];
    entries.push(...items);
    offset += items.length;
    if (!result?.has_more || !items.length) {
      break;
    }
  }
  return entries;
}

export async function buildGuide(access: fx.Access, progress?: Progress): Promise<GuideData> {
  const providers = await fx.providers(access);
  const lists: {provider: string; country: Country; entries: ProviderEntry[]}[] = [];
  // Roughly 10-50 pages per provider; the estimate only drives the progress bar.
  const estimate = Math.max(1, providers.length * 25);
  let pages = 0;
  for (const provider of providers) {
    progress?.(pages, estimate, `Reading ${provider.label} channels…`);
    try {
      const scoped = await fx.useProvider(access, provider.id);
      for (const country of COUNTRIES) {
        const entries = await fetchCountry(scoped, country, () => {
          pages++;
          progress?.(Math.min(pages, estimate - 1), estimate, `Reading ${provider.label} channels…`);
        });
        lists.push({provider: provider.id, country: country.country, entries});
      }
    } catch {
      // A provider that is down is skipped; the others still build the guide.
    }
  }
  const found = collectSources(lists);
  const channels = mergeChannels(found, await loadReliability());
  const guide: GuideData = {builtAt: Date.now(), channels, sources: Object.fromEntries(found)};
  if (channels.length) {
    await saveJson(GUIDE_KEY, guide);
  }
  progress?.(estimate, estimate, 'Done');
  return guide;
}

/** Re-ranks cached sources with the latest reliability data. */
export async function reRank(guide: GuideData): Promise<GuideData> {
  const rel = await loadReliability();
  return {...guide, channels: mergeChannels(new Map(Object.entries(guide.sources)), rel)};
}
