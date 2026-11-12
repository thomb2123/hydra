// Launch ident: a large "S" rises in with a glow, flares bright,
// then the view zooms through the letter into the app (about two seconds).
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {brand} from '../ui/brand';

export const Splash = ({onDone}: {onDone: () => void}) => {
  const appear = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(appear, {toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: false}),
      Animated.timing(sweep, {toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: false}),
      Animated.timing(zoom, {toValue: 1, duration: 480, easing: Easing.in(Easing.cubic), useNativeDriver: false}),
    ]);
    animation.start(() => onDone());
    return () => animation.stop();
  }, [appear, sweep, zoom, onDone]);

  const scale = Animated.add(
    appear.interpolate({inputRange: [0, 1], outputRange: [0.72, 1]}),
    zoom.interpolate({inputRange: [0, 1], outputRange: [0, 13]}),
  );
  const opacity = Animated.multiply(appear, zoom.interpolate({inputRange: [0, 0.75, 1], outputRange: [1, 0.9, 0]}));
  const shine = sweep.interpolate({inputRange: [0, 0.5, 1], outputRange: [brand.accent, '#d9ceff', brand.accent]});

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.mark, {opacity, transform: [{scale}]}]}>
        {/* Depth layer under the face; the face flares bright once before the zoom. */}
        <Animated.Text style={[styles.letter, styles.depth]}>S</Animated.Text>
        <Animated.Text style={[styles.letter, styles.face, {color: shine}]}>S</Animated.Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: brand.background, justifyContent: 'center', alignItems: 'center'},
  mark: {width: 420, height: 520, justifyContent: 'center', alignItems: 'center'},
  letter: {position: 'absolute', fontSize: 470, lineHeight: 520, fontWeight: '900', textAlign: 'center', width: 420},
  depth: {color: brand.accentDeep, transform: [{translateX: 10}, {translateY: 12}]},
  face: {color: brand.accent, textShadowColor: 'rgba(123,92,255,0.9)', textShadowOffset: {width: 0, height: 0}, textShadowRadius: 40},
});
