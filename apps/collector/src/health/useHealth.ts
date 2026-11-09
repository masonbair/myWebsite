import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { collectHealth, evaluateHealth, type HealthInput, type HealthItem } from './health';

export type HealthState = { items: HealthItem[]; input: HealthInput | null; refresh: () => Promise<void> };

/** Reads the phone's health now, again whenever the app returns to the front, and on demand. */
export function useHealth(): HealthState {
  const [input, setInput] = useState<HealthInput | null>(null);

  const refresh = useCallback(async () => {
    setInput(await collectHealth());
  }, []);

  useEffect(() => {
    let live = true;
    const load = () =>
      collectHealth().then(
        (next) => live && setInput(next),
        () => {},
      );
    load();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const items = input ? evaluateHealth(input) : [];
  return { items, input, refresh };
}
