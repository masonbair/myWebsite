import * as Location from 'expo-location';
import type { Point } from './nearestPlace';

/** One low-accuracy fix, never fine. Null when location is not allowed. */
export async function coarseFix(): Promise<Point | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
  return { latitude: coords.latitude, longitude: coords.longitude };
}
