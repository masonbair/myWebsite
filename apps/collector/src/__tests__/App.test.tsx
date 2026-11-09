import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { Alert } from 'react-native';
import App from '../../App';
import { pickDaylioFolder } from '../daylio/daylioJob';
import { runFix } from '../health/fix';
import { collectHealth, type HealthInput } from '../health/health';
import { runPeriodic, registerPeriodic } from '../jobs/periodicTask';
import { signInWithGitHub, signOut } from '../lib/signIn';
import { runPlaceTask, syncPlaceTask } from '../place/placeTask';

jest.mock('../lib/supabase', () => ({ supabase: {}, signedIn: jest.fn() }));
jest.mock('../../modules/battery-status', () => ({
  isIgnoringBatteryOptimizations: jest.fn(),
  standbyBucket: jest.fn(),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  Accuracy: { Lowest: 1, Balanced: 3 },
}));
jest.mock('../health/health', () => ({ ...jest.requireActual('../health/health'), collectHealth: jest.fn() }));
jest.mock('../health/fix', () => ({ runFix: jest.fn() }));
jest.mock('../daylio/daylioJob', () => ({ pickDaylioFolder: jest.fn() }));
jest.mock('../jobs/periodicTask', () => ({ runPeriodic: jest.fn(), registerPeriodic: jest.fn() }));
jest.mock('../place/placeTask', () => ({ syncPlaceTask: jest.fn(), runPlaceTask: jest.fn() }));
jest.mock('../lib/signIn', () => ({ signInWithGitHub: jest.fn(), signOut: jest.fn() }));

const NOW = Date.now();
const HOUR = 3_600_000;
const good: HealthInput = {
  signedIn: true,
  backgroundLocation: 'granted',
  photosAccess: 'all',
  daylioFolder: true,
  batteryUnrestricted: true,
  standbyBucket: 10,
  placeWanted: true,
  lastOk: { place: NOW - HOUR, photos: NOW - 2 * HOUR, daylio: NOW - 3 * 60_000 },
  now: NOW,
};
const collect = collectHealth as jest.Mock;

async function show(input: HealthInput = good) {
  collect.mockResolvedValue(input);
  await render(<App />);
  await waitFor(() => expect(screen.queryByText('Collector')).not.toBeNull());
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('place-task-wanted', 'true');
  (runFix as jest.Mock).mockResolvedValue(true);
  (runPeriodic as jest.Mock).mockResolvedValue(undefined);
  (registerPeriodic as jest.Mock).mockResolvedValue(undefined);
  (syncPlaceTask as jest.Mock).mockResolvedValue(undefined);
  (signOut as jest.Mock).mockResolvedValue(undefined);
});

it('shows a healthy screen with the three last-run ages, setup steps and credit', async () => {
  await show();
  expect(screen.getByText('Everything is running')).toBeTruthy();
  expect(screen.getByText('Place: last report 1 hour ago')).toBeTruthy();
  expect(screen.getByText('Photos: last upload 2 hours ago')).toBeTruthy();
  expect(screen.getByText('Daylio: last check 3 minutes ago')).toBeTruthy();
  expect(screen.getByText(/^1\. Open Settings/)).toBeTruthy();
  expect(screen.getByText(/GeoNames/)).toBeTruthy();
  expect(registerPeriodic).toHaveBeenCalled();
});

it('lists a failing item first with its fix button, and pressing it runs the fix', async () => {
  await show({ ...good, batteryUnrestricted: false });
  expect(screen.queryByText('Everything is running')).toBeNull();
  expect(screen.getAllByText(/./)[1].props.children).toBe('Battery: set the app to unrestricted');
  await fireEvent.press(screen.getByText('Open battery settings'));
  await waitFor(() => expect(runFix).toHaveBeenCalledWith('battery-optimization'));
});

it('signs in from the signed-out screen and registers the periodic task', async () => {
  collect.mockResolvedValue({ ...good, signedIn: false });
  (signInWithGitHub as jest.Mock).mockImplementation(async () => {
    collect.mockResolvedValue(good);
    return 'ok';
  });
  await render(<App />);
  await fireEvent.press(await screen.findByText('Sign in with GitHub'));
  await waitFor(() => expect(screen.queryByText('Collector')).not.toBeNull());
  expect(registerPeriodic).toHaveBeenCalled();
});

it('first launch leaves place reporting off: the task never starts and nothing is sent', async () => {
  await AsyncStorage.clear();
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 38.7223, longitude: -9.1393 } });
  await show();
  await waitFor(() => expect(syncPlaceTask).toHaveBeenCalledWith('off'));
  expect(screen.getByRole('switch').props.value).toBe(false);
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(runPeriodic).toHaveBeenCalled());
  expect(syncPlaceTask).not.toHaveBeenCalledWith('on');
  expect(runPlaceTask).not.toHaveBeenCalled();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});

it('hints to mark home private while reporting is off and no private place exists', async () => {
  const hint = 'Mark home as private before you turn this on.';
  await AsyncStorage.clear();
  await show();
  expect(await screen.findByText(hint)).toBeTruthy();
  const ask = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.text === 'No, send')?.onPress?.();
  });
  await fireEvent(screen.getByRole('switch'), 'valueChange', true);
  await waitFor(() => expect(screen.queryByText(hint)).toBeNull());
  ask.mockRestore();
});

describe('first-send question', () => {
  const answer = (text: string) =>
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === text)?.onPress?.();
    });

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('asks before turning on with no private places; "Mark private first" keeps it off and opens the form', async () => {
    const ask = answer('Mark private first');
    await show();
    await waitFor(() => expect(syncPlaceTask).toHaveBeenCalledWith('off'));
    (syncPlaceTask as jest.Mock).mockClear();
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
    await screen.findByPlaceholderText('Name for this place');
    expect(ask).toHaveBeenCalledWith('Private place', 'Are you at a private place (home or family) right now?', expect.any(Array), expect.anything());
    expect(screen.getByRole('switch').props.value).toBe(false);
    expect(await AsyncStorage.getItem('place-task-wanted')).toBeNull();
    expect(syncPlaceTask).not.toHaveBeenCalledWith('on');
    expect(runPlaceTask).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  it('"No, send" stores the choice and starts the task', async () => {
    const ask = answer('No, send');
    await show();
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByRole('switch').props.value).toBe(true));
    expect(await AsyncStorage.getItem('place-task-wanted')).toBe('true');
    expect(syncPlaceTask).toHaveBeenCalledWith('on');
    ask.mockRestore();
  });

  it('does not ask when a private place exists', async () => {
    const ask = jest.spyOn(Alert, 'alert');
    await AsyncStorage.setItem('private-places', JSON.stringify([{ label: 'test-a', latitude: 1, longitude: 1, radiusKm: 25 }]));
    await show();
    await screen.findByText('test-a');
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByRole('switch').props.value).toBe(true));
    expect(ask).not.toHaveBeenCalled();
    ask.mockRestore();
  });
});

it('shows no hint once a private place exists', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('private-places', JSON.stringify([{ label: 'test-a', latitude: 1, longitude: 1, radiusKm: 25 }]));
  await show();
  await screen.findByText('test-a');
  expect(screen.queryByText(/Mark home as private/)).toBeNull();
});

it('a signed-out reading does not stop the place task; only Sign out does', async () => {
  collect.mockResolvedValue({ ...good, signedIn: false });
  await render(<App />);
  await screen.findByText('Sign in with GitHub');
  expect(syncPlaceTask).not.toHaveBeenCalled();
});

it('Sign out stops the place task before signing out', async () => {
  await show();
  (syncPlaceTask as jest.Mock).mockClear();
  await fireEvent.press(screen.getByText('Sign out'));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(syncPlaceTask).toHaveBeenCalledWith('off');
  expect((syncPlaceTask as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((signOut as jest.Mock).mock.invocationCallOrder[0]);
});

it('Run now runs the periodic job and the place sync, then refreshes health', async () => {
  await show();
  const before = collect.mock.calls.length;
  (syncPlaceTask as jest.Mock).mockClear();
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(collect.mock.calls.length).toBeGreaterThan(before));
  expect(runPeriodic).toHaveBeenCalled();
  expect(syncPlaceTask).toHaveBeenCalledWith('on');
});

it('Run now cannot start a second run while one is going', async () => {
  let finish: () => void = () => {};
  (runPeriodic as jest.Mock).mockReturnValue(new Promise<void>((r) => { finish = r; }));
  await show();
  const first = fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(runPeriodic).toHaveBeenCalledTimes(1));
  const button = screen.getByRole('button', { name: 'Running...' });
  expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  const second = fireEvent.press(button);
  finish();
  await Promise.all([first, second]);
  expect(runPeriodic).toHaveBeenCalledTimes(1);
  await screen.findByText('Run now');
});

it('Run now sends one coarse place report when tracking is allowed and wanted', async () => {
  const fix = { coords: { latitude: 38.7223, longitude: -9.1393 } };
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fix);
  await show();
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(runPlaceTask).toHaveBeenCalledTimes(1));
  expect((runPlaceTask as jest.Mock).mock.calls[0][0]).toEqual([{ coords: fix.coords }]);
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Lowest });
});

it('Run now sends no place report when not allowed or switched off, and survives a location failure', async () => {
  await show({ ...good, backgroundLocation: 'denied' });
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(runPeriodic).toHaveBeenCalled());
  expect(runPlaceTask).not.toHaveBeenCalled();
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
});

it('Run now still finishes when the location fix fails', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockRejectedValue(new Error('x'));
  await show();
  const before = collect.mock.calls.length;
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(collect.mock.calls.length).toBeGreaterThan(before));
  expect(runPlaceTask).not.toHaveBeenCalled();
});

it('Run now sends no place report when the switch is off', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  await show();
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
  await fireEvent.press(screen.getByText('Run now'));
  await waitFor(() => expect(runPeriodic).toHaveBeenCalled());
  expect(runPlaceTask).not.toHaveBeenCalled();
});

it('the location switch stops and starts the place task', async () => {
  await show();
  await waitFor(() => expect(syncPlaceTask).toHaveBeenCalledWith('on'));
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
  await waitFor(() => expect(syncPlaceTask).toHaveBeenLastCalledWith('off'));
});

it('does not offer the location task before background location is granted', async () => {
  await show({ ...good, backgroundLocation: 'denied' });
  await waitFor(() => expect(syncPlaceTask).toHaveBeenCalledWith('off'));
  expect(syncPlaceTask).not.toHaveBeenCalledWith('on');
});

it('marks a place private with one coarse fix and shows only its label', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 38.7223, longitude: -9.1393 } });
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText((await screen.findByPlaceholderText('Name for this place')), 'Lisbon flat');
  await fireEvent.press(screen.getByText('Save place'));
  await screen.findByText('Lisbon flat');
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Lowest });
  expect(screen.queryByText(/38\.72|9\.13/)).toBeNull();

  await fireEvent.press(screen.getByText('Remove Lisbon flat'));
  await waitFor(() => expect(screen.queryByText('Lisbon flat')).toBeNull());
});

it('marking a place private re-sends the place at once with the same fix, and so does removing one', async () => {
  const at = { latitude: 38.7223, longitude: -9.1393 };
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: at });
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Name for this place'), 'test-a');
  await fireEvent.press(screen.getByText('Save place'));
  await waitFor(() => expect(runPlaceTask).toHaveBeenCalledTimes(1));
  expect((runPlaceTask as jest.Mock).mock.calls[0][0]).toEqual([{ coords: at }]);
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  expect(JSON.parse((await AsyncStorage.getItem('private-places'))!)).toHaveLength(1);

  await fireEvent.press(screen.getByText('Remove test-a'));
  await waitFor(() => expect(runPlaceTask).toHaveBeenCalledTimes(2));
  expect((runPlaceTask as jest.Mock).mock.calls[1][0]).toEqual([{ coords: at }]);
  expect(JSON.parse((await AsyncStorage.getItem('private-places'))!)).toEqual([]);
});

it('a failed re-send still keeps the new private place and shows no location error', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 38.7223, longitude: -9.1393 } });
  (runPlaceTask as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Name for this place'), 'test-a');
  await fireEvent.press(screen.getByText('Save place'));
  await screen.findByText('Remove test-a');
  await waitFor(() => expect(runPlaceTask).toHaveBeenCalled());
  expect(screen.queryByText(/Could not get your location/)).toBeNull();
});

it('changing private places sends nothing while reporting is off', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 38.7223, longitude: -9.1393 } });
  await AsyncStorage.setItem('place-task-wanted', 'false');
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Name for this place'), 'test-a');
  await fireEvent.press(screen.getByText('Save place'));
  await fireEvent.press(await screen.findByText('Remove test-a'));
  await waitFor(() => expect(screen.queryByText('test-a')).toBeNull());
  expect(runPlaceTask).not.toHaveBeenCalled();
  expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
});

it('marking a place private uses only a fresh fix: no fix means nothing saved, nothing sent', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('timed out'));
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.12 } });
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText(await screen.findByPlaceholderText('Name for this place'), 'test-a');
  await fireEvent.press(screen.getByText('Save place'));
  await screen.findByText('Could not get your location. Try again outside or in a minute.');
  expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  expect(screen.queryByText('Remove test-a')).toBeNull();
  expect(await AsyncStorage.getItem('private-places')).toBeNull();
  expect(runPlaceTask).not.toHaveBeenCalled();
});

it('asks for permission and saves nothing when location is refused', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  await show();
  await fireEvent.press(screen.getByText('Mark this place private'));
  await fireEvent.changeText((await screen.findByPlaceholderText('Name for this place')), 'Cabin');
  await fireEvent.press(screen.getByText('Save place'));
  await screen.findByText(/permission is needed/);
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  expect(screen.queryByText('Remove Cabin')).toBeNull();
});

it('offers one Choose Daylio folder button while no folder is set', async () => {
  (runFix as jest.Mock).mockClear();
  await show({ ...good, daylioFolder: false });
  expect(screen.getAllByText('Choose Daylio folder')).toHaveLength(1);
  expect(screen.queryByText('Change Daylio folder')).toBeNull();
  await fireEvent.press(screen.getByText('Choose Daylio folder'));
  await waitFor(() => expect(runFix).toHaveBeenCalledWith('pick-folder'));
});

it('changes the Daylio folder and signs out', async () => {
  (pickDaylioFolder as jest.Mock).mockResolvedValue(true);
  await show();
  expect(screen.queryByText('Choose Daylio folder')).toBeNull();
  await fireEvent.press(screen.getByText('Change Daylio folder'));
  await waitFor(() => expect(pickDaylioFolder).toHaveBeenCalled());
  await fireEvent.press(screen.getByText('Sign out'));
  expect(signOut).toHaveBeenCalled();
});
