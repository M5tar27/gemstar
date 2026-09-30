import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { readTokenLocally, verifyToken } from './src/api';
import ConsoleScreen from './src/screens/ConsoleScreen';
import LoginScreen from './src/screens/LoginScreen';
import { clearToken, getDeviceId, loadToken, saveToken } from './src/session';
import { Tier } from './src/tiers';

type Phase = { name: 'loading' } | { name: 'login' } | { name: 'console'; tier: Tier };

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });

  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
      const token = await loadToken();
      if (!token) { setPhase({ name: 'login' }); return; }
      const r = await verifyToken(token, id);
      if (r.status === 'valid') { setPhase({ name: 'console', tier: r.tier }); return; }
      if (r.status === 'offline') {
        // No connection: a stored, unexpired token still unlocks the on-device processing.
        const local = readTokenLocally(token);
        if (local && local.expiresAt > Date.now()) { setPhase({ name: 'console', tier: local.tier }); return; }
      }
      await clearToken();
      setPhase({ name: 'login' });
    })();
  }, []);

  const onSignedIn = useCallback(async (token: string, tier: Tier) => {
    await saveToken(token);
    setPhase({ name: 'console', tier });
  }, []);

  const onSignOut = useCallback(async () => {
    await clearToken();
    setPhase({ name: 'login' });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.root}>
        {phase.name === 'loading' || !deviceId ? (
          <ActivityIndicator style={styles.center} color="#8A6CFF" size="large" />
        ) : phase.name === 'login' ? (
          <LoginScreen deviceId={deviceId} onSignedIn={onSignedIn} />
        ) : (
          <ConsoleScreen tier={phase.tier} onSignOut={onSignOut} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0714' },
  center: { flex: 1 },
});
