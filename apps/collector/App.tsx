import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { signedIn } from './src/lib/supabase';
import { signInWithGitHub, signOut, type SignInResult } from './src/lib/signIn';

export default function App() {
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [result, setResult] = useState<SignInResult | null>(null);

  useEffect(() => {
    signedIn()
      .then(setIsSignedIn)
      .catch(() => setIsSignedIn(false));
  }, []);

  async function handleSignIn() {
    const outcome = await signInWithGitHub();
    setResult(outcome);
    if (outcome === 'ok') setIsSignedIn(true);
  }

  async function handleSignOut() {
    await signOut();
    setResult(null);
    setIsSignedIn(false);
  }

  return (
    <View style={styles.container}>
      {isSignedIn === null ? (
        <ActivityIndicator />
      ) : isSignedIn ? (
        <>
          <Text style={styles.title}>Collector</Text>
          <Text>Health list goes here.</Text>
          <Button title="Sign out" onPress={handleSignOut} />
        </>
      ) : (
        <>
          <Button title="Sign in with GitHub" onPress={handleSignIn} />
          {result === 'not-allowed' && <Text style={styles.error}>This GitHub account is not allowed.</Text>}
          {result === 'error' && <Text style={styles.error}>Sign-in failed. Try again.</Text>}
        </>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  error: { color: '#b00020' },
});
