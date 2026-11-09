import AsyncStorage from '@react-native-async-storage/async-storage';
import { readJson, writeJson } from '../store';

beforeEach(() => AsyncStorage.clear());

describe('store', () => {
  it('returns the fallback for a missing key', async () => {
    expect(await readJson('missing', [])).toEqual([]);
  });

  it('returns the fallback for corrupt JSON', async () => {
    await AsyncStorage.setItem('bad', '{not json');
    expect(await readJson('bad', { ok: true })).toEqual({ ok: true });
  });

  it('round-trips a value', async () => {
    await writeJson('k', { a: [1, 2] });
    expect(await readJson('k', null)).toEqual({ a: [1, 2] });
  });
});
