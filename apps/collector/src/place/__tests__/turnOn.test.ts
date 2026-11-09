import AsyncStorage from '@react-native-async-storage/async-storage';
import { addPrivatePlace } from '../privatePlaces';
import { syncPlaceTask } from '../placeTask';
import { turnOnPlaceReporting } from '../turnOn';

jest.mock('../placeTask', () => ({ syncPlaceTask: jest.fn() }));

const sync = syncPlaceTask as jest.Mock;
const wanted = async () => JSON.parse((await AsyncStorage.getItem('place-task-wanted')) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
  sync.mockReset().mockResolvedValue(undefined);
});

describe('turnOnPlaceReporting', () => {
  it('asks first with no private places and sends nothing for "mark first"', async () => {
    const ask = jest.fn().mockResolvedValue('mark-first');
    expect(await turnOnPlaceReporting(ask)).toBe(false);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await wanted()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
  });

  it('turns on and starts the task after "No, send"', async () => {
    expect(await turnOnPlaceReporting(jest.fn().mockResolvedValue('send'))).toBe(true);
    expect(await wanted()).toBe(true);
    expect(sync).toHaveBeenCalledWith('on');
  });

  it('does not ask when a private place exists', async () => {
    await addPrivatePlace('Home', { latitude: 1, longitude: 2 });
    const ask = jest.fn();
    expect(await turnOnPlaceReporting(ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(await wanted()).toBe(true);
    expect(sync).toHaveBeenCalledWith('on');
  });
});
