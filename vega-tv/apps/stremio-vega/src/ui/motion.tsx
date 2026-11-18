// Motion used across the app. Vega has no native animation driver (the system log says
// "Library 'NativeAnimatedTurboModule' not found"), so every animated frame is drawn
// from JavaScript and competes with loading rows and listings. Motion is therefore kept
// to what reads as smooth without costing every frame:
//   - focus changes are instant (an animated zoom on every card move made scrolling stutter)
//   - blinking and pulsing switch twice a second from one shared timer, not per frame
//   - page entrances are one short ease, started a frame after the page is drawn
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleProp, ViewStyle} from 'react-native';

export const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1); // quick start, soft landing

/** Focus zoom: set at once (see above), still an Animated value so styles stay the same. */
export function useFocusScale(focused: boolean, to = 1.08, _duration?: number): Animated.Value {
  const scale = useRef(new Animated.Value(focused ? to : 1)).current;
  useEffect(() => {
    scale.setValue(focused ? to : 1);
  }, [focused, to, scale]);
  return scale;
}

export type TransitionKind = 'fade' | 'rise' | 'slide' | 'zoom';

/**
 * Entrance whenever `token` changes (a new page, or coming back to one). The children
 * are never remounted, so going back keeps focus and scroll positions.
 */
export const Transition = ({token, kind = 'rise', duration = 220, style, children}: {token: string; kind?: TransitionKind; duration?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode}) => {
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    progress.setValue(0);
    let animation: Animated.CompositeAnimation | null = null;
    // Start once the new page has been drawn, so the first frames are not spent waiting.
    const frame = requestAnimationFrame(() => {
      animation = Animated.timing(progress, {toValue: 1, duration, easing: EASE_OUT, useNativeDriver: false, isInteraction: false});
      animation.start();
    });
    return () => {
      cancelAnimationFrame(frame);
      animation?.stop();
    };
  }, [token, duration, progress]);
  const opacity = progress.interpolate({inputRange: [0, 1], outputRange: [kind === 'fade' ? 0.3 : 0.15, 1]});
  const transform =
    kind === 'slide'
      ? [{translateX: progress.interpolate({inputRange: [0, 1], outputRange: [60, 0]})}]
      : kind === 'zoom'
        ? [{scale: progress.interpolate({inputRange: [0, 1], outputRange: [1.03, 1]})}]
        : kind === 'rise'
          ? [{translateY: progress.interpolate({inputRange: [0, 1], outputRange: [28, 0]})}]
          : [];
  return <Animated.View style={[style, {opacity, transform}]}>{children}</Animated.View>;
};

// One timer for every blinking thing on screen (caret, live dots): on/off every half period.
const blinkers = new Map<number, {value: Animated.Value; users: number; timer: ReturnType<typeof setInterval>}>();

/** 1 / dim, alternating every `period / 2` ms (shared timer; costs nothing between ticks). */
export function usePulse(period = 1000, active = true): Animated.Value {
  const fallback = useRef(new Animated.Value(1)).current;
  const entry = useRef<{value: Animated.Value} | null>(null);
  if (active && !entry.current) {
    let shared = blinkers.get(period);
    if (!shared) {
      const value = new Animated.Value(1);
      let on = true;
      const timer = setInterval(() => {
        on = !on;
        value.setValue(on ? 1 : 0.25);
      }, period / 2);
      shared = {value, users: 0, timer};
      blinkers.set(period, shared);
    }
    shared.users++;
    entry.current = shared;
  }
  useEffect(
    () => () => {
      const shared = blinkers.get(period);
      if (entry.current && shared) {
        shared.users--;
        if (shared.users <= 0) {
          clearInterval(shared.timer);
          blinkers.delete(period);
        }
      }
    },
    [period],
  );
  return entry.current ? entry.current.value : fallback;
}
