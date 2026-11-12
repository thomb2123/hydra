import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {FocusButton, PosterTile} from '../../../../shared/src/ui/FocusButton';
import {TextField} from '../../../../shared/src/ui/TextField';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {exitApp, useBackHandler} from '../../../../shared/src/tv/remote';
import {CatalogKind, Item} from '../flixnest/api';
import {FlixState} from '../state';

export type Tab = 'live' | 'events' | 'movies' | 'series' | 'settings';

export interface BrowseProps {
  state: FlixState;
  tab: Tab;
  setTab: (tab: Tab) => void;
  playLive: (item: Item, list: Item[]) => void;
  playMovie: (item: Item) => void;
  openSeries: (item: Item) => void;
}

export const Browse = ({state, tab, setTab, playLive, playMovie, openSeries}: BrowseProps) => {
  useBackHandler(() => {
    exitApp();
    return true;
  });
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>FlixNest</Text>
        <FocusButton compact label="Live TV" selected={tab === 'live'} onPress={() => setTab('live')} hasTVPreferredFocus={tab === 'live'} />
        <FocusButton compact label="Events" selected={tab === 'events'} onPress={() => setTab('events')} />
        <FocusButton compact label="Movies" selected={tab === 'movies'} onPress={() => setTab('movies')} />
        <FocusButton compact label="Series" selected={tab === 'series'} onPress={() => setTab('series')} />
        <FocusButton compact label="Settings" selected={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>
      {tab === 'live' ? <Catalog key="live" state={state} kind="live" onSelect={(item, list) => playLive(item, list)} /> : null}
      {tab === 'movies' ? <Catalog key="movies" state={state} kind="movies" onSelect={(item) => playMovie(item)} /> : null}
      {tab === 'series' ? <Catalog key="series" state={state} kind="series" onSelect={(item) => openSeries(item)} /> : null}
      {tab === 'events' ? <Events state={state} playLive={playLive} /> : null}
      {tab === 'settings' ? <SettingsPanel state={state} /> : null}
    </View>
  );
};

const Catalog = ({state, kind, onSelect}: {state: FlixState; kind: CatalogKind; onSelect: (item: Item, list: Item[]) => void}) => {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>('');
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (append: boolean, offsetOverride?: number) => {
      if (!state.access) {
        return;
      }
      const current = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const result = await state.client.catalog(state.access, kind, {
          query: query.trim(),
          category: category ? [category] : [],
          offset: append ? offsetOverride : 0,
          limit: 100,
        });
        if (current !== generation.current) {
          return;
        }
        const incoming = (result.items || []).filter((i) => i && i.id != null).map((i) => ({...i, id: String(i.id), name: String(i.name || 'Untitled')}));
        setItems((previous) => (append ? previous.concat(incoming) : incoming));
        if (Array.isArray(result.categories) && result.categories.length) {
          setCategories(result.categories.map(String));
        }
        setHasMore(!!result.has_more);
      } catch (e: any) {
        if (current === generation.current) {
          setError(String(e?.message || e));
        }
      } finally {
        if (current === generation.current) {
          setLoading(false);
        }
      }
    },
    [state.access, state.client, kind, query, category],
  );

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, state.access]);

  const resumeIds = useMemo(() => new Set(Object.keys(state.resume)), [state.resume]);

  return (
    <View style={styles.flex}>
      <View style={styles.toolbar}>
        <TextField label="Search" value={query} onChangeText={setQuery} onSubmit={() => load(false)} />
        <FocusButton compact label="Search" onPress={() => load(false)} />
        {category ? <FocusButton compact label={`Category: ${category} ✕`} onPress={() => setCategory('')} /> : null}
      </View>
      <View style={styles.split}>
        {categories.length ? (
          <FlatList
            style={styles.categories}
            data={['', ...categories]}
            keyExtractor={(c) => c || 'all'}
            renderItem={({item}) => <FocusButton compact label={item || 'All categories'} selected={item === category} onPress={() => setCategory(item)} />}
          />
        ) : null}
        <View style={styles.flex}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && !items.length ? <Text style={styles.muted}>Loading…</Text> : null}
          {!loading && !items.length && !error ? <Text style={styles.muted}>Nothing found.</Text> : null}
          {kind === 'live' ? (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              onEndReachedThreshold={0.5}
              onEndReached={() => hasMore && !loading && load(true, items.length)}
              renderItem={({item, index}) => <ChannelRow item={item} preferred={index === 0} onPress={() => onSelect(item, items)} />}
            />
          ) : (
            <FlatList
              key={`grid-${kind}`}
              data={items}
              numColumns={6}
              keyExtractor={(item) => item.id}
              onEndReachedThreshold={0.5}
              onEndReached={() => hasMore && !loading && load(true, items.length)}
              renderItem={({item}) => (
                <PosterTile
                  width={200}
                  height={300}
                  title={item.name}
                  caption={[item.year, resumeIds.has(item.id) ? 'Resume' : ''].filter(Boolean).join(' · ')}
                  image={item.image}
                  onPress={() => onSelect(item, items)}
                />
              )}
            />
          )}
        </View>
      </View>
    </View>
  );
};

const ChannelRow = ({item, preferred, onPress}: {item: Item; preferred: boolean; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.channel, focused && styles.channelFocused]}>
      {item.image ? <Image source={{uri: item.image}} style={styles.logo} resizeMode="contain" /> : <View style={styles.logo} />}
      <Text numberOfLines={1} style={[styles.channelName, focused && styles.channelNameFocused]}>
        {item.name}
      </Text>
      <Text numberOfLines={1} style={[styles.channelMeta, focused && styles.channelNameFocused]}>
        {[item.category, item.country].filter(Boolean).join(' · ')}
      </Text>
    </TouchableOpacity>
  );
};

const Events = ({state, playLive}: {state: FlixState; playLive: (item: Item, list: Item[]) => void}) => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  useEffect(() => {
    if (!state.access) {
      return;
    }
    state.client
      .events(state.access)
      .then((result) => setItems(result.items || []))
      .catch((e) => setError(String(e?.message || e)));
  }, [state.access, state.client]);
  if (open) {
    const broadcasts = open.broadcasts || [];
    return (
      <View style={styles.flex}>
        <Text style={styles.heading}>{open.name}</Text>
        <Text style={styles.muted}>Choose a broadcast</Text>
        {broadcasts.map((b, index) => (
          <FocusButton key={b.id} label={b.name || b.id} hasTVPreferredFocus={index === 0} onPress={() => playLive({id: String(b.id), name: `${open.name} · ${b.name}`}, [])} />
        ))}
        <FocusButton compact label="Back to events" onPress={() => setOpen(null)} />
      </View>
    );
  }
  return (
    <View style={styles.flex}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!items && !error ? <Text style={styles.muted}>Loading events…</Text> : null}
      <FlatList
        data={items || []}
        keyExtractor={(item) => item.id}
        renderItem={({item}) => (
          <FocusButton
            label={`${item.status === 'live' ? '● LIVE  ' : ''}${item.name}`}
            subtitle={[item.sport, item.category, formatTime(item.start), `${(item.broadcasts || []).length} broadcast(s)`].filter(Boolean).join(' · ')}
            disabled={!(item.broadcasts || []).length}
            onPress={() => ((item.broadcasts || []).length === 1 ? playLive({id: String(item.broadcasts![0].id), name: item.name}, []) : setOpen(item))}
          />
        )}
      />
    </View>
  );
};

function formatTime(value: string | number | undefined): string {
  if (value == null || value === '') {
    return '';
  }
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

const SettingsPanel = ({state}: {state: FlixState}) => {
  const providers = state.info?.providers || [];
  const current = state.access && state.access.type === 'account' ? state.access.provider || state.info?.provider : undefined;
  return (
    <View style={styles.flex}>
      <Text style={styles.heading}>Account</Text>
      <Text style={styles.text}>
        {state.access?.type === 'account' ? 'Signed in with your Flix-Streams account.' : state.access?.type === 'xtream' ? 'Using Xtream server access.' : 'Using a playlist URL.'}
      </Text>
      {providers.length > 1 ? (
        <View>
          <Text style={styles.heading}>Live TV provider</Text>
          <View style={styles.wrapRow}>
            {providers.map((p) => (
              <FocusButton key={p.id} compact label={p.name || p.id} selected={p.id === current} onPress={() => state.switchProvider(p.id)} />
            ))}
          </View>
        </View>
      ) : null}
      <FocusButton label="Sign out on this TV" onPress={() => state.signOut()} />
      <Text style={styles.muted}>Unofficial native Vega client for the FlixNest web-player service.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  header: {flexDirection: 'row', alignItems: 'center', marginBottom: spacing.s},
  brand: {color: colors.text, fontSize: fonts.title, fontWeight: '800', marginRight: spacing.l},
  flex: {flex: 1},
  toolbar: {flexDirection: 'row', alignItems: 'flex-end'},
  split: {flex: 1, flexDirection: 'row', marginTop: spacing.s},
  categories: {width: 380, flexGrow: 0, marginRight: spacing.m},
  heading: {color: colors.text, fontSize: fonts.heading, fontWeight: '700', marginVertical: spacing.s},
  text: {color: colors.text, fontSize: fonts.body, marginVertical: spacing.xs},
  muted: {color: colors.textMuted, fontSize: fonts.small, marginVertical: spacing.xs},
  error: {color: colors.danger, fontSize: fonts.body},
  wrapRow: {flexDirection: 'row', flexWrap: 'wrap'},
  channel: {flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 4, borderColor: 'transparent', padding: 8, marginVertical: 4},
  channelFocused: {backgroundColor: colors.focus, borderColor: colors.focus},
  logo: {width: 96, height: 54, marginRight: spacing.m, backgroundColor: colors.surfaceRaised, borderRadius: 6},
  channelName: {color: colors.text, fontSize: fonts.body, fontWeight: '600', flex: 1},
  channelMeta: {color: colors.textMuted, fontSize: fonts.small, width: 420, textAlign: 'right'},
  channelNameFocused: {color: colors.focusText},
});
