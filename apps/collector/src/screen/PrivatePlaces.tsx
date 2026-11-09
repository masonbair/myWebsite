import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { addPrivatePlace, loadPrivatePlaces, removePrivatePlace } from '../place/privatePlaces';
import { Button } from './HealthList';
import { ERROR } from './theme';

/** One coarse fix, used once and dropped: only addPrivatePlace stores it. */
async function coarseFix(): Promise<{ latitude: number; longitude: number } | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
  return { latitude: coords.latitude, longitude: coords.longitude };
}

export function PrivatePlaces() {
  const [labels, setLabels] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLabels((await loadPrivatePlaces()).map((p) => p.label));
  }, []);

  useEffect(() => {
    let live = true;
    loadPrivatePlaces().then((places) => live && setLabels(places.map((p) => p.label)));
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    const name = label.trim();
    if (!name) return;
    setError(null);
    try {
      const at = await coarseFix();
      if (!at) {
        setError('Location permission is needed to mark this place.');
        return;
      }
      await addPrivatePlace(name, at);
      setAsking(false);
      setLabel('');
      await reload();
    } catch {
      setError('Could not get your location. Try again.');
    }
  }

  async function remove(name: string) {
    await removePrivatePlace(name);
    await reload();
  }

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>Private places</Text>
      {labels.map((name) => (
        <View key={name} style={styles.row}>
          <Text>{name}</Text>
          <Button title={`Remove ${name}`} onPress={() => remove(name)} />
        </View>
      ))}
      {asking ? (
        <>
          <TextInput placeholder="Name for this place" value={label} onChangeText={setLabel} style={styles.input} />
          <Button title="Save place" onPress={save} />
        </>
      ) : (
        <Button title="Mark this place private" onPress={() => setAsking(true)} />
      )}
      {error && <Text style={{ color: ERROR }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  heading: { fontSize: 16, fontWeight: '600' },
  row: { gap: 6 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, backgroundColor: '#fff' },
});
