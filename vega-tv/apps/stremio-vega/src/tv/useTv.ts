// Live TV state for the Stremio app: FlixNest sign-in, the merged channel
// guide (cached, refreshed daily in the background) and live sport events.
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';
import * as fx from './flixnest';
import {GuideData, buildGuide, isStale, loadCachedGuide, reRank} from './guide';
import {EARLY_SEC, SportEvent, buildEvents, eventTokens, feedLabel, guideAgrees, isOnNow, liveNow} from './events';
import {firstLive, prefetchChannel} from './tune';
import {nowNext} from './epg';
import {ProgrammeTag, Scores, applyScores, fetchScores, programmeTag} from './scores';
import {loadJson, saveJson} from '../../../../shared/src/storage';

const LAST_KEY = 'tv.last.v1';

/** Where the viewer was: the guide reopens on this category and channel, like a TV box. */
export interface LastWatched {
  category: string;
  channelId: string;
}

export interface TvState {
  ready: boolean;
  access: fx.Access | null;
  guide: GuideData | null;
  building: {done: number; total: number; label: string} | null;
  error: string | null;
  events: SportEvent[];
  last: LastWatched | null;
  setLast: (last: LastWatched) => void;
  connect: (access: fx.Access) => Promise<void>;
  disconnect: () => Promise<void>;
  rebuild: () => Promise<void>;
  refreshRanking: () => Promise<void>;
  refreshEvents: () => Promise<void>;
  /** LIVE / REPLAY tag for a channel's current programme (from live scores). */
  programmeTag: (title: string) => ProgrammeTag;
}

/**
 * While a film or channel plays, Live TV does no background work (listings, scores,
 * guides, clock re-renders): the stick needs everything for smooth playback.
 */
let backgroundPaused = false;
/** Refreshes Live Now (set by the hook); run as soon as playback ends. */
let refreshOnResume: (() => void) | null = null;
export function setTvBackgroundPaused(paused: boolean): void {
  const resuming = backgroundPaused && !paused;
  backgroundPaused = paused;
  if (resuming) {
    refreshOnResume?.();
  }
}

export function useTv(): TvState {
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<fx.Access | null>(null);
  const [guide, setGuide] = useState<GuideData | null>(null);
  const [building, setBuilding] = useState<TvState['building']>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SportEvent[]>([]);
  const [scores, setScores] = useState<Scores | null>(null);
  const [last, setLastState] = useState<LastWatched | null>(null);
  const buildingRef = useRef(false);
  const guideRef = useRef<GuideData | null>(null);
  guideRef.current = guide;
  /** When the events list last refreshed successfully (ms). */
  const fetchedAtRef = useRef(0);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (backgroundPaused) {
      return;
    }
    const acc = access;
    const g = guideRef.current;
    if (!acc || !g) {
      return;
    }
    try {
      const raw = await fx.events(acc);
      const items: any[] = raw.items || [];
      const built = buildEvents(items, g.channels);
      // Listings call re-runs "live"; live scores say what is really in progress.
      const scores = await fetchScores().catch(() => null);
      if (scores) {
        setScores(scores);
      }
      const scored = applyScores(built, scores);
      // (No background stream checks: each one opens a session on the IPTV account, and
      // the providers' connection limits then refuse films and channels the viewer opens.
      // The player itself fails over between sources when one will not start.)
      const verified = (await checkAgainstGuide(acc, scored, g)).map((e) => ({...e, streamOk: true}));
      fetchedAtRef.current = Date.now();
      setEvents(verified);
      const statuses = new Map<string, number>();
      items.forEach((i) => statuses.set(String(i?.status), (statuses.get(String(i?.status)) || 0) + 1));
      // eslint-disable-next-line no-console
      console.log(
        `[stremio] tv events: ${items.length} listed (${[...statuses].map(([s, n]) => `${s}=${n}`).join(' ')}; fields ${Object.keys(items[0] || {}).join(',')}); ` +
          `scores ${scores ? `${scores.events.length} (${[...scores.covered].join(',')})` : 'unavailable'}; ` +
          `live now: ${liveNow(verified).filter((e) => e.streamOk).map((e) => `${e.live ? '' : 'soon '}${e.title}${e.verified ? ' ✓' : ''} [${e.channelName || '?'}]`).join(' | ') || 'none'}`,
      );
    } catch (e: any) {
      // Sport rows are optional; an old list expires on its own (see below). FlixNest's
      // "temporarily unavailable" usually clears in seconds, so try again soon.
      // eslint-disable-next-line no-console
      console.log(`[stremio] tv events refresh failed: ${e?.message || e}; retrying in 20 s`);
      if (!retryRef.current) {
        retryRef.current = setTimeout(() => {
          retryRef.current = null;
          refreshRef.current();
        }, 20 * 1000);
      }
    }
  }, [access]);
  const refreshRef = useRef(refreshEvents);
  refreshRef.current = refreshEvents;
  useEffect(() => {
    refreshOnResume = () => refreshRef.current();
    return () => {
      refreshOnResume = null;
    };
  }, []);

  // Re-judge "live" against the clock every 30 s, so finished events drop off without a refetch.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!backgroundPaused) {
        setClock(Date.now());
      }
    }, 30 * 1000);
    return () => clearInterval(timer);
  }, []);
  const liveEvents = useMemo(() => {
    // A list that could not be refreshed for a while is not trusted at all.
    if (!fetchedAtRef.current || clock - fetchedAtRef.current > STALE_EVENTS_MS) {
      return [];
    }
    // Only what was checked as really streaming; the next refresh (≤ 2 min) checks newcomers.
    return liveNow(events, clock / 1000).filter((e) => e.streamOk);
  }, [events, clock]);

  useEffect(() => {
    (async () => {
      setLastState(await loadJson<LastWatched | null>(LAST_KEY, null));
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
    const timer = setInterval(refreshEvents, EVENTS_REFRESH_MS);
    // Timers do not run while the app is in the background: refetch on return.
    const sub = AppState.addEventListener?.('change', (next: string) => {
      if (next === 'active' && Date.now() - fetchedAtRef.current > 60 * 1000) {
        refreshEvents();
      }
    });
    return () => {
      clearInterval(timer);
      sub?.remove?.();
    };
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

  const setLast = useCallback((next: LastWatched) => {
    setLastState((prev) => (prev && prev.channelId === next.channelId && prev.category === next.category ? prev : next));
    saveJson(LAST_KEY, next);
  }, []);

  const tagProgramme = useCallback((title: string) => programmeTag(title, scores), [scores]);
  return {ready, access, guide, building, error, events: liveEvents, last, setLast, connect, disconnect, rebuild, refreshRanking, refreshEvents, programmeTag: tagProgramme};
}

const EVENTS_REFRESH_MS = 2 * 60 * 1000;

/**
 * Checks that what Live Now would show (and what joins it before the next refresh)
 * is really streaming: the channel's best source, else the direct event feeds, must
 * be a moving live stream, not a dead link or a "maintenance" placeholder. The
 * found source is cached, so choosing the event then starts straight away.
 */
async function checkStreams(acc: fx.Access, events: SportEvent[], g: GuideData): Promise<SportEvent[]> {
  const byId = new Map(g.channels.map((c) => [c.id, c]));
  const now = Date.now() / 1000;
  const soon = now + EVENTS_REFRESH_MS / 1000 + 60;
  const candidates = events.filter((e) => e.tier <= 1 && (isOnNow(e, now) || isOnNow(e, soon))).slice(0, 14);
  const result = new Map<string, 'channel' | 'feeds' | 'none'>();
  await Promise.all(
    candidates.map(async (e) => {
      const channel = e.channelId ? byId.get(e.channelId) : undefined;
      if (channel && (await prefetchChannel(acc, channel).catch(() => null))) {
        result.set(e.key, 'channel');
        return;
      }
      if (e.feeds.length && (await firstLive(acc, e.feeds.slice(0, 4)).catch(() => null))) {
        result.set(e.key, 'feeds');
        return;
      }
      result.set(e.key, 'none');
    }),
  );
  const out: SportEvent[] = [];
  for (const e of events) {
    const r = result.get(e.key);
    if (r === 'none') {
      continue;
    }
    if (r === 'feeds' && e.channelId) {
      out.push({...e, channelId: undefined, channelName: feedLabel(e.feeds[0].rawName), streamOk: true});
    } else {
      out.push(r ? {...e, streamOk: true} : e);
    }
  }
  return out;
}
const STALE_EVENTS_MS = 15 * 60 * 1000;

/**
 * Checks live events against their channel's own guide for right now (up to 10
 * channels, cached for 5 minutes). When the guide clearly shows something else
 * (a replay, a studio show), that channel is not carrying the event: it falls
 * back to its direct event feeds, or is dropped when it has none.
 */
async function checkAgainstGuide(acc: fx.Access, events: SportEvent[], g: GuideData): Promise<SportEvent[]> {
  const byId = new Map(g.channels.map((c) => [c.id, c]));
  const now = Date.now() / 1000;
  // Starting within the Live Now window (plus one refresh): shown as "soon", so checked now too.
  const soon = (e: SportEvent) => !e.live && !!e.start && e.start - now <= EARLY_SEC + EVENTS_REFRESH_MS / 1000;
  const toCheck = events.filter((e) => (e.live || soon(e)) && e.channelId && byId.has(e.channelId) && e.tier <= 1).slice(0, 14);
  const verdicts = new Map<string, {agrees: 'match' | 'other' | 'unknown'; saysLive: boolean; nextIsIt: boolean; official: boolean}>();
  await Promise.all(
    toCheck.map(async (e) => {
      try {
        const nn = await nowNext(acc, byId.get(e.channelId!)!);
        const next = String(nn.next?.title || '').toLowerCase();
        verdicts.set(e.key, {
          agrees: guideAgrees(e, nn.now),
          saysLive: !!nn.now?.live || /\blive\b/i.test(String(nn.now?.title || '')),
          official: !!nn.official,
          // The channel's next programme is this event, live (or it is already on now).
          nextIsIt: (/\blive\b/.test(next) && eventTokens(e.title).some((t) => next.includes(t))) || guideAgrees(e, nn.now) === 'match',
        });
      } catch {
        verdicts.set(e.key, {agrees: 'unknown', saysLive: false, nextIsIt: false, official: false});
      }
    }),
  );
  const out: SportEvent[] = [];
  for (const e of events) {
    if (!e.live) {
      // About to start: live scores list it as scheduled, or the channel's guide has it next, live.
      // Later ones are judged again when they come close.
      if (!soon(e) || e.scheduled || verdicts.get(e.key)?.nextIsIt) {
        out.push(e);
      }
      continue;
    }
    const v = verdicts.get(e.key);
    if (v?.official) {
      // The channel has a real TV guide (Sky / Virgin / TV Guide): it must list this match
      // now. If it lists something else, the channel is not carrying it; a direct feed may
      // still be offered, marked unconfirmed.
      if (v.agrees === 'match') {
        out.push({...e, confirmed: true});
      } else if (e.feeds.length && e.verified) {
        out.push({...e, channelId: undefined, channelName: feedLabel(e.feeds[0].rawName), confirmed: false});
      }
      continue;
    }
    if (e.verified) {
      // Live scores confirm play; the channel only has to not be showing something else.
      if (v?.agrees !== 'other') {
        out.push(e);
      } else if (e.feeds.length) {
        out.push({...e, channelId: undefined, channelName: feedLabel(e.feeds[0].rawName)});
      }
    } else if (v?.agrees === 'match' && v.saysLive) {
      // No live scores for this sport: the channel's own guide must say it is live now.
      out.push(e);
    }
  }
  // Matches a TV guide confirms on their channel come first; unconfirmed feeds after.
  return [...out.filter((e) => e.confirmed), ...out.filter((e) => !e.confirmed)];
}
