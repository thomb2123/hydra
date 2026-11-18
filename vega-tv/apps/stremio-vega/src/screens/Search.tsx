// Streaming-service style search: an on-screen keyboard on the left and live
// results on the right (merged across every add-on that supports search), with
// matching categories and popular titles before anything is typed.
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {Pill, PosterCard} from '../ui/Cards';
import {useRowItems} from '../ui/ContentRow';
import {brand, edge, type} from '../ui/brand';
import {fetchCatalog, searchCatalogs} from '../stremio/addons';
import {allGenres, rowsForTab} from '../stremio/rows';
import {MetaPreview} from '../stremio/types';
import {StremioState} from '../state';
import {MergedChannel} from '../tv/channels';
import {SportEvent} from '../tv/events';
import {matchChannels, matchEvents} from '../tv/searchMatch';

export interface SearchProps {
  state: StremioState;
  openMeta: (type: string, id: string, preview?: MetaPreview) => void;
  openGenre: (genre: string) => void;
  onBack: () => void;
  /** Live TV channels and live sport, so "sky sports" or a team name finds them too. */
  channels?: MergedChannel[];
  events?: SportEvent[];
  playChannel?: (channel: MergedChannel, list: MergedChannel[]) => void;
  playEvent?: (event: SportEvent) => void;
}

const KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

const Key = ({label, onPress, wide, preferred}: {label: string; onPress: () => void; wide?: boolean; preferred?: boolean}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.key, wide && styles.keyWide, focused && styles.keyFocused]}>
      <Text style={[styles.keyText, focused && styles.keyTextFocused]}>{label}</Text>
    </TouchableOpacity>
  );
};

const resultCache = new Map<string, MetaPreview[]>();

export const Search = ({state, openMeta, openGenre, onBack, channels = [], events = [], playChannel, playEvent}: SearchProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MetaPreview[] | null>(null);
  const [searching, setSearching] = useState(false);
  const catalogs = useMemo(() => searchCatalogs(state.addons).slice(0, 8), [state.addons]);
  const genres = useMemo(() => allGenres(state.addons), [state.addons]);
  const popularRow = useMemo(() => rowsForTab('home', state.addons)[0], [state.addons]);
  const popular = useRowItems(popularRow || ({key: 'none', title: '', kind: 'other', type: 'movie', source: null, items: []} as any));
  const runId = useRef(0);

  useBackHandler(() => {
    onBack();
    return true;
  });

  const text = query.trim();
  const channelMatches = useMemo(() => (playChannel ? matchChannels(channels, text) : []), [channels, text, playChannel]);
  const eventMatches = useMemo(() => (playEvent ? matchEvents(events.filter((e) => e.live), text) : []), [events, text, playEvent]);
  const genreMatches = text.length >= 2 ? genres.filter((g) => g.toLowerCase().startsWith(text.toLowerCase()) || g.toLowerCase().includes(` ${text.toLowerCase()}`)).slice(0, 4) : [];

  // Live search, debounced while typing; results cached per query.
  useEffect(() => {
    if (text.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const key = text.toLowerCase();
    if (resultCache.has(key)) {
      setResults(resultCache.get(key) || []);
      return;
    }
    const id = ++runId.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await Promise.all(catalogs.map(async (row) => ({type: row.catalog.type, metas: await fetchCatalog(row, {search: text}).catch(() => [] as MetaPreview[])})));
      if (id !== runId.current) {
        return;
      }
      const seen = new Set<string>();
      const merged: MetaPreview[] = [];
      // Interleave add-ons' results so the best match of each comes first.
      const lists = found.map((f) => f.metas.filter((m) => m.type === 'movie' || m.type === 'series' || !m.type).map((m) => ({...m, type: m.type || f.type})));
      for (let i = 0; i < 40; i++) {
        for (const list of lists) {
          const m = list[i];
          // The same title from two add-ons (different ids) is shown once.
          const same = m ? `${m.type}|${String(m.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}|${String((m as any).releaseInfo || (m as any).year || '').slice(0, 4)}` : '';
          if (m && !seen.has(m.id) && !seen.has(same)) {
            seen.add(m.id);
            seen.add(same);
            merged.push(m);
          }
        }
      }
      resultCache.set(key, merged);
      setResults(merged);
      setSearching(false);
    }, 450);
    return () => clearTimeout(timer);
  }, [text, catalogs]);

  const type_ = useCallback((ch: string) => setQuery((q) => (q + ch).slice(0, 40)), []);
  const items = results ?? (popular || []);
  const heading = results ? (results.length ? `Results for "${text}"` : searching ? 'Searching…' : `No results for "${text}"`) : 'Popular right now';

  return (
    <View style={styles.root}>
      <View style={styles.left}>
        <View style={styles.queryBox}>
          <Text style={[styles.query, !query && styles.placeholder]} numberOfLines={1}>
            {query || 'Search titles, genres, channels, teams'}
          </Text>
          <View style={styles.caret} />
        </View>
        <View style={styles.keyboard}>
          {KEYS.map((k, i) => (
            <Key key={k} label={k.toUpperCase()} preferred={i === 0} onPress={() => type_(k)} />
          ))}
          <Key label="Space" wide onPress={() => type_(' ')} />
          <Key label="Delete" wide onPress={() => setQuery((q) => q.slice(0, -1))} />
          <Key label="Clear" wide onPress={() => setQuery('')} />
        </View>
        {catalogs.length === 0 ? <Text style={styles.muted}>None of your add-ons support search.</Text> : null}
      </View>

      <View style={styles.right}>
        {genreMatches.length ? (
          <View style={styles.genres}>
            {genreMatches.map((g) => (
              <Pill key={g} label={g} onPress={() => openGenre(g)} />
            ))}
          </View>
        ) : null}
        {eventMatches.length || channelMatches.length ? (
          <View style={styles.live}>
            {eventMatches.map((e) => (
              <Pill key={e.key} label={`● LIVE  ${e.title}${e.channelName ? `  ·  ${e.channelName}` : ''}`} onPress={() => playEvent?.(e)} style={styles.livePill} />
            ))}
            {channelMatches.map((c) => (
              <Pill
                key={c.id}
                label={`${c.number}  ${c.name}`}
                onPress={() => playChannel?.(c, channels.filter((x) => x.category === c.category))}
                style={styles.livePill}
              />
            ))}
          </View>
        ) : null}
        <Text style={styles.heading}>{heading}</Text>
        <FlatList
          data={items}
          numColumns={5}
          keyExtractor={(m) => m.id}
          initialNumToRender={10}
          windowSize={3}
          removeClippedSubviews
          contentContainerStyle={styles.grid}
          renderItem={({item}) => <PosterCard meta={item} onPress={() => openMeta(item.type || 'movie', item.id, item)} />}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, flexDirection: 'row', backgroundColor: brand.background, paddingTop: 50},
  left: {width: 640, paddingLeft: edge, paddingRight: 30},
  queryBox: {flexDirection: 'row', alignItems: 'center', height: 70, borderBottomWidth: 3, borderBottomColor: brand.accent, marginBottom: 26},
  query: {color: brand.text, fontSize: 38, fontWeight: '700', flexShrink: 1},
  placeholder: {color: brand.textMuted, fontSize: 28, fontWeight: '500'},
  caret: {width: 3, height: 40, backgroundColor: brand.text, marginLeft: 4},
  keyboard: {flexDirection: 'row', flexWrap: 'wrap', width: 540},
  key: {width: 80, height: 68, margin: 5, borderRadius: 6, backgroundColor: brand.surface, justifyContent: 'center', alignItems: 'center'},
  keyWide: {width: 170},
  keyFocused: {backgroundColor: brand.text, transform: [{scale: 1.08}]},
  keyText: {color: brand.text, fontSize: type.body, fontWeight: '700'},
  keyTextFocused: {color: '#000'},
  right: {flex: 1, paddingRight: 40},
  genres: {flexDirection: 'row', marginBottom: 16},
  live: {flexDirection: 'row', flexWrap: 'wrap', marginBottom: 10},
  livePill: {marginBottom: 10, paddingHorizontal: 22, paddingVertical: 10},
  heading: {color: brand.text, fontSize: type.heading, fontWeight: '800', marginLeft: 12, marginBottom: 6},
  grid: {paddingBottom: 120},
  muted: {color: brand.textMuted, fontSize: type.small, marginTop: 20},
});
