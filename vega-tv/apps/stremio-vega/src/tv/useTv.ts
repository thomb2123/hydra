// Live TV state for the Stremio app: FlixNest sign-in, the merged channel
// guide (cached, refreshed daily in the background) and live sport events.
import {useCallback, useEffect, useRef, useState} from 'react';
import * as fx from './flixnest';
import {GuideData, buildGuide, isStale, loadCachedGuide, reRank} from './guide';
import {SportEvent, buildEvents} from './events';

export interface TvState {
  ready: boolean;
  access: fx.Access | null;
  guide: GuideData | null;
  building: {done: number; total: number; label: string} | null;
  error: string | null;
  events: SportEvent[];
  connect: (access: fx.Access) => Promise<void>;
  disconnect: () => Promise<void>;
  rebuild: () => Promise<void>;
  refreshRanking: () => Promise<void>;
  refreshEvents: () => Promise<void>;
}

export function useTv(): TvState {
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<fx.Access | null>(null);
  const [guide, setGuide] = useState<GuideData | null>(null);
  const [building, setBuilding] = useState<TvState['building']>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SportEvent[]>([]);
  const buildingRef = useRef(false);
  const guideRef = useRef<GuideData | null>(null);
  guideRef.current = guide;

  const rebuildWith = useCallback(async (acc: fx.Access, quiet: boolean) => {
    if (buildingRef.current) {
      return;
    }
    buildingRef.current = true;
    if (!quiet) {
      setBuilding({done: 0, total: 1, label: 'Finding your channels…'});
    }
    setError(null);
    try {
      const next = await buildGuide(acc, quiet ? undefined : (done, total, label) => setBuilding({done, total, label}));
      if (next.channels.length) {
        setGuide(next);
      } else if (!quiet) {
        setError('No UK or US channels were found on your FlixNest providers.');
      }
    } catch (e: any) {
      if (fx.needsSignIn(e)) {
        // The FlixNest session (about 30 days) has ended: show the pairing screen again.
        await fx.forgetAccess();
        setAccess(null);
      } else if (!quiet) {
        setError(`Couldn't load channels: ${e?.message || e}`);
      }
    } finally {
      buildingRef.current = false;
      setBuilding(null);
    }
  }, []);

  const refreshEvents = useCallback(async () => {
    const acc = access;
    const g = guideRef.current;
    if (!acc || !g) {
      return;
    }
    try {
      const raw = await fx.events(acc);
      setEvents(buildEvents(raw.items || [], g.channels));
    } catch {
      // Sport rows are optional.
    }
  }, [access]);

  useEffect(() => {
    (async () => {
      const saved = await fx.loadAccess();
      const cached = await loadCachedGuide();
      setAccess(saved);
      if (cached) {
        setGuide(await reRank(cached));
      }
      setReady(true);
      if (saved && isStale(cached)) {
        rebuildWith(saved, !!cached);
      }
    })();
  }, [rebuildWith]);

  useEffect(() => {
    if (!access || !guide) {
      return undefined;
    }
    refreshEvents();
    const timer = setInterval(refreshEvents, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [access, guide, refreshEvents]);

  const connect = useCallback(
    async (next: fx.Access) => {
      await fx.saveAccess(next);
      setAccess(next);
      await rebuildWith(next, false);
    },
    [rebuildWith],
  );

  const disconnect = useCallback(async () => {
    await fx.forgetAccess();
    setAccess(null);
    setEvents([]);
  }, []);

  const rebuild = useCallback(async () => {
    if (access) {
      await rebuildWith(access, false);
    }
  }, [access, rebuildWith]);

  const refreshRanking = useCallback(async () => {
    const g = guideRef.current;
    if (g) {
      setGuide(await reRank(g));
    }
  }, []);

  return {ready, access, guide, building, error, events, connect, disconnect, rebuild, refreshRanking, refreshEvents};
}
