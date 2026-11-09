import { requireOptionalNativeModule } from 'expo';

type Native = {
  isIgnoringBatteryOptimizations(): boolean;
  standbyBucket(): number;
};

// Null in Jest and Expo Go, where the native side does not exist.
const native = requireOptionalNativeModule<Native>('BatteryStatus');

export const batteryStatusAvailable = native !== null;

export function isIgnoringBatteryOptimizations(): boolean | null {
  return native?.isIgnoringBatteryOptimizations() ?? null;
}

/** Android standby bucket of this app (10 active ... 50 never); -1 below Android 9; null without the native module. */
export function standbyBucket(): number | null {
  return native?.standbyBucket() ?? null;
}
