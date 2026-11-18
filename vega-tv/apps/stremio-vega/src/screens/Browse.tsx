// Main browse experience: top navigation, a billboard that follows focus, and
// tidy rows built from the user's Stremio add-on catalogs.
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {BILLBOARD_H, LiveBillboard} from '../ui/Billboard';
import {createFeaturedStore} from '../ui/featured';
import {LandscapeCard, NavTab, PosterCard} from '../ui/Cards';
import {ContentRow} from '../ui/ContentRow';
import {LiveSportRow} from '../ui/LiveSportRow';
import {brand, edge, type} from '../ui/brand';
import {RowSpec, Tab, rowsForTab} from '../stremio/rows';
import {recommendationRows} from '../stremio/recommend';
import {fetchMeta} from '../stremio/addons';
import {LibraryItem, MetaPreview} from '../stremio/types';
import {StremioState, continueWatching} from '../state';
import {TvGuide} from './TvGuide';
import {TvState} from '../tv/useTv';
import {MergedChannel} from '../tv/channels';
import {SportEvent} from '../tv/events';

export type BrowseTab = Tab | 'mylist' | 'tv';

export interface BrowseProps {
  state: StremioState;
  tab: BrowseTab;
  setTab: (tab: BrowseTab) => void;
  openMeta: (type: string, id: string, preview?: MetaPreview) => void;
  openSearch: () => void;
  openCategories: () => void;
  openSettings: () => void;
  tv: TvState;
  playChannel: (channel: MergedChannel, list: MergedChannel[]) => void;
  playEvent: (event: SportEvent) => void;
  /** False while a title page (or another screen) covers this one. */
  active?: boolean;
}

const TABS: {key: BrowseTab; label: string}[] = [
  {key: 'home', label: 'Home'},
  {key: 'tv', label: 'Live TV'},
  {key: 'series', label: 'Series'},
  {key: 'films', label: 'Films'},
  {key: 'new', label: 'New & Popular'},
  {key: 'mylist', label: 'My List'},
];

// Continue Watching and My List entries carry only a name and poster; the billboard
// fills in artwork, year, rating and synopsis from the title's details (once each).
const fullPreview = new Map<string, MetaPreview | null>();

function libraryPreview(item: LibraryItem): MetaPreview {
  return {id: item._id, type: item.type, name: item.name, poster: item.poster || undefined};
}

export const Browse = ({state, tab, setTab, openMeta, openSearch, openCategories, openSettings, tv, playChannel, playEvent, active = true}: BrowseProps) => {
  const baseRows = useMemo<RowSpec[]>(() => (tab === 'mylist' || tab === 'tv' ? [] : rowsForTab(tab, state.addons)), [tab, state.addons]);
  const [personalRows, setPersonalRows] = useState<RowSpec[] | null>(null);
  const wantsPersonal = !!state.session && tab !== 'mylist' && tab !== 'new' && tab !== 'tv' && state.library.length > 0;
  // Personal recommendations from watched titles and My List; computed once per tab
  // and library change. Their slots are reserved up front so rows never jump around.
  const libraryKey = state.library.map((i) => `${i._id}:${i._mtime}`).slice(0, 30).join('|');
  useEffect(() => {
    if (!wantsPersonal) {
      setPersonalRows([]);
      return;
    }
    let alive = true;
    recommendationRows(state.addons, state.library, tab === 'films' ? 'movie' : tab === 'series' ? 'series' : null)
      .then((r) => alive && setPersonalRows(r))
      .catch(() => alive && setPersonalRows([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, state.addons, libraryKey, wantsPersonal]);
  const rows = useMemo<RowSpec[]>(() => {
    if (!wantsPersonal || !baseRows.length) {
      return baseRows;
    }
    const slot = (key: string, title: string): RowSpec => ({...baseRows[0], key, title, kind: 'personal', top10: false, pending: true, items: undefined});
    const computed = personalRows || [];
    const recommended = personalRows ? computed.find((r) => r.key.startsWith('recommended')) : slot('recommended', 'Recommended for You');
    const because = personalRows ? computed.find((r) => r.key.startsWith('because')) : slot('because', 'Because you watched');
    const out = [...baseRows];
    const afterTop = out[0].top10 ? 1 : 0;
    if (because) {
      out.splice(Math.min(out.length, afterTop + 3), 0, {...because, key: 'because'});
    }
    if (recommended) {
      out.splice(afterTop, 0, {...recommended, key: 'recommended'});
    }
    return out;
  }, [baseRows, personalRows, wantsPersonal]);
  const resume = useMemo(
    () =>
      continueWatching(state.library).filter(
        (item) => (item.type === 'movie' || item.type === 'series') && (tab === 'home' || (tab === 'series' ? item.type === 'series' : tab === 'films' ? item.type === 'movie' : false)),
      ),
    [state.library, tab],
  );
  const featured = useRef(createFeaturedStore()).current;
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => featured.set(null), [tab, featured]);
  useEffect(
    () => () => {
      if (focusTimer.current) {
        clearTimeout(focusTimer.current);
      }
    },
    [],
  );

  // Debounced so the billboard does not reload art for every card skimmed past;
  // only the billboard re-renders (rows are untouched).
  // The card last focused: back from a title page, focus returns to it (the platform
  // does not restore focus inside a screen that was hidden).
  const lastFocus = useRef<{row: string; id: string} | null>(null);
  const addonsRef = useRef(state.addons);
  addonsRef.current = state.addons;
  const [restore, setRestore] = useState<{row: string; id: string} | null>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && lastFocus.current) {
      setRestore(lastFocus.current);
    }
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    if (!restore) {
      return undefined;
    }
    const timer = setTimeout(() => setRestore(null), 800);
    return () => clearTimeout(timer);
  }, [restore]);
  const onFocusItem = useCallback(
    (meta: MetaPreview, row: string) => {
      lastFocus.current = {row, id: meta.id};
      if (focusTimer.current) {
        clearTimeout(focusTimer.current);
      }
      focusTimer.current = setTimeout(() => {
        const known = fullPreview.get(meta.id);
        featured.set(known || meta);
        if (meta.description || known !== undefined) {
          return;
        }
        fetchMeta(addonsRef.current, meta.type || 'movie', meta.id)
          .then((full) => {
            const merged = full ? {...meta, ...full, id: meta.id, type: meta.type || full.type} : null;
            fullPreview.set(meta.id, merged);
            // Still the title in focus: show the details.
            if (merged && lastFocus.current?.id === meta.id) {
              featured.set(merged);
            }
          })
          .catch(() => fullPreview.set(meta.id, null));
      }, 350);
    },
    [featured],
  );
  const onLoaded = useCallback(
    (_row: RowSpec, items: MetaPreview[]) => {
      if (!featured.get() && items[0]) {
        featured.set(items[0]);
      }
    },
    [featured],
  );
  const open = useCallback((meta: MetaPreview, type: string) => openMeta(type, meta.id, meta), [openMeta]);
  const onFocusEvent = useCallback((e: SportEvent) => {
    lastFocus.current = {row: 'live', id: e.key};
  }, []);
  const hasResume = resume.length > 0;
  const renderRow = useCallback(
    ({item, index}: {item: RowSpec; index: number}) => (
      <ContentRow
        row={item}
        openMeta={open}
        onFocusItem={onFocusItem}
        onLoaded={index < 2 ? onLoaded : undefined}
        preferFirst={index === 0 && !hasResume && !lastFocus.current}
        focusId={restore && restore.row === item.key ? restore.id : undefined}
      />
    ),
    [open, onFocusItem, onLoaded, hasResume, restore],
  );

  const nav = (
    <View style={styles.nav}>
      <Text style={styles.mark}>S</Text>
      <NavTab label="Search" onPress={openSearch} />
      {TABS.map((t) => (
        <NavTab key={t.key} label={t.label} active={tab === t.key} onPress={() => setTab(t.key)} />
      ))}
      <NavTab label="Categories" onPress={openCategories} />
      <View style={styles.navSpacer} />
      <NavTab label={state.session ? 'Account' : 'Sign in'} onPress={openSettings} />
    </View>
  );

  if (tab === 'tv') {
    return <TvGuide tv={tv} nav={nav} playChannel={playChannel} playEvent={playEvent} />;
  }

  if (tab === 'mylist') {
    const items = state.library.filter((item) => !item.removed && !item.temp).map(libraryPreview);
    return (
      <View style={styles.root}>
        {nav}
        <Text style={styles.pageTitle}>My List</Text>
        {items.length === 0 ? (
          <Text style={styles.empty}>{state.session ? 'Titles you add to your Stremio library appear here.' : 'Sign in to Stremio to see your library here.'}</Text>
        ) : null}
        <FlatList
          data={items}
          numColumns={7}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.grid}
          renderItem={({item, index}) => <PosterCard meta={item} hasTVPreferredFocus={index === 0} onPress={() => open(item, item.type)} />}
        />
      </View>
    );
  }

  const sportRow =
    tab === 'home' ? (
      <LiveSportRow events={tv.events} onPlay={playEvent} focusKey={restore && restore.row === 'live' ? restore.id : undefined} onFocusEvent={onFocusEvent} />
    ) : null;
  const resumeRow =
    resume.length > 0 ? (
      <View style={styles.resumeRow}>
        <Text style={styles.rowTitle}>Continue Watching</Text>
        <FlatList
          horizontal
          data={resume}
          keyExtractor={(item) => item._id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rowList}
          renderItem={({item, index}) => (
            <LandscapeCard
              meta={libraryPreview(item)}
              hasTVPreferredFocus={restore ? restore.row === 'resume' && restore.id === item._id : index === 0 && !lastFocus.current}
              progress={item.state.duration ? (item.state.timeOffset || 0) / item.state.duration : undefined}
              onFocus={() => onFocusItem(libraryPreview(item), 'resume')}
              onPress={() => open(libraryPreview(item), item.type)}
            />
          )}
        />
      </View>
    ) : null;
  const header =
    resumeRow || sportRow ? (
      <>
        {resumeRow}
        {sportRow}
      </>
    ) : null;

  return (
    <View style={styles.root}>
      <LiveBillboard store={featured} />
      <View style={styles.navOverlay}>{nav}</View>
      <View style={styles.rows}>
        {state.addonError ? <Text style={styles.empty}>Couldn't load your add-ons: {state.addonError}</Text> : null}
        <FlatList
          data={rows}
          keyExtractor={rowKey}
          ListHeaderComponent={header}
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.rowsContent}
          renderItem={renderRow}
          ListEmptyComponent={<Text style={styles.empty}>{state.ready ? 'No catalogs found in your add-ons.' : 'Loading…'}</Text>}
        />
      </View>
    </View>
  );
};

const rowKey = (row: RowSpec) => row.key;

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background},
  navOverlay: {position: 'absolute', top: 0, left: 0, right: 0},
  nav: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: edge - 18, paddingTop: 30, paddingBottom: 10},
  mark: {color: brand.accent, fontSize: 52, fontWeight: '900', marginRight: 26, marginLeft: 18},
  navSpacer: {flex: 1},
  rows: {position: 'absolute', top: BILLBOARD_H - 90, left: 0, right: 0, bottom: 0},
  rowsContent: {paddingBottom: 300},
  resumeRow: {height: 308},
  rowTitle: {color: brand.text, fontSize: type.heading - 2, fontWeight: '800', marginLeft: edge, marginBottom: 14},
  rowList: {paddingLeft: edge, paddingRight: edge, paddingVertical: 10},
  pageTitle: {color: brand.text, fontSize: type.title, fontWeight: '900', marginLeft: edge, marginTop: 20},
  grid: {paddingHorizontal: edge - 12, paddingBottom: 120},
  empty: {color: brand.textMuted, fontSize: type.body, marginLeft: edge, marginTop: 20},
});
