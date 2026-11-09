import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import { pickDaylioFolder } from '../daylio/daylioJob';
import type { HealthFix } from './health';

export const PACKAGE_NAME = 'com.masonbair.collector';

/** Runs the fix for a health item. Returns false when the screen must handle it (sign-in) or it failed. */
export async function runFix(fix: HealthFix): Promise<boolean> {
  try {
    switch (fix) {
      case 'app-settings':
      case 'grant-photos':
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
          data: `package:${PACKAGE_NAME}`,
        });
        return true;
      case 'battery-optimization':
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, {
          data: `package:${PACKAGE_NAME}`,
        });
        return true;
      case 'grant-location': {
        const foreground = await Location.requestForegroundPermissionsAsync();
        if (foreground.status !== 'granted') return false;
        return (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
      }
      case 'pick-folder':
        return await pickDaylioFolder();
      case 'sign-in':
        return false;
    }
  } catch {
    return false;
  }
}
