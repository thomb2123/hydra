// App-wide Stremio state: session, add-ons, streaming server and resume points.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {loadJson, removeKey, saveJson} from '../../../shared/src/storage';
import * as api from './stremio/api';
import {usableAddons} from './stremio/addons';
import {AddonDescriptor, LibraryItem, MetaPreview} from './stremio/types';
import {discoverServer} from './stremio/streaming';

const SESSION_KEY = 'stremio.session.v1';
const SERVER_KEY = 'stremio.server.v1';
const RESUME_KEY = 'stremio.resume.v1';

export interface StoredSession {
  authKey: string;
  email: string;
}

export interface ResumePoint {
  position: number;
  duration: number;
  at: number;
}

export interface StremioState {
  ready: boolean;
  session: StoredSession | null;
  addons: AddonDescriptor[];
  addonError: string | null;
  library: LibraryItem[];
  server: string;
  resume: Record<string, ResumePoint>;
  signIn: (authKey: string, email?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setServer: (url: string) => Promise<void>;
  saveProgress: (meta: MetaPreview, videoId: string, position: number, duration: number) => Promise<void>;
  /** Adds to or removes from My List (the Stremio library). Returns the new membership. */
  toggleMyList: (meta: MetaPreview) => Promise<boolean>;
  inMyList: (id: string) => boolean;
  removeFromContinueWatching: (id: string) => Promise<void>;
  /** True while the app is looking for the PC's streaming server on the network. */
  discovering: boolean;
  /** Remembered subtitle language (e.g. "eng"), or null for subtitles off. */
  subtitleLanguage: string | null;
  setSubtitleLanguage: (lang: string | null) => void;
}

const SUBTITLE_KEY = 'stremio.subtitle.v1';

export function useStremioState(): StremioState {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [addonError, setAddonError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [server, setServerState] = useState('');
  const [resume, setResume] = useState<Record<string, ResumePoint>>({});
  const [discovering, setDiscovering] = useState(false);
  const [subtitleLanguage, setSubtitleLanguageState] = useState<string | null>(null);
  const lastSync = useRef<Record<string, number>>({});

  const setSubtitleLanguage = useCallback((lang: string | null) => {
    setSubtitleLanguageState(lang);
    saveJson(SUBTITLE_KEY, lang);
  }, []);

  const [rawAddons, setRawAddons] = useState<AddonDescriptor[]>([]);
  const addons = useMemo(() => usableAddons(rawAddons, server), [rawAddons, server]);

  const loadAccountData = useCallback(async (current: StoredSession | null) => {
    try {
      setRawAddons(await api.addonCollection(current?.authKey || ''));
      setAddonError(null);
    } catch (e: any) {
      setAddonError(String(e?.message || e));
    }
    if (current) {
      try {
        setLibrary(await api.libraryItems(current.authKey));
      } catch {
        setLibrary([]);
      }
    } else {
      setLibrary([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const stored = await loadJson<StoredSession | null>(SESSION_KEY, null);
      setSession(stored);
      setServerState(await loadJson<string>(SERVER_KEY, ''));
      setResume(await loadJson<Record<string, ResumePoint>>(RESUME_KEY, {}));
      setSubtitleLanguageState(await loadJson<string | null>(SUBTITLE_KEY, null));
      await loadAccountData(stored);
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAccountData]);

  // No streaming server saved: look for Stremio on the home network once.
  useEffect(() => {
    if (!ready || server || discovering) {
      return;
    }
    let alive = true;
    setDiscovering(true);
    discoverServer((line) => console.log(`[stremio] ${line}`))
      .then(async (found) => {
        if (alive && found) {
          await saveJson(SERVER_KEY, found);
          setServerState(found);
        }
      })
      .finally(() => alive && setDiscovering(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, server]);


  const signIn = useCallback(
    async (authKey: string, email?: string) => {
      let address = email || '';
      if (!address) {
        try {
          address = (await api.getUser(authKey)).email || 'Stremio account';
        } catch {
          address = 'Stremio account';
        }
      }
      const next = {authKey, email: address};
      await saveJson(SESSION_KEY, next);
      setSession(next);
      await loadAccountData(next);
    },
    [loadAccountData],
  );

  const signOut = useCallback(async () => {
    if (session) {
      await api.logout(session.authKey);
    }
    await removeKey(SESSION_KEY);
    setSession(null);
    await loadAccountData(null);
  }, [loadAccountData, session]);

  const refresh = useCallback(() => loadAccountData(session), [loadAccountData, session]);

  const setServer = useCallback(async (url: string) => {
    await saveJson(SERVER_KEY, url);
    setServerState(url);
  }, []);

  // Writes a library item to the account and mirrors it locally.
  const putItem = useCallback(
    async (item: LibraryItem) => {
      setLibrary((previous) => {
        const others = previous.filter((entry) => entry._id !== item._id);
        return [item, ...others];
      });
      if (session) {
        try {
          await api.putLibraryItems(session.authKey, [item]);
        } catch (e: any) {
          console.log(`[stremio] library sync failed: ${e?.message || e}`);
        }
      }
    },
    [session],
  );

  const saveProgress = useCallback(
    async (meta: MetaPreview, videoId: string, position: number, duration: number) => {
      const point = {position, duration, at: Date.now()};
      setResume((previous) => {
        const next = {...previous, [videoId]: point};
        // Keep the 200 most recent entries.
        const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, 200));
        saveJson(RESUME_KEY, trimmed);
        return trimmed;
      });
      if (!session || position < 5) {
        return;
      }
      // Sync to the Stremio library (Continue Watching on every device) at most every 30 s.
      const finished = duration > 0 && position / duration > 0.93;
      const now = Date.now();
      if (!finished && now - (lastSync.current[meta.id] || 0) < 30000) {
        return;
      }
      lastSync.current[meta.id] = now;
      const existing = library.find((entry) => entry._id === meta.id);
      const base = existing || api.newLibraryItem({id: meta.id, type: meta.type, name: meta.name, poster: meta.poster}, false);
      const updated = finished ? api.withFinished(api.withProgress(base, videoId, position, duration)) : api.withProgress(base, videoId, position, duration);
      await putItem(updated);
    },
    [library, session, putItem],
  );

  // "Remove from Continue Watching": clears the resume point (here and on the account)
  // without touching My List.
  const removeFromContinueWatching = useCallback(
    async (id: string) => {
      setResume((previous) => {
        const next = Object.fromEntries(Object.entries(previous).filter(([videoId]) => videoId !== id && !videoId.startsWith(`${id}:`)));
        saveJson(RESUME_KEY, next);
        return next;
      });
      const existing = library.find((entry) => entry._id === id);
      if (existing) {
        await putItem({...existing, state: {...existing.state, timeOffset: 0}, _mtime: new Date().toISOString()});
      }
    },
    [library, putItem],
  );

  const inMyList = useCallback((id: string) => api.isInList(library.find((entry) => entry._id === id)), [library]);

  const toggleMyList = useCallback(
    async (meta: MetaPreview) => {
      const existing = library.find((entry) => entry._id === meta.id);
      const add = !api.isInList(existing);
      const item = existing ? api.withListMembership(existing, add) : api.newLibraryItem({id: meta.id, type: meta.type, name: meta.name, poster: meta.poster}, true);
      await putItem(item);
      return add;
    },
    [library, putItem],
  );

  return {ready, session, addons, addonError, library, server, resume, signIn, signOut, refresh, setServer, saveProgress, toggleMyList, inMyList, removeFromContinueWatching, discovering, subtitleLanguage, setSubtitleLanguage};
}

export function continueWatching(library: LibraryItem[]): LibraryItem[] {
  return library
    // Same rule as Stremio: items with a resume point, including watched-only (temp) items.
    .filter((item) => (!item.removed || item.temp) && (item.state?.timeOffset || 0) > 0)
    .sort((a, b) => String(b.state?.lastWatched || '').localeCompare(String(a.state?.lastWatched || '')))
    .slice(0, 20);
}
