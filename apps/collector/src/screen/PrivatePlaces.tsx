import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { coarseFix } from '../place/coarseFix';
import type { Point } from '../place/nearestPlace';
import { addPrivatePlace, loadPrivatePlaces, removePrivatePlace } from '../place/privatePlaces';
import { Button } from './Button';
import { ERROR } from './theme';

/** reportPlace is null while place reporting is off; otherwise a change re-sends the place so the site updates now. */
export function PrivatePlaces({ reportPlace }: { reportPlace: ((at: Point) => Promise<void>) | null }) {
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
    let at: Point | null;
    try {
      at = await coarseFix();
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
      return;
    }
    await sendQuietly(at);
  }

  async function sendQuietly(at: Point) {
    try {
      await reportPlace?.(at);
    } catch {
      // The next background wake or Run now sends the place instead.
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
    if (!reportPlace) return;
    const at = await coarseFix().catch(() => null);
    if (at) await sendQuietly(at);
  }

  return (
    <View style={styles.box}>
      <Text style={styles.heading}>Private places</Text>
      {!reportPlace && labels.length === 0 && <Text>Mark home as private before you turn this on.</Text>}
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
