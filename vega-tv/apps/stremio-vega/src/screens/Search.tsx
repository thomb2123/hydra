import React, {useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {FocusButton, PosterTile} from '../../../../shared/src/ui/FocusButton';
import {TextField} from '../../../../shared/src/ui/TextField';
import {colors, fonts, safeArea, spacing} from '../../../../shared/src/ui/theme';
import {useBackHandler} from '../../../../shared/src/tv/remote';
import {BoardCatalog, fetchCatalog, searchCatalogs} from '../stremio/addons';
import {MetaPreview} from '../stremio/types';
import {StremioState} from '../state';

type Result = {row: BoardCatalog; metas: MetaPreview[]};

export const Search = ({state, openMeta, onBack}: {state: StremioState; openMeta: (type: string, id: string, preview?: MetaPreview) => void; onBack: () => void}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const catalogs = useMemo(() => searchCatalogs(state.addons).slice(0, 8), [state.addons]);

  useBackHandler(() => {
    onBack();
    return true;
  });

  const run = async () => {
    const text = query.trim();
    if (!text) {
      return;
    }
    setSearching(true);
    const found = await Promise.all(
      catalogs.map(async (row) => ({row, metas: await fetchCatalog(row, {search: text}).catch(() => [] as MetaPreview[])})),
    );
    setResults(found.filter((r) => r.metas.length));
    setSearching(false);
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Search</Text>
      <View style={styles.bar}>
        <TextField label="Title (press OK to type)" value={query} onChangeText={setQuery} onSubmit={run} hasTVPreferredFocus />
        <FocusButton label={searching ? 'Searching…' : 'Search'} onPress={run} disabled={searching} />
        <FocusButton label="Back" compact onPress={onBack} />
      </View>
      {catalogs.length === 0 ? <Text style={styles.muted}>None of your add-ons support search.</Text> : null}
      {results && results.length === 0 ? <Text style={styles.muted}>No results.</Text> : null}
      <FlatList
        data={results || []}
        keyExtractor={(r) => `${r.row.addon.transportUrl}|${r.row.catalog.type}|${r.row.catalog.id}`}
        renderItem={({item}) => (
          <View style={styles.row}>
            <Text style={styles.rowTitle}>{item.row.title}</Text>
            <FlatList
              horizontal
              data={item.metas}
              keyExtractor={(m) => m.id}
              renderItem={({item: meta}) => (
                <PosterTile title={meta.name} caption={meta.releaseInfo} image={meta.poster} onPress={() => openMeta(meta.type || item.row.catalog.type, meta.id, meta)} />
              )}
            />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background, paddingHorizontal: safeArea.horizontal, paddingVertical: safeArea.vertical},
  title: {color: colors.text, fontSize: fonts.title, fontWeight: '800'},
  bar: {flexDirection: 'row', alignItems: 'flex-end'},
  muted: {color: colors.textMuted, fontSize: fonts.small, marginTop: spacing.s},
  row: {marginTop: spacing.m},
  rowTitle: {color: colors.text, fontSize: fonts.body, fontWeight: '700', marginBottom: spacing.s},
});
