// Title page: full-bleed artwork, Play/Resume (automatic stream choice),
// seasons and episodes for series, and "Other versions" for manual choice.
import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Fade} from '../ui/Billboard';
import {NavTab, Pill} from '../ui/Cards';
import {backdropOf, logoOf, yearOf} from '../ui/art';
import {brand, edge, type} from '../ui/brand';
import {fetchMeta} from '../stremio/addons';
import {prefetchPick} from '../stremio/autoPick';
import {subtitleList, videoIdOf} from '../stremio/playback';
import {MetaDetail, MetaPreview, Video} from '../stremio/types';
import {StremioState} from '../state';

// Title details for the session: reopening a title (e.g. after watching) is instant.
const metaCache = new Map<string, MetaDetail>();

export interface DetailProps {
  state: StremioState;
  type: string;
  id: string;
  preview?: MetaPreview;
  play: (meta: MetaDetail, video: Video | null) => void;
  openStreams: (meta: MetaDetail, video: Video | null) => void;
  onBack: () => void;
}

const EpisodeCard = ({video, progress, onPress, preferred}: {video: Video; progress?: number; onPress: () => void; preferred?: boolean}) => {
  const [focused, setFocused] = useState(false);
  const number = video.episode ?? video.number;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Episode ${number ?? ''} ${video.title || video.name || ''}`}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.episode, focused && styles.episodeFocused]}>
      <View style={styles.episodeArt}>
        {video.thumbnail ? <Image source={{uri: video.thumbnail}} style={styles.fill} resizeMode="cover" /> : null}
        {progress ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {width: `${Math.min(100, progress * 100)}%`}]} />
          </View>
        ) : null}
      </View>
      <Text style={styles.episodeTitle} numberOfLines={1}>
        {number != null ? `${number}. ` : ''}
        {video.title || video.name || 'Episode'}
      </Text>
      <Text style={styles.episodeText} numberOfLines={focused ? 4 : 2}>
        {video.overview || video.description || ''}
      </Text>
    </TouchableOpacity>
  );
};

export const Detail = ({state, type, id, preview, play, openStreams, onBack}: DetailProps) => {
  const [meta, setMeta] = useState<MetaDetail | null>(preview ? ({...preview} as MetaDetail) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  useBackHandler(() => {
    onBack();
    return true;
  });

  useEffect(() => {
    let alive = true;
    const cacheKey = `${type}:${id}`;
    const cached = metaCache.get(cacheKey);
    if (cached) {
      setMeta(cached);
      setLoading(false);
      return;
    }
    fetchMeta(state.addons, type, id)
      .then((detail) => {
        if (!alive) {
          return;
        }
        if (detail) {
          metaCache.set(cacheKey, detail);
          setMeta(detail);
        } else if (!preview) {
          setError('Details for this title are unavailable.');
        }
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [state.addons, type, id, preview]);

  const videos = useMemo(() => (meta?.videos || []).filter((v) => v && v.id), [meta]);
  const isSeries = videos.length > 0 && type !== 'movie';
  const seasons = useMemo(() => {
    const set = new Set<number>();
    videos.forEach((v) => set.add(typeof v.season === 'number' ? v.season : 0));
    return Array.from(set).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  }, [videos]);

  // Where "Play" should start for a series: the most recently watched episode, else the first.
  const nextUp = useMemo<Video | null>(() => {
    if (!isSeries) {
      return null;
    }
    const library = state.library.find((item) => item._id === id);
    let best: Video | null = null;
    let bestAt = 0;
    for (const v of videos) {
      const r = state.resume[v.id];
      if (r && r.at > bestAt) {
        best = v;
        bestAt = r.at;
      }
    }
    if (!best && library?.state.video_id) {
      best = videos.find((v) => v.id === library.state.video_id) || null;
    }
    const ordered = videos
      .filter((v) => (v.season ?? 0) > 0)
      .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0));
    return best || ordered[0] || videos[0] || null;
  }, [isSeries, videos, state.resume, state.library, id]);

  const activeSeason = season ?? nextUp?.season ?? (seasons.find((s) => s > 0) ?? seasons[0] ?? null);
  const episodes = useMemo(
    () =>
      videos
        .filter((v) => (typeof v.season === 'number' ? v.season : 0) === activeSeason)
        .sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)),
    [videos, activeSeason],
  );

  // Start choosing the stream (and loading subtitles) now, so Play starts instantly.
  const prefetchVideo = isSeries ? nextUp : null;
  useEffect(() => {
    if (!meta || loading || (isSeries && !prefetchVideo)) {
      return;
    }
    const log = (line: string) => console.log(`[stremio] ${line}`);
    prefetchPick(state, meta, prefetchVideo, log).catch(() => undefined);
    subtitleList(state, meta.type, videoIdOf(meta, prefetchVideo)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.id, loading, prefetchVideo?.id]);

  if (!meta) {
    return (
      <View style={styles.root}>
        <Text style={styles.message}>{loading ? 'Loading…' : error}</Text>
        <Pill label="Back" primary hasTVPreferredFocus onPress={onBack} />
      </View>
    );
  }

  const movieVideoId = meta.behaviorHints?.defaultVideoId || id;
  const target = isSeries ? nextUp : null;
  const localResume = state.resume[isSeries ? target?.id || '' : movieVideoId];
  // Progress from this device, else from the Stremio account (other devices, earlier versions).
  const libraryEntry = state.library.find((item) => item._id === id);
  const accountOffset = libraryEntry && (!isSeries || libraryEntry.state.video_id === target?.id) ? (libraryEntry.state.timeOffset || 0) / 1000 : 0;
  // Whichever saved place is further in (this device or the account).
  const accountResume = accountOffset > 0 ? {position: accountOffset, duration: (libraryEntry?.state.duration || 0) / 1000, at: 0} : undefined;
  const resumeAt = localResume && accountResume ? (localResume.position >= accountResume.position ? localResume : accountResume) : localResume || accountResume;
  const resuming = !!resumeAt && resumeAt.position > 30 && (!resumeAt.duration || resumeAt.position < resumeAt.duration - 60);
  const inContinueWatching = resuming || (libraryEntry?.state.timeOffset || 0) > 0;
  const playLabel = isSeries && target
    ? `${resuming ? 'Resume' : 'Play'} S${target.season ?? 0}:E${target.episode ?? target.number ?? 1}`
    : resuming
    ? 'Resume'
    : 'Play';
  const facts = [yearOf(meta) || meta.year, meta.runtime, meta.imdbRating ? `★ ${meta.imdbRating}` : '', isSeries && seasons.filter((s) => s > 0).length ? `${seasons.filter((s) => s > 0).length} Seasons` : '']
    .filter(Boolean)
    .join('   ');
  const logo = logoOf(meta);

  return (
    <View style={styles.root}>
      <Image source={{uri: backdropOf(meta, 'medium')}} style={styles.backdrop} resizeMode="cover" fadeDuration={0} />
      <Fade direction="left" size={1300} />
      <Fade direction="bottom" size={isSeries ? 760 : 420} />
      <View style={[styles.info, isSeries && styles.infoSeries]}>
        {logo && !logoFailed ? (
          <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" onError={() => setLogoFailed(true)} />
        ) : (
          <Text style={styles.name} numberOfLines={2}>
            {meta.name}
          </Text>
        )}
        {facts ? <Text style={styles.facts}>{facts}</Text> : null}
        {meta.genres?.length ? <Text style={styles.genres}>{meta.genres.slice(0, 4).join(' • ')}</Text> : null}
        <Text style={styles.synopsis} numberOfLines={isSeries ? 3 : 5}>
          {meta.description || ''}
        </Text>
        <View style={styles.actions}>
          <Pill label={`▶  ${playLabel}`} primary hasTVPreferredFocus onPress={() => play(meta, target)} />
          {state.session ? (
            <Pill label={state.inMyList(meta.id) ? '✓  My List' : '+  My List'} onPress={() => state.toggleMyList({id: meta.id, type: meta.type || type, name: meta.name, poster: meta.poster})} />
          ) : null}
          <Pill label="Other versions" onPress={() => openStreams(meta, target)} />
          {inContinueWatching ? <Pill label="Remove from Continue Watching" onPress={() => state.removeFromContinueWatching(id)} /> : null}
        </View>
      </View>
      {isSeries ? (
        <View style={styles.seriesBox}>
          <View style={styles.seasonTabs}>
            <FlatList
              horizontal
              data={seasons}
              keyExtractor={(s) => String(s)}
              showsHorizontalScrollIndicator={false}
              renderItem={({item}) => <NavTab label={item === 0 ? 'Specials' : `Season ${item}`} active={item === activeSeason} onPress={() => setSeason(item)} />}
            />
          </View>
          <FlatList
            horizontal
            data={episodes}
            keyExtractor={(v) => v.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.episodeList}
            initialNumToRender={6}
            renderItem={({item}) => {
              const r = state.resume[item.id];
              return <EpisodeCard video={item} progress={r && r.duration ? r.position / r.duration : undefined} onPress={() => play(meta, item)} />;
            }}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background},
  fill: {width: '100%', height: '100%'},
  backdrop: {position: 'absolute', top: 0, right: 0, width: 1600, height: '100%'},
  message: {color: brand.text, fontSize: type.title, margin: edge},
  info: {position: 'absolute', left: edge, top: 150, width: 900},
  infoSeries: {top: 60},
  logo: {width: 620, height: 190, marginBottom: 22},
  name: {color: brand.text, fontSize: type.hero, fontWeight: '900', marginBottom: 16},
  facts: {color: brand.textSoft, fontSize: type.body, fontWeight: '700', marginBottom: 8},
  genres: {color: brand.textMuted, fontSize: type.small, marginBottom: 14},
  synopsis: {color: brand.textSoft, fontSize: type.body, lineHeight: 34, marginBottom: 26},
  actions: {flexDirection: 'row'},
  seriesBox: {position: 'absolute', left: 0, right: 0, bottom: 30, height: 430},
  seasonTabs: {marginLeft: edge - 18, marginBottom: 8, height: 60},
  episodeList: {paddingHorizontal: edge, paddingVertical: 10},
  episode: {width: 400, marginRight: 22, borderRadius: 8, borderWidth: 4, borderColor: 'transparent', padding: 4},
  episodeFocused: {borderColor: brand.focus, backgroundColor: 'rgba(255,255,255,0.08)'},
  episodeArt: {width: '100%', height: 216, borderRadius: 6, overflow: 'hidden', backgroundColor: brand.surfaceRaised},
  episodeTitle: {color: brand.text, fontSize: type.small, fontWeight: '800', marginTop: 10},
  episodeText: {color: brand.textMuted, fontSize: type.tiny, lineHeight: 24, marginTop: 4},
  progressTrack: {position: 'absolute', left: 10, right: 10, bottom: 8, height: 5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 3},
  progressFill: {height: 5, backgroundColor: brand.accent, borderRadius: 3},
});
