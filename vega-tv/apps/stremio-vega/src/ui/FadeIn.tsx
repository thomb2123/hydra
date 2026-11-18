// A short fade whenever `token` changes (a new screen, or returning to one), so
// screens arrive smoothly instead of popping in. The children are never remounted.
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleProp, ViewStyle} from 'react-native';

export const FadeIn = ({token, duration = 170, style, children}: {token: string; duration?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode}) => {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    opacity.setValue(0.35);
    const animation = Animated.timing(opacity, {toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: false});
    animation.start();
    return () => animation.stop();
  }, [token, duration, opacity]);
  return <Animated.View style={[style, {opacity}]}>{children}</Animated.View>;
};
