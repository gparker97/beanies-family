/**
 * Family memories on the beanie wall (#140): pure rules, so the Settings drawer, the
 * scrapbook viewer and the sleep slideshow read one definition.
 *
 * Per device (`GlobalSettings.wall.memories`), everything on by default: a family who
 * never opens Settings still finds their scrapbook behind a face and their photos at night.
 */
import type {
  ScrapType,
  StoredWallMemories,
  WallMemoriesSettings,
  WallMemoryBrightness,
  WallSlideshowMode,
  WallSlideshowSpeed,
} from '@/types/models';

/** Every memory type, in the order the Settings drawer lists them. */
export const WALL_MEMORY_TYPES: readonly ScrapType[] = ['milestone', 'favorite', 'saying', 'note'];

/** Every slideshow mode, brightness and speed, in the order the Settings drawer offers them. */
export const WALL_SLIDESHOW_MODES: readonly WallSlideshowMode[] = ['off', 'around', 'full'];
export const WALL_MEMORY_BRIGHTNESS_LEVELS: readonly WallMemoryBrightness[] = [
  'dim',
  'medium',
  'bright',
];
export const WALL_SLIDESHOW_SPEEDS: readonly WallSlideshowSpeed[] = ['slow', 'medium', 'fast'];

/** How long each rotation of the sleep slideshow lasts, per speed. */
export const WALL_SLIDESHOW_ROTATE_MS: Readonly<Record<WallSlideshowSpeed, number>> = {
  slow: 60_000,
  medium: 30_000,
  fast: 15_000,
};

export const DEFAULT_WALL_MEMORIES: Readonly<WallMemoriesSettings> = {
  viewer: true,
  show: { milestone: true, favorite: true, saying: true, note: true },
  slideshow: 'around',
  brightness: 'medium',
  speed: 'medium',
};

/**
 * How the memories are drawn at each brightness: opacity and CSS saturation. Medium is the
 * default: Dim, for a wall that sleeps in a dark kitchen, read too faint in most rooms.
 */
export const WALL_MEMORY_BRIGHTNESS: Readonly<
  Record<WallMemoryBrightness, { opacity: number; saturation: number }>
> = {
  dim: { opacity: 0.38, saturation: 0.7 },
  medium: { opacity: 0.62, saturation: 0.85 },
  bright: { opacity: 0.92, saturation: 1 },
};

/**
 * The stored settings with every field checked, falling back field by field to the
 * defaults (each memory type on its own). A corrupt or partial record (an older build, a
 * hand-edited export) degrades to sensible behaviour rather than a broken night screen.
 */
export function resolveWallMemories(raw: StoredWallMemories | undefined): WallMemoriesSettings {
  const d = DEFAULT_WALL_MEMORIES;
  const show = {} as Record<ScrapType, boolean>;
  /* eslint-disable security/detect-object-injection -- `type` comes from WALL_MEMORY_TYPES */
  for (const type of WALL_MEMORY_TYPES) {
    const on = raw?.show?.[type];
    show[type] = typeof on === 'boolean' ? on : d.show[type];
  }
  /* eslint-enable security/detect-object-injection */
  return {
    viewer: typeof raw?.viewer === 'boolean' ? raw.viewer : d.viewer,
    show,
    slideshow:
      raw?.slideshow && WALL_SLIDESHOW_MODES.includes(raw.slideshow) ? raw.slideshow : d.slideshow,
    brightness:
      raw?.brightness && WALL_MEMORY_BRIGHTNESS_LEVELS.includes(raw.brightness)
        ? raw.brightness
        : d.brightness,
    speed: raw?.speed && WALL_SLIDESHOW_SPEEDS.includes(raw.speed) ? raw.speed : d.speed,
  };
}

/**
 * The memory types switched on. May be empty: callers must NOT hand an empty set to
 * `useScrapbookFeed`, where an empty set means every type.
 */
export function enabledScrapTypes(settings: WallMemoriesSettings): ReadonlySet<ScrapType> {
  // eslint-disable-next-line security/detect-object-injection -- `type` comes from WALL_MEMORY_TYPES
  return new Set(WALL_MEMORY_TYPES.filter((type) => settings.show[type]));
}

/**
 * Whether the slideshow may show photos at all. The "Photos and Milestones" switch
 * governs milestone photos AND bean avatars AND recipe dish photos; this is the one place
 * that rule lives.
 */
export function photosEnabled(settings: WallMemoriesSettings): boolean {
  return settings.show.milestone;
}
