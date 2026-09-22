/**
 * Entity → in-app deep link (path + query). Extracted verbatim from
 * `GlobalSearch.selectResult` so global search AND notification "Open" share one
 * map — the target pages honour these query params (`?view=`/`?activity=`/
 * `?edit=`). Adding a new linkable entity is a single record entry here.
 */
export type DeepLinkType =
  | 'activity'
  | 'vacation'
  | 'todo'
  | 'list'
  | 'account'
  | 'transaction'
  | 'goal'
  | 'asset'
  | 'member';

export interface DeepLink {
  path: string;
  query: Record<string, string>;
}

/**
 * Entity → route path + the query param that page's receiver reads.
 *
 * A RECORD, not a switch, so the path list can be derived for the OS-level deep-link
 * claims (`constants/externalDeepLinkPaths.ts`) without restating a single path. Keyed
 * by `DeepLinkType`, so omitting an entity is a COMPILE error — the property the old
 * exhaustive switch had, kept, with the list now readable as data.
 *
 * ⚠️ FROZEN. `entityDeepLink()` reads it at CALL time while `EXTERNAL_DEEP_LINK_PATHS`
 * snapshots it at MODULE-EVAL time, so a runtime write would make what the app MINTS
 * diverge from what it ROUTES and from what the OS claims — invisibly to the tripwire,
 * which only ever sees the static files.
 *
 * ⚠️ THIS LIST NOW FEEDS AN OS-LEVEL CLAIM. Adding an entry widens what iOS and Android
 * may hand to the app. That cannot happen by accident: the tripwire test in
 * `src/constants/__tests__/deepLinkPaths.manifests.test.ts` fails until the AASA and the
 * AndroidManifest are updated to match. Read that test's docblock before adding a row.
 */
export const ENTITY_DEEP_LINKS: Readonly<Record<DeepLinkType, { path: string; param: string }>> =
  Object.freeze({
    activity: { path: '/activities', param: 'activity' },
    vacation: { path: '/travel', param: 'vacation' },
    todo: { path: '/todo', param: 'view' },
    // `/lists` opens `?view=<id>` straight into the list drawer — the same param
    // `useRecipeShoppingLists.openList` pushes, so a tapped reminder and an
    // in-app "open list" land in exactly the same place.
    list: { path: '/lists', param: 'view' },
    account: { path: '/accounts', param: 'view' },
    transaction: { path: '/transactions', param: 'view' },
    goal: { path: '/goals', param: 'view' },
    asset: { path: '/assets', param: 'view' },
    member: { path: '/family', param: 'edit' },
  } as const);

export function entityDeepLink(type: DeepLinkType, id: string): DeepLink {
  const { path, param } = ENTITY_DEEP_LINKS[type];
  return { path, query: { [param]: id } };
}
