import React, {useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {FocusButton, PosterTile} from '../../../../shared/src/ui/FocusButton';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {BoardCatalog, boardCatalogs, fetchCatalog} from '../stremio/addons';
import {MetaPreview} from '../stremio/types';
import {StremioState, continueWatching} from '../state';

export interface HomeProps {
  state: StremioState;
  openMeta: (type: string, id: string, preview?: MetaPreview) => void;
  openSearch: () => void;
  openSettings: () => void;
}

const MAX_ROWS = 14;

export const Home = ({state, openMeta, openSearch, openSettings}: HomeProps) => {
  const rows = useMemo(() => boardCatalogs(state.addons).slice(0, MAX_ROWS), [state.addons]);
  const resumeRow = useMemo(() => continueWatching(state.library), [state.library]);

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.brand}>Stremio</Text>
        <Text style={styles.account} numberOfLines={1}>
          {state.session ? `Signed in: ${state.session.email}` : 'Not signed in · default add-ons'}
          {state.server ? ' · Server: ' + state.server.replace(/^https?:\/\//, '') : ' · No streaming server'}
        </Text>
      </View>
      <View style={styles.actions}>
        <FocusButton label="Search" compact hasTVPreferredFocus onPress={openSearch} />
        <FocusButton label="Settings & sign-in" compact onPress={openSettings} />
        <FocusButton label="Reload add-ons" compact onPress={() => state.refresh()} />
      </View>
      {state.addonError ? <Text style={styles.error}>Add-ons could not load: {state.addonError}</Text> : null}
      {resumeRow.length ? (
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Continue watching</Text>
          <FlatList
            horizontal
            data={resumeRow}
            keyExtractor={(item) => item._id}
            renderItem={({item}) => {
              const pct = item.state.duration ? Math.round(((item.state.timeOffset || 0) / item.state.duration) * 100) : 0;
              return (
                <PosterTile
                  title={item.name}
                  caption={pct ? `${pct}% watched` : 'In progress'}
                  image={item.poster || undefined}
                  onPress={() => openMeta(item.type, item._id)}
                />
              );
            }}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(row) => `${row.addon.transportUrl}|${row.catalog.type}|${row.catalog.id}`}
      ListHeaderComponent={header}
      renderItem={({item}) => <CatalogRow row={item} openMeta={openMeta} />}
      ListEmptyComponent={<Text style={styles.muted}>{state.ready ? 'No catalogs from your add-ons.' : 'Loading add-ons…'}</Text>}
    />
  );
};

const CatalogRow = ({row, openMeta}: {row: BoardCatalog; openMeta: HomeProps['openMeta']}) => {
  const [items, setItems] = useState<MetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchCatalog(row)
      .then((metas) => alive && setItems(metas.slice(0, 40)))
      .catch((e) => alive && setError(String(e?.message || e)));
    return () => {
      alive = false;
    };
  }, [row]);
  if (error || (items && items.length === 0)) {
    return null;
  }
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {row.title}
      </Text>
      {items ? (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(meta) => meta.id}
          initialNumToRender={8}
          windowSize={5}
          renderItem={({item}) => (
            <PosterTile
              title={item.name}
              caption={[item.releaseInfo, item.imdbRating ? `★ ${item.imdbRating}` : ''].filter(Boolean).join(' · ')}
              image={item.poster}
              onPress={() => openMeta(item.type || row.catalog.type, item.id, item)}
            />
          )}
        />
      ) : (
        <Text style={styles.muted}>Loading…</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  content: {paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  header: {flexDirection: 'row', alignItems: 'baseline'},
  brand: {color: colors.text, fontSize: fonts.title, fontWeight: '800', marginRight: spacing.l},
  account: {color: colors.textMuted, fontSize: fonts.small, flex: 1},
  actions: {flexDirection: 'row', marginVertical: spacing.s},
  error: {color: colors.danger, fontSize: fonts.small},
  row: {marginTop: spacing.m},
  rowTitle: {color: colors.text, fontSize: fonts.heading - 4, fontWeight: '700', marginBottom: spacing.s},
  muted: {color: colors.textMuted, fontSize: fonts.small},
});
