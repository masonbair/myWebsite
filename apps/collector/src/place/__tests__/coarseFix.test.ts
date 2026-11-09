import * as Location from 'expo-location';
import { coarseFix } from '../coarseFix';

jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1 },
  requestForegroundPermissionsAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const current = Location.getCurrentPositionAsync as jest.Mock;
const lastKnown = Location.getLastKnownPositionAsync as jest.Mock;
const LISBON = { coords: { latitude: 38.72, longitude: -9.14, accuracy: 3000 } };
const LONDON = { coords: { latitude: 51.5, longitude: -0.12, accuracy: 3000 } };

beforeEach(() => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  current.mockReset();
  lastKnown.mockReset().mockResolvedValue(null);
});

afterEach(() => jest.useRealTimers());

it('returns a lowest-accuracy fix with only latitude and longitude', async () => {
  current.mockResolvedValue(LISBON);
  expect(await coarseFix()).toEqual({ latitude: 38.72, longitude: -9.14 });
  expect(current).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Lowest });
  expect(lastKnown).not.toHaveBeenCalled();
});

it('returns null without asking for a position when location is refused', async () => {
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  expect(await coarseFix()).toBeNull();
  expect(current).not.toHaveBeenCalled();
});

it('gives up on a slow fix after 20 seconds and uses a last-known position under 30 minutes old', async () => {
  jest.useFakeTimers();
  current.mockReturnValue(new Promise(() => {}));
  lastKnown.mockResolvedValue(LONDON);
  const result = coarseFix();
  await jest.advanceTimersByTimeAsync(19_999);
  expect(lastKnown).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({ latitude: 51.5, longitude: -0.12 });
  expect(lastKnown).toHaveBeenCalledWith({ maxAge: 30 * 60_000 });
});

it('falls back to the last-known position when the fix fails', async () => {
  current.mockRejectedValue(new Error('no provider'));
  lastKnown.mockResolvedValue(LONDON);
  expect(await coarseFix()).toEqual({ latitude: 51.5, longitude: -0.12 });
});

it('returns null when neither a fix nor a recent last-known position exists', async () => {
  jest.useFakeTimers();
  current.mockReturnValue(new Promise(() => {}));
  const result = coarseFix();
  await jest.advanceTimersByTimeAsync(20_000);
  expect(await result).toBeNull();
  lastKnown.mockRejectedValue(new Error('x'));
  current.mockRejectedValue(new Error('x'));
  expect(await coarseFix()).toBeNull();
});

it('with ask false only checks the permission, so a background run never prompts', async () => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  current.mockResolvedValue(LISBON);
  expect(await coarseFix({ ask: false })).toEqual({ latitude: 38.72, longitude: -9.14 });
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  expect(await coarseFix({ ask: false })).toBeNull();
});

it('with fallback false never uses a last-known position', async () => {
  jest.useFakeTimers();
  current.mockReturnValue(new Promise(() => {}));
  lastKnown.mockResolvedValue(LONDON);
  const result = coarseFix({ fallback: false });
  await jest.advanceTimersByTimeAsync(20_000);
  expect(await result).toBeNull();
  current.mockRejectedValue(new Error('no provider'));
  expect(await coarseFix({ fallback: false })).toBeNull();
  expect(lastKnown).not.toHaveBeenCalled();
});
