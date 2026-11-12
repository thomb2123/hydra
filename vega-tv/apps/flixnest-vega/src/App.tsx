// Native FlixNest client for Vega OS Fire TV devices (unofficial).
// Talks to the same API as the FlixNest web player and plays media with
// Vega's native player (which also handles AVI and plain-HTTP streams that the
// web player has to hand off to external apps).
import React, {useCallback, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../shared/src/player/VideoScreen';
import {colors, fonts} from '../../../shared/src/ui/theme';
import {FocusButton} from '../../../shared/src/ui/FocusButton';
import {useBackHandler} from '../../../shared/src/tv/remote';
import {Episode, Item, PlayKind, SeriesResult} from './flixnest/api';
import {useFlixState} from './state';
import {SignIn} from './screens/SignIn';
import {Browse, Tab} from './screens/Browse';
import {Series} from './screens/Series';

type Playing = {source: PlaySource; id: string; kind: PlayKind; list: Item[]; index: number};

export const App = () => {
  const state = useFlixState();
  const [tab, setTab] = useState<Tab>('live');
  const [seriesItem, setSeriesItem] = useState<Item | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const zapping = useRef(false);

  const start = useCallback(
    async (id: string, kind: PlayKind, title: string, detail: string, list: Item[] = [], index = -1) => {
      if (!state.access) {
        return;
      }
      setFailure(null);
      try {
        const result = await state.client.play(state.access, id, kind);
        if (!result || !result.url) {
          throw new Error('The server did not return playable media.');
        }
        const resume = kind !== 'live' ? state.resume[id] : undefined;
        const startAt = resume && resume.position > 30 && (!resume.duration || resume.position < resume.duration - 60) ? resume.position : 0;
        const notes = [detail, result.external_only ? `web player would hand this off (${result.reason || 'format'}); trying the native Vega player` : ''].filter(Boolean);
        setPlaying({
          source: {url: result.url, mime: result.mime, title: result.name || title, detail: notes.join(' · '), live: kind === 'live', startAt},
          id,
          kind,
          list,
          index,
        });
      } catch (e: any) {
        setFailure(`${title}: ${e?.message || e}`);
      }
    },
    [state.access, state.client, state.resume],
  );

  if (!state.ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Loading FlixNest…</Text>
      </View>
    );
  }

  if (!state.access) {
    return <SignIn state={state} />;
  }

  if (playing) {
    const zap =
      playing.kind === 'live' && playing.list.length > 1
        ? async (step: number) => {
            if (zapping.current) {
              return;
            }
            zapping.current = true;
            const nextIndex = (playing.index + step + playing.list.length) % playing.list.length;
            const next = playing.list[nextIndex];
            await start(next.id, 'live', next.name, [next.category, next.country].filter(Boolean).join(' · '), playing.list, nextIndex);
            zapping.current = false;
          }
        : undefined;
    return (
      <VideoScreen
        key={playing.source.url}
        source={playing.source}
        onZap={zap}
        onExit={() => setPlaying(null)}
        onProgress={(position, duration) => {
          if (playing.kind !== 'live') {
            state.saveResume(playing.id, {position, duration, at: Date.now(), name: playing.source.title, kind: playing.kind === 'episode' ? 'episode' : 'movies'});
          }
        }}
      />
    );
  }

  if (seriesItem) {
    return (
      <Series
        state={state}
        item={seriesItem}
        onBack={() => setSeriesItem(null)}
        playEpisode={(series: SeriesResult, season: number, episode: Episode) =>
          start(String(episode.id), 'episode', `${series.name || seriesItem.name} · S${season}E${episode.episode ?? ''}`, episode.name || '')
        }
      />
    );
  }

  return (
    <View style={styles.flex}>
      <Browse
        state={state}
        tab={tab}
        setTab={setTab}
        playLive={(item, list) => start(item.id, 'live', item.name, [item.category, item.country].filter(Boolean).join(' · '), list, list.indexOf(item))}
        playMovie={(item) => start(item.id, 'movies', item.name, String(item.year || ''))}
        openSeries={(item) => setSeriesItem(item)}
      />
      {failure ? <FailureBanner message={failure} onClose={() => setFailure(null)} /> : null}
    </View>
  );
};

const FailureBanner = ({message, onClose}: {message: string; onClose: () => void}) => {
  useBackHandler(() => {
    onClose();
    return true;
  });
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{message}</Text>
      <FocusButton compact label="OK" hasTVPreferredFocus onPress={onClose} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: {flex: 1, backgroundColor: colors.background},
  center: {flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center'},
  text: {color: colors.text, fontSize: fonts.heading},
  banner: {position: 'absolute', left: 80, right: 80, bottom: 48, backgroundColor: colors.surfaceRaised, borderRadius: 14, padding: 20, flexDirection: 'row', alignItems: 'center'},
  bannerText: {color: colors.danger, fontSize: fonts.body, flex: 1},
});
