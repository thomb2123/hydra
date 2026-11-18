// The large preview at the top of browse pages: backdrop of the focused title,
// its logo (or name), year, rating, genres and a short synopsis.
import React, {memo, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {backdropOf, logoOf, ratingOf, yearOf} from './art';
import {brand, edge, type} from './brand';
import {MetaPreview} from '../stremio/types';
import {FeaturedStore, useFeatured} from './featured';

/** Fakes a gradient with stacked translucent bands (no native gradient view on Vega). */
// Band i spans from the edge to (size - i*band); overlapping bands build up to
// roughly `strength` opacity at the edge and fade smoothly to ~0 at `size`.
export const Fade = ({direction, size, color = '0,0,0', strength = 1, steps = 12}: {direction: 'left' | 'bottom' | 'top'; size: number; color?: string; strength?: number; steps?: number}) => {
  const bands = [];
  for (let i = 0; i < steps; i++) {
    const alpha = 0.36 * Math.pow((i + 1) / steps, 1.5) * strength;
    const band = size / steps;
    const pos: any =
      direction === 'left'
        ? {left: 0, top: 0, bottom: 0, width: size - i * band}
        : direction === 'bottom'
        ? {left: 0, right: 0, bottom: 0, height: size - i * band}
        : {left: 0, right: 0, top: 0, height: size - i * band};
    bands.push(<View key={i} pointerEvents="none" style={[{position: 'absolute'}, pos, {backgroundColor: `rgba(${color},${alpha.toFixed(3)})`}]} />);
  }
  return <>{bands}</>;
};

export const BILLBOARD_H = 600;

// The fades never change, so they are rendered once and not on every focus change.
const BillboardFades = memo(() => (
  <>
    <Fade direction="left" size={1150} />
    <Fade direction="bottom" size={260} />
  </>
));

export const Billboard = ({meta, height = BILLBOARD_H}: {meta: MetaPreview | null; height?: number}) => {
  const [logoFailed, setLogoFailed] = useState<string | null>(null);
  if (!meta) {
    return <View style={[styles.root, {height}]} />;
  }
  const logo = logoOf(meta);
  const showLogo = logo && logoFailed !== logo;
  const facts = [yearOf(meta), ratingOf(meta) ? `★ ${ratingOf(meta)}` : '', ((meta as any).genres || []).slice(0, 3).join(' • ')].filter(Boolean);
  return (
    <View style={[styles.root, {height}]}>
      {/* Medium-size art: decodes much faster on the stick than full-HD backdrops. */}
      <Image source={{uri: backdropOf(meta, 'medium')}} style={styles.backdrop} resizeMode="cover" fadeDuration={0} />
      <BillboardFades />
      <View style={styles.info}>
        {showLogo ? (
          <Image source={{uri: logo}} style={styles.logo} resizeMode="contain" fadeDuration={0} onError={() => setLogoFailed(logo || null)} />
        ) : (
          <Text style={styles.name} numberOfLines={2}>
            {meta.name}
          </Text>
        )}
        {facts.length ? <Text style={styles.facts}>{facts.join('   ')}</Text> : null}
        {meta.description ? (
          <Text style={styles.synopsis} numberOfLines={2}>
            {meta.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

/** Billboard bound to the featured-title store (only this component re-renders on focus moves). */
export const LiveBillboard = ({store, height}: {store: FeaturedStore; height?: number}) => {
  const meta = useFeatured(store);
  return <Billboard meta={meta} height={height} />;
};

const styles = StyleSheet.create({
  root: {width: '100%', backgroundColor: brand.background, overflow: 'hidden'},
  backdrop: {position: 'absolute', top: 0, right: 0, width: 1500, height: '100%'},
  info: {position: 'absolute', left: edge, bottom: 140, width: 820},
  logo: {width: 500, height: 150, marginBottom: 16},
  name: {color: brand.text, fontSize: type.hero, fontWeight: '900', marginBottom: 14},
  facts: {color: brand.textSoft, fontSize: type.small, fontWeight: '600', marginBottom: 12},
  synopsis: {color: brand.textSoft, fontSize: type.small, lineHeight: 30},
});
