// FlixNest web-player API (https://player.flixnest.app/webplayer/api), used as
// the live-TV back end. Account access from phone pairing works without a
// cookie; every channel id carries its provider ("dream4k:channel:123"), so
// any source plays without switching provider.
import {HttpError, request} from '../../../../shared/src/net';
import {loadJson, removeKey, saveJson} from '../../../../shared/src/storage';

const ORIGIN = 'https://player.flixnest.app';
const BASE = `${ORIGIN}/webplayer/api/`;
const ACCESS_KEY = 'tv.flixnest.access.v1';
const ROUTED = ['access', 'catalog', 'catchup', 'epg', 'events', 'find', 'series', 'play'];

export interface Access {
  type: 'account';
  scope: string;
  provider?: string;
}

export interface Provider {
  id: string;
  label: string;
}

export interface Programme {
  title?: string;
  description?: string;
  start?: number;
  end?: number;
}

export interface Epg {
  now?: Programme | null;
  next?: Programme | null;
}

export async function call<T = any>(operation: string, access: Access | null, args: Record<string, unknown> = {}, timeoutMs = 30000): Promise<T> {
  const path = access && ROUTED.includes(operation) ? `account-data/${operation}` : operation;
  const response = await request(BASE + path, {
    method: 'POST',
    body: {access, preferences: {server: 'auto', cdn: 'auto'}, ...args},
    headers: {Origin: ORIGIN, Referer: `${ORIGIN}/webplayer/`},
    timeoutMs,
  });
  let data: any = {};
  try {
    data = response.text ? JSON.parse(response.text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new HttpError(data.message || `FlixNest error ${response.status}`, response.status, data.error || 'request_failed', data);
  }
  return data as T;
}

export const loadAccess = () => loadJson<Access | null>(ACCESS_KEY, null);
export const saveAccess = (access: Access) => saveJson(ACCESS_KEY, access);
export const forgetAccess = () => removeKey(ACCESS_KEY);

export async function providers(access: Access): Promise<Provider[]> {
  const result = await call<{providers?: Provider[]}>('access', {type: 'account', scope: access.scope});
  return (result.providers || []).filter((p) => p && p.id);
}

/** Connects the session to one provider; catalog requests need this first. */
export async function useProvider(access: Access, provider: string): Promise<Access> {
  const next: Access = {type: 'account', scope: access.scope, provider};
  await call('access', next);
  return next;
}

export interface CatalogPage {
  items: {id: string; name: string; category?: string; epg_id?: string; image?: string}[];
  categories?: string[];
  has_more?: boolean;
  total?: number;
}

export function catalog(access: Access, country: string, category: string[], offset: number): Promise<CatalogPage> {
  return call<CatalogPage>('catalog', access, {kind: 'live', query: '', category, country: [country], offset, limit: 100}, 60000);
}

export function epg(access: Access, id: string): Promise<Epg> {
  return call<Epg>('epg', access, {id}, 15000);
}

export async function play(access: Access, id: string): Promise<{url: string; mime?: string}> {
  const result = await call<{url?: string; mime?: string}>('play', access, {id, kind: 'live'}, 20000);
  if (!result.url) {
    throw new HttpError('No stream returned', 200, 'no_stream', result);
  }
  return {url: result.url, mime: result.mime};
}

export function events(access: Access): Promise<{items?: any[]}> {
  return call('events', access, {}, 60000);
}

// Phone pairing: the TV shows an 8-letter code; the viewer approves it in the
// FlixNest web player on their phone; the TV then receives account access.
export interface PairStart {
  device_code: string;
  code: string;
  expires_in?: number;
  interval?: number;
}

export const pairStart = () => call<PairStart>('pair/start', null, {tv: true});
export const pairPoll = (deviceCode: string) => call<{status: string; access?: Access}>('pair/poll', null, {device_code: deviceCode});
export const pairCancel = (deviceCode: string) => call('pair/cancel', null, {device_code: deviceCode}).catch(() => undefined);
export const pairUrl = (code: string) => `${ORIGIN}/webplayer/pair?code=${encodeURIComponent(code)}`;
export const formatCode = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);
