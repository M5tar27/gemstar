import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { KnobId, KnobValues } from './knobs';

interface GemstarAudioNative {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  setKnob(id: string, value: number): void;
  setKnobs(values: Record<string, number>): void;
  setBypass(bypass: boolean): void;
  setOutputGainDb(db: number): void;
  setScaleMask(mask: number): void;
  getStatus(): Promise<{ running: boolean; sampleRate: number; latencyMs: number }>;
  takePeak(): Promise<number>;
}

const native: GemstarAudioNative = NativeModules.GemstarAudio;

export async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone access',
    message: 'Gemstar needs your microphone to process your voice in real time.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export const engine = {
  async start(): Promise<boolean> {
    if (!(await ensureMicPermission())) return false;
    return native.start();
  },
  stop: () => native.stop(),
  setKnob: (id: KnobId, v: number) => native.setKnob(id, v),
  setKnobs: (vals: KnobValues) => native.setKnobs(vals),
  setBypass: (b: boolean) => native.setBypass(b),
  setOutputGainDb: (db: number) => native.setOutputGainDb(db),
  setScaleMask: (mask: number) => native.setScaleMask(mask),
  status: () => native.getStatus(),
  takePeak: () => native.takePeak(),
};
