/**
 * Canonical localStorage keys.
 *
 * The settings store mirrors a small set of appearance preferences to
 * localStorage on every change so the synchronous bootstrap script in
 * `index.html` can apply them before any CSS loads (avoiding FOUC). The
 * IndexedDB / Automerge layers remain the durable source of truth and
 * confirm or correct the bootstrap shortly after Vue mounts.
 *
 * Important: the bootstrap script in `index.html` cannot import this file
 * (it runs as inline JS before module loading), so it duplicates these
 * literals. Keep both places in sync — if you rename a key here, update
 * `index.html` in the same commit.
 */
export const STORAGE_KEYS = {
  TEXT_SIZE: 'beanies:textSize',
  THEME: 'beanies:theme',
  /** Who Owns What (#109): the last-used view (overview / deal / deck). Device-local;
   *  not read by the `index.html` bootstrap. */
  WHO_OWNS_WHAT_VIEW: 'beanies:whoOwnsWhatView',
  /** Who Owns What (#109): the Deal view at md+, card by card (`pile`) or the board. */
  WHO_OWNS_WHAT_DEAL_MODE: 'beanies:whoOwnsWhatDealMode',
  /** Who Owns What: the deal pile's phone swipe hint, `show` until the first swipe, then
   *  `seen`. Device-local; not read by the `index.html` bootstrap. */
  WHO_OWNS_WHAT_SWIPE_HINT: 'beanies:whoOwnsWhatSwipeHint',
  /** #117: the last Counter-write policy the registry served (`dataPolicy.counterWrites`),
   *  so a boot before the registry answers uses it. Device-local, never in the pod; not read
   *  by the `index.html` bootstrap. */
  COUNTER_WRITES: 'beanies:counterWrites',
  /** #124: the last scalar-strings policy the registry served (`dataPolicy.scalarWrites`), the
   *  SERVED value (the update-floor guard is applied on read). Device-local, never in the pod;
   *  not read by the `index.html` bootstrap. */
  SCALAR_WRITES: 'beanies:scalarWrites',
  /** The last update floor (`promptBelowVersion` from `min-app-version.json`) fetched on any
   *  platform, so the KDF write gate (`kdfWriteGate.ts`) can read it synchronously at boot.
   *  Device-local, never in the pod; not read by the `index.html` bootstrap. */
  UPDATE_FLOOR: 'beanies:updateFloor',
  /** #134: the device's last weather reading for the active family's home town
   *  (`services/weather/weatherCache.ts`). ONE key holding the reading plus the `familyId`
   *  and `placeKey` it belongs to, so sign-out is a single removal. Device-local, never in
   *  the pod; not read by the `index.html` bootstrap. */
  WEATHER: 'beanies:weather',
  /** #143: this device's latest live flight check per travel segment
   *  (`services/flightStatus/flightStatusCache.ts`): ONE key holding the checks, the failure
   *  backoffs and the `familyId` they belong to, so sign-out is a single removal. Provider
   *  answers only (public flight data), never synced. Device-local, never in the pod; not read
   *  by the `index.html` bootstrap. */
  FLIGHT_STATUS: 'beanies:flight-status',
  /** #143: DEV BUILDS ONLY. How many provider fetches this device spent today
   *  (`services/flightStatus/devFetchBudget.ts`), so a dev server left open cannot drain the
   *  production provider quota. Never written by a production build. */
  FLIGHT_STATUS_DEV_BUDGET: 'beanies:flight-status-dev',
  /** #141: the desktop month grid's density (`compact` | `comfortable`). Device-local;
   *  not read by the `index.html` bootstrap. */
  MONTH_GRID_DENSITY: 'beanies:monthGridDensity',
  /** #141: whether the desktop month grid's chips show times (`shown` | `hidden`).
   *  Device-local; not read by the `index.html` bootstrap. */
  MONTH_GRID_TIMES: 'beanies:monthGridTimes',
  /** #141: whether one-owner chips on the desktop month grid show their face (`shown` |
   *  `hidden`). Device-local; not read by the `index.html` bootstrap. */
  MONTH_GRID_SOLO_FACES: 'beanies:monthGridSoloFaces',
  /** #141: the phone Month view's mode (`grid` | `list`). Device-local; not read by the
   *  `index.html` bootstrap. */
  PHONE_MONTH_MODE: 'beanies:phoneMonthMode',
  /** #141: the phone month grid's density (`faces` | `bars` | `titles`). Device-local;
   *  not read by the `index.html` bootstrap. */
  PHONE_MONTH_DENSITY: 'beanies:phoneMonthDensity',
} as const;
