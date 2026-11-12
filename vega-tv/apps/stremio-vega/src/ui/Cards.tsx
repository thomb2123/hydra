// Focusable title cards: landscape artwork cards, ranked Top 10 posters,
// plain buttons and nav tabs, all with the same white focus treatment.
import React, {useState} from 'react';
import {Image, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle} from 'react-native';
import {backdropOf} from './art';
import {brand, type} from './brand';
import {MetaPreview} from '../stremio/types';

export const CARD_W = 384;
export const CARD_H = 216;

function Art({uri, fallback, style}: {uri?: string; fallback?: string; style: any}) {
  const [failed, setFailed] = useState(false);
  const source = !failed && uri ? uri : fallback;
  if (!source) {
    return <View style={[style, {backgroundColor: brand.surfaceRaised}]} />;
  }
  return <Image source={{uri: source}} style={style} resizeMode="cover" onError={() => !failed && setFailed(true)} />;
}

export interface CardProps {
  meta: MetaPreview;
  onPress: () => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
  /** 0..1 progress bar (Continue Watching). */
  progress?: number;
}

/** 16:9 artwork card with the title along the bottom. */
export const LandscapeCard = ({meta, onPress, onFocus, hasTVPreferredFocus, progress}: CardProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={meta.name}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.card, focused && styles.cardFocused]}>
      <Art uri={backdropOf(meta, 'small')} fallback={meta.poster} style={styles.cardArt} />
      <View style={styles.cardShade} />
      <Text style={styles.cardTitle} numberOfLines={1}>
        {meta.name}
      </Text>
      {progress != null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, {width: `${Math.max(3, Math.min(100, progress * 100))}%`}]} />
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

/** Poster with a large rank number, for "Top 10" rows. */
export const RankedCard = ({meta, rank, onPress, onFocus, hasTVPreferredFocus}: CardProps & {rank: number}) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Number ${rank}, ${meta.name}`}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={styles.ranked}>
      <Text style={[styles.rankNumber, rank >= 10 && styles.rankNumberWide]}>{rank}</Text>
      <View style={[styles.rankPoster, focused && styles.cardFocused]}>
        <Art uri={meta.poster} fallback={backdropOf(meta, 'small')} style={styles.rankArt} />
      </View>
    </TouchableOpacity>
  );
};

/** Poster card for grids (My List, Categories, Search). */
export const PosterCard = ({meta, onPress, onFocus, hasTVPreferredFocus}: CardProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={meta.name}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.poster, focused && styles.cardFocused]}>
      <Art uri={meta.poster} fallback={backdropOf(meta, 'small')} style={styles.posterArt} />
      {focused ? (
        <Text style={styles.posterTitle} numberOfLines={1}>
          {meta.name}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

export interface PillProps {
  label: string;
  onPress: () => void;
  onFocus?: () => void;
  primary?: boolean;
  active?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Rounded action button ("Play", "Episodes", "Other versions"). */
export const Pill = ({label, onPress, onFocus, primary, hasTVPreferredFocus, style}: PillProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.pill, primary && styles.pillPrimary, focused && styles.pillFocused, style]}>
      <Text style={[styles.pillText, (primary || focused) && styles.pillTextDark]}>{label}</Text>
    </TouchableOpacity>
  );
};

/** Text tab for the top navigation. */
export const NavTab = ({label, onPress, onFocus, active, hasTVPreferredFocus}: PillProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{selected: !!active}}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.tab, focused && styles.tabFocused]}>
      <Text style={[styles.tabText, active && styles.tabTextActive, focused && styles.tabTextFocused]}>{label}</Text>
      {active && !focused ? <View style={styles.tabUnderline} /> : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    marginRight: 18,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: 'transparent',
    backgroundColor: brand.surface,
  },
  cardFocused: {borderColor: brand.focus, transform: [{scale: 1.08}]},
  cardArt: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0},
  cardShade: {position: 'absolute', left: 0, right: 0, bottom: 0, height: 70, backgroundColor: 'rgba(0,0,0,0.55)'},
  cardTitle: {position: 'absolute', left: 14, right: 14, bottom: 14, color: brand.text, fontSize: type.small, fontWeight: '700'},
  progressTrack: {position: 'absolute', left: 14, right: 14, bottom: 6, height: 5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 3},
  progressFill: {height: 5, backgroundColor: brand.accent, borderRadius: 3},
  ranked: {flexDirection: 'row', alignItems: 'flex-end', marginRight: 26, height: CARD_H + 60},
  rankNumber: {
    color: '#0b0b0d',
    fontSize: 230,
    lineHeight: 230,
    fontWeight: '900',
    marginRight: -30,
    textShadowColor: 'rgba(255,255,255,0.85)',
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 3,
  },
  rankNumberWide: {letterSpacing: -24},
  rankPoster: {width: 184, height: 276, borderRadius: 8, overflow: 'hidden', borderWidth: 4, borderColor: 'transparent'},
  rankArt: {width: '100%', height: '100%'},
  poster: {width: 220, height: 330, margin: 12, borderRadius: 8, overflow: 'hidden', borderWidth: 4, borderColor: 'transparent', backgroundColor: brand.surface},
  posterArt: {width: '100%', height: '100%'},
  posterTitle: {position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8, color: brand.text, fontSize: type.tiny, fontWeight: '700', backgroundColor: 'rgba(0,0,0,0.7)'},
  pill: {
    paddingHorizontal: 34,
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(110,110,120,0.55)',
    marginRight: 18,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  pillPrimary: {backgroundColor: brand.text},
  pillFocused: {backgroundColor: brand.text, borderColor: brand.accent, transform: [{scale: 1.06}]},
  pillText: {color: brand.text, fontSize: type.body, fontWeight: '700'},
  pillTextDark: {color: '#000'},
  tab: {paddingHorizontal: 18, paddingVertical: 8, marginRight: 6, borderRadius: 6},
  tabFocused: {backgroundColor: brand.text},
  tabText: {color: brand.textMuted, fontSize: type.body, fontWeight: '600'},
  tabTextActive: {color: brand.text, fontWeight: '800'},
  tabTextFocused: {color: '#000'},
  tabUnderline: {height: 3, backgroundColor: brand.accent, marginTop: 4, borderRadius: 2},
});
