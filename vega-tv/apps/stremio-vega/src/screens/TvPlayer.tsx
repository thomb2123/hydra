// Plays a merged channel: asks FlixNest for the best-ranked source's stream,
// falls back to the next source if it does not start within a few seconds,
// remembers which sources work, and zaps through the category with ▲/▼.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {PlaySource, VideoScreen} from '../../../../shared/src/player/VideoScreen';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Pill} from '../ui/Cards';
import {brand, type} from '../ui/brand';
import * as fx from '../tv/flixnest';
import {MergedChannel, Source} from '../tv/channels';
import {cleanTitle, nowNext, timeRange} from '../tv/epg';
import {recordResult} from '../tv/guide';

export interface TvPlayerProps {
  access: fx.Access;
  list: MergedChannel[];
  index: number;
  /** For sport events without a curated channel: play these feeds directly. */
  feeds?: Source[];
  title?: string;
  onExit: () => void;
  onRanked?: () => void;
  log?: (line: string) => void;
}

const START_TIMEOUT_MS = 10000;

export const TvPlayer = ({access, list, index: startIndex, feeds, title, onExit, onRanked, log = () => undefined}: TvPlayerProps) => {
  const [index, setIndex] = useState(startIndex);
  const [attempt, setAttempt] = useState(0);
  const [source, setSource] = useState<PlaySource | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const channel: MergedChannel | undefined = list[index];
  const sources: Source[] = feeds && feeds.length ? feeds : channel?.sources || [];
  const name = title || channel?.name || 'Live TV';
  const current = sources[attempt];
  const generation = useRef(0);

  useEffect(() => {
    const gen = ++generation.current;
    setSource(null);
    setFailure(null);
    if (!current) {
      setFailure(`${name} isn't available right now. All ${sources.length} sources failed.`);
      return;
    }
    (async () => {
      let guide = '';
      if (channel && !feeds) {
        const info = await nowNext(access, channel).catch(() => null);
        if (info?.now?.title) {
          guide = `${timeRange(info.now)}  ${cleanTitle(info.now.title)}`;
        }
      }
      try {
        const stream = await fx.play(access, current.id);
        if (gen !== generation.current) {
          return;
        }
        log(`tv ${name}: source ${attempt + 1}/${sources.length} (${current.provider}, q${current.quality})`);
        setSource({
          url: stream.url,
          mime: stream.mime || 'application/vnd.apple.mpegurl',
          title: name,
          subtitle: guide || undefined,
          detail: current.quality >= 4 ? 'UHD' : current.quality >= 3 ? 'HD' : undefined,
          live: true,
          startTimeoutMs: START_TIMEOUT_MS,
        });
      } catch (e: any) {
        if (gen !== generation.current) {
          return;
        }
        log(`tv ${name}: source ${attempt + 1} refused (${e?.message || e})`);
        recordResult(current, false).catch(() => undefined);
        setAttempt((a) => a + 1);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, attempt]);

  const onFailed = useCallback(
    (reason: string) => {
      log(`tv ${name}: source ${attempt + 1} failed (${reason}), trying the next one`);
      if (current) {
        recordResult(current, false).catch(() => undefined);
      }
      setAttempt((a) => a + 1);
    },
    [attempt, current, log, name],
  );

  const onStarted = useCallback(() => {
    if (current) {
      recordResult(current, true)
        .then(() => onRanked?.())
        .catch(() => undefined);
    }
  }, [current, onRanked]);

  const zap = useCallback(
    (step: number) => {
      if (feeds || list.length < 2) {
        return;
      }
      setIndex((i) => (i + step + list.length) % list.length);
      setAttempt(0);
    },
    [feeds, list.length],
  );

  useBackHandler(() => {
    if (!source) {
      onExit();
      return true;
    }
    return false;
  });

  if (failure) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{failure}</Text>
        <View style={styles.actions}>
          <Pill label="Try again" primary hasTVPreferredFocus onPress={() => setAttempt(0)} />
          {!feeds && list.length > 1 ? <Pill label="Next channel" onPress={() => zap(1)} /> : null}
          <Pill label="Back to guide" onPress={onExit} />
        </View>
      </View>
    );
  }
  if (!source) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.muted}>{attempt > 0 ? 'Switching to a better source…' : 'Tuning…'}</Text>
      </View>
    );
  }
  return (
    <VideoScreen
      key={`${index}:${attempt}:${source.url}`}
      source={source}
      onExit={onExit}
      onLog={log}
      onFailed={onFailed}
      onStarted={onStarted}
      onZap={feeds ? undefined : zap}
    />
  );
};

const styles = StyleSheet.create({
  center: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 160},
  title: {color: brand.text, fontSize: type.title, fontWeight: '900', textAlign: 'center'},
  muted: {color: brand.textMuted, fontSize: type.body, marginTop: 12},
  actions: {flexDirection: 'row', marginTop: 30},
});
