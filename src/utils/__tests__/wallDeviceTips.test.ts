import { describe, it, expect } from 'vitest';

import { wallDeviceTipKeys } from '../wallDeviceTips';
import type { DevicePlatform } from '@/services/sync/capabilities';
import { UI_STRINGS } from '@/services/translation/uiStrings';

/**
 * The picker takes both its inputs as arguments precisely so this file needs no
 * module mocking: six rows cover the whole space.
 */
describe('wallDeviceTipKeys', () => {
  const cases: Array<{
    platform: DevicePlatform;
    wakeLock: boolean;
    expected: string[];
  }> = [
    {
      platform: 'ios',
      wakeLock: true,
      expected: [
        'wall.setup.tips.screenBacked',
        'wall.setup.tips.guidedAccess',
        'wall.setup.tips.power',
      ],
    },
    {
      platform: 'ios',
      wakeLock: false,
      expected: [
        'wall.setup.tips.screenOnly',
        'wall.setup.tips.guidedAccess',
        'wall.setup.tips.power',
      ],
    },
    {
      platform: 'android',
      wakeLock: true,
      expected: [
        'wall.setup.tips.screenBacked',
        'wall.setup.tips.screenPinning',
        'wall.setup.tips.power',
      ],
    },
    {
      platform: 'android',
      wakeLock: false,
      expected: [
        'wall.setup.tips.screenOnly',
        'wall.setup.tips.screenPinning',
        'wall.setup.tips.power',
      ],
    },
    {
      platform: 'other',
      wakeLock: true,
      expected: [
        'wall.setup.tips.screenBacked',
        'wall.setup.tips.lockGeneric',
        'wall.setup.tips.power',
      ],
    },
    {
      platform: 'other',
      wakeLock: false,
      expected: [
        'wall.setup.tips.screenOnly',
        'wall.setup.tips.lockGeneric',
        'wall.setup.tips.power',
      ],
    },
  ];

  for (const { platform, wakeLock, expected } of cases) {
    it(`${platform}, wake lock ${wakeLock ? 'supported' : 'unsupported'}`, () => {
      expect(wallDeviceTipKeys(platform, wakeLock)).toEqual(expected);
    });
  }

  it('always returns exactly three lines, because the card is a nudge and not a checklist', () => {
    for (const { platform, wakeLock } of cases) {
      expect(wallDeviceTipKeys(platform, wakeLock)).toHaveLength(3);
    }
  });

  it('every key it can return actually resolves to a string', () => {
    // The return type is `UIStringKey[]`, so a typo is normally a compile error.
    // This catches the other direction: a key deleted from uiStrings.ts while
    // this module still names it would type-check until the file is recompiled.
    const all = new Set(
      cases.flatMap(({ platform, wakeLock }) => wallDeviceTipKeys(platform, wakeLock))
    );
    for (const key of all) {
      expect(UI_STRINGS[key], `missing en string for ${key}`).toBeTruthy();
    }
  });

  it('names Guided Access on Apple and screen pinning on Android, never the other way round', () => {
    expect(wallDeviceTipKeys('ios', true)).toContain('wall.setup.tips.guidedAccess');
    expect(wallDeviceTipKeys('ios', true)).not.toContain('wall.setup.tips.screenPinning');
    expect(wallDeviceTipKeys('android', true)).toContain('wall.setup.tips.screenPinning');
    expect(wallDeviceTipKeys('android', true)).not.toContain('wall.setup.tips.guidedAccess');
  });
});
