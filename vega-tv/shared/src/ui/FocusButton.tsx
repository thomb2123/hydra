import React, {useState} from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {colors, fonts, spacing} from './theme';

export interface FocusButtonProps {
  label: string;
  subtitle?: string;
  onPress?: () => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
  disabled?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  testID?: string;
}

/** A remote-friendly button: high-contrast focus ring and a large hit target. */
export const FocusButton = ({
  label,
  subtitle,
  onPress,
  onFocus,
  hasTVPreferredFocus,
  disabled,
  selected,
  style,
  compact,
  testID,
}: FocusButtonProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${label}. ${subtitle}` : label}
      activeOpacity={1}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[
        styles.button,
        compact && styles.compact,
        selected && styles.selected,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
      ]}>
      <Text numberOfLines={1} style={[styles.label, compact && styles.compactLabel, focused && styles.focusedText]}>
        {selected ? '● ' : ''}
        {label}
      </Text>
      {subtitle ? (
        <Text numberOfLines={2} style={[styles.subtitle, focused && styles.focusedText]}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

export interface PosterTileProps {
  title: string;
  caption?: string;
  image?: string;
  onPress: () => void;
  onFocus?: () => void;
  hasTVPreferredFocus?: boolean;
  width?: number;
  height?: number;
}

/** Poster card used in catalog rows. */
export const PosterTile = ({title, caption, image, onPress, onFocus, hasTVPreferredFocus, width = 220, height = 330}: PosterTileProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={caption ? `${title}, ${caption}` : title}
      activeOpacity={1}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[styles.poster, {width, height: height + 64}, focused && styles.posterFocused]}>
      <View style={[styles.posterImageWrap, {width: width - 8, height}]}>
        {image ? (
          <Image source={{uri: image}} style={styles.posterImage} resizeMode="cover" />
        ) : (
          <Text style={styles.posterFallback} numberOfLines={4}>
            {title}
          </Text>
        )}
      </View>
      <Text numberOfLines={1} style={[styles.posterTitle, focused && styles.posterTitleFocused]}>
        {title}
      </Text>
      {caption ? (
        <Text numberOfLines={1} style={styles.posterCaption}>
          {caption}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: 'transparent',
    paddingVertical: spacing.s,
    paddingHorizontal: spacing.m,
    marginVertical: spacing.xs,
    marginRight: spacing.s,
  },
  compact: {paddingVertical: 8, paddingHorizontal: 16},
  selected: {borderColor: colors.accent},
  focused: {backgroundColor: colors.focus, borderColor: colors.focus, transform: [{scale: 1.03}]},
  disabled: {opacity: 0.4},
  label: {color: colors.text, fontSize: fonts.body, fontWeight: '600'},
  compactLabel: {fontSize: fonts.small},
  subtitle: {color: colors.textMuted, fontSize: fonts.small, marginTop: 4},
  focusedText: {color: colors.focusText},
  poster: {
    marginRight: spacing.m,
    borderRadius: 14,
    borderWidth: 4,
    borderColor: 'transparent',
    padding: 0,
  },
  posterFocused: {borderColor: colors.focus, transform: [{scale: 1.05}]},
  posterImageWrap: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterImage: {width: '100%', height: '100%'},
  posterFallback: {color: colors.text, fontSize: fonts.small, padding: spacing.s, textAlign: 'center'},
  posterTitle: {color: colors.text, fontSize: fonts.small, marginTop: 6, paddingHorizontal: 4},
  posterTitleFocused: {color: colors.focus},
  posterCaption: {color: colors.textMuted, fontSize: 18, paddingHorizontal: 4},
});
