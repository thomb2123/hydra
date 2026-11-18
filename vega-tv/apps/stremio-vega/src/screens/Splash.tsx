// Launch ident, in step with the intro sound (about 2.2 seconds):
//   0.0–0.7 s  two light streaks rush in from the sides (the whoosh)
//   0.7 s      the "S" lands with a ring of light bursting outward (the hit)
//   0.8–1.5 s  a glint sweeps across the letter while the chord rings
//   1.5–2.0 s  the view pushes into the "S" and fades to the app
// Vega has no native animation driver, so every frame is drawn from JavaScript and by a
// modest GPU: nothing here is blurred (no text or box shadows: re-blurring a 470 px glyph
// each frame as it scaled up made the intro stutter), the push-in stops at 3.5x rather
// than 14x, and the frame rate is written to the log.
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {brand} from '../ui/brand';
import {EASE_OUT} from '../ui/motion';
import {playIntroSound} from '../ui/introSound';

const D = false; // Vega has no native animation driver (see ui/motion.tsx)

export const Splash = ({onDone}: {onDone: () => void}) => {
  const streaks = useRef(new Animated.Value(0)).current;
  const land = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const glint = useRef(new Animated.Value(0)).current;
  const push = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    // Frame counter for the log (how smooth the intro really was on this stick).
    let frames = 0;
    let counting = true;
    const count = () => {
      frames++;
      if (counting) {
        requestAnimationFrame(count);
      }
    };
    playIntroSound().then(() => {
      if (cancelled) {
        return;
      }
      const began = Date.now();
      requestAnimationFrame(count);
      animation = Animated.sequence([
        Animated.timing(streaks, {toValue: 1, duration: 700, easing: Easing.in(Easing.cubic), useNativeDriver: D}),
        Animated.parallel([
          Animated.timing(land, {toValue: 1, duration: 320, easing: EASE_OUT, useNativeDriver: D}),
          Animated.timing(ring, {toValue: 1, duration: 800, easing: EASE_OUT, useNativeDriver: D}),
          Animated.sequence([Animated.delay(120), Animated.timing(glint, {toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: D})]),
        ]),
        Animated.timing(push, {toValue: 1, duration: 480, easing: Easing.in(Easing.quad), useNativeDriver: D}),
      ]);
      animation.start(() => {
        counting = false;
        const ms = Date.now() - began;
        // eslint-disable-next-line no-console
        console.log(`[stremio] intro: ${frames} frames in ${ms} ms (${Math.round((frames * 1000) / Math.max(1, ms))} fps)`);
        if (!cancelled) {
          onDone();
        }
      });
    });
    return () => {
      cancelled = true;
      counting = false;
      animation?.stop();
    };
  }, [streaks, land, ring, glint, push, onDone]);

  const streakOpacity = streaks.interpolate({inputRange: [0, 0.2, 0.85, 1], outputRange: [0, 1, 1, 0]});
  const leftX = streaks.interpolate({inputRange: [0, 1], outputRange: [-1100, -40]});
  const rightX = streaks.interpolate({inputRange: [0, 1], outputRange: [1100, 40]});
  const letterScale = Animated.add(
    land.interpolate({inputRange: [0, 1], outputRange: [1.3, 1]}),
    push.interpolate({inputRange: [0, 1], outputRange: [0, 2.5]}),
  );
  const letterOpacity = Animated.multiply(
    land.interpolate({inputRange: [0, 0.4, 1], outputRange: [0, 1, 1]}),
    push.interpolate({inputRange: [0, 0.5, 1], outputRange: [1, 0.8, 0]}),
  );
  const ringScale = ring.interpolate({inputRange: [0, 1], outputRange: [0.5, 2.4]});
  const ringOpacity = ring.interpolate({inputRange: [0, 0.15, 1], outputRange: [0, 0.85, 0]});
  const glintX = glint.interpolate({inputRange: [0, 1], outputRange: [-340, 340]});
  const glintOpacity = glint.interpolate({inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.6, 0.6, 0]});
  const haloOpacity = Animated.multiply(land, push.interpolate({inputRange: [0, 1], outputRange: [1, 0]}));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.streak, {opacity: streakOpacity, transform: [{translateX: leftX}]}]} />
      <Animated.View style={[styles.streak, {opacity: streakOpacity, transform: [{translateX: rightX}]}]} />
      {/* A soft glow made of two flat circles (cheap, unlike a blurred shadow). */}
      <Animated.View style={[styles.haloOuter, {opacity: haloOpacity}]} />
      <Animated.View style={[styles.haloInner, {opacity: haloOpacity}]} />
      <Animated.View style={[styles.ring, {opacity: ringOpacity, transform: [{scale: ringScale}]}]} />
      <Animated.View style={[styles.mark, {opacity: letterOpacity, transform: [{scale: letterScale}]}]}>
        <Animated.Text style={[styles.letter, styles.depth]}>S</Animated.Text>
        <Animated.Text style={[styles.letter, styles.face]}>S</Animated.Text>
        <View style={styles.glintClip} pointerEvents="none">
          <Animated.View style={[styles.glint, {opacity: glintOpacity, transform: [{translateX: glintX}, {rotate: '18deg'}]}]} />
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', overflow: 'hidden'},
  streak: {position: 'absolute', width: 1000, height: 6, borderRadius: 3, backgroundColor: brand.accent},
  haloOuter: {position: 'absolute', width: 820, height: 820, borderRadius: 410, backgroundColor: 'rgba(123,92,255,0.10)'},
  haloInner: {position: 'absolute', width: 560, height: 560, borderRadius: 280, backgroundColor: 'rgba(123,92,255,0.14)'},
  ring: {position: 'absolute', width: 420, height: 420, borderRadius: 210, borderWidth: 6, borderColor: '#b9a8ff'},
  mark: {width: 420, height: 520, justifyContent: 'center', alignItems: 'center'},
  letter: {position: 'absolute', fontSize: 470, lineHeight: 520, fontWeight: '900', textAlign: 'center', width: 420},
  depth: {color: brand.accentDeep, transform: [{translateX: 10}, {translateY: 12}]},
  face: {color: brand.accent},
  glintClip: {position: 'absolute', top: 40, bottom: 40, left: 30, right: 30, overflow: 'hidden'},
  glint: {position: 'absolute', top: -80, bottom: -80, left: 150, width: 70, backgroundColor: 'rgba(255,255,255,0.5)'},
});
