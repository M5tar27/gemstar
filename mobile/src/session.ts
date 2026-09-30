import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_KEY = 'gemstar_device_id';
const TOKEN_KEY = 'gemstar_access_token';

function randomId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `and-${hex()}${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
}

/** Stable per-install ID; the backend caps an account at 3 devices by this. */
export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = randomId();
    await AsyncStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export const loadToken = () => AsyncStorage.getItem(TOKEN_KEY);
export const saveToken = (t: string) => AsyncStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => AsyncStorage.removeItem(TOKEN_KEY);

const KNOBS_KEY = 'gemstar_knob_values';
export async function loadKnobValues(): Promise<Record<string, number> | null> {
  try {
    const raw = await AsyncStorage.getItem(KNOBS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export const saveKnobValues = (v: Record<string, number>) =>
  AsyncStorage.setItem(KNOBS_KEY, JSON.stringify(v)).catch(() => {});
