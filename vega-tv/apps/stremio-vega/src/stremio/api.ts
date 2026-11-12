// Stremio account API (https://api.strem.io/api/<method>) and the TV link flow
// (https://link.stremio.com/api/v2/<create|read>), as used by stremio-core.
import {HttpError, requestJson} from '../../../../shared/src/net';
import {AddonDescriptor, LibraryItem, User} from './types';

const API = 'https://api.strem.io/api/';
const LINK = 'https://link.stremio.com/api/v2/';

type ApiEnvelope<T> = {result?: T; error?: {message?: string; code?: number} | string};

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const data = await requestJson<ApiEnvelope<T>>(API + method, {method: 'POST', body, timeoutMs: 20000});
  if (data.error) {
    const message = typeof data.error === 'string' ? data.error : data.error.message || 'Stremio API error';
    throw new HttpError(message, 200, 'api_error', data.error);
  }
  if (data.result === undefined) {
    throw new HttpError('Empty response from Stremio', 200, 'empty', data);
  }
  return data.result;
}

export interface Session {
  authKey: string;
  user: User;
}

export async function login(email: string, password: string): Promise<Session> {
  // stremio-core serialises Auth(Login{..}) with the inner tag winning: type=Login.
  const result = await call<{authKey: string; user: User}>('login', {type: 'Login', email, password, facebook: false});
  return {authKey: result.authKey, user: result.user};
}

export async function getUser(authKey: string): Promise<User> {
  return call<User>('getUser', {type: 'GetUser', authKey});
}

export async function logout(authKey: string): Promise<void> {
  await call<unknown>('logout', {type: 'Logout', authKey}).catch(() => undefined);
}

/** With an empty authKey the API returns Stremio's default add-ons (Cinemeta etc.). */
export async function addonCollection(authKey: string): Promise<AddonDescriptor[]> {
  const result = await call<{addons: AddonDescriptor[]}>('addonCollectionGet', {type: 'AddonCollectionGet', authKey, update: true});
  return (result.addons || []).filter((a) => a && a.transportUrl && a.manifest);
}

export async function libraryItems(authKey: string): Promise<LibraryItem[]> {
  const result = await call<LibraryItem[]>('datastoreGet', {authKey, collection: 'libraryItem', ids: [], all: true});
  return Array.isArray(result) ? result : [];
}

export async function putLibraryItems(authKey: string, changes: LibraryItem[]): Promise<void> {
  await call<unknown>('datastorePut', {authKey, collection: 'libraryItem', changes});
}

export interface LinkCode {
  code: string;
  link: string;
  qrcode: string;
}

export async function createLinkCode(): Promise<LinkCode> {
  const data = await requestJson<ApiEnvelope<LinkCode>>(LINK + 'create?type=Create', {timeoutMs: 20000});
  if (!data.result || !data.result.code) {
    throw new HttpError('Could not get a sign-in code from Stremio.', 200, 'link_create', data);
  }
  return data.result;
}

/** Resolves with the authKey once the code was approved, or null while still pending. */
export async function readLinkCode(code: string): Promise<string | null> {
  const data = await requestJson<ApiEnvelope<{authKey?: string}>>(LINK + 'read?type=Read&code=' + encodeURIComponent(code), {timeoutMs: 20000});
  return data.result && data.result.authKey ? data.result.authKey : null;
}

/** Updates watch progress on an item that is already in the user's library. */
export function withProgress(item: LibraryItem, videoId: string | undefined, positionSec: number, durationSec: number): LibraryItem {
  const now = new Date().toISOString();
  const state = {...item.state};
  state.timeOffset = Math.max(0, Math.round(positionSec * 1000));
  if (durationSec > 0) {
    state.duration = Math.round(durationSec * 1000);
  }
  state.lastWatched = now;
  if (videoId) {
    state.video_id = videoId;
  }
  return {...item, state, _mtime: now};
}

/**
 * A new library item in the shape the official Stremio apps write.
 * Watching something creates a "temp" item (Continue Watching only, removed
 * from the visible library); adding to My List makes it a normal item.
 */
export function newLibraryItem(meta: {id: string; type: string; name: string; poster?: string | null; posterShape?: string}, inList: boolean): LibraryItem {
  const now = new Date().toISOString();
  return {
    _id: meta.id,
    name: meta.name,
    type: meta.type,
    poster: meta.poster || null,
    posterShape: meta.posterShape || 'poster',
    removed: !inList,
    temp: !inList,
    _ctime: now,
    _mtime: now,
    state: {
      lastWatched: null,
      timeWatched: 0,
      timeOffset: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: null,
      watched: null,
      noNotif: false,
    },
    behaviorHints: {defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false},
  };
}

/** True when the item shows in My List (the visible Stremio library). */
export function isInList(item: LibraryItem | undefined): boolean {
  return !!item && !item.removed && !item.temp;
}

/** Adds to or removes from My List, keeping any watch progress. */
export function withListMembership(item: LibraryItem, inList: boolean): LibraryItem {
  const now = new Date().toISOString();
  const hasProgress = (item.state?.timeOffset || 0) > 0;
  return {...item, removed: !inList, temp: inList ? false : hasProgress, _mtime: now};
}

/** Marks a title finished: clears the resume point so it leaves Continue Watching. */
export function withFinished(item: LibraryItem): LibraryItem {
  const now = new Date().toISOString();
  return {
    ...item,
    state: {...item.state, timeOffset: 0, timesWatched: (item.state.timesWatched || 0) + 1, flaggedWatched: 1, lastWatched: now},
    _mtime: now,
  };
}
