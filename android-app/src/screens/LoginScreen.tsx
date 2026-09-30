import React, { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { checkAccess, verifyCode } from '../api';
import { SIGNUP_URL } from '../config';
import { Tier } from '../tiers';

interface Props {
  deviceId: string;
  onSignedIn: (token: string, tier: Tier) => void;
}

export default function LoginScreen({ deviceId, onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsSub, setNeedsSub] = useState(false);

  const sendCode = async () => {
    if (!email.includes('@')) { setMessage('Enter the email you subscribed with.'); return; }
    setBusy(true); setMessage(null); setNeedsSub(false);
    const r = await checkAccess(email);
    setBusy(false);
    if (r.kind === 'granted') onSignedIn(r.token, r.tier);
    else if (r.kind === 'code_sent') { setChallenge(r.challenge); setMessage('We emailed you a 6-digit code.'); }
    else if (r.kind === 'no_subscription') { setNeedsSub(true); setMessage('No active Gemstar subscription found for that email.'); }
    else setMessage(r.message);
  };

  const submitCode = async () => {
    if (!challenge) return;
    setBusy(true); setMessage(null);
    const r = await verifyCode(challenge, code, deviceId);
    setBusy(false);
    if (r.ok) onSignedIn(r.token, r.tier);
    else setMessage(r.message);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.logo}>GEMSTAR</Text>
      <Text style={styles.sub}>Sign in with your subscription email</Text>

      <TextInput
        style={styles.input} placeholder="you@email.com" placeholderTextColor="#6F668C"
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
        value={email} onChangeText={setEmail} editable={!busy && !challenge}
      />
      {challenge && (
        <TextInput
          style={styles.input} placeholder="6-digit code" placeholderTextColor="#6F668C"
          keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} editable={!busy}
        />
      )}

      <TouchableOpacity style={styles.button} onPress={challenge ? submitCode : sendCode} disabled={busy}>
        {busy ? <ActivityIndicator color="#0B0714" /> : <Text style={styles.buttonText}>{challenge ? 'Verify' : 'Email me a code'}</Text>}
      </TouchableOpacity>

      {challenge && (
        <TouchableOpacity onPress={() => { setChallenge(null); setCode(''); setMessage(null); }}>
          <Text style={styles.link}>Use a different email</Text>
        </TouchableOpacity>
      )}
      {message && <Text style={styles.message}>{message}</Text>}
      {needsSub && (
        <TouchableOpacity onPress={() => Linking.openURL(SIGNUP_URL)}>
          <Text style={styles.link}>Subscribe on gemstaraudio.com</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0714', padding: 28, justifyContent: 'center' },
  logo: { color: '#E9E4FF', fontSize: 34, fontWeight: '800', letterSpacing: 6, textAlign: 'center' },
  sub: { color: '#9C93BD', textAlign: 'center', marginTop: 8, marginBottom: 32 },
  input: { backgroundColor: '#14101F', color: '#E9E4FF', borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2B2345' },
  button: { backgroundColor: '#3CF2A0', borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#0B0714', fontWeight: '800', fontSize: 16 },
  link: { color: '#8A6CFF', textAlign: 'center', marginTop: 16, fontWeight: '600' },
  message: { color: '#FFC24C', textAlign: 'center', marginTop: 16 },
});
