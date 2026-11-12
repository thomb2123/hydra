// Stremio add-on protocol: resource matching and URL construction.
// https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
import {hostOf, requestJson} from '../../../../shared/src/net';
import {AddonDescriptor, CatalogDescriptor, Manifest, MetaDetail, MetaPreview, Stream, Subtitle} from './types';

const LOCAL_SERVER = /^https?:\/\/(127\.0\.0\.1|localhost):11470/i;

/**
 * Prepares the account's add-on list for a TV that is not running the
 * streaming server itself:
 * - add-ons served by the local streaming server (e.g. "Local Files",
 *   http://127.0.0.1:11470/...) are pointed at the PC's server, or dropped
 *   when no server is configured;
 * - legacy (pre-v3) add-ons whose URL is not a manifest.json are dropped.
 */
export function usableAddons(addons: AddonDescriptor[], server: string): AddonDescriptor[] {
  const out: AddonDescriptor[] = [];
  for (const addon of addons) {
    if (!/\/manifest\.json(\?.*)?$/.test(addon.transportUrl)) {
      continue;
    }
    if (LOCAL_SERVER.test(addon.transportUrl)) {
      if (!server) {
        continue;
      }
      out.push({...addon, transportUrl: addon.transportUrl.replace(LOCAL_SERVER, server.replace(/\/+$/, ''))});
      continue;
    }
    out.push(addon);
  }
  return out;
}

export function addonBase(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json(\?.*)?$/, '').replace(/\/+$/, '');
}

export function encodeExtra(extra?: Record<string, string>): string {
  if (!extra) {
    return '';
  }
  const parts = Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return parts.length ? '/' + parts.join('&') : '';
}

export function resourceUrl(transportUrl: string, resource: string, type: string, id: string, extra?: Record<string, string>): string {
  return `${addonBase(transportUrl)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${encodeExtra(extra)}.json`;
}

/** True when the add-on declares `resource` for this type and id. */
export function supportsResource(manifest: Manifest, resource: string, type: string, id?: string): boolean {
  for (const entry of manifest.resources || []) {
    const name = typeof entry === 'string' ? entry : entry.name;
    if (name !== resource) {
      continue;
    }
    const types = (typeof entry === 'string' ? undefined : entry.types) || manifest.types || [];
    const prefixes = typeof entry === 'string' ? manifest.idPrefixes : entry.idPrefixes ?? manifest.idPrefixes;
    if (types.length && !types.includes(type)) {
      continue;
    }
    if (id && prefixes && prefixes.length && !prefixes.some((prefix) => id.startsWith(prefix))) {
      continue;
    }
    return true;
  }
  return false;
}

export function requiredExtras(catalog: CatalogDescriptor): string[] {
  const fromExtra = (catalog.extra || []).filter((e) => e.isRequired).map((e) => e.name);
  return Array.from(new Set([...fromExtra, ...(catalog.extraRequired || [])]));
}

export function supportsExtra(catalog: CatalogDescriptor, name: string): boolean {
  return (catalog.extra || []).some((e) => e.name === name) || (catalog.extraSupported || []).includes(name);
}

export interface BoardCatalog {
  addon: AddonDescriptor;
  catalog: CatalogDescriptor;
  title: string;
}

/** Catalogs that can be shown on the home board (no required extra parameters). */
export function boardCatalogs(addons: AddonDescriptor[]): BoardCatalog[] {
  const out: BoardCatalog[] = [];
  for (const addon of addons) {
    if (addon.manifest.behaviorHints?.configurationRequired) {
      continue;
    }
    for (const catalog of addon.manifest.catalogs || []) {
      if (requiredExtras(catalog).length) {
        continue;
      }
      const typeLabel = catalog.type.charAt(0).toUpperCase() + catalog.type.slice(1);
      out.push({addon, catalog, title: `${catalog.name || catalog.id} · ${typeLabel} · ${addon.manifest.name}`});
    }
  }
  return out;
}

export function searchCatalogs(addons: AddonDescriptor[]): BoardCatalog[] {
  const out: BoardCatalog[] = [];
  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs || []) {
      const required = requiredExtras(catalog);
      if (supportsExtra(catalog, 'search') && required.every((name) => name === 'search')) {
        out.push({addon, catalog, title: `${catalog.name || catalog.id} (${catalog.type}) · ${addon.manifest.name}`});
      }
    }
  }
  return out;
}

export async function fetchCatalog(entry: BoardCatalog, extra?: Record<string, string>): Promise<MetaPreview[]> {
  const url = resourceUrl(entry.addon.transportUrl, 'catalog', entry.catalog.type, entry.catalog.id, extra);
  const data = await requestJson<{metas?: MetaPreview[]}>(url, {timeoutMs: 20000});
  return Array.isArray(data.metas) ? data.metas.filter((m) => m && m.id && m.name) : [];
}

export async function fetchMeta(addons: AddonDescriptor[], type: string, id: string): Promise<MetaDetail | null> {
  for (const addon of addons) {
    if (!supportsResource(addon.manifest, 'meta', type, id)) {
      continue;
    }
    try {
      const data = await requestJson<{meta?: MetaDetail}>(resourceUrl(addon.transportUrl, 'meta', type, id), {timeoutMs: 20000});
      if (data.meta && data.meta.id) {
        return data.meta;
      }
    } catch {
      // Try the next add-on.
    }
  }
  return null;
}

export interface StreamGroup {
  addon: AddonDescriptor;
  streams: Stream[];
  error?: string;
}

/** Asks every stream add-on in parallel; groups keep the user's add-on order. */
export async function fetchStreams(addons: AddonDescriptor[], type: string, videoId: string): Promise<StreamGroup[]> {
  const candidates = addons.filter((addon) => supportsResource(addon.manifest, 'stream', type, videoId));
  return Promise.all(
    candidates.map(async (addon) => {
      try {
        const data = await requestJson<{streams?: Stream[]}>(resourceUrl(addon.transportUrl, 'stream', type, videoId), {timeoutMs: 30000});
        return {addon, streams: Array.isArray(data.streams) ? data.streams : []};
      } catch (e: any) {
        return {addon, streams: [], error: String(e?.message || e)};
      }
    }),
  );
}

/**
 * Stremio's official OpenSubtitles add-on. It is queried as well as the user's
 * own subtitle add-ons, because community mirrors can be unreachable (for
 * example blocked by a broadband provider's content filter).
 */
export const OFFICIAL_SUBTITLES_URL = 'https://opensubtitles-v3.strem.io/manifest.json';

export interface SourcedSubtitle extends Subtitle {
  /** Name of the add-on that listed this subtitle. */
  source: string;
}

export async function fetchSubtitles(
  addons: AddonDescriptor[],
  type: string,
  videoId: string,
  extra?: Record<string, string>,
): Promise<SourcedSubtitle[]> {
  const candidates = addons
    .filter((addon) => supportsResource(addon.manifest, 'subtitles', type, videoId))
    .map((addon) => ({transportUrl: addon.transportUrl, name: addon.manifest.name || hostOf(addon.transportUrl)}));
  const official = addonBase(OFFICIAL_SUBTITLES_URL);
  const hasOfficial = candidates.some((c) => addonBase(c.transportUrl) === official);
  if (!hasOfficial && (type === 'movie' || type === 'series') && /^tt\d+/.test(videoId)) {
    candidates.unshift({transportUrl: OFFICIAL_SUBTITLES_URL, name: 'OpenSubtitles'});
  }
  const lists = await Promise.all(
    candidates.map(async (addon) => {
      try {
        const data = await requestJson<{subtitles?: Subtitle[]}>(resourceUrl(addon.transportUrl, 'subtitles', type, videoId, extra), {timeoutMs: 20000});
        return Array.isArray(data.subtitles) ? data.subtitles.map((s) => ({...s, source: addon.name})) : [];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().filter((s) => s && s.url);
}
