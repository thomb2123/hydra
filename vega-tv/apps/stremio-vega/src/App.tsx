// Native Stremio client for Vega OS Fire TV devices (unofficial).
// UI in React Native for Vega; playback through Vega's native media player;
// torrents via the user's own Stremio streaming server on their PC.
import React, {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../shared/src/player/VideoScreen';
import {exitApp, useBackHandler} from '../../../shared/src/tv/remote';
import {colors, fonts} from '../../../shared/src/ui/theme';
import {useStremioState} from './state';
import {Home} from './screens/Home';
import {Detail} from './screens/Detail';
import {Streams} from './screens/Streams';
import {Search} from './screens/Search';
import {Settings} from './screens/Settings';
import {MetaDetail, MetaPreview, Video} from './stremio/types';

type Route =
  | {name: 'home'}
  | {name: 'detail'; type: string; id: string; preview?: MetaPreview}
  | {name: 'streams'; meta: MetaDetail; video: Video | null}
  | {name: 'search'}
  | {name: 'settings'}
  | {name: 'player'; source: PlaySource; metaId: string; videoId: string};

export const App = () => {
  const state = useStremioState();
  const [stack, setStack] = useState<Route[]>([{name: 'home'}]);
  const route = stack[stack.length - 1];
  const push = useCallback((next: Route) => setStack((s) => [...s, next]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  const openMeta = useCallback((type: string, id: string, preview?: MetaPreview) => push({name: 'detail', type, id, preview}), [push]);

  if (!state.ready) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading Stremio…</Text>
      </View>
    );
  }

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
          openStreams={(meta, video) => push({name: 'streams', meta, video})}
        />
      );
    case 'streams':
      return (
        <Streams
          state={state}
          meta={route.meta}
          video={route.video}
          onBack={pop}
          onPlay={(source, metaId, videoId) => push({name: 'player', source, metaId, videoId})}
        />
      );
    case 'search':
      return <Search state={state} openMeta={openMeta} onBack={pop} />;
    case 'settings':
      return <Settings state={state} onBack={pop} />;
    case 'player':
      return (
        <VideoScreen
          source={route.source}
          onExit={pop}
          onProgress={(position, duration) => state.saveProgress(route.metaId, route.videoId, position, duration)}
        />
      );
    default:
      return <HomeRoot state={state} openMeta={openMeta} push={push} />;
  }
};

const HomeRoot = ({state, openMeta, push}: {state: ReturnType<typeof useStremioState>; openMeta: (type: string, id: string, preview?: MetaPreview) => void; push: (r: Route) => void}) => {
  useBackHandler(() => {
    exitApp();
    return true;
  });
  return <Home state={state} openMeta={openMeta} openSearch={() => push({name: 'search'})} openSettings={() => push({name: 'settings'})} />;
};

const styles = StyleSheet.create({
  loading: {flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center'},
  loadingText: {color: colors.text, fontSize: fonts.heading},
});
