// Native Stremio client for Vega OS Fire TV devices (unofficial).
// Stremio is the back end (account, add-ons, streams); the front end is a
// streaming-service style browser with automatic stream choice.
// UI in React Native for Vega; playback through Vega's native media player;
// torrents via the user's own Stremio streaming server on their PC.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../shared/src/player/VideoScreen';
import {exitApp, useBackHandler, useRemoteKeys} from '../../../shared/src/tv/remote';
import {SUBTITLE_SCALE, useStremioState} from './state';
import {Browse, BrowseTab} from './screens/Browse';
import {Categories, GenrePage} from './screens/Categories';
import {Detail} from './screens/Detail';
import {Search} from './screens/Search';
import {Settings} from './screens/Settings';
import {Splash} from './screens/Splash';
import {Starting} from './screens/Starting';
import {Streams} from './screens/Streams';
import {brand} from './ui/brand';
import {FadeIn} from './ui/FadeIn';
import {perfScreen, startPerfMonitor, stopPerfMonitor} from './perf';
import {RankedStream} from './stremio/streamPicker';
import {nextEpisode} from './stremio/playback';
import {forgetPick, noteFailure} from './stremio/autoPick';
import {markNoSeekHost} from './stremio/badHosts';
import {MetaDetail, MetaPreview, Video} from './stremio/types';
import {setTvBackgroundPaused, useTv} from './tv/useTv';
import {TvPlayer} from './screens/TvPlayer';
import {MergedChannel, Source} from './tv/channels';
import {LIVE_NOW_ID, SportEvent} from './tv/events';

type Route =
  | {name: 'browse'}
  | {name: 'detail'; type: string; id: string; preview?: MetaPreview}
  | {name: 'starting'; meta: MetaDetail; video: Video | null; ranked?: RankedStream[]; startIndex?: number; notice?: string; fromStart?: boolean}
  | {name: 'streams'; meta: MetaDetail; video: Video | null}
  | {name: 'player'; source: PlaySource; meta: MetaDetail; video: Video | null; videoId: string; ranked?: RankedStream[]; index?: number}
  /** A blank moment between two players, so the stick releases the old video surface first. */
  | {name: 'gap'; next: Route}
  | {name: 'search'}
  | {name: 'categories'}
  | {name: 'genre'; genre: string}
  | {name: 'settings'}
  | {name: 'tv'; list: MergedChannel[]; index: number; feeds?: Source[]; title?: string; feedName?: string; eventKey?: string};

const log = (line: string) => console.log(`[stremio] ${line}`);

export const App = () => {
  const state = useStremioState();
  const tv = useTv();
  const [splashDone, setSplashDone] = useState(false);
  const [tab, setTab] = useState<BrowseTab>('home');
  // Open on the screen chosen in Settings (once, when the saved settings are in).
  const startApplied = useRef(false);
  useEffect(() => {
    if (state.ready && !startApplied.current) {
      startApplied.current = true;
      if (state.startTab === 'tv') {
        setTab('tv');
      }
    }
  }, [state.ready, state.startTab]);
  const [stack, setStack] = useState<Route[]>([{name: 'browse'}]);
  const route = stack[stack.length - 1];
  const browseAlive = useRef(true);
  const playing = route.name === 'player' || route.name === 'tv' || route.name === 'gap';
  useEffect(() => {
    setTvBackgroundPaused(playing);
  }, [playing]);
  useEffect(() => {
    startPerfMonitor();
    return stopPerfMonitor;
  }, []);
  useEffect(() => {
    perfScreen(route.name === 'browse' ? tab : route.name);
  }, [route.name, tab]);
  // Notes every key press app-wide (handler off), so background work can wait for a still remote.
  useRemoteKeys(noop, false);
  const push = useCallback((next: Route) => setStack((s) => [...s, next]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const replaceTop = useCallback((next: Route) => setStack((s) => [...s.slice(0, -1), next]), []);
  const finishSplash = useCallback(() => setSplashDone(true), []);

  const openMeta = useCallback((type: string, id: string, preview?: MetaPreview) => push({name: 'detail', type, id, preview}), [push]);
  const openGenre = useCallback((genre: string) => push({name: 'genre', genre}), [push]);
  const openSearch = useCallback(() => push({name: 'search'}), [push]);
  const openCategories = useCallback(() => push({name: 'categories'}), [push]);
  const openSettings = useCallback(() => push({name: 'settings'}), [push]);
  const playChannel = useCallback((channel: MergedChannel, list: MergedChannel[]) => push({name: 'tv', list, index: Math.max(0, list.indexOf(channel))}), [push]);
  const {setLast} = tv;
  const playEvent = useCallback(
    (event: SportEvent) => {
      // Back from the event returns to Live Now, on this event.
      setLast({category: LIVE_NOW_ID, channelId: event.key});
      const channel = event.channelId ? (tv.guide?.channels || []).find((c) => c.id === event.channelId) : undefined;
      if (channel) {
        // Play the channel within its category, so ▲/▼ zaps to its neighbours.
        const siblings = (tv.guide?.channels || []).filter((c) => c.category === channel.category);
        push({name: 'tv', list: siblings, index: Math.max(0, siblings.indexOf(channel)), title: event.title, eventKey: event.key});
      } else if (event.feeds.length) {
        push({name: 'tv', list: [], index: 0, feeds: event.feeds, title: event.title, feedName: event.channelName, eventKey: event.key});
      }
    },
    [push, tv.guide, setLast],
  );

  // Diagnostics: which catalogs the account's add-ons offer (names only).
  useEffect(() => {
    if (state.ready) {
      log(`server=${state.server ? 'set' : 'not set'} signedIn=${!!state.session} addons=${state.addons.length}`);
      for (const addon of state.addons) {
        const catalogs = (addon.manifest.catalogs || []).map((c) => `${c.type}/${c.id}${c.name ? `(${c.name})` : ''}${(c.extra || []).some((e) => e.isRequired) ? '*' : ''}`);
        log(`addon ${addon.manifest.name}: ${catalogs.join(', ') || 'no catalogs'}`);
      }
    }
  }, [state.ready, state.addons, state.server, state.session]);

  if (!splashDone) {
    return <Splash onDone={finishSplash} />;
  }
  if (!state.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingMark}>S</Text>
      </View>
    );
  }

  const renderTop = (): React.ReactElement | null => {
  switch (route.name) {
    case 'detail':
      return (
        <Detail
          key={`${route.type}:${route.id}`}
          state={state}
          type={route.type}
          id={route.id}
          preview={route.preview}
          onBack={pop}
          play={(meta, video, fromStart) => push({name: 'starting', meta, video, fromStart})}
          openStreams={(meta, video) => push({name: 'streams', meta, video})}
          openMeta={openMeta}
        />
      );
    case 'starting':
      return (
        <Starting
          key={`${route.meta.id}:${route.video?.id || ''}:${route.startIndex || 0}`}
          state={state}
          meta={route.meta}
          video={route.video}
          ranked={route.ranked}
          startIndex={route.startIndex}
          notice={route.notice}
          log={log}
          onBack={pop}
          onManual={() => replaceTop({name: 'streams', meta: route.meta, video: route.video})}
          onReady={(source, ranked, index) =>
            replaceTop({
              name: 'player',
              source: route.fromStart ? {...source, startAt: 0} : source,
              meta: route.meta,
              video: route.video,
              videoId: route.video ? route.video.id : route.meta.behaviorHints?.defaultVideoId || route.meta.id,
              ranked,
              index,
            })
          }
        />
      );
    case 'streams':
      return (
        <Streams
          state={state}
          meta={route.meta}
          video={route.video}
          onBack={pop}
          onPlay={(source, _metaId, videoId) => push({name: 'player', source, meta: route.meta, video: route.video, videoId})}
        />
      );
    case 'gap':
      return <Gap onDone={() => replaceTop(route.next)} />;
    case 'player': {
      const {ranked, index} = route;
      const next = nextEpisode(route.meta, route.video);
      return (
        <VideoScreen
          key={`${route.source.url}${route.source.engine ? '#engine' : ''}`}
          source={route.source}
          onExit={pop}
          onLog={log}
          onFailed={
            ranked && index != null
              ? (reason) => {
                  log(`falling back after: ${reason.slice(0, 200)}`);
                  if (noteFailure(ranked[index], reason)) {
                    log(`skipping ${ranked[index].addonName} for 30 min (its links fail on this network)`);
                  }
                  forgetPick(route.meta, route.video);
                  replaceTop({name: 'starting', meta: route.meta, video: route.video, ranked, startIndex: index + 1, notice: 'Finding the best version…'});
                }
              : undefined
          }
          onNext={next ? () => replaceTop({name: 'starting', meta: route.meta, video: next}) : undefined}
          nextLabel="Next Episode"
          preferredSubtitle={state.subtitleLanguage}
          onSubtitleChosen={state.setSubtitleLanguage}
          subtitleScale={SUBTITLE_SCALE[state.subtitleSize]}
          onUseEngine={(position) => replaceTop({name: 'gap', next: {...route, source: {...route.source, engine: true, startAt: position}}})}
          onRouteSwitched={(fromUrl, position) => {
            // Remember that this host cannot seek directly, then reopen on the PC route at
            // the same moment (a fresh player: Vega cannot reload a source in place).
            markNoSeekHost(fromUrl).catch(() => undefined);
            if (route.source.altUrl) {
              replaceTop({...route, source: {...route.source, url: route.source.altUrl, altUrl: undefined, startAt: position}});
            }
          }}
          onProgress={route.meta.id === 'test' ? undefined : (position, duration) => state.saveProgress(route.meta, route.videoId, position, duration)}
        />
      );
    }
    case 'search':
      return (
        <Search
          state={state}
          openMeta={openMeta}
          openGenre={openGenre}
          onBack={pop}
          channels={tv.guide?.channels}
          events={tv.events}
          playChannel={playChannel}
          playEvent={playEvent}
        />
      );
    case 'categories':
      return <Categories state={state} onBack={pop} openGenre={openGenre} />;
    case 'genre':
      return <GenrePage key={route.genre} state={state} genre={route.genre} onBack={pop} openMeta={openMeta} />;
    case 'settings':
      return <Settings state={state} tv={tv} onBack={pop} />;
    case 'tv':
      return tv.access ? (
        <TvPlayer
          access={tv.access}
          list={route.list}
          index={route.index}
          feeds={route.feeds}
          title={route.title}
          feedName={route.feedName}
          onExit={pop}
          onRanked={tv.refreshRanking}
          onChannel={(c) =>
            // Still on the event's own channel: keep Live Now as the place to return to.
            route.eventKey && c.id === route.list[route.index]?.id
              ? tv.setLast({category: LIVE_NOW_ID, channelId: route.eventKey})
              : tv.setLast({category: c.category, channelId: c.id})
          }
          log={log}
        />
      ) : null;
    default:
      return null;
  }
  };

  // The browse screen stays mounted (hidden) under title pages, search and categories,
  // so Back is instant and lands on the same row and card. It is released during
  // playback to give the player the stick's memory.
  const top = route.name === 'browse' ? null : renderTop();
  // After playback it is rebuilt only once it is on screen again: a list first laid out
  // while hidden measures as empty and showed no rows until a key was pressed.
  const onVideo = route.name === 'player' || route.name === 'tv' || route.name === 'gap';
  if (onVideo) {
    browseAlive.current = false;
  } else if (!top) {
    browseAlive.current = true;
  }
  const keepBrowse = !onVideo && browseAlive.current;
  return (
    <View style={styles.fill}>
      {keepBrowse ? (
        <FadeIn token={top ? 'hidden' : `browse-${stack.length}`} style={[styles.fill, top ? styles.hidden : null]}>
          <BrowseRoot
            active={!top}
            state={state}
            tab={tab}
            setTab={setTab}
            openMeta={openMeta}
            openSearch={openSearch}
            openCategories={openCategories}
            openSettings={openSettings}
            tv={tv}
            playChannel={playChannel}
            playEvent={playEvent}
          />
        </FadeIn>
      ) : null}
      {top ? (
        // Video screens appear on their own (a fade over a starting picture would flash).
        route.name === 'player' || route.name === 'tv' || route.name === 'gap' ? (
          <View style={styles.layer}>{top}</View>
        ) : (
          <FadeIn token={`${stack.length}-${route.name}`} style={styles.layer}>
            {top}
          </FadeIn>
        )
      ) : null}
    </View>
  );
};

/** Black for a moment, then the next screen (lets the stick free the previous player's surface). */
const Gap = ({onDone}: {onDone: () => void}) => {
  useEffect(() => {
    const timer = setTimeout(onDone, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View style={styles.gap} />;
};

const BrowseRoot = ({active, ...props}: React.ComponentProps<typeof Browse> & {active: boolean}) => {
  useBackHandler(() => {
    if (props.tab !== 'home') {
      props.setTab('home');
      return true;
    }
    exitApp();
    return true;
  }, active);
  return <MemoBrowse {...props} active={active} />;
};

const MemoBrowse = React.memo(Browse);

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: brand.background},
  hidden: {display: 'none'},
  gap: {flex: 1, backgroundColor: '#000'},
  layer: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: brand.background},
  loading: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center'},
  loadingMark: {color: brand.accent, fontSize: 160, fontWeight: '900'},
});

const noop = () => undefined;
