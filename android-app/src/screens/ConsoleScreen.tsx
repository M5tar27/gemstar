import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { engine } from '../audio';
import Knob from '../components/Knob';
import Meter from '../components/Meter';
import { DEFAULT_VALUES, KNOB_DEFS, KnobId, KnobValues, PRESET_LABELS, PRESETS } from '../knobs';
import { loadKnobValues, saveKnobValues } from '../session';
import { Tier } from '../tiers';

const GROUP_TITLES: Record<string, string> = {
  chain: 'Chain', signature: 'Signature', finish: 'Finish', pitch: 'Pitch',
};
const TIER_LABEL: Record<Tier, string> = { starter: 'Starter', mix: 'Mix', unlimited: 'Unlimited' };
const DEFAULT_OUTPUT_DB = 3; // same as outputGainDb in the web app

export default function ConsoleScreen({ tier, onSignOut }: { tier: Tier; onSignOut: () => void }) {
  const [values, setValues] = useState<KnobValues>(DEFAULT_VALUES);
  const [running, setRunning] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [outDb, setOutDb] = useState(DEFAULT_OUTPUT_DB);
  const [peak, setPeak] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the last knob settings and push them into the engine.
  useEffect(() => {
    (async () => {
      const saved = await loadKnobValues();
      const v = { ...DEFAULT_VALUES, ...(saved || {}) } as KnobValues;
      setValues(v);
      engine.setKnobs(v);
      engine.setOutputGainDb(DEFAULT_OUTPUT_DB);
    })();
    return () => { engine.stop(); };
  }, []);

  const persist = useCallback((v: KnobValues) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveKnobValues(v), 400);
  }, []);

  const setKnob = useCallback((id: KnobId, v: number) => {
    engine.setKnob(id, v);
    setValues(prev => {
      const next = { ...prev, [id]: v };
      persist(next);
      return next;
    });
  }, [persist]);

  const applyPreset = (key: string) => {
    const p = PRESETS[key];
    engine.setKnobs(p);
    setValues(p);
    persist(p);
  };

  // Level meter poll while the engine runs.
  useEffect(() => {
    if (!running) { setPeak(0); return; }
    const t = setInterval(async () => { setPeak(await engine.takePeak()); }, 70);
    return () => clearInterval(t);
  }, [running]);

  const toggleRunning = async () => {
    if (running) {
      await engine.stop();
      setRunning(false);
      return;
    }
    const ok = await engine.start();
    if (!ok) {
      Alert.alert('Could not start audio',
        'Check that microphone access is allowed for Gemstar and that no other app is using the mic.');
      return;
    }
    const s = await engine.status();
    setLatency(s.latencyMs > 0 ? s.latencyMs : null);
    setRunning(true);
  };

  const changeOut = (delta: number) => {
    const next = Math.max(-12, Math.min(12, outDb + delta));
    setOutDb(next);
    engine.setOutputGainDb(next);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.logo}>GEMSTAR</Text>
        <TouchableOpacity onPress={onSignOut}>
          <Text style={styles.tier}>{TIER_LABEL[tier]} · Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[styles.startBtn, running && styles.stopBtn]} onPress={toggleRunning}>
        <Text style={styles.startText}>{running ? 'Stop' : 'Start processing mic'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        {running
          ? `Live${latency ? ` · ${latency.toFixed(0)} ms round trip` : ''}. Use headphones to avoid feedback.`
          : 'Plug in headphones first — the phone speaker will feed back into the mic.'}
      </Text>
      <View style={styles.meterRow}><Meter peak={peak} /></View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets}>
        {Object.keys(PRESETS).map(k => (
          <TouchableOpacity key={k} style={styles.pill} onPress={() => applyPreset(k)}>
            <Text style={styles.pillText}>{PRESET_LABELS[k]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {(['chain', 'signature', 'finish', 'pitch'] as const).map(group => (
        <View key={group} style={styles.group}>
          <Text style={styles.groupTitle}>{GROUP_TITLES[group]}</Text>
          <View style={styles.knobRow}>
            {KNOB_DEFS.filter(d => d.group === group).map(d => (
              <Knob key={d.id} label={d.label} color={d.color} value={values[d.id]}
                onChange={v => setKnob(d.id, v)} />
            ))}
          </View>
        </View>
      ))}

      <View style={styles.footerRow}>
        <View style={styles.footerItem}>
          <Text style={styles.groupTitle}>Output gain</Text>
          <View style={styles.stepper}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => changeOut(-1)}><Text style={styles.stepText}>−</Text></TouchableOpacity>
            <Text style={styles.stepValue}>{outDb > 0 ? '+' : ''}{outDb} dB</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => changeOut(1)}><Text style={styles.stepText}>+</Text></TouchableOpacity>
          </View>
        </View>
        <View style={styles.footerItem}>
          <Text style={styles.groupTitle}>Original (A/B)</Text>
          <Switch value={bypass} onValueChange={v => { setBypass(v); engine.setBypass(v); }}
            trackColor={{ true: '#8A6CFF', false: '#2B2345' }} thumbColor="#E9E4FF" />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0714' },
  content: { padding: 18, paddingBottom: 48 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  logo: { color: '#E9E4FF', fontSize: 22, fontWeight: '800', letterSpacing: 4 },
  tier: { color: '#8A6CFF', fontWeight: '600' },
  startBtn: { backgroundColor: '#3CF2A0', borderRadius: 14, padding: 16, alignItems: 'center' },
  stopBtn: { backgroundColor: '#FF4C6A' },
  startText: { color: '#0B0714', fontSize: 16, fontWeight: '800' },
  hint: { color: '#9C93BD', fontSize: 12, marginTop: 8, textAlign: 'center' },
  meterRow: { marginTop: 12, marginBottom: 14 },
  presets: { marginBottom: 6 },
  pill: { backgroundColor: '#1D1630', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, borderWidth: 1, borderColor: '#2B2345' },
  pillText: { color: '#E9E4FF', fontWeight: '600' },
  group: { marginTop: 14 },
  groupTitle: { color: '#6F668C', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  knobRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  footerItem: { alignItems: 'flex-start' },
  stepper: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1D1630', alignItems: 'center', justifyContent: 'center' },
  stepText: { color: '#E9E4FF', fontSize: 20 },
  stepValue: { color: '#E9E4FF', minWidth: 64, textAlign: 'center', fontWeight: '600' },
});
