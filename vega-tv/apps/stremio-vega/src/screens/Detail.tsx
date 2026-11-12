import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {fetchMeta} from '../stremio/addons';
import {MetaDetail, MetaPreview, Video} from '../stremio/types';
import {StremioState} from '../state';

export interface DetailProps {
  state: StremioState;
  type: string;
  id: string;
  preview?: MetaPreview;
  openStreams: (meta: MetaDetail, video: Video | null) => void;
  onBack: () => void;
}

function episodeLabel(video: Video): string {
  const number = video.season != null && video.episode != null ? `S${video.season}E${video.episode}` : '';
  return [number, video.title || video.name].filter(Boolean).join(' · ') || video.id;
}

export const Detail = ({state, type, id, preview, openStreams, onBack}: DetailProps) => {
  const [meta, setMeta] = useState<MetaDetail | null>(preview ? ({...preview} as MetaDetail) : null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  useBackHandler(() => {
    onBack();
    return true;
  });

  useEffect(() => {
    let alive = true;
    fetchMeta(state.addons, type, id)
      .then((detail) => {
        if (!alive) {
          return;
        }
        if (detail) {
          setMeta(detail);
        } else if (!preview) {
          setError('No add-on returned details for this title.');
        }
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [state.addons, type, id, preview]);

  const videos = useMemo(() => (meta?.videos || []).filter((v) => v && v.id), [meta]);
  const seasons = useMemo(() => {
    const set = new Set<number>();
    videos.forEach((v) => set.add(typeof v.season === 'number' ? v.season : 0));
    return Array.from(set).sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  }, [videos]);
  const activeSeason = season ?? (seasons.find((s) => s > 0) ?? seasons[0] ?? null);
  const episodes = useMemo(
    () =>
      videos
        .filter((v) => (typeof v.season === 'number' ? v.season : 0) === activeSeason)
        .sort((a, b) => (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0)),
    [videos, activeSeason],
  );

  const isSeries = videos.length > 0 && type !== 'movie';
  const libraryItem = state.library.find((item) => item._id === id);
  const movieVideoId = meta?.behaviorHints?.defaultVideoId || id;
  const localResume = state.resume[movieVideoId];

  if (!meta) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>{loading ? 'Loading…' : error}</Text>
        <FocusButton label="Back" hasTVPreferredFocus onPress={onBack} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        {meta.poster ? <Image source={{uri: meta.poster}} style={styles.poster} resizeMode="cover" /> : null}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {meta.name}
          </Text>
          <Text style={styles.meta}>
            {[meta.releaseInfo || meta.year, meta.runtime, meta.imdbRating ? `IMDb ${meta.imdbRating}` : '', (meta.genres || []).slice(0, 3).join(', ')]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <ScrollView style={styles.descriptionBox}>
            <Text style={styles.description}>{meta.description || ''}</Text>
          </ScrollView>
          <View style={styles.actions}>
            {!isSeries ? (
              <FocusButton
                label={localResume && localResume.position > 30 ? 'Choose stream (resume available)' : 'Choose stream'}
                hasTVPreferredFocus
                onPress={() => openStreams(meta, null)}
              />
            ) : null}
            {libraryItem ? <Text style={styles.meta}>In your Stremio library</Text> : null}
            <FocusButton label="Back" compact onPress={onBack} hasTVPreferredFocus={isSeries && episodes.length === 0} />
          </View>
        </View>
      </View>
      {isSeries ? (
        <View style={styles.seriesBox}>
          <FlatList
            horizontal
            data={seasons}
            keyExtractor={(s) => String(s)}
            renderItem={({item}) => (
              <FocusButton compact label={item === 0 ? 'Specials' : `Season ${item}`} selected={item === activeSeason} onPress={() => setSeason(item)} />
            )}
          />
          <FlatList
            data={episodes}
            keyExtractor={(v) => v.id}
            renderItem={({item, index}) => {
              const resumeAt = state.resume[item.id];
              return (
                <FocusButton
                  label={episodeLabel(item)}
                  subtitle={[item.released ? item.released.slice(0, 10) : '', resumeAt && resumeAt.position > 30 ? 'Resume available' : '', item.overview || item.description || '']
                    .filter(Boolean)
                    .join(' · ')}
                  hasTVPreferredFocus={index === 0}
                  onPress={() => openStreams(meta, item)}
                />
              );
            }}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  top: {flexDirection: 'row', height: 470},
  poster: {width: 300, height: 450, borderRadius: 14, marginRight: spacing.l, backgroundColor: colors.surface},
  info: {flex: 1},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  meta: {color: colors.textMuted, fontSize: fonts.small, marginTop: spacing.xs},
  descriptionBox: {maxHeight: 200, marginTop: spacing.s},
  description: {color: colors.text, fontSize: fonts.small, lineHeight: 30},
  actions: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.s},
  seriesBox: {flex: 1, marginTop: spacing.s},
});
