// Categories: a grid of genre tiles, and a page per genre with Films/Series.
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Animated, FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {NavTab, PosterCard} from '../ui/Cards';
import {brand, edge, type} from '../ui/brand';
import {fetchCatalog} from '../stremio/addons';
import {allGenres, genreSources} from '../stremio/rows';
import {MetaPreview} from '../stremio/types';
import {genreCover} from '../stremio/recommend';
import {backdropOf} from '../ui/art';
import {useFocusScale} from '../ui/motion';
import {Fade} from '../ui/Billboard';
import {StremioState} from '../state';

// One colour per genre (stripe and tint), so the grid reads at a glance.
const TILE_COLOURS = ['#7b5cff', '#e5484d', '#1fb3c4', '#f08c2e', '#2fbf71', '#b05cff', '#ff5c8a', '#3e7bfa', '#d9b44a', '#14a37f'];

/**
 * A genre tile: the backdrop of the genre's most popular title (loaded a few tiles at a
 * time), tinted in the genre's colour, darkened at the bottom so the name always reads.
 */
const GenreTile = ({label, index, state, onPress}: {label: string; index: number; state: StremioState; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const [cover, setCover] = useState<MetaPreview | null>(null);
  const scale = useFocusScale(focused, 1.06);
  const colour = TILE_COLOURS[index % TILE_COLOURS.length];
  useEffect(() => {
    let alive = true;
    genreCover(state.addons, label).then((m) => alive && setCover(m));
    return () => {
      alive = false;
    };
  }, [state.addons, label]);
  const art = cover ? backdropOf(cover, 'small') || cover.poster : undefined;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
      hasTVPreferredFocus={index === 0}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={styles.tileOuter}>
      <Animated.View style={[styles.tile, {backgroundColor: colour}, focused && styles.tileFocused, {transform: [{scale}]}]}>
        {art ? <Image source={{uri: art}} style={styles.tileArt} resizeMode="cover" fadeDuration={0} /> : null}
        {art ? <View style={[styles.tileTint, {backgroundColor: colour}, focused && styles.tileTintFocused]} /> : null}
        <Fade direction="bottom" size={130} steps={7} strength={1.6} />
        <View style={[styles.stripe, {backgroundColor: colour}]} />
        {focused && cover?.name ? (
          <Text style={styles.tileFrom} numberOfLines={1}>
            {cover.name}
          </Text>
        ) : null}
        <Text style={styles.tileText} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

export const Categories = ({state, onBack, openGenre}: {state: StremioState; onBack: () => void; openGenre: (genre: string) => void}) => {
  const genres = useMemo(() => allGenres(state.addons), [state.addons]);
  useBackHandler(() => {
    onBack();
    return true;
  });
  const renderTile = useCallback(
    ({item, index}: {item: string; index: number}) => <GenreTile label={item} index={index} state={state} onPress={() => openGenre(item)} />,
    [state, openGenre],
  );
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Categories</Text>
      <Text style={styles.subtitle}>{genres.length ? `${genres.length} genres across your add-ons` : ' '}</Text>
      {genres.length === 0 ? <Text style={styles.muted}>None of your add-ons offer genre browsing.</Text> : null}
      <FlatList
        data={genres}
        numColumns={5}
        keyExtractor={(g) => g}
        contentContainerStyle={styles.grid}
        initialNumToRender={15}
        windowSize={5}
        renderItem={renderTile}
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

  // The genre's cover title fills the top of the page behind its name.
  const [cover, setCover] = useState<MetaPreview | null>(null);
  useEffect(() => {
    let alive = true;
    genreCover(state.addons, genre).then((m) => alive && setCover(m));
    return () => {
      alive = false;
    };
  }, [state.addons, genre]);
  const coverArt = cover ? backdropOf(cover, 'medium') : undefined;

  return (
    <View style={styles.root}>
      {coverArt ? (
        <View style={styles.banner} pointerEvents="none">
          <Image source={{uri: coverArt}} style={styles.bannerArt} resizeMode="cover" fadeDuration={0} />
          <Fade direction="left" size={900} steps={10} strength={1.4} />
          <Fade direction="bottom" size={200} steps={8} strength={1.6} />
        </View>
      ) : null}
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
  header: {flexDirection: 'row', alignItems: 'center', height: 200, paddingTop: 40},
  banner: {position: 'absolute', top: 0, left: 0, right: 0, height: 360, overflow: 'hidden'},
  bannerArt: {position: 'absolute', top: 0, right: 0, width: 1300, height: 360, opacity: 0.85},
  title: {color: brand.text, fontSize: type.title + 8, fontWeight: '900', marginLeft: edge, marginRight: 30, marginBottom: 4},
  muted: {color: brand.textMuted, fontSize: type.body, marginLeft: edge},
  grid: {paddingHorizontal: edge - 12, paddingBottom: 120},
  subtitle: {color: brand.textMuted, fontSize: type.small, marginLeft: edge, marginBottom: 18},
  tileOuter: {width: 330, height: 186, margin: 12},
  tile: {flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 4, borderColor: 'transparent'},
  tileFocused: {borderColor: brand.focus},
  tileArt: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  tileTint: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.45},
  tileTintFocused: {opacity: 0.15},
  stripe: {position: 'absolute', left: 0, top: 0, bottom: 0, width: 8},
  tileText: {position: 'absolute', left: 24, right: 16, bottom: 14, color: brand.text, fontSize: type.heading, fontWeight: '900'},
  tileFrom: {position: 'absolute', left: 24, right: 16, top: 14, color: 'rgba(255,255,255,0.85)', fontSize: type.tiny, fontWeight: '700'},
});
