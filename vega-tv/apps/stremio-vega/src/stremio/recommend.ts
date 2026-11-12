// Personal recommendations from the user's own Stremio library: what they
// watched (Continue Watching / history) and what they added to My List.
// Genres of those titles are weighted by recency, genre catalogs are fetched,
// and titles appearing under several favourite genres with good ratings win.
import {fetchCatalog, fetchMeta} from './addons';
import {GenreSource, RowSpec, genreRow, genreSources} from './rows';
import {AddonDescriptor, LibraryItem, MetaPreview} from './types';

export interface Seed {
  id: string;
  type: string;
  name: string;
  weight: number;
}

/** Most relevant library titles first: recently watched, then My List. */
export function pickSeeds(library: LibraryItem[], max = 8): Seed[] {
  const relevant = library.filter((item) => item && (item.type === 'movie' || item.type === 'series') && (!item.removed || (item.state?.timeOffset || 0) > 0 || (item.state?.timesWatched || 0) > 0 || item.temp));
  const sorted = relevant
    .map((item) => ({item, at: Date.parse(item.state?.lastWatched || item._mtime || '') || 0}))
    .sort((a, b) => b.at - a.at)
    .slice(0, max);
  return sorted.map(({item}, rank) => ({
    id: item._id,
    type: item.type,
    name: item.name,
    // Recent titles count more; titles on My List get a boost.
    weight: 1 / (1 + rank * 0.35) + (!item.removed && !item.temp ? 0.4 : 0),
  }));
}

/** Weighted genre scores per type from seed genres. */
export function genreWeights(seeds: Seed[], genresById: Record<string, string[]>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const seed of seeds) {
    const genres = genresById[seed.id] || [];
    genres.slice(0, 3).forEach((genre, i) => {
      const bucket = (out[seed.type] = out[seed.type] || {});
      bucket[genre.toLowerCase()] = (bucket[genre.toLowerCase()] || 0) + seed.weight * (i === 0 ? 1 : 0.7);
    });
  }
  return out;
}

/** Scores candidate titles: sum of the weights of the genre lists they appear in, plus rating. */
export function scoreCandidates(lists: {weight: number; metas: MetaPreview[]}[], exclude: Set<string>): MetaPreview[] {
  const scores = new Map<string, {meta: MetaPreview; score: number}>();
  for (const list of lists) {
    list.metas.forEach((meta, position) => {
      if (exclude.has(meta.id)) {
        return;
      }
      const entry = scores.get(meta.id) || {meta, score: Number(meta.imdbRating || 0) / 4};
      // Earlier in a popularity-ordered list is slightly better.
      entry.score += list.weight * (1 - Math.min(position, 80) / 160);
      scores.set(meta.id, entry);
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((e) => e.meta);
}

const genreCache = new Map<string, string[]>();
const listCache = new Map<string, MetaPreview[]>();

async function genresOf(addons: AddonDescriptor[], seed: Seed): Promise<string[]> {
  if (!genreCache.has(seed.id)) {
    const meta = await fetchMeta(addons, seed.type, seed.id).catch(() => null);
    genreCache.set(seed.id, meta?.genres || []);
  }
  return genreCache.get(seed.id) || [];
}

async function genreList(source: GenreSource, genre: string): Promise<MetaPreview[]> {
  const exact = source.genres.find((g) => g.toLowerCase() === genre.toLowerCase());
  if (!exact) {
    return [];
  }
  const key = `${source.type}|${exact}`;
  if (!listCache.has(key)) {
    listCache.set(key, await fetchCatalog(source.source, {genre: exact}).catch(() => []));
  }
  return (listCache.get(key) || []).map((m) => ({...m, type: m.type || source.type}));
}

/**
 * "Recommended for You" (per type) and "Because you watched …" rows.
 * `wantType` limits to films or series (null for both).
 */
export async function recommendationRows(addons: AddonDescriptor[], library: LibraryItem[], wantType: 'movie' | 'series' | null): Promise<RowSpec[]> {
  const seeds = pickSeeds(library).filter((s) => !wantType || s.type === wantType);
  if (!seeds.length) {
    return [];
  }
  const sources = genreSources(addons);
  const genresById: Record<string, string[]> = {};
  await Promise.all(seeds.map(async (seed) => (genresById[seed.id] = await genresOf(addons, seed))));
  const weights = genreWeights(seeds, genresById);
  const exclude = new Set(library.filter((i) => (i.state?.timesWatched || 0) > 0 || (i.state?.timeOffset || 0) > 0 || !i.removed).map((i) => i._id));
  seeds.forEach((s) => exclude.add(s.id));

  const rows: RowSpec[] = [];
  const recommended: MetaPreview[] = [];
  for (const source of sources) {
    if (wantType && source.type !== wantType) {
      continue;
    }
    const top = Object.entries(weights[source.type] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    if (!top.length) {
      continue;
    }
    const lists = await Promise.all(top.map(async ([genre, weight]) => ({weight, metas: await genreList(source, genre)})));
    recommended.push(...scoreCandidates(lists, exclude).slice(0, 20));
  }
  if (recommended.length) {
    // Interleave films and series for a varied row.
    const films = recommended.filter((m) => m.type === 'movie');
    const series = recommended.filter((m) => m.type !== 'movie');
    const mixed: MetaPreview[] = [];
    for (let i = 0; i < Math.max(films.length, series.length); i++) {
      if (films[i]) {
        mixed.push(films[i]);
      }
      if (series[i]) {
        mixed.push(series[i]);
      }
    }
    const anySource = sources.find((s) => !wantType || s.type === wantType) as GenreSource;
    rows.push({key: `recommended|${wantType || 'all'}`, title: 'Recommended for You', kind: 'personal', type: wantType || 'movie', source: anySource.source, items: mixed.slice(0, 30)});
  }

  // "Because you watched X" for the most recent title with genres.
  const latest = seeds.find((s) => (genresById[s.id] || []).length > 0);
  const latestSource = latest ? sources.find((s) => s.type === latest.type) : undefined;
  if (latest && latestSource) {
    const genres = genresById[latest.id].slice(0, 2);
    const lists = await Promise.all(genres.map(async (genre, i) => ({weight: i === 0 ? 1 : 0.8, metas: await genreList(latestSource, genre)})));
    const items = scoreCandidates(lists, exclude)
      .filter((m) => !recommended.slice(0, 8).some((r) => r.id === m.id))
      .slice(0, 20);
    if (items.length) {
      rows.push({...genreRow(latestSource, genres[0]), key: `because|${latest.id}`, title: `Because you watched ${latest.name}`, kind: 'personal', items});
    }
  }
  return rows;
}
