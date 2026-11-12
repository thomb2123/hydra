// Automatic playback screen: shows the title's artwork while the best version
// is chosen (usually already prefetched from the title page), then starts it.
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Image, StyleSheet, Text, View} from 'react-native';
import {PlaySource} from '../../../../shared/src/player/VideoScreen';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Fade} from '../ui/Billboard';
import {Pill} from '../ui/Cards';
import {backdropOf, logoOf} from '../ui/art';
import {brand, edge, type} from '../ui/brand';
import {Pick, pickStream, prefetchPick} from '../stremio/autoPick';
import {episodeLine, prepareSource} from '../stremio/playback';
import {RankedStream} from '../stremio/streamPicker';
import {MetaDetail, Video} from '../stremio/types';
import {StremioState} from '../state';

export interface StartingProps {
  state: StremioState;
  meta: MetaDetail;
  video: Video | null;
  /** Ranking from an earlier attempt (when falling back after a failed start). */
  ranked?: RankedStream[];
  startIndex?: number;
  notice?: string;
  onReady: (source: PlaySource, ranked: RankedStream[], index: number) => void;
  onManual: () => void;
  onBack: () => void;
  log: (line: string) => void;
}

export const Starting = ({state, meta, video, startIndex = 0, onReady, onManual, onBack, log}: StartingProps) => {
  const [failed, setFailed] = useState<string | null>(null);
  const cancelled = useRef(false);
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(sweep, {toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: false}));
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  useBackHandler(() => {
    cancelled.current = true;
    onBack();
    return true;
  });

  useEffect(() => {
    cancelled.current = false;
    const began = Date.now();
    (async () => {
      try {
        // First attempt uses the prefetched choice; fallbacks re-check from the next candidate.
        const pick: Pick | null = startIndex === 0 ? await prefetchPick(state, meta, video, log) : await pickStream(state, meta, video, log, startIndex);
        if (cancelled.current) {
          return;
        }
        if (!pick) {
          setFailed('No playable versions were found for this title.');
          return;
        }
        const chosen = pick.ranked[pick.index];
        const source = await prepareSource(state, meta, video, chosen.stream, chosen.summary, {frameRate: pick.frameRate}, pick.url);
        if (cancelled.current) {
          return;
        }
        log(`ready in ${Date.now() - began} ms: #${pick.index} ${chosen.summary}`);
        // Only torrents get a start-up timeout (peers can be slow); HTTP streams fall back on real errors only.
        onReady({...source, startTimeoutMs: chosen.traits.torrent ? 120000 : undefined}, pick.ranked, pick.index);
      } catch (e: any) {
        if (!cancelled.current) {
          setFailed(String(e?.message || e));
        }
      }
    })();
    return () => {
      cancelled.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logo = logoOf(meta);
  const [logoFailed, setLogoFailed] = useState(false);
  const line = episodeLine(video);
  return (
    <View style={styles.root}>
      <Image source={{uri: backdropOf(meta, 'medium')}} style={styles.backdrop} resizeMode="cover" fadeDuration={0} />
      <View style={styles.dim} />
      <Fade direction="left" size={1200} />
      <View style={styles.info}>
        {logo && !logoFailed ? (
          <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" onError={() => setLogoFailed(true)} />
        ) : (
          <Text style={styles.title} numberOfLines={2}>
            {meta.name}
          </Text>
        )}
        {line ? <Text style={styles.episode}>{line}</Text> : null}
        {failed ? (
          <>
            <Text style={styles.error}>{failed}</Text>
            <View style={styles.actions}>
              <Pill label="Choose a version" primary hasTVPreferredFocus onPress={onManual} />
              <Pill label="Back" onPress={onBack} />
            </View>
          </>
        ) : (
          <View style={styles.bar}>
            <Animated.View style={[styles.barPulse, {transform: [{translateX: sweep.interpolate({inputRange: [0, 1], outputRange: [-160, 420]})}]}]} />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background},
  backdrop: {position: 'absolute', top: 0, right: 0, width: 1600, height: '100%'},
  dim: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)'},
  info: {position: 'absolute', left: edge, top: 320, width: 1000},
  logo: {width: 560, height: 180, marginBottom: 10},
  title: {color: brand.text, fontSize: type.hero, fontWeight: '900'},
  episode: {color: brand.textSoft, fontSize: type.body, marginTop: 8},
  bar: {width: 420, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 30, overflow: 'hidden'},
  barPulse: {width: 160, height: 6, borderRadius: 3, backgroundColor: brand.accent},
  error: {color: brand.danger, fontSize: type.body, marginTop: 24, marginBottom: 20},
  actions: {flexDirection: 'row'},
});
