import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPlatformLabel, getDeviceLabel } from './platformLabel';
import * as capabilities from '@/services/sync/capabilities';

/**
 * The UA-parsing branches of getDeviceLabel are exercised by stubbing the
 * canonical capabilities seam (isNative/getPlatform/isStandalone/isIosOrIpadOs)
 * plus navigator.userAgent. We only assert the label composition here — the
 * seam functions themselves are covered by their own module.
 */

function stub(opts: {
  native?: boolean;
  platform?: 'web' | 'ios' | 'android';
  standalone?: boolean;
  ios?: boolean;
  ua?: string;
}) {
  vi.spyOn(capabilities, 'isNative').mockReturnValue(opts.native ?? false);
  vi.spyOn(capabilities, 'getPlatform').mockReturnValue(opts.platform ?? 'web');
  vi.spyOn(capabilities, 'isStandalone').mockReturnValue(opts.standalone ?? false);
  vi.spyOn(capabilities, 'isIosOrIpadOs').mockReturnValue(opts.ios ?? false);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(opts.ua ?? '');
}

afterEach(() => vi.restoreAllMocks());

const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const EDGE_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0';

describe('getPlatformLabel', () => {
  it('reports app for native, pwa for standalone, web otherwise', () => {
    stub({ native: true, platform: 'android' });
    expect(getPlatformLabel()).toBe('app');

    stub({ standalone: true });
    expect(getPlatformLabel()).toBe('pwa');

    stub({ ua: CHROME_DESKTOP });
    expect(getPlatformLabel()).toBe('web');
  });
});

describe('getDeviceLabel — native', () => {
  it('labels the android app', () => {
    stub({ native: true, platform: 'android', ua: CHROME_ANDROID });
    expect(getDeviceLabel()).toBe('android app');
  });

  it('distinguishes iphone from ipad', () => {
    stub({ native: true, platform: 'ios', ua: SAFARI_IOS });
    expect(getDeviceLabel()).toBe('iphone app');

    stub({
      native: true,
      platform: 'ios',
      ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
    });
    expect(getDeviceLabel()).toBe('ipad app');
  });
});

describe('getDeviceLabel — browser', () => {
  it('labels chrome desktop', () => {
    stub({ ua: CHROME_DESKTOP });
    expect(getDeviceLabel()).toBe('chrome desktop');
  });

  it('labels chrome android', () => {
    stub({ ua: CHROME_ANDROID });
    expect(getDeviceLabel()).toBe('chrome android');
  });

  it('labels safari ios (Safari tested last so iOS UA is not mislabelled chrome)', () => {
    stub({ ios: true, ua: SAFARI_IOS });
    expect(getDeviceLabel()).toBe('safari ios');
  });

  it('detects edge before chrome', () => {
    stub({ ua: EDGE_DESKTOP });
    expect(getDeviceLabel()).toBe('edge desktop');
  });
});

describe('getDeviceLabel — installed PWA', () => {
  it('appends a pwa suffix', () => {
    stub({ standalone: true, ua: CHROME_ANDROID });
    expect(getDeviceLabel()).toBe('chrome android pwa');
  });
});

describe('never throws into the caller (best-effort telemetry)', () => {
  it('falls back when platform detection throws', () => {
    // Simulates a partially-mocked capabilities seam (as in createNewFile.test)
    // or a hostile runtime: a detection failure must not propagate.
    vi.spyOn(capabilities, 'isNative').mockImplementation(() => {
      throw new Error('capabilities unavailable');
    });
    expect(getPlatformLabel()).toBe('web');
    expect(getDeviceLabel()).toBe('unknown');
  });
});
