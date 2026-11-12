// Categories: a grid of genre tiles, and a page per genre with Films/Series.
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {NavTab, PosterCard} from '../ui/Cards';
import {brand, edge, type} from '../ui/brand';
import {fetchCatalog} from '../stremio/addons';
import {allGenres, genreSources} from '../stremio/rows';
import {MetaPreview} from '../stremio/types';
import {StremioState} from '../state';

// A few tile colours so the grid reads at a glance.
const TILE_COLOURS = ['#5b3fd6', '#b0306a', '#1f7a8c', '#c2571a', '#2f8f4e', '#7a3fa0', '#a83232', '#2d5fb5'];

const GenreTile = ({label, index, onPress}: {label: string; index: number; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
      hasTVPreferredFocus={index === 0}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tile, {backgroundColor: TILE_COLOURS[index % TILE_COLOURS.length]}, focused && styles.tileFocused]}>
      <Text style={styles.tileText} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

export const Categories = ({state, onBack, openGenre}: {state: StremioState; onBack: () => void; openGenre: (genre: string) => void}) => {
  const genres = useMemo(() => allGenres(state.addons), [state.addons]);
  useBackHandler(() => {
    onBack();
    return true;
  });
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Categories</Text>
      {genres.length === 0 ? <Text style={styles.muted}>None of your add-ons offer genre browsing.</Text> : null}
      <FlatList
        data={genres}
        numColumns={5}
        keyExtractor={(g) => g}
        contentContainerStyle={styles.grid}
        renderItem={({item, index}) => <GenreTile label={item} index={index} onPress={() => openGenre(item)} />}
      />
    </View>
  );
};

export const GenrePage = ({
  state,
  genre,
  onBack,
  openMeta,
}: {
  state: StremioState;
  genre: string;
  onBack: () => void;
  openMeta: (type: string, id: string, preview?: MetaPreview) => void;
}) => {
  const sources = useMemo(() => genreSources(state.addons).filter((s) => s.genres.some((g) => g.toLowerCase() === genre.toLowerCase())), [state.addons, genre]);
  const [typeIndex, setTypeIndex] = useState(0);
  const [items, setItems] = useState<MetaPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const source = sources[typeIndex];

  useBackHandler(() => {
    onBack();
    return true;
  });

  const load = useCallback(
    async (reset: boolean) => {
      if (!source) {
        return;
      }
      setLoading(true);
      const exact = source.genres.find((g) => g.toLowerCase() === genre.toLowerCase()) || genre;
      const skip = reset ? 0 : items.length;
      const extra: Record<string, string> = {genre: exact};
      if (skip) {
        extra.skip = String(skip);
      }
      const page = await fetchCatalog(source.source, extra).catch(() => [] as MetaPreview[]);
      setItems((previous) => {
        const base = reset ? [] : previous;
        const seen = new Set(base.map((m) => m.id));
        return [...base, ...page.filter((m) => !seen.has(m.id))];
      });
      setDone(page.length === 0);
      setLoading(false);
    },
    [source, genre, items.length],
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, genre]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{genre}</Text>
        {sources.map((s, i) => (
          <NavTab key={s.type} label={s.type === 'movie' ? 'Films' : 'Series'} active={i === typeIndex} onPress={() => setTypeIndex(i)} />
        ))}
      </View>
      {!loading && items.length === 0 ? <Text style={styles.muted}>Nothing found.</Text> : null}
      <FlatList
        data={items}
        numColumns={7}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.grid}
        onEndReachedThreshold={0.6}
        onEndReached={() => !loading && !done && load(false)}
        renderItem={({item, index}) => (
          <PosterCard meta={item} hasTVPreferredFocus={index === 0} onPress={() => openMeta(item.type || source?.type || 'movie', item.id, item)} />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background, paddingTop: 40},
  header: {flexDirection: 'row', alignItems: 'center'},
  title: {color: brand.text, fontSize: type.title, fontWeight: '900', marginLeft: edge, marginRight: 30, marginBottom: 10},
  muted: {color: brand.textMuted, fontSize: type.body, marginLeft: edge},
  grid: {paddingHorizontal: edge - 12, paddingBottom: 120},
  tile: {width: 330, height: 170, margin: 12, borderRadius: 10, justifyContent: 'flex-end', padding: 20, borderWidth: 4, borderColor: 'transparent'},
  tileFocused: {borderColor: brand.focus, transform: [{scale: 1.06}]},
  tileText: {color: brand.text, fontSize: type.heading, fontWeight: '900'},
});
