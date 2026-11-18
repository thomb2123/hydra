// A channel's logo, or its name when the provider's logo is missing, broken or a thin
// strip that would be unreadable at guide size (e.g. a 10:1 banner shrunk into a box).
import React, {useState} from 'react';
import {Image, ImageStyle, StyleProp, Text, TextStyle} from 'react-native';

// Logos found unusable this session (so the guide does not flash them again).
const unusable = new Set<string>();

/** Wider than this (width / height) is a banner strip, not a logo. */
export const MAX_LOGO_ASPECT = 4.5;

export function usableLogo(width?: number, height?: number): boolean {
  if (!width || !height) {
    return true; // size unknown: trust it
  }
  return width >= 24 && height >= 12 && width / height <= MAX_LOGO_ASPECT;
}

export const ChannelLogo = ({uri, name, style, textStyle, lines = 2}: {uri?: string; name: string; style: StyleProp<ImageStyle>; textStyle: StyleProp<TextStyle>; lines?: number}) => {
  const [bad, setBad] = useState(() => !uri || unusable.has(uri));
  if (bad || !uri) {
    return (
      <Text style={textStyle} numberOfLines={lines}>
        {name}
      </Text>
    );
  }
  const reject = () => {
    unusable.add(uri);
    setBad(true);
  };
  return (
    <Image
      source={{uri}}
      style={style}
      resizeMode="contain"
      onError={reject}
      onLoad={(e: any) => {
        const src = e?.nativeEvent?.source;
        if (!usableLogo(src?.width, src?.height)) {
          reject();
        }
      }}
    />
  );
};
