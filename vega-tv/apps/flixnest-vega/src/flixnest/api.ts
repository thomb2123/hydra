// FlixNest web-player API client (https://player.flixnest.app/webplayer/api).
// Request shapes mirror the official web player (webplayer.js):
//   POST /webplayer/api/<operation>  {access, preferences, ...args}
// Account sessions are cookie based; account metadata requests are routed via
// "account-data/<operation>". The phone-pairing flow is /webplayer/api/pair/*.
import {HttpError, request} from '../../../../shared/src/net';
import {loadJson, removeKey, saveJson} from '../../../../shared/src/storage';

export const ORIGIN = 'https://player.flixnest.app';
const BASE = `${ORIGIN}/webplayer/api`;
const COOKIE_KEY = 'flixnest.cookies.v1';

export type Access =
  | {type: 'account'; scope: string; provider?: string}
  | {type: 'xtream'; url: string; username: string; password: string}
  | {type: 'playlist'; url: string};

export type CatalogKind = 'live' | 'movies' | 'series';
export type PlayKind = 'live' | 'movies' | 'episode';

export interface Item {
  id: string;
  name: string;
  category?: string;
  country?: string;
  image?: string;
  year?: string | number;
  epg_id?: string;
  start?: string | number;
  end?: string | number;
  status?: string;
  sport?: string;
  broadcasts?: {id: string; name: string}[];
}

export interface CatalogResult {
  items: Item[];
  categories?: string[];
  countries?: string[];
  total?: number;
  has_more?: boolean;
}

export interface Episode {
  id: string;
  name?: string;
  episode?: number;
  duration?: number | string;
  image?: string;
  description?: string;
}

export interface SeriesResult {
  name?: string;
  image?: string;
  backdrop?: string;
  description?: string;
  genre?: string;
  year?: string | number;
  seasons: {number: number; episodes: Episode[]}[];
}

export interface PlayResult {
  url: string;
  mime?: string;
  name?: string;
  external_only?: boolean;
  reason?: string;
}

export interface AccessResult {
  providers?: {id: string; name?: string; username?: string}[];
  provider?: string;
  message?: string;
}

const ACCOUNT_DATA_OPS = ['access', 'catalog', 'catchup', 'epg', 'events', 'find', 'series', 'play'];

/** Splits a (possibly comma-joined) Set-Cookie header into name=value pairs. */
export function parseSetCookie(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  // Commas also appear inside Expires dates, so only split before "name=".
  for (const cookie of header.split(/,(?=\s*[A-Za-z0-9_\-.]+=)/)) {
    const first = cookie.split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq > 0) {
      out[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
    }
  }
  return out;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export function routedOperation(operation: string, access: Access | null): string {
  return access && access.type === 'account' && ACCOUNT_DATA_OPS.includes(operation) ? `account-data/${operation}` : operation;
}

export class FlixNestClient {
  private cookies: Record<string, string> = {};
  preferences = {server: 'auto', cdn: 'auto'};

  async restoreCookies(): Promise<void> {
    this.cookies = await loadJson<Record<string, string>>(COOKIE_KEY, {});
  }

  async clearCookies(): Promise<void> {
    this.cookies = {};
    await removeKey(COOKIE_KEY);
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = {Origin: ORIGIN, Referer: `${ORIGIN}/webplayer/`};
    const cookie = cookieHeader(this.cookies);
    if (cookie) {
      headers.Cookie = cookie;
    }
    const response = await request(`${BASE}/${path}`, {method: 'POST', body, headers, timeoutMs: 45000, credentials: 'include'});
    const received = parseSetCookie(response.headers['set-cookie']);
    if (Object.keys(received).length) {
      this.cookies = {...this.cookies, ...received};
      await saveJson(COOKIE_KEY, this.cookies);
    }
    let data: any = {};
    try {
      data = response.text ? JSON.parse(response.text) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new HttpError(data.message || `FlixNest error (HTTP ${response.status})`, response.status, data.error || 'request_failed', data);
    }
    return data as T;
  }

  call<T>(operation: string, access: Access | null, args: Record<string, unknown> = {}): Promise<T> {
    return this.post<T>(routedOperation(operation, access), {access, preferences: this.preferences, ...args});
  }

  connect(access: Access): Promise<AccessResult> {
    return this.call<AccessResult>('access', access);
  }

  catalog(access: Access, kind: CatalogKind, options: {query?: string; category?: string[]; offset?: number; limit?: number} = {}): Promise<CatalogResult> {
    return this.call<CatalogResult>('catalog', access, {
      kind,
      query: options.query || '',
      category: options.category || [],
      country: [],
      offset: options.offset || 0,
      limit: options.limit || 100,
    });
  }

  series(access: Access, id: string): Promise<SeriesResult> {
    return this.call<SeriesResult>('series', access, {id});
  }

  events(access: Access): Promise<CatalogResult> {
    return this.call<CatalogResult>('events', access);
  }

  play(access: Access, id: string, kind: PlayKind): Promise<PlayResult> {
    return this.call<PlayResult>('play', access, {id, kind});
  }

  accountLogin(email: string, password: string): Promise<{access: Access; sync?: unknown}> {
    return this.call('account/login', null, {email, password, remember: true});
  }

  accountSession(): Promise<{access: Access; sync?: unknown}> {
    return this.call('account/session', null, {});
  }

  async accountLogout(access: Access): Promise<void> {
    await this.call('account/logout', access, {}).catch(() => undefined);
    await this.clearCookies();
  }

  pairStart(): Promise<{device_code: string; code: string; expires_in?: number; interval?: number}> {
    return this.post('pair/start', {tv: true});
  }

  pairPoll(deviceCode: string): Promise<{status: string; access?: Access; sync?: unknown}> {
    return this.post('pair/poll', {device_code: deviceCode});
  }

  pairCancel(deviceCode: string): Promise<unknown> {
    return this.post('pair/cancel', {device_code: deviceCode}).catch(() => undefined);
  }
}

export function normalisePairCode(value: string): string {
  const code = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  return /^[BCDFGHJKLMNPQRSTVWXZ]{8}$/.test(code) ? code : '';
}

export function formatPairCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function pairUrl(code: string): string {
  return `${ORIGIN}/webplayer/pair?code=${encodeURIComponent(code)}`;
}

export function accessIsValid(access: any): access is Access {
  if (!access || typeof access !== 'object') {
    return false;
  }
  if (access.type === 'account') {
    return typeof access.scope === 'string' && /^[a-f0-9]{64}$/.test(access.scope);
  }
  if (access.type !== 'playlist' && access.type !== 'xtream') {
    return false;
  }
  if (!/^https?:\/\//i.test(String(access.url || ''))) {
    return false;
  }
  return access.type === 'playlist' || (typeof access.username === 'string' && typeof access.password === 'string');
}
