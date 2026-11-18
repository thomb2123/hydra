// Native Stremio client for Vega OS Fire TV devices (unofficial).
// Stremio is the back end (account, add-ons, streams); the front end is a
// streaming-service style browser with automatic stream choice.
// UI in React Native for Vega; playback through Vega's native media player;
// torrents via the user's own Stremio streaming server on their PC.
import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../shared/src/player/VideoScreen';
import {exitApp, useBackHandler} from '../../../shared/src/tv/remote';
import {useStremioState} from './state';
import {Browse, BrowseTab} from './screens/Browse';
import {Categories, GenrePage} from './screens/Categories';
import {Detail} from './screens/Detail';
import {Search} from './screens/Search';
import {Settings} from './screens/Settings';
import {Splash} from './screens/Splash';
import {Starting} from './screens/Starting';
import {Streams} from './screens/Streams';
import {brand} from './ui/brand';
import {RankedStream} from './stremio/streamPicker';
import {nextEpisode} from './stremio/playback';
import {forgetPick} from './stremio/autoPick';
import {markNoSeekHost} from './stremio/badHosts';
import {MetaDetail, MetaPreview, Video} from './stremio/types';
import {useTv} from './tv/useTv';
import {TvPlayer} from './screens/TvPlayer';
import {MergedChannel, Source} from './tv/channels';
import {SportEvent} from './tv/events';

type Route =
  | {name: 'browse'}
  | {name: 'detail'; type: string; id: string; preview?: MetaPreview}
  | {name: 'starting'; meta: MetaDetail; video: Video | null; ranked?: RankedStream[]; startIndex?: number; notice?: string}
  | {name: 'streams'; meta: MetaDetail; video: Video | null}
  | {name: 'player'; source: PlaySource; meta: MetaDetail; video: Video | null; videoId: string; ranked?: RankedStream[]; index?: number}
  | {name: 'search'}
  | {name: 'categories'}
  | {name: 'genre'; genre: string}
  | {name: 'settings'}
  | {name: 'tv'; list: MergedChannel[]; index: number; feeds?: Source[]; title?: string};

const log = (line: string) => console.log(`[stremio] ${line}`);

export const App = () => {
  const state = useStremioState();
  const tv = useTv();
  const [splashDone, setSplashDone] = useState(false);
  const [tab, setTab] = useState<BrowseTab>('home');
  const [stack, setStack] = useState<Route[]>([{name: 'browse'}]);
  const route = stack[stack.length - 1];
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
  const playEvent = useCallback(
    (event: SportEvent) => {
      const channel = event.channelId ? (tv.guide?.channels || []).find((c) => c.id === event.channelId) : undefined;
      if (channel) {
        push({name: 'tv', list: [channel], index: 0, title: `${event.title}`});
      } else if (event.feeds.length) {
        push({name: 'tv', list: [], index: 0, feeds: event.feeds, title: event.title});
      }
    },
    [push, tv.guide],
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
          play={(meta, video) => push({name: 'starting', meta, video})}
          openStreams={(meta, video) => push({name: 'streams', meta, video})}
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
              source,
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
    case 'player': {
      const {ranked, index} = route;
      const next = nextEpisode(route.meta, route.video);
      return (
        <VideoScreen
          key={route.source.url}
          source={route.source}
          onExit={pop}
          onLog={log}
          onFailed={
            ranked && index != null
              ? (reason) => {
                  log(`falling back after: ${reason}`);
                  forgetPick(route.meta, route.video);
                  replaceTop({name: 'starting', meta: route.meta, video: route.video, ranked, startIndex: index + 1, notice: 'Finding the best version…'});
                }
              : undefined
          }
          onNext={next ? () => replaceTop({name: 'starting', meta: route.meta, video: next}) : undefined}
          nextLabel="Next Episode"
          preferredSubtitle={state.subtitleLanguage}
          onSubtitleChosen={state.setSubtitleLanguage}
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
      return <Search state={state} openMeta={openMeta} openGenre={openGenre} onBack={pop} />;
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
          onExit={pop}
          onRanked={tv.refreshRanking}
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
  const keepBrowse = route.name !== 'player' && route.name !== 'tv';
  return (
    <View style={styles.fill}>
      {keepBrowse ? (
        <View style={[styles.fill, top ? styles.hidden : null]}>
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
        </View>
      ) : null}
      {top ? <View style={styles.layer}>{top}</View> : null}
    </View>
  );
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
  return <MemoBrowse {...props} />;
};

const MemoBrowse = React.memo(Browse);

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: brand.background},
  hidden: {display: 'none'},
  layer: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: brand.background},
  loading: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center'},
  loadingMark: {color: brand.accent, fontSize: 160, fontWeight: '900'},
});
