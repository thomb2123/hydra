import React, {useEffect, useState} from 'react';
import {FlatList, Image, StyleSheet, Text, View} from 'react-native';
import {FocusButton} from '../../../../shared/src/ui/FocusButton';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Episode, Item, SeriesResult} from '../flixnest/api';
import {FlixState} from '../state';

export const Series = ({state, item, onBack, playEpisode}: {state: FlixState; item: Item; onBack: () => void; playEpisode: (series: SeriesResult, season: number, episode: Episode) => void}) => {
  const [series, setSeries] = useState<SeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  useBackHandler(() => {
    onBack();
    return true;
  });
  useEffect(() => {
    if (!state.access) {
      return;
    }
    state.client
      .series(state.access, item.id)
      .then((result) => {
        setSeries(result);
        setSeason(result.seasons?.[0]?.number ?? null);
      })
      .catch((e) => setError(String(e?.message || e)));
  }, [state.access, state.client, item.id]);

  const episodes = series?.seasons?.find((s) => s.number === season)?.episodes || [];

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        {series?.image || item.image ? <Image source={{uri: series?.image || item.image}} style={styles.poster} resizeMode="cover" /> : null}
        <View style={styles.flex}>
          <Text style={styles.title}>{series?.name || item.name}</Text>
          <Text style={styles.muted}>{[series?.year || item.year, series?.genre].filter(Boolean).join(' · ')}</Text>
          <Text style={styles.text} numberOfLines={5}>
            {series?.description || ''}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!series && !error ? <Text style={styles.muted}>Loading…</Text> : null}
          <FocusButton compact label="Back" onPress={onBack} hasTVPreferredFocus={!!error} />
        </View>
      </View>
      <FlatList
        horizontal
        style={styles.seasons}
        data={series?.seasons || []}
        keyExtractor={(s) => String(s.number)}
        renderItem={({item: s}) => <FocusButton compact label={`Season ${s.number}`} selected={s.number === season} onPress={() => setSeason(s.number)} />}
      />
      <FlatList
        data={episodes}
        keyExtractor={(e) => String(e.id)}
        renderItem={({item: episode, index}) => {
          const resume = state.resume[String(episode.id)];
          return (
            <FocusButton
              label={`${episode.episode != null ? `E${episode.episode} · ` : ''}${episode.name || 'Episode'}`}
              subtitle={[resume && resume.position > 30 ? 'Resume available' : '', episode.description || ''].filter(Boolean).join(' · ')}
              hasTVPreferredFocus={index === 0}
              onPress={() => series && season != null && playEpisode(series, season, episode)}
            />
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  top: {flexDirection: 'row', marginBottom: spacing.s},
  poster: {width: 220, height: 330, borderRadius: 12, marginRight: spacing.l, backgroundColor: colors.surface},
  flex: {flex: 1},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  text: {color: colors.text, fontSize: fonts.small, marginVertical: spacing.xs},
  muted: {color: colors.textMuted, fontSize: fonts.small},
  error: {color: colors.danger, fontSize: fonts.body},
  seasons: {flexGrow: 0},
});
