// Mirrors KNOB_DEFS / DEFAULT_VALUES / PRESETS in the web app's index.html.
export type KnobId =
  | 'clean' | 'punch' | 'bass' | 'voice' | 'highs' | 'm5tar' | 'jewels'
  | 'smooth' | 'space' | 'wide' | 'radio' | 'delay' | 'tune' | 'humanize';

export type KnobValues = Record<KnobId, number>;

export interface KnobDef {
  id: KnobId;
  label: string;
  group: 'chain' | 'signature' | 'finish' | 'pitch';
  color: string;
}

export const KNOB_DEFS: KnobDef[] = [
  { id: 'clean', label: 'Clean', group: 'chain', color: '#00F5FF' },
  { id: 'punch', label: 'Punch', group: 'chain', color: '#29C9FF' },
  { id: 'bass', label: 'Bass', group: 'chain', color: '#4FD8E8' },
  { id: 'voice', label: 'Voice', group: 'chain', color: '#8A6CFF' },
  { id: 'highs', label: 'Highs', group: 'chain', color: '#FFE066' },
  { id: 'm5tar', label: 'M5tar', group: 'signature', color: '#FFC24C' },
  { id: 'jewels', label: 'Jewels', group: 'signature', color: '#3CF2A0' },
  { id: 'smooth', label: 'Smooth', group: 'finish', color: '#FF2E88' },
  { id: 'space', label: 'Space', group: 'finish', color: '#14C8B8' },
  { id: 'wide', label: 'Wide', group: 'finish', color: '#C24CFF' },
  { id: 'radio', label: 'Radio', group: 'finish', color: '#FFB020' },
  { id: 'delay', label: 'Delay', group: 'finish', color: '#FF7A45' },
  { id: 'tune', label: 'Tune', group: 'pitch', color: '#FF4CD6' },
  { id: 'humanize', label: 'Humanize', group: 'pitch', color: '#FF8FE0' },
];

export const DEFAULT_VALUES: KnobValues = {
  clean: 0, punch: 0, bass: 0, voice: 0, highs: 0, smooth: 0, tune: 0,
  space: 0, wide: 0, radio: 0, m5tar: 0, jewels: 0, humanize: 0, delay: 0,
};

export const PRESETS: Record<string, KnobValues> = {
  M5TAR_VOCAL: { clean: 45, punch: 65, bass: 55, voice: 66, highs: 20, smooth: 40, tune: 10, space: 25, wide: 15, radio: 25, m5tar: 70, jewels: 0, humanize: 15, delay: 0 },
  JEWELS_VOCAL: { clean: 35, punch: 45, bass: 26, voice: 66, highs: 35, smooth: 38, tune: 15, space: 50, wide: 45, radio: 20, m5tar: 0, jewels: 70, humanize: 20, delay: 0 },
  SINGER_STACK: { clean: 30, punch: 50, bass: 40, voice: 60, highs: 30, smooth: 40, tune: 20, space: 60, wide: 55, radio: 15, m5tar: 0, jewels: 40, humanize: 25, delay: 0 },
  RAP_CLEAN: { clean: 60, punch: 70, bass: 55, voice: 65, highs: 15, smooth: 50, tune: 10, space: 20, wide: 5, radio: 45, m5tar: 40, jewels: 0, humanize: 10, delay: 0 },
  AUTO_TUNED: { clean: 40, punch: 55, bass: 45, voice: 60, highs: 20, smooth: 45, tune: 85, space: 45, wide: 15, radio: 35, m5tar: 15, jewels: 15, humanize: 5, delay: 0 },
  RNB_SMOOTH: { clean: 35, punch: 45, bass: 50, voice: 55, highs: 25, smooth: 55, tune: 15, space: 55, wide: 35, radio: 20, m5tar: 10, jewels: 25, humanize: 30, delay: 0 },
};

export const PRESET_LABELS: Record<string, string> = {
  M5TAR_VOCAL: 'M5tar Vocal',
  JEWELS_VOCAL: 'Jewels Vocal',
  SINGER_STACK: 'Singer Stack',
  RAP_CLEAN: 'Rap Clean',
  AUTO_TUNED: 'Auto-Tuned',
  RNB_SMOOTH: 'R&B Smooth',
};
