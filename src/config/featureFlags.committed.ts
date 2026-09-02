// AUTO-GENERATED committed feature-flag PRODUCTION state — the single source of
// truth for which flags ship enabled to prod. Edit via the dev-only Feature
// Flags card in Settings (which rewrites this file through the dev Vite
// endpoint), or by hand. `true` ships the feature to ALL prod users on the next
// deploy; `false` keeps it dev-only. Keys are DevFlag ids, sorted.
import type { DevFlag } from './flagRegistry';

export const COMMITTED_FLAGS: Record<DevFlag, boolean> = {
  aiPhotoExtract: true,
  aiTravelExtract: true,
  beanieWall: false,
  calendarClashNudge: true,
  docWorker: true,
  familyLists: true,
  googleCalendarSync: true,
  helpfulHints: true,
  mealPlanner: true,
};
