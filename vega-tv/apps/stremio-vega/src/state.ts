// App-wide Stremio state: session, add-ons, streaming server and resume points.
import {useCallback, useEffect, useMemo, useState} from 'react';
import {loadJson, removeKey, saveJson} from '../../../shared/src/storage';
import * as api from './stremio/api';
import {usableAddons} from './stremio/addons';
import {AddonDescriptor, LibraryItem} from './stremio/types';

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
  saveProgress: (metaId: string, videoId: string, position: number, duration: number) => Promise<void>;
}

export function useStremioState(): StremioState {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [addonError, setAddonError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [server, setServerState] = useState('');
  const [resume, setResume] = useState<Record<string, ResumePoint>>({});

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
      await loadAccountData(stored);
      setReady(true);
    })();
  }, [loadAccountData]);

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

  const saveProgress = useCallback(
    async (metaId: string, videoId: string, position: number, duration: number) => {
      const point = {position, duration, at: Date.now()};
      setResume((previous) => {
        const next = {...previous, [videoId]: point};
        // Keep the 200 most recent entries.
        const trimmed = Object.fromEntries(Object.entries(next).sort((a, b) => b[1].at - a[1].at).slice(0, 200));
        saveJson(RESUME_KEY, trimmed);
        return trimmed;
      });
      // Sync to the Stremio library only for items the user already saved there.
      const item = library.find((entry) => entry._id === metaId && !entry.removed);
      if (session && item && position > 5) {
        const updated = api.withProgress(item, videoId, position, duration);
        try {
          await api.putLibraryItems(session.authKey, [updated]);
          setLibrary((previous) => previous.map((entry) => (entry._id === metaId ? updated : entry)));
        } catch {
          // Progress is still kept locally.
        }
      }
    },
    [library, session],
  );

  return {ready, session, addons, addonError, library, server, resume, signIn, signOut, refresh, setServer, saveProgress};
}

export function continueWatching(library: LibraryItem[]): LibraryItem[] {
  return library
    .filter((item) => !item.removed && (item.state?.timeOffset || 0) > 0)
    .sort((a, b) => String(b.state?.lastWatched || '').localeCompare(String(a.state?.lastWatched || '')))
    .slice(0, 20);
}
