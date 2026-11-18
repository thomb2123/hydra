// The channel list over the picture while watching live TV (OK twice): every channel
// in the category with what is on now, opened at the channel playing. Choosing one
// switches to it; Back closes the list. The picture keeps playing underneath.
import React, {memo, useCallback, useEffect, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import * as fx from './flixnest';
import {MergedChannel} from './channels';
import {NowNext, cachedNowNext, displayTitle, nowNext, nowTag, progressOf, timeRange} from './epg';
import {brand, type} from '../ui/brand';
import {CATEGORIES} from './lineup';

export const MINI_ROW_H = 92;
const ROW_STEP = MINI_ROW_H + 8;
const SPORT = new Set(['uk-sport', 'us-sport']);

export const MiniGuide = ({access, list, current, onChoose}: {access: fx.Access; list: MergedChannel[]; current: number; onChoose: (index: number) => void}) => {
  const category = list[current]?.category;
  // A Favourites or Recently Watched list mixes categories.
  const title = (list.every((c) => c.category === category) && CATEGORIES.find((c) => c.id === category)?.title) || 'Channels';
  // The OK press that opened the list must not also choose a row when it is released.
  const openedAt = useRef(Date.now());
  const renderItem = useCallback(
    ({item, index}: {item: MergedChannel; index: number}) => (
      <MiniRow access={access} channel={item} playing={index === current} onPress={() => Date.now() - openedAt.current > 700 && onChoose(index)} />
    ),
    [access, current, onChoose],
  );
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.hint}>OK switches channel · Back closes</Text>
      <FlatList
        data={list}
        keyExtractor={keyOf}
        renderItem={renderItem}
        getItemLayout={layout}
        initialScrollIndex={current > 2 ? current - 2 : undefined}
        initialNumToRender={10}
        windowSize={5}
      />
    </View>
  );
};

const keyOf = (c: MergedChannel) => c.id;
const layout = (_: unknown, index: number) => ({length: ROW_STEP, offset: ROW_STEP * index, index});

const MiniRow = memo(({access, channel, playing, onPress}: {access: fx.Access; channel: MergedChannel; playing: boolean; onPress: () => void}) => {
  const [focused, setFocused] = useState(false);
  const [info, setInfo] = useState<NowNext | null>(() => cachedNowNext(channel));
  useEffect(() => {
    let alive = true;
    if (!info) {
      nowNext(access, channel)
        .then((v) => alive && setInfo(v))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [access, channel, info]);
  const now = info?.now;
  const tag = nowTag(info, SPORT.has(channel.category));
  return (
    <TouchableOpacity
      activeOpacity={1}
      hasTVPreferredFocus={playing}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={`${channel.number} ${channel.name}${now?.title ? `, now ${displayTitle(now)}` : ''}`}
      style={[styles.row, playing && styles.rowPlaying, focused && styles.rowFocused]}>
      <Text style={[styles.number, focused && styles.dark]}>{channel.number}</Text>
      <View style={styles.main}>
        <Text numberOfLines={1} style={[styles.name, focused && styles.dark]}>
          {channel.name}
          {playing ? <Text style={[styles.playing, focused && styles.dark]}>{'   ● Watching'}</Text> : null}
        </Text>
        <Text numberOfLines={1} style={[styles.now, focused && styles.darkSoft]}>
          {tag ? <Text style={tag === 'LIVE' ? styles.tagLive : styles.tagReplay}>{tag === 'LIVE' ? 'LIVE  ' : 'REPLAY  '}</Text> : null}
          {now?.title ? `${timeRange(now)}  ${displayTitle(now)}` : info ? 'No listings' : ' '}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, {width: `${Math.round(progressOf(now) * 100)}%`}]} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  panel: {position: 'absolute', top: 40, left: 40, bottom: 40, width: 760, backgroundColor: 'rgba(12,12,16,0.95)', borderRadius: 16, paddingHorizontal: 24, paddingTop: 24, zIndex: 10},
  title: {color: brand.text, fontSize: type.heading, fontWeight: '900'},
  hint: {color: brand.textMuted, fontSize: type.tiny, marginTop: 4, marginBottom: 16},
  row: {height: MINI_ROW_H, marginBottom: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderRadius: 10, borderWidth: 3, borderColor: 'transparent', backgroundColor: brand.surface},
  rowPlaying: {borderColor: brand.accent},
  rowFocused: {backgroundColor: brand.text, borderColor: brand.text},
  number: {width: 64, color: brand.textMuted, fontSize: type.small, fontWeight: '800'},
  main: {flex: 1},
  name: {color: brand.text, fontSize: type.small, fontWeight: '800'},
  playing: {color: brand.accent, fontSize: type.tiny, fontWeight: '800'},
  now: {color: brand.textSoft, fontSize: type.tiny, marginTop: 4},
  dark: {color: '#000'},
  darkSoft: {color: '#222'},
  tagLive: {color: '#e50914', fontWeight: '900'},
  tagReplay: {color: '#f5a524', fontWeight: '900'},
  track: {height: 4, marginTop: 8, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.35)'},
  fill: {height: 4, borderRadius: 2, backgroundColor: brand.accent},
});
