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
    // `useOpenList().openList` pushes, so a tapped reminder and an
    // in-app "open list" land in exactly the same place.
    list: { path: '/lists', param: 'view' },
    account: { path: '/accounts', param: 'view' },
    transaction: { path: '/transactions', param: 'view' },
    goal: { path: '/goals', param: 'view' },
    asset: { path: '/assets', param: 'view' },
    member: { path: '/family', param: 'edit' },
  } as const);

/**
 * The planner's Day view, on `ymd` (a `YYYY-MM-DD` string), or on today when `ymd` is omitted
 * (a fresh planner mount with no `d` is today). Widgets mint this for every calendar tap.
 *
 * The RECEIVER is `parsePlannerQuery` in `src/composables/usePlannerUrlState.ts`; the in-app
 * writer of the same `view`/`d` keys is `toPlannerQuery` there. The two are deliberately
 * separate: this module must stay free of Vue and vue-router so `widgetSnapshot.ts` and the
 * OS-claim tripwire can import it. They are held in step by the round-trip unit test in
 * `__tests__/entityDeepLink.test.ts`.
 */
export function plannerDayLink(ymd?: string): DeepLink {
  return {
    path: ENTITY_DEEP_LINKS.activity.path,
    query: ymd ? { view: 'day', d: ymd } : { view: 'day' },
  };
}

/**
 * `extra` adds companion query params the receiver reads beside the id, e.g.
 * `{ date }` so an activity link opens on one session of a repeating activity.
 */
export function entityDeepLink(
  type: DeepLinkType,
  id: string,
  extra?: Record<string, string>
): DeepLink {
  const { path, param } = ENTITY_DEEP_LINKS[type];
  return { path, query: { ...extra, [param]: id } };
}
