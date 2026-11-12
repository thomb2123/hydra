import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {colors, fonts, spacing} from './theme';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'url' | 'numeric';
  hasTVPreferredFocus?: boolean;
}

/** Text input for the TV: OK opens the on-screen keyboard (manifest: com.amazon.inputmethod.service). */
export const TextField = ({label, value, onChangeText, onSubmit, placeholder, secure, keyboardType, hasTVPreferredFocus}: TextFieldProps) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus={hasTVPreferredFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && styles.focused]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {marginVertical: spacing.xs},
  label: {color: colors.textMuted, fontSize: fonts.small, marginBottom: 4},
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fonts.body,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: colors.surfaceRaised,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    minWidth: 640,
  },
  focused: {borderColor: colors.focus},
});
