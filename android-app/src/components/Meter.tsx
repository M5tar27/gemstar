import React from 'react';
import { StyleSheet, View } from 'react-native';

/** Horizontal output level bar; peak is linear 0..1. */
export default function Meter({ peak }: { peak: number }) {
  const db = peak > 0.0001 ? 20 * Math.log10(peak) : -60;
  const pct = Math.max(0, Math.min(1, (db + 48) / 48));
  const hot = peak > 0.95;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, hot ? styles.hot : styles.ok, { width: `${pct * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: 5, backgroundColor: '#241C38', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  ok: { backgroundColor: '#3CF2A0' },
  hot: { backgroundColor: '#FF4C6A' },
});
