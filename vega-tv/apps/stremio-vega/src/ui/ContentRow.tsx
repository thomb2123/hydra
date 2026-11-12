// One titled, horizontally scrolling row of cards fed by an add-on catalog
// (or by ready-made items, e.g. recommendations). Tuned for the Fire TV stick:
// few off-screen cards, fixed card sizes, stable callbacks.
import React, {memo, useCallback, useEffect, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {CARD_H, CARD_W, LandscapeCard, RankedCard} from './Cards';
import {brand, edge, type} from './brand';
import {fetchCatalog} from '../stremio/addons';
import {RowSpec} from '../stremio/rows';
import {MetaPreview} from '../stremio/types';

// Catalog results are cached for the session so tab switches are instant.
const cache = new Map<string, MetaPreview[]>();

/** Films and series only (live TV channels have no artwork and are not "titles"). */
function isTitle(meta: MetaPreview): boolean {
  return !meta.type || meta.type === 'movie' || meta.type === 'series';
}

export function useRowItems(row: RowSpec): MetaPreview[] | null {
  const cacheKey = `${row.key}|${JSON.stringify(row.extra || {})}`;
  const [items, setItems] = useState<MetaPreview[] | null>(row.items || cache.get(cacheKey) || null);
  useEffect(() => {
    if (row.pending) {
      setItems(null);
      return;
    }
    if (row.items) {
      setItems(row.items);
      return;
    }
    if (cache.has(cacheKey)) {
      setItems(cache.get(cacheKey) || null);
      return;
    }
    let alive = true;
    fetchCatalog(row.source, row.extra)
      .then((metas) => {
        const list = metas
          .filter((m) => isTitle(m) && (m.poster || m.background || /^tt\d/.test(m.id)))
          .slice(0, row.top10 ? 10 : 24);
        cache.set(cacheKey, list);
        if (alive) {
          setItems(list);
        }
      })
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [cacheKey, row]);
  return items;
}

export interface ContentRowProps {
  row: RowSpec;
  openMeta: (meta: MetaPreview, type: string) => void;
  onFocusItem: (meta: MetaPreview) => void;
  onLoaded?: (row: RowSpec, items: MetaPreview[]) => void;
  preferFirst?: boolean;
}

const CARD_STEP = CARD_W + 18; // card width + right margin

export const ContentRow = memo(({row, openMeta, onFocusItem, onLoaded, preferFirst}: ContentRowProps) => {
  const items = useRowItems(row);
  useEffect(() => {
    if (items && items.length) {
      onLoaded?.(row, items);
    }
  }, [items, row, onLoaded]);

  const renderItem = useCallback(
    ({item, index}: {item: MetaPreview; index: number}) =>
      row.top10 ? (
        <RankedCard meta={item} rank={index + 1} hasTVPreferredFocus={preferFirst && index === 0} onFocus={() => onFocusItem(item)} onPress={() => openMeta(item, item.type || row.type)} />
      ) : (
        <LandscapeCard meta={item} hasTVPreferredFocus={preferFirst && index === 0} onFocus={() => onFocusItem(item)} onPress={() => openMeta(item, item.type || row.type)} />
      ),
    [row.top10, row.type, preferFirst, onFocusItem, openMeta],
  );
  const getItemLayout = useCallback((_: unknown, index: number) => ({length: CARD_STEP, offset: CARD_STEP * index, index}), []);

  if (items && items.length === 0) {
    return null; // Hide empty or failed rows entirely.
  }
  return (
    <View style={[styles.row, row.top10 && styles.rowTall]}>
      <Text style={styles.title}>{row.title}</Text>
      {items ? (
        <FlatList
          horizontal
          data={items}
          keyExtractor={keyOf}
          renderItem={renderItem}
          getItemLayout={row.top10 ? undefined : getItemLayout}
          initialNumToRender={5}
          maxToRenderPerBatch={4}
          windowSize={3}
          removeClippedSubviews
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      ) : (
        <View style={styles.placeholderRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.placeholder} />
          ))}
        </View>
      )}
    </View>
  );
});

const keyOf = (meta: MetaPreview) => meta.id;

const styles = StyleSheet.create({
  row: {height: CARD_H + 92},
  rowTall: {height: CARD_H + 150},
  title: {color: brand.text, fontSize: type.heading - 2, fontWeight: '800', marginLeft: edge, marginBottom: 14},
  list: {paddingLeft: edge, paddingRight: edge, paddingVertical: 10},
  placeholderRow: {flexDirection: 'row', paddingLeft: edge, paddingVertical: 10},
  placeholder: {width: CARD_W, height: CARD_H, marginRight: 18, borderRadius: 8, backgroundColor: brand.surface},
});
