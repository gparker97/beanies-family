import type { RouteLocationRaw } from 'vue-router';

/**
 * Shared in-app deep-links. Single source of truth for the `?open=…` query
 * contract consumed by `SettingsPage`'s `cardOpenMap`, so multiple callers
 * can't drift out of sync on the exact path/query shape.
 */

/**
 * Lands directly inside Settings → Family Data (where Reconnect + Switch file
 * live). Used by `SaveFailureBanner` and the sidebar `SaveStatusIndicator`.
 */
export const FAMILY_DATA_DEEP_LINK: RouteLocationRaw = {
  path: '/settings',
  query: { open: 'family-data' },
};
