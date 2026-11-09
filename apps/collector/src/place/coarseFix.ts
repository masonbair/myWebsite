import * as Location from 'expo-location';
import type { Point } from './nearestPlace';

// A phone indoors can wait minutes for a fix; nobody should watch Run now spin that long.
const FIX_TIMEOUT_MS = 20_000;
const LAST_KNOWN_MAX_AGE_MS = 30 * 60_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One low-accuracy fix, never fine; a recent last-known position if no fix comes in time.
 * Null when location is not allowed or neither exists. ask false never prompts (for background runs);
 * fallback false never uses a last-known position (it may be from somewhere else).
 */
export async function coarseFix({ ask = true, fallback = true }: { ask?: boolean; fallback?: boolean } = {}): Promise<Point | null> {
  const { status } = await (ask ? Location.requestForegroundPermissionsAsync() : Location.getForegroundPermissionsAsync());
  if (status !== 'granted') return null;
  const position =
    (await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }), FIX_TIMEOUT_MS).catch(() => null)) ??
    (fallback ? await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS }).catch(() => null) : null);
  return position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : null;
}
