import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { runFix } from './src/health/fix';
import type { HealthFix } from './src/health/health';
import { SAMSUNG_SETUP_STEPS } from './src/health/samsungSetup';
import { useHealth } from './src/health/useHealth';
import { pickDaylioFolder } from './src/daylio/daylioJob';
import { registerPeriodic, runPeriodic } from './src/jobs/periodicTask';
import { readJson, writeJson } from './src/lib/store';
import { PLACE_TASK_WANTED_KEY } from './src/lib/storageKeys';
import { signInWithGitHub, signOut, type SignInResult } from './src/lib/signIn';
import { ABOUT, type Point } from './src/place/nearestPlace';
import { coarseFix } from './src/place/coarseFix';
import { runPlaceTask, syncPlaceTask } from './src/place/placeTask';
import { turnOnPlaceReporting, type FirstSendAnswer } from './src/place/turnOn';
import { Button } from './src/screen/Button';
import { HealthList } from './src/screen/HealthList';
import { PrivatePlaces } from './src/screen/PrivatePlaces';
import { ACCENT, BACKGROUND, ERROR } from './src/screen/theme';

function askAtPrivatePlace(): Promise<FirstSendAnswer> {
  return new Promise((resolve) => {
    Alert.alert(
      'Private place',
      'Are you at a private place (home or family) right now?',
      [
        { text: 'Mark private first', onPress: () => resolve('mark-first') },
        { text: 'No, send', onPress: () => resolve('send') },
      ],
      { cancelable: true, onDismiss: () => resolve('mark-first') },
    );
  });
}

export default function App() {
  const { items, input, refresh } = useHealth();
  const [result, setResult] = useState<SignInResult | null>(null);
  const [locationWanted, setLocationWanted] = useState(false);
  const [running, setRunning] = useState(false);
  const [markRequest, setMarkRequest] = useState(0);

  const isSignedIn = input === null ? null : input.signedIn;
  const canTrack = input?.backgroundLocation === 'granted';

  useEffect(() => {
    readJson<boolean>(PLACE_TASK_WANTED_KEY, false).then(setLocationWanted);
  }, []);

  useEffect(() => {
    if (isSignedIn) registerPeriodic().catch(() => {});
  }, [isSignedIn]);

  useEffect(() => {
    // Only Sign out stops the task: a signed-out reading may be a lost session the task should outlive.
    if (!isSignedIn) return;
    syncPlaceTask(canTrack && locationWanted ? 'on' : 'off');
  }, [isSignedIn, canTrack, locationWanted]);

  async function handleSignIn() {
    const outcome = await signInWithGitHub();
    setResult(outcome);
    if (outcome === 'ok') {
      registerPeriodic().catch(() => {});
      await refresh();
    }
  }

  async function handleFix(fix: HealthFix) {
    if (fix === 'sign-in') await handleSignIn();
    else await runFix(fix);
    await refresh();
  }

  async function handleSignOut() {
    await syncPlaceTask('off');
    await signOut();
    setResult(null);
    await refresh();
  }

  async function handleRunNow() {
    setRunning(true);
    try {
      await runPeriodic();
      if (canTrack && locationWanted) {
        try {
          const at = await coarseFix();
          if (at) await runPlaceTask([{ coords: at }], Date.now());
        } catch {
          // A location failure must not block the rest of the run.
        }
      }
      await syncPlaceTask(canTrack && locationWanted ? 'on' : 'off');
    } finally {
      setRunning(false);
      await refresh();
    }
  }

  async function reportPlaceNow(at: Point) {
    await runPlaceTask([{ coords: at }], Date.now());
  }

  async function handleLocationSwitch(next: boolean) {
    if (next) {
      const turnedOn = await turnOnPlaceReporting(askAtPrivatePlace);
      if (!turnedOn) setMarkRequest((n) => n + 1);
      setLocationWanted(turnedOn);
    } else {
      setLocationWanted(false);
      await writeJson(PLACE_TASK_WANTED_KEY, false);
    }
    await refresh();
  }

  async function handlePickFolder() {
    await pickDaylioFolder();
    await refresh();
  }

  if (isSignedIn === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!isSignedIn) {
    return (
      <View style={styles.center}>
        <Button title="Sign in with GitHub" onPress={handleSignIn} />
        {result === 'not-allowed' && <Text style={styles.error}>This GitHub account is not allowed.</Text>}
        {result === 'error' && <Text style={styles.error}>Sign-in failed. Try again.</Text>}
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Collector</Text>
      <HealthList items={items} onFix={handleFix} />
      <Button title={running ? 'Running...' : 'Run now'} onPress={handleRunNow} disabled={running} />

      <View style={styles.switchRow}>
        <Text>Report my place</Text>
        <Switch value={canTrack && locationWanted} disabled={!canTrack} onValueChange={handleLocationSwitch} trackColor={{ true: ACCENT }} />
      </View>

      <PrivatePlaces key={markRequest} startOpen={markRequest > 0} reportPlace={canTrack && locationWanted ? reportPlaceNow : null} />
      {input?.daylioFolder && <Button title="Change Daylio folder" onPress={handlePickFolder} />}

      <Text style={styles.heading}>Setup</Text>
      {SAMSUNG_SETUP_STEPS.map((step, i) => (
        <Text key={step}>{`${i + 1}. ${step}`}</Text>
      ))}

      <Button title="Sign out" onPress={handleSignOut} />
      <Text style={styles.small}>{ABOUT}</Text>
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BACKGROUND },
  content: { padding: 20, paddingTop: 56, gap: 16 },
  center: { flex: 1, backgroundColor: BACKGROUND, alignItems: 'center', justifyContent: 'center', gap: 12 },
  title: { fontSize: 22, fontWeight: '600' },
  heading: { fontSize: 16, fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  small: { fontSize: 11, color: '#666' },
  error: { color: ERROR },
});
