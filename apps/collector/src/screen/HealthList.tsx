import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HealthFix, HealthItem } from '../health/health';
import { ACCENT, ERROR } from './theme';

const FIX_LABEL: Record<HealthFix, string> = {
  'app-settings': 'Open app settings',
  'battery-optimization': 'Open battery settings',
  'pick-folder': 'Choose Daylio folder',
  'sign-in': 'Sign in with GitHub',
  'grant-location': 'Allow location all the time',
  'grant-photos': 'Allow all photos',
};

export function Button({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

export function HealthList({ items, onFix }: { items: HealthItem[]; onFix: (fix: HealthFix) => void }) {
  const sorted = [...items].sort((a, b) => Number(a.ok) - Number(b.ok));
  const allOk = sorted.length > 0 && sorted.every((i) => i.ok);
  return (
    <View style={styles.list}>
      {allOk && <Text style={styles.good}>Everything is running</Text>}
      {sorted.map((item) => (
        <View key={item.key} style={styles.row}>
          <Text style={item.ok ? styles.ok : styles.bad}>{item.label}</Text>
          {item.fix && <Button title={FIX_LABEL[item.fix]} onPress={() => onFix(item.fix as HealthFix)} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  row: { gap: 6 },
  good: { fontSize: 18, fontWeight: '600', color: ACCENT },
  ok: { color: '#333' },
  bad: { color: ERROR, fontWeight: '600' },
  button: { backgroundColor: ACCENT, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignSelf: 'flex-start' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
