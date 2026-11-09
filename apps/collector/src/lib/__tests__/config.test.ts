import config from '../../../app.config';

type PluginEntry = string | [string, Record<string, unknown>];

describe('app config', () => {
  it('uses the collector scheme and package', () => {
    expect(config.scheme).toBe('masonbair-collector');
    expect(config.android?.package).toBe('com.masonbair.collector');
  });

  it('blocks fine location and the permissions libraries add that the collector never uses', () => {
    expect(config.android?.blockedPermissions).toEqual(
      expect.arrayContaining([
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ]),
    );
  });

  it('keeps the permissions the collector needs out of the block list', () => {
    for (const kept of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VISUAL_USER_SELECTED', 'FOREGROUND_SERVICE', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION']) {
      expect(config.android?.blockedPermissions).not.toContain(`android.permission.${kept}`);
    }
  });

  it('turns off Android backup, so private places never leave the phone', () => {
    expect(config.android?.allowBackup).toBe(false);
  });

  it('declares the permissions the collector needs', () => {
    expect(config.android?.permissions).toEqual(
      expect.arrayContaining([
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'READ_MEDIA_IMAGES',
        'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      ]),
    );
  });

  it('turns on background location without a foreground service', () => {
    const plugin = (config.plugins as PluginEntry[]).find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-location',
    );
    expect(plugin?.[1]).toMatchObject({
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: false,
    });
  });
});
