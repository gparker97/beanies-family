import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALL_MEMORIES,
  WALL_MEMORY_BRIGHTNESS,
  WALL_SLIDESHOW_ROTATE_MS,
  WALL_SLIDESHOW_SPEEDS,
  enabledScrapTypes,
  photosEnabled,
  resolveWallMemories,
} from '@/utils/wallMemories';
import type { WallMemoriesSettings } from '@/types/models';

/** A stored record as an older build or a hand-edited export might leave it. */
const garbage = (raw: unknown) => resolveWallMemories(raw as Partial<WallMemoriesSettings>);

describe('resolveWallMemories', () => {
  it('is the defaults when absent: viewer on, every type on, around the clock, medium', () => {
    expect(resolveWallMemories(undefined)).toEqual({
      viewer: true,
      show: { milestone: true, favorite: true, saying: true, note: true },
      slideshow: 'around',
      brightness: 'medium',
      speed: 'medium',
    });
    expect(resolveWallMemories({})).toEqual(DEFAULT_WALL_MEMORIES);
  });

  it('keeps the valid fields of a partial record, each type on its own', () => {
    expect(garbage({ viewer: false, show: { note: false }, brightness: 'bright' })).toEqual({
      ...DEFAULT_WALL_MEMORIES,
      viewer: false,
      show: { ...DEFAULT_WALL_MEMORIES.show, note: false },
      brightness: 'bright',
    });
    expect(resolveWallMemories({ slideshow: 'full' }).slideshow).toBe('full');
    expect(resolveWallMemories({ slideshow: 'off' }).slideshow).toBe('off');
    // A device that already saved a brightness or speed keeps it.
    expect(resolveWallMemories({ brightness: 'dim' }).brightness).toBe('dim');
    expect(resolveWallMemories({ speed: 'slow' }).speed).toBe('slow');
    expect(resolveWallMemories({ speed: 'fast' }).speed).toBe('fast');
  });

  it('falls back field by field on garbage', () => {
    expect(garbage({ viewer: 'yes' }).viewer).toBe(true);
    expect(garbage({ slideshow: 'sideways' }).slideshow).toBe('around');
    expect(garbage({ slideshow: 3 }).slideshow).toBe('around');
    expect(garbage({ brightness: 'blinding' }).brightness).toBe('medium');
    expect(garbage({ brightness: null }).brightness).toBe('medium');
    expect(garbage({ speed: 'warp' }).speed).toBe('medium');
    expect(garbage({ speed: 30_000 }).speed).toBe('medium');
    expect(garbage({ show: null }).show).toEqual(DEFAULT_WALL_MEMORIES.show);
    expect(garbage({ show: 'all' }).show).toEqual(DEFAULT_WALL_MEMORIES.show);
    expect(garbage({ show: { milestone: 0, saying: false, extra: true } }).show).toEqual({
      ...DEFAULT_WALL_MEMORIES.show,
      saying: false,
    });
    expect(garbage(42)).toEqual(DEFAULT_WALL_MEMORIES);
  });

  it('never hands back the shared default object', () => {
    const resolved = resolveWallMemories(undefined);
    resolved.show.note = false;
    expect(DEFAULT_WALL_MEMORIES.show.note).toBe(true);
  });
});

describe('slideshow speeds', () => {
  it('are Slow 60 s, Medium 30 s and Fast 15 s, in that order', () => {
    expect(WALL_SLIDESHOW_SPEEDS).toEqual(['slow', 'medium', 'fast']);
    expect(WALL_SLIDESHOW_ROTATE_MS).toEqual({ slow: 60_000, medium: 30_000, fast: 15_000 });
  });
});

describe('enabledScrapTypes', () => {
  it('lists the types switched on', () => {
    expect([...enabledScrapTypes(DEFAULT_WALL_MEMORIES)].sort()).toEqual([
      'favorite',
      'milestone',
      'note',
      'saying',
    ]);
    const some = resolveWallMemories({
      show: { milestone: false, favorite: true, saying: false, note: true },
    });
    expect([...enabledScrapTypes(some)].sort()).toEqual(['favorite', 'note']);
  });

  it('is empty, not "all", when every type is off', () => {
    const none = resolveWallMemories({
      show: { milestone: false, favorite: false, saying: false, note: false },
    });
    expect(enabledScrapTypes(none).size).toBe(0);
  });
});

describe('photosEnabled', () => {
  it('follows the milestone switch alone', () => {
    expect(photosEnabled(DEFAULT_WALL_MEMORIES)).toBe(true);
    expect(photosEnabled(garbage({ show: { milestone: false } }))).toBe(false);
    expect(
      photosEnabled(
        garbage({ show: { milestone: true, favorite: false, saying: false, note: false } })
      )
    ).toBe(true);
  });
});

describe('WALL_MEMORY_BRIGHTNESS', () => {
  it('steps opacity and saturation up from dim to bright', () => {
    expect(WALL_MEMORY_BRIGHTNESS).toEqual({
      dim: { opacity: 0.38, saturation: 0.7 },
      medium: { opacity: 0.62, saturation: 0.85 },
      bright: { opacity: 0.92, saturation: 1 },
    });
  });
});
