import config from '../../../app.config';

type PluginEntry = string | [string, Record<string, unknown>];

describe('app config', () => {
  it('uses the collector scheme and package', () => {
    expect(config.scheme).toBe('masonbair-collector');
    expect(config.android?.package).toBe('com.masonbair.collector');
  });

  it('blocks fine location', () => {
    expect(config.android?.blockedPermissions).toContain('android.permission.ACCESS_FINE_LOCATION');
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
