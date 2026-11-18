// "Live Sport Now" on the home screen: matches in progress right now (the same list as
// Live TV › Live Now, those a TV guide confirms first), so live sport is one press away.
import React, {memo, useCallback, useMemo, useState} from 'react';
import {Animated, FlatList, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useFocusScale, usePulse} from './motion';
import {brand, edge, type} from './brand';
import {SportEvent} from '../tv/events';

export const SPORT_CARD_W = 384;
export const SPORT_CARD_H = 168;
export const LIVE_ROW_H = SPORT_CARD_H + 96;
const MAX_CARDS = 12;

/** Live events worth a home-screen card, best first. */
export function homeSportEvents(events: SportEvent[]): SportEvent[] {
  return events
    .filter((e) => e.live)
    .sort((a, b) => Number(!!b.confirmed) - Number(!!a.confirmed) || a.tier - b.tier || Number(!!b.verified) - Number(!!a.verified) || a.start - b.start)
    .slice(0, MAX_CARDS);
}

const SPORT_COLOUR: Record<string, string> = {
  Football: '#2fbf71',
  'UFC & MMA': '#e5484d',
  Boxing: '#e5484d',
  'Formula 1': '#ff3b30',
  Motorsport: '#ff8a00',
  Rugby: '#3e7bfa',
  Cricket: '#d9b44a',
  Darts: '#f5a524',
  Snooker: '#14a37f',
  Tennis: '#c8e64c',
  Golf: '#5cc66e',
  NFL: '#7b5cff',
  Basketball: '#ff7a1a',
};

export const LiveSportRow = memo(
  ({events, onPlay, focusKey, onFocusEvent}: {events: SportEvent[]; onPlay: (e: SportEvent) => void; focusKey?: string; onFocusEvent?: (e: SportEvent) => void}) => {
    const list = useMemo(() => homeSportEvents(events), [events]);
    const renderItem = useCallback(
      ({item}: {item: SportEvent}) => <SportCard event={item} preferred={item.key === focusKey} onPress={() => onPlay(item)} onFocus={() => onFocusEvent?.(item)} />,
      [focusKey, onPlay, onFocusEvent],
    );
    if (!list.length) {
      return null;
    }
    return (
      <View style={styles.row}>
        <Text style={styles.title}>Live Sport Now</Text>
        <FlatList
          horizontal
          data={list}
          keyExtractor={keyOf}
          renderItem={renderItem}
          initialNumToRender={5}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      </View>
    );
  },
);

const keyOf = (e: SportEvent) => e.key;

const SportCard = ({event, preferred, onPress, onFocus}: {event: SportEvent; preferred?: boolean; onPress: () => void; onFocus?: () => void}) => {
  const [focused, setFocused] = useState(false);
  const scale = useFocusScale(focused);
  const pulse = usePulse(1400);
  const colour = SPORT_COLOUR[event.sport] || brand.accent;
  const where = event.channelName || 'Live feed';
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Live, ${event.title}, ${event.sport}, on ${where}`}
      activeOpacity={1}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={styles.cardOuter}>
      <Animated.View style={[styles.card, focused && styles.cardFocused, {transform: [{scale}]}]}>
      <View style={[styles.stripe, {backgroundColor: colour}]} />
      <View style={styles.top}>
        <Animated.View style={[styles.liveDot, {opacity: pulse}]} />
        <Text style={styles.live}>LIVE</Text>
        <Text numberOfLines={1} style={styles.sport}>
          {event.competition || event.sport}
        </Text>
      </View>
      <Text numberOfLines={2} style={styles.match}>
        {event.title}
      </Text>
      <Text numberOfLines={1} style={[styles.where, event.confirmed && styles.whereConfirmed]}>
        {event.confirmed ? `✓ ${where}` : where}
      </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {height: LIVE_ROW_H},
  title: {color: brand.text, fontSize: type.heading - 2, fontWeight: '800', marginLeft: edge, marginBottom: 14},
  list: {paddingLeft: edge, paddingRight: edge, paddingVertical: 10},
  cardOuter: {width: SPORT_CARD_W, height: SPORT_CARD_H, marginRight: 18},
  card: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: 'transparent',
    backgroundColor: brand.surfaceRaised,
    paddingLeft: 26,
    paddingRight: 18,
    paddingVertical: 14,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  cardFocused: {borderColor: brand.focus},
  liveDot: {width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff3b3b', marginRight: 8},
  stripe: {position: 'absolute', left: 0, top: 0, bottom: 0, width: 8},
  top: {flexDirection: 'row', alignItems: 'center'},
  live: {color: '#fff', backgroundColor: '#e50914', fontSize: type.tiny - 2, fontWeight: '900', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginRight: 10, overflow: 'hidden'},
  sport: {flex: 1, color: brand.textMuted, fontSize: type.tiny, fontWeight: '700'},
  match: {color: brand.text, fontSize: type.body, fontWeight: '800', lineHeight: 30},
  where: {color: brand.textSoft, fontSize: type.tiny, fontWeight: '600'},
  whereConfirmed: {color: brand.match},
});
