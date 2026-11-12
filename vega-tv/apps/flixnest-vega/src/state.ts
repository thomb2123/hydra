import {useCallback, useEffect, useMemo, useState} from 'react';
import {loadJson, removeKey, saveJson} from '../../../shared/src/storage';
import {Access, AccessResult, FlixNestClient, accessIsValid} from './flixnest/api';

const ACCESS_KEY = 'flixnest.access.v1';
const RESUME_KEY = 'flixnest.resume.v1';

export interface Resume {
  position: number;
  duration: number;
  at: number;
  name: string;
  kind: 'movies' | 'episode';
}

export interface FlixState {
  ready: boolean;
  client: FlixNestClient;
  access: Access | null;
  info: AccessResult | null;
  error: string | null;
  resume: Record<string, Resume>;
  connect: (access: Access) => Promise<boolean>;
  switchProvider: (provider: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  saveResume: (id: string, entry: Resume) => void;
}

export function useFlixState(): FlixState {
  const client = useMemo(() => new FlixNestClient(), []);
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<Access | null>(null);
  const [info, setInfo] = useState<AccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<Record<string, Resume>>({});

  const connect = useCallback(
    async (next: Access) => {
      setError(null);
      try {
        const result = await client.connect(next);
        setInfo(result || {});
        setAccess(next);
        await saveJson(ACCESS_KEY, next);
        return true;
      } catch (e: any) {
        setError(String(e?.message || e));
        return false;
      }
    },
    [client],
  );

  useEffect(() => {
    (async () => {
      await client.restoreCookies();
      setResume(await loadJson<Record<string, Resume>>(RESUME_KEY, {}));
      const saved = await loadJson<Access | null>(ACCESS_KEY, null);
      if (saved && accessIsValid(saved)) {
        if (saved.type === 'account') {
          // Account access needs a live session cookie; ask the server to confirm it.
          try {
            const session = await client.accountSession();
            const restored: Access = session.access.type === 'account' && saved.provider ? {...session.access, provider: saved.provider} : session.access;
            await connect(restored);
          } catch (e: any) {
            setError(e?.code === 'account_required' ? 'Your FlixNest session has ended. Sign in again.' : `Could not restore your session: ${e?.message || e}`);
          }
        } else {
          await connect(saved);
        }
      }
      setReady(true);
    })();
  }, [client, connect]);

  const switchProvider = useCallback(
    async (provider: string) => {
      if (!access || access.type !== 'account') {
        return false;
      }
      return connect({type: 'account', scope: access.scope, provider});
    },
    [access, connect],
  );

  const signOut = useCallback(async () => {
    if (access && access.type === 'account') {
      await client.accountLogout(access);
    }
    await removeKey(ACCESS_KEY);
    setAccess(null);
    setInfo(null);
  }, [access, client]);

  const saveResume = useCallback((id: string, entry: Resume) => {
    setResume((previous) => {
      const next = Object.fromEntries(
        Object.entries({...previous, [id]: entry})
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, 200),
      );
      saveJson(RESUME_KEY, next);
      return next;
    });
  }, []);

  return {ready, client, access, info, error, resume, connect, switchProvider, signOut, saveResume};
}
