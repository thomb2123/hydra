// Turns the catalogs of the user's add-ons into tidy, streaming-service style
// rows ("Trending Films", "New Releases", "Comedy Series"…) with no add-on
// names or technical labels, and works out which genres can be browsed.
import {BoardCatalog, boardCatalogs, requiredExtras, supportsExtra} from './addons';
import {AddonDescriptor, CatalogDescriptor, MetaPreview} from './types';

export type RowKind = 'trending' | 'popular' | 'new' | 'top' | 'provider' | 'personal' | 'other';
export type MediaKind = 'movie' | 'series';

export interface RowSpec {
  key: string;
  title: string;
  kind: RowKind;
  type: string;
  source: BoardCatalog;
  extra?: Record<string, string>;
  /** Show as a ranked "Top 10" row. */
  top10?: boolean;
  /** Ready-made items (recommendations) instead of fetching the catalog. */
  items?: MetaPreview[];
  /** Reserved slot whose items are still being worked out (shows a placeholder). */
  pending?: boolean;
}

const PROVIDERS: [RegExp, string][] = [
  [/netflix/i, 'Netflix'],
  [/prime|amazon/i, 'Prime Video'],
  [/disney/i, 'Disney+'],
  [/\bhbo\b|\bmax\b/i, 'Max'],
  [/apple/i, 'Apple TV+'],
  [/hulu/i, 'Hulu'],
  [/paramount/i, 'Paramount+'],
  [/peacock/i, 'Peacock'],
  [/now ?tv|\bsky\b/i, 'NOW'],
  [/britbox/i, 'BritBox'],
  [/bbc|iplayer/i, 'BBC iPlayer'],
  [/\bitv/i, 'ITVX'],
  [/channel ?4/i, 'Channel 4'],
];

const REGIONS: [RegExp, string][] = [
  [/\b(uk|gb|united kingdom|britain|british)\b/i, 'the UK'],
  [/\b(us|usa|united states|america|american)\b/i, 'the US'],
];

export function typeLabel(type: string): string {
  return type === 'movie' ? 'Films' : type === 'series' ? 'Series' : type.charAt(0).toUpperCase() + type.slice(1);
}

// Personal catalogs (Trakt, Simkl, MDBList lists…) and their friendly names.
const PERSONAL: [RegExp, string, boolean][] = [
  [/recommend/i, 'Trakt Picks for You', false],
  [/watchlist/i, 'My Watchlist', false],
  [/history|watched/i, 'Watch It Again', false],
  [/collection/i, 'Your Collection', false],
];

export function classify(catalog: CatalogDescriptor): {kind: RowKind; provider?: string; region?: string; personal?: string; personalFirst?: boolean} {
  const text = `${catalog.id} ${catalog.name || ''}`;
  const personal = PERSONAL.find(([re]) => re.test(text));
  if (personal) {
    return {kind: 'personal', personal: personal[1], personalFirst: personal[2]};
  }
  const region = REGIONS.find(([re]) => re.test(text))?.[1];
  const provider = PROVIDERS.find(([re]) => re.test(text))?.[1];
  if (provider) {
    return {kind: 'provider', provider, region};
  }
  if (/trend/i.test(text)) {
    return {kind: 'trending', region};
  }
  if (/\bnew\b|latest|recent|release|now[ _-]?playing|airing|upcoming|in[ _-]?theat|year/i.test(text)) {
    return {kind: 'new', region};
  }
  if (/rated|imdbrating|featured|best|acclaim|award/i.test(text)) {
    return {kind: 'top', region};
  }
  if (/popular|^top$|\btop\b/i.test(text)) {
    return {kind: 'popular', region};
  }
  return {kind: 'other', region};
}

function cleanName(name: string): string {
  return name
    .replace(/\b(tmdb|imdb|trakt|tvdb|mdblist|cinemeta|aio\w*|elfhosted|letterboxd)\b/gi, '')
    .replace(/[|·•:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rowTitle(catalog: CatalogDescriptor): string {
  const {kind, provider, region, personal} = classify(catalog);
  const what = typeLabel(catalog.type);
  const where = region ? ` in ${region}` : '';
  switch (kind) {
    case 'provider':
      return `${what} on ${provider}${where}`;
    case 'personal':
      return `${personal} · ${what}`;
    case 'trending':
      return region ? `Trending Now in ${region}` : `Trending ${what}`;
    case 'new':
      return /airing[ _-]?today/i.test(`${catalog.id} ${catalog.name || ''}`) ? 'New Episodes Today' : `New ${what}${where}`;
    case 'top':
      return `Top Rated ${what}${where}`;
    case 'popular':
      return `Popular ${what}${where}`;
    default: {
      const name = cleanName(catalog.name || catalog.id);
      return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} ${what}`.replace(/\b(films|series) (films|series)\b/i, '$1') : what;
    }
  }
}

/** Every board catalog as a cleanly titled row, de-duplicated by title (first add-on wins). */
export function catalogRows(addons: AddonDescriptor[]): RowSpec[] {
  const seen = new Set<string>();
  const out: RowSpec[] = [];
  for (const source of boardCatalogs(addons)) {
    if (source.catalog.type !== 'movie' && source.catalog.type !== 'series') {
      continue;
    }
    const title = rowTitle(source.catalog);
    if (seen.has(title.toLowerCase())) {
      continue;
    }
    seen.add(title.toLowerCase());
    out.push({
      key: `${source.addon.transportUrl}|${source.catalog.type}|${source.catalog.id}`,
      title,
      kind: classify(source.catalog).kind,
      type: source.catalog.type,
      source,
    });
  }
  return out;
}

export interface GenreSource {
  type: string;
  source: BoardCatalog;
  genres: string[];
}

/** For each type, the catalog to browse genres with (prefers "popular" catalogs that list genre options). */
export function genreSources(addons: AddonDescriptor[]): GenreSource[] {
  const out: GenreSource[] = [];
  for (const type of ['movie', 'series']) {
    let best: GenreSource | null = null;
    let bestRank = 99;
    for (const addon of addons) {
      for (const catalog of addon.manifest.catalogs || []) {
        if (catalog.type !== type || !supportsExtra(catalog, 'genre')) {
          continue;
        }
        if (requiredExtras(catalog).some((name) => name !== 'genre')) {
          continue;
        }
        const genres = (catalog.extra || []).find((e) => e.name === 'genre')?.options || [];
        const usable = genres.filter((g) => g && !/^\d{4}$/.test(g)); // skip year lists
        if (usable.length < 4) {
          continue;
        }
        const kind = classify(catalog).kind;
        const rank = {popular: 0, trending: 1, top: 2, other: 3, new: 4, provider: 5, personal: 6}[kind];
        if (rank < bestRank) {
          bestRank = rank;
          best = {type, source: {addon, catalog, title: catalog.name || catalog.id}, genres: usable};
        }
      }
    }
    if (best) {
      out.push(best);
    }
  }
  return out;
}

export function genreRow(source: GenreSource, genre: string): RowSpec {
  return {
    key: `genre|${source.type}|${genre}`,
    title: `${genre} ${typeLabel(source.type)}`,
    kind: 'other',
    type: source.type,
    source: source.source,
    extra: {genre},
  };
}

// Genres that make good home-screen rows, in display order.
const FEATURED_GENRES = ['Action', 'Comedy', 'Thriller', 'Drama', 'Sci-Fi', 'Animation', 'Crime', 'Horror', 'Documentary', 'Family', 'Romance', 'Fantasy'];

export type Tab = 'home' | 'series' | 'films' | 'new';

/** Rows for a browse tab, in a streaming-service order. */
export function rowsForTab(tab: Tab, addons: AddonDescriptor[]): RowSpec[] {
  const all = catalogRows(addons);
  const genres = genreSources(addons);
  const wantType = tab === 'series' ? 'series' : tab === 'films' ? 'movie' : null;
  const ofType = (rows: RowSpec[]) => (wantType ? rows.filter((r) => r.type === wantType) : rows);
  const byKind = (kind: RowKind) => ofType(all.filter((r) => r.kind === kind));

  const out: RowSpec[] = [];
  const add = (rows: RowSpec[]) => rows.forEach((r) => !out.some((o) => o.key === r.key) && out.push(r));

  if (tab === 'new') {
    add(byKind('new'));
    add(byKind('trending'));
    add(byKind('popular'));
    return out;
  }

  // Top 10 from the first trending (else popular) catalog.
  const topSource = byKind('trending')[0] || byKind('popular')[0];
  if (topSource) {
    out.push({...topSource, key: `top10|${topSource.key}`, title: `Top 10 ${typeLabel(topSource.type)} Today`, top10: true});
  }
  const personal = byKind('personal');
  const personalFirst = personal.filter((r) => classify(r.source.catalog).personalFirst);
  add(personalFirst);
  add(byKind('trending'));
  add(byKind('new'));
  add(byKind('popular'));
  add(personal.filter((r) => /watchlist/i.test(r.source.catalog.id)));
  add(byKind('provider'));
  add(byKind('top'));

  const genreRows: RowSpec[] = [];
  for (const genre of FEATURED_GENRES) {
    for (const source of genres) {
      if ((!wantType || source.type === wantType) && source.genres.some((g) => g.toLowerCase() === genre.toLowerCase())) {
        genreRows.push(genreRow(source, source.genres.find((g) => g.toLowerCase() === genre.toLowerCase()) as string));
      }
    }
  }
  // Interleave genres for a varied home screen.
  add(genreRows.slice(0, tab === 'home' ? 10 : 12));
  add(personal);
  add(byKind('other'));
  return out;
}

/** All genres across films and series, for the Categories page. */
export function allGenres(addons: AddonDescriptor[]): string[] {
  const names = new Map<string, string>();
  for (const source of genreSources(addons)) {
    for (const genre of source.genres) {
      if (!names.has(genre.toLowerCase())) {
        names.set(genre.toLowerCase(), genre);
      }
    }
  }
  return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
}
