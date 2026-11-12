// Small JSON wrapper around Vega's persistent AsyncStorage. Everything an app
// must remember across restarts (sign-in tokens, server addresses, resume
// positions) goes through here so it can be inspected in one place.
import {AsyncStorage} from '@amazon-devices/react-native-kepler';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJson(key: string, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing to remove.
  }
}
