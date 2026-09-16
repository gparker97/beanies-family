import { afterEach, describe, expect, it } from 'vitest';
import {
  WALL_MIN_BOX_SIDE_PX,
  WALL_MIN_DEVICE_SIDE_PX,
  deviceCanBeAWall,
  deviceCanRotate,
  deviceShortSidePx,
  wallChromeFor,
  wallTierFor,
} from '../wallRoom';

/**
 * `screen` is a getter on the jsdom/happy-dom window. Stub it by defining the
 * global directly and restore afterwards so no test leaks a device into another.
 */
const original = Object.getOwnPropertyDescriptor(globalThis, 'screen');

function setScreen(width: number | undefined, height: number | undefined): void {
  Object.defineProperty(globalThis, 'screen', {
    value: width === undefined ? undefined : { width, height },
    configurable: true,
    writable: true,
  });
}

function clearScreen(): void {
  Object.defineProperty(globalThis, 'screen', {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'screen', original);
  else delete (globalThis as { screen?: unknown }).screen;
});

describe('the device floor: what may ever be a wall', () => {
  /**
   * The table from the plan, as the test. Each row is a real device whose CSS
   * dimensions were derived as physical/DPR — the arithmetic that started this
   * whole bug, pinned so nobody has to redo it.
   */
  const devices: ReadonlyArray<[label: string, short: number, wall: boolean]> = [
    ['Lenovo Tab M8 TB-8505F, hdpi 1.5', 533, true],
    ['Lenovo Tab M8 TB-8505F, tvdpi 1.33', 601, true],
    ['Amazon Fire HD 8, tvdpi', 601, true],
    ['Galaxy Tab A9 / A7 Lite 8.7"', 533, true],
    ['iPad mini 6', 744, true],
    ['iPad 10.2"', 810, true],
    ['iPhone 15', 393, false],
    ['a large phone', 430, false],
  ];

  it.each(devices)('%s (%ipx short side)', (_label, short, wall) => {
    setScreen(short, short * 2);
    expect(deviceCanBeAWall()).toBe(wall);
  });

  it('sits exactly on its own threshold', () => {
    setScreen(WALL_MIN_DEVICE_SIDE_PX, 960);
    expect(deviceCanBeAWall()).toBe(true);
    setScreen(WALL_MIN_DEVICE_SIDE_PX - 1, 960);
    expect(deviceCanBeAWall()).toBe(false);
  });

  /**
   * ⭐ The guard on lowering the floor. 430 is the largest phone we know of, 533
   * the smallest tablet we mean to admit, so the floor has to live in (430, 533].
   * If someone lowers it to admit something smaller, this fails and says why.
   */
  it('leaves the floor inside the window that separates phones from tablets', () => {
    expect(WALL_MIN_DEVICE_SIDE_PX).toBeGreaterThan(430);
    expect(WALL_MIN_DEVICE_SIDE_PX).toBeLessThanOrEqual(533);
  });

  it('reads the SMALLER side, so a phone held sideways is still a phone', () => {
    setScreen(852, 393);
    expect(deviceCanBeAWall()).toBe(false);
  });
});

describe('an unmeasurable device gets OPPOSITE defaults', () => {
  /**
   * The Pass-2 catch. `isRotatableFormFactor` returned false on an unknown
   * screen, which is right for rotation and wrong for admission: reusing it for
   * the gate would have blanked the wall in SSR, in every jsdom component test,
   * and in any webview reporting 0.
   */
  it('admits a wall it cannot measure', () => {
    clearScreen();
    expect(deviceShortSidePx()).toBeNull();
    expect(deviceCanBeAWall()).toBe(true);
  });

  it('refuses to unlock rotation it cannot measure', () => {
    clearScreen();
    expect(deviceCanRotate()).toBe(false);
  });

  it.each([
    ['zero width', 0, 800],
    ['zero height', 600, 0],
    ['NaN', Number.NaN, 800],
    ['Infinity', Number.POSITIVE_INFINITY, 800],
  ])('treats %s as unmeasured, not as tiny', (_label, w, h) => {
    setScreen(w, h);
    expect(deviceShortSidePx()).toBeNull();
    expect(deviceCanBeAWall()).toBe(true);
    expect(deviceCanRotate()).toBe(false);
  });
});

describe('the box floor', () => {
  it('is lower than the device floor, because chrome is not the user’s fault', () => {
    expect(WALL_MIN_BOX_SIDE_PX).toBeLessThan(WALL_MIN_DEVICE_SIDE_PX);
  });

  /**
   * The case that started this: a 533px-short tablet in landscape, minus a
   * Chrome toolbar (~56) and the status and nav bars (~24 + ~48), has ~405 left.
   * The box floor has to clear that or the original bug survives the fix.
   */
  it('clears a 533px tablet in landscape with full browser and system chrome', () => {
    expect(WALL_MIN_BOX_SIDE_PX).toBeLessThanOrEqual(533 - 56 - 24 - 48);
  });
});

describe('the density tier', () => {
  it.each([
    [1280, 'full'],
    [800, 'full'],
    [720, 'full'],
    [719, 'mid'],
    [601, 'mid'],
    [600, 'mid'],
    [599, 'compact'],
    [533, 'compact'],
    [405, 'compact'],
  ] as const)('%ipx short side is the %s tier', (short, tier) => {
    expect(wallTierFor(short)).toBe(tier);
  });

  it.each([
    ['zero, i.e. not measured yet', 0],
    ['negative', -100],
    ['NaN', Number.NaN],
  ])('falls back to full on %s rather than assuming the screen is tiny', (_label, input) => {
    expect(wallTierFor(input)).toBe('full');
  });
});

describe('the chrome table', () => {
  it('shrinks monotonically as the wall gets smaller', () => {
    const full = wallChromeFor('full');
    const mid = wallChromeFor('mid');
    const compact = wallChromeFor('compact');
    expect(full.padding).toBeGreaterThan(mid.padding);
    expect(mid.padding).toBeGreaterThan(compact.padding);
    expect(full.arrowGutter).toBeGreaterThanOrEqual(mid.arrowGutter);
    expect(mid.arrowGutter).toBeGreaterThanOrEqual(compact.arrowGutter);
  });

  /**
   * The arrow gutter reserves room for a button, so shrinking it past the
   * button's own minimum shrinks the button. 2.4rem = 38px is the floor for a
   * wall a child operates standing at it.
   */
  it('never shrinks the arrow gutter below a 2.4rem tap target', () => {
    for (const tier of ['full', 'mid', 'compact'] as const) {
      expect(wallChromeFor(tier).arrowGutter).toBeGreaterThanOrEqual(38);
    }
  });

  it('falls back to full chrome for an unknown tier', () => {
    expect(wallChromeFor('nonsense' as never)).toEqual(wallChromeFor('full'));
  });
});
