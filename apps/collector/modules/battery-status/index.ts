import { requireOptionalNativeModule } from 'expo';

type Native = {
  isIgnoringBatteryOptimizations(): boolean;
  standbyBucket(): number;
};

// Null in Jest and Expo Go, where the native side does not exist.
const native = requireOptionalNativeModule<Native>('BatteryStatus');

export const batteryStatusAvailable = native !== null;

export function isIgnoringBatteryOptimizations(): boolean {
  return native?.isIgnoringBatteryOptimizations() ?? true;
}

/** Android standby bucket of this app (10 active ... 50 never); 0 when unknown. */
export function standbyBucket(): number {
  return native?.standbyBucket() ?? 0;
}
