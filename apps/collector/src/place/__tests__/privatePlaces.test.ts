import AsyncStorage from '@react-native-async-storage/async-storage';
import { addPrivatePlace, loadPrivatePlaces, removePrivatePlace } from '../privatePlaces';

const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const BERLIN = { latitude: 52.52, longitude: 13.405 };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('private places', () => {
  it('starts empty', async () => {
    expect(await loadPrivatePlaces()).toEqual([]);
  });

  it('round-trips with the default radius of 25 km', async () => {
    await addPrivatePlace('test-a', PARIS);
    expect(await loadPrivatePlaces()).toEqual([{ label: 'test-a', ...PARIS, radiusKm: 25 }]);
  });

  it('keeps a custom radius', async () => {
    await addPrivatePlace('test-a', PARIS, 5);
    expect((await loadPrivatePlaces())[0].radiusKm).toBe(5);
  });

  it('replaces a place that has the same label', async () => {
    await addPrivatePlace('test-a', PARIS);
    await addPrivatePlace('test-a', BERLIN);
    expect(await loadPrivatePlaces()).toEqual([{ label: 'test-a', ...BERLIN, radiusKm: 25 }]);
  });

  it('removes by label and leaves the others', async () => {
    await addPrivatePlace('test-a', PARIS);
    await addPrivatePlace('test-b', BERLIN);
    await removePrivatePlace('test-a');
    expect((await loadPrivatePlaces()).map((p) => p.label)).toEqual(['test-b']);
  });

  it('stores only under the private-places key', async () => {
    await addPrivatePlace('test-a', PARIS);
    expect(await AsyncStorage.getAllKeys()).toEqual(['private-places']);
  });
});
