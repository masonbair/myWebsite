import { Pressable, StyleSheet, Text } from 'react-native';
import { ACCENT } from './theme';

export function Button({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: ACCENT, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, alignSelf: 'flex-start' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
});
