import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { coarseFix } from '../place/coarseFix';
import { addPrivatePlace, loadPrivatePlaces, removePrivatePlace } from '../place/privatePlaces';
import { Button } from './Button';
import { ERROR } from './theme';

export function PrivatePlaces() {
  const [labels, setLabels] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLabels((await loadPrivatePlaces()).map((p) => p.label));
  }

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

  function cancel() {
    setAsking(false);
    setLabel('');
    setError(null);
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
          <Button title="Cancel" onPress={cancel} />
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
