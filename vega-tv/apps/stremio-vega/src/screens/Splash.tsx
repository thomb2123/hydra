// Launch ident, in step with the intro sound (about 2.3 seconds):
//   0.0–0.7 s  two light streaks rush in from the sides (the whoosh)
//   0.7 s      the "S" lands with a ring of light bursting outward (the hit)
//   0.8–1.6 s  a glint sweeps across the letter while the chord rings
//   1.6–2.3 s  the view flies through the "S" into the app
// Only opacity and transforms are animated; the app below waits until it ends to build
// the home screen, so nothing else competes for the frames.
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {brand} from '../ui/brand';
import {EASE_OUT} from '../ui/motion';
import {playIntroSound} from '../ui/introSound';

const N = false; // Vega has no native animation driver (see ui/motion.tsx)

export const Splash = ({onDone}: {onDone: () => void}) => {
  const streaks = useRef(new Animated.Value(0)).current;
  const land = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const glint = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    playIntroSound().then(() => {
      if (cancelled) {
        return;
      }
      animation = Animated.sequence([
        Animated.timing(streaks, {toValue: 1, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: N}),
        Animated.parallel([
          Animated.timing(land, {toValue: 1, duration: 360, easing: EASE_OUT, useNativeDriver: N}),
          Animated.timing(ring, {toValue: 1, duration: 900, easing: EASE_OUT, useNativeDriver: N}),
          Animated.sequence([Animated.delay(150), Animated.timing(glint, {toValue: 1, duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: N})]),
        ]),
        Animated.timing(fly, {toValue: 1, duration: 620, easing: Easing.in(Easing.cubic), useNativeDriver: N}),
      ]);
      animation.start(() => !cancelled && onDone());
    });
    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [streaks, land, ring, glint, fly, onDone]);

  // Streaks: from the screen edges to the centre, fading as they meet.
  const streakOpacity = streaks.interpolate({inputRange: [0, 0.2, 0.85, 1], outputRange: [0, 1, 1, 0]});
  const leftX = streaks.interpolate({inputRange: [0, 1], outputRange: [-1100, -40]});
  const rightX = streaks.interpolate({inputRange: [0, 1], outputRange: [1100, 40]});
  // The letter lands slightly big and settles; then flies at the viewer.
  const letterScale = Animated.add(
    land.interpolate({inputRange: [0, 1], outputRange: [1.35, 1]}),
    fly.interpolate({inputRange: [0, 1], outputRange: [0, 14]}),
  );
  const letterOpacity = Animated.multiply(
    land.interpolate({inputRange: [0, 0.4, 1], outputRange: [0, 1, 1]}),
    fly.interpolate({inputRange: [0, 0.7, 1], outputRange: [1, 0.85, 0]}),
  );
  const ringScale = ring.interpolate({inputRange: [0, 1], outputRange: [0.4, 2.6]});
  const ringOpacity = ring.interpolate({inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0]});
  const glintX = glint.interpolate({inputRange: [0, 1], outputRange: [-360, 360]});
  const glintOpacity = glint.interpolate({inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.75, 0.75, 0]});
  const haloOpacity = Animated.multiply(land, fly.interpolate({inputRange: [0, 1], outputRange: [0.55, 0]}));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.streak, {opacity: streakOpacity, transform: [{translateX: leftX}]}]} />
      <Animated.View style={[styles.streak, {opacity: streakOpacity, transform: [{translateX: rightX}]}]} />
      <Animated.View style={[styles.halo, {opacity: haloOpacity}]} />
      <Animated.View style={[styles.ring, {opacity: ringOpacity, transform: [{scale: ringScale}]}]} />
      <Animated.View style={[styles.mark, {opacity: letterOpacity, transform: [{scale: letterScale}]}]}>
        <Animated.Text style={[styles.letter, styles.depth]}>S</Animated.Text>
        <Animated.Text style={[styles.letter, styles.face]}>S</Animated.Text>
        {/* The glint: a soft bright band crossing the letter (clipped to its box). */}
        <View style={styles.glintClip} pointerEvents="none">
          <Animated.View style={[styles.glint, {opacity: glintOpacity, transform: [{translateX: glintX}, {rotate: '18deg'}]}]} />
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', overflow: 'hidden'},
  streak: {position: 'absolute', width: 1000, height: 6, borderRadius: 3, backgroundColor: brand.accent, shadowColor: brand.accent, shadowOpacity: 1, shadowRadius: 20},
  halo: {position: 'absolute', width: 760, height: 760, borderRadius: 380, backgroundColor: 'rgba(123,92,255,0.18)'},
  ring: {position: 'absolute', width: 420, height: 420, borderRadius: 210, borderWidth: 6, borderColor: '#b9a8ff'},
  mark: {width: 420, height: 520, justifyContent: 'center', alignItems: 'center'},
  letter: {position: 'absolute', fontSize: 470, lineHeight: 520, fontWeight: '900', textAlign: 'center', width: 420},
  depth: {color: brand.accentDeep, transform: [{translateX: 10}, {translateY: 12}]},
  face: {color: brand.accent, textShadowColor: 'rgba(123,92,255,0.9)', textShadowOffset: {width: 0, height: 0}, textShadowRadius: 40},
  glintClip: {position: 'absolute', top: 40, bottom: 40, left: 30, right: 30, overflow: 'hidden', borderRadius: 40},
  glint: {position: 'absolute', top: -80, bottom: -80, left: 150, width: 70, backgroundColor: 'rgba(255,255,255,0.55)'},
});
