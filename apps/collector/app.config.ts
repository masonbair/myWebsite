import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Collector',
  slug: 'masonbair-collector',
  version: '1.0.0',
  scheme: 'masonbair-collector',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: 'com.masonbair.collector',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'READ_MEDIA_IMAGES',
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
    // Fine location is blocked on purpose (city-level is enough); the rest are added by libraries and never used.
    blockedPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_MEDIA_AUDIO',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
    // Private places live only on the phone; a cloud backup would copy them off it.
    allowBackup: false,
  },
  plugins: [
    [
      'expo-location',
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    'expo-background-task',
    'expo-web-browser',
  ],
};

export default config;
