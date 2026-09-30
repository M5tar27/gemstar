import React, { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

interface Props {
  label: string;
  color: string;
  value: number; // 0..100
  onChange: (v: number) => void;
}

const DRAG_RANGE_PX = 180; // full sweep for a 0 -> 100 drag
const SWEEP_DEG = 270;

/** Vertical-drag rotary knob. Double-tap resets to 0. */
export default function Knob({ label, color, value, onChange }: Props) {
  const startValue = useRef(0);
  const lastTap = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startValue.current = valueRef.current;
          const now = Date.now();
          if (now - lastTap.current < 300) onChangeRef.current(0);
          lastTap.current = now;
        },
        onPanResponderMove: (_e, g) => {
          const next = startValue.current - (g.dy / DRAG_RANGE_PX) * 100;
          onChangeRef.current(Math.max(0, Math.min(100, Math.round(next))));
        },
      }),
    [],
  );

  const angle = -SWEEP_DEG / 2 + (value / 100) * SWEEP_DEG;
  return (
    <View style={styles.wrap} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value) }}>
      <View style={[styles.dial, { borderColor: color, shadowColor: color }]}>
        <View style={[styles.pointerWrap, { transform: [{ rotate: `${angle}deg` }] }]}>
          <View style={[styles.pointer, { backgroundColor: color }]} />
        </View>
        <Text style={styles.value}>{Math.round(value)}</Text>
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 84, alignItems: 'center', marginVertical: 8 },
  dial: {
    width: 68, height: 68, borderRadius: 34, borderWidth: 3, backgroundColor: '#14101F',
    alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
  },
  pointerWrap: { position: 'absolute', width: 68, height: 68, alignItems: 'center' },
  pointer: { width: 4, height: 16, borderRadius: 2, marginTop: 5 },
  value: { color: '#E9E4FF', fontSize: 15, fontWeight: '600' },
  label: { marginTop: 6, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
});
