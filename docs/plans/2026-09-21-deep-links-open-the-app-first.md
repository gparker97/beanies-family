# Plan: Deep links open the installed app first, then the PWA, then the browser

> ⚠️ **OUTCOME (2026-09-21): SHIPPED IN PART.** Read this before treating the plan below as
> a description of the code. Two of the four layers were deliberately NOT shipped after two
> `/code-review max` rounds, and the plan text below still describes the full design.
>
> **Shipped:** the OS claim (iOS AASA + Android intent-filter, enumerated and pinned), the
> widened in-app `ROUTABLE_PATHS`, the `ENTITY_DEEP_LINKS` record, the drift tripwire, the
> `/oauth/*` exclusion, the apex `APP_PATHS` 301 entries, and the telemetry facade move.
>
> **NOT shipped — step 6, the PWA rung (`handle_links`).** A PWA's `scope` is `/`, so its
> capture cannot be narrowed to `EXTERNAL_DEEP_LINK_PATHS`, and `inboundLinkBridge` returns
> early on `!isNative()`, so the in-app safety net does not run there either. It would
> re-claim `/oauth/callback` — the one path the AASA exclusion exists to refuse — risking
> the Drive Picker flow validated on a production iPhone on 2026-09-20. Needs a real WebAPK
> device test first. Requirement 4 is therefore NOT met.
>
> **NOT shipped — step 8, `?next=` surviving sign-in.** Reverted wholesale. Two review
> rounds found six defects in it, four of them introduced by the previous round's fixes,
> and the decisive one is that it does not work on the journey it was built for: on
> signed-out redirect auth (iOS / PWA / native) `App.vue`'s pre-auth bounce hard-codes
> `/nook` and the login views pass fixed OAuth return paths, so the intent is destroyed
> before `handleSignedIn` runs. Requirement 8 is NOT met and needs its own plan, which
> must start at `App.vue`'s pre-auth bounce and `resumePaths`' return-path constants, not
> at `handleSignedIn`.
>
> **Observability correction:** `inbound_link_ignored` ships with `action` + `error_code`
> only. The table below says it carries `route_path`; it does not. Both reject branches
> fire on paths we did not mint, so the path is attacker-supplied free text, and
> `route_path` is allowlisted and declared to Apple and Google as collected Diagnostics.
> The drift signal is the rate; the tripwire names the path.

> Date: 2026-09-21
> Related issues: Notion tracker #63 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-21-deep-links-open-the-app-first.md`

## User Story

As a family member who receives a beanies link — the activity link inside a Google Calendar
invite, a magic link, a shared to-do — I want tapping it to land me in the richest surface I
have installed, so that I arrive at the actual item instead of a browser tab that asks me to
sign in again.

## Context

#63 has been half-built for a while, and the half that exists is the half that is invisible.

**What already works.** `ios/App/App/App.entitlements` already claims
`applinks:app.beanies.family`. `public/.well-known/assetlinks.json` is hosted and correct.
`src/services/share/inboundLinkBridge.ts` exists specifically to route an inbound link into
the Vue router, and it is a carefully-reasoned file. Every one of the nine entity
destinations already has a receiver: `useDeepLinkParam` on seven pages, plus hand-rolled
query handling on `/lists` (`BeanieListsPage.vue:46`) and `/transactions`
(`TransactionsPage.vue:120`). `src/utils/entityDeepLink.ts` is already the single map from
entity to path+query, shared by global search, scheduled reminders, notifications, and the
calendar-invite description builder.

**What does not work.** Four layers are each scoped to two paths, missing entirely, or wired
to a value nobody reads:

1. **The OS claim is scoped to `/join` and `/welcome`.** Both the app-host AASA
   (`public/.well-known/apple-app-site-association`) and the Android intent-filter claim only
   those two. So `https://app.beanies.family/activities?activity=<id>` — the exact URL
   `utils/calendar/eventDescription.ts` writes into every synced Google Calendar event
   description — is not claimed by either platform and always opens the browser.
2. **The in-app router allowlist is scoped to the same two paths.**
   `ROUTABLE_PATHS = new Set(['/join', '/welcome'])`. This matters more than it looks: widening
   the OS claim _without_ widening this produces the precise failure its own docblock warns
   about, "the app opens, and then sits on whatever screen it was already on."
3. **The PWA rung does not exist.** `vite.config.ts` declares `start_url` and `scope` but no
   `handle_links`, so an installed PWA never captures a link.
4. **The signed-out arrival is thrown away — at TWO sites, not one.**
   `router/index.ts:513-521` redirects an unauthenticated `requiresAuth` hit to `Welcome` with
   `query: { next: to.fullPath }`, and its own docblock admits "currently the login flow
   defaults to /nook on success; the param is available for future use." A grep confirms
   **nothing reads `query.next`**. Worse — and this is what Pass 3 found — that guard
   _returns early while `!authStore.isInitialized`_, which is exactly the state during a cold
   load or a cold native launch. The redirect that actually fires on the tracker's journey is
   `App.vue:1337`, `router.replace('/welcome')`, **with no query at all**. So on the primary
   journey the intent is not merely unread, it is never recorded. This is in scope: it is the
   same user-visible bug, on the same tap.

The user-visible consequence is the one named in the tracker: a parent taps the beanies link
in a calendar invite on a phone with the app installed, and gets a browser.

## Requirements

1. Tapping `https://app.beanies.family/activities?activity=<id>` with the native app installed
   opens the app and lands on that activity (Android reliably; iOS when the tap context allows
   a Universal Link to fire).
2. The same must hold for every entity destination `entityDeepLink` can produce, not only
   activities: `/activities`, `/travel`, `/todo`, `/lists`, `/accounts`, `/transactions`,
   `/goals`, `/assets`, `/family` (and its redirect target `/pod`).
3. The existing auth paths `/join` and `/welcome` keep working exactly as they do today,
   including the device-approval marker gate, the recovery-kit hash forwarding, and the
   launch-URL replay guard.
4. Without the native app, the link opens the installed PWA where the browser supports link
   capturing, else the mobile browser, and routes to the item through the existing
   query-param handling.
5. The OAuth Universal Link `https://beanies.family/oauth/native` continues to work unchanged.
6. **The Google Drive Picker's web return path must not regress.** See the hazard below.
7. A link that opens the app and then goes nowhere must be diagnosable from CloudWatch alone,
   **without** adding a new event for every non-link `appUrlOpen` the app already receives.
8. A deep link that arrives while signed out must survive sign-in, not be discarded — on the
   cold path, which is the only path the tracker's journey uses, **and across the Google
   redirect round-trip that cold path usually contains**.
9. The layers must not be able to drift apart silently.

## The central design decision: enumerate, do not claim the host wide

The tracker's acceptance criterion says "applies host-wide to app.beanies.family app links,
not only activities." **This plan deliberately does not claim the host wide. It enumerates.**
That is a deviation from the literal wording, so here is the argument in full; if greg
disagrees, the change is a one-line edit to the source-of-truth module and a regenerated AASA.

**The hazard that forces the question.** `https://app.beanies.family/oauth/callback` is the
Google Drive Picker's _web_ return path (`googleAuth.ts:551` —
`${window.location.origin}/oauth/callback`). `src/services/google/pickerRedirect.ts` exists to
distinguish `picker_redirect_returned_web` (arriving through `/oauth/callback`) from
`picker_redirect_returned_native` (arriving through `appUrlOpen`), and its comments say the
two transports cannot otherwise be separated on a device where both are possible. greg
confirmed the iOS Picker working on a production iPhone on 2026-09-20. A host-wide claim puts
that freshly-validated flow at risk of being handed to the app mid-OAuth.

**Why enumeration beats host-wide-with-an-exclusion.**

- **It makes the two gates identical by construction.** `inboundLinkBridge`'s docblock prizes
  exactly this property: it chose exact matching over prefix matching so that its routing
  allowlist and its approval-marker gate "are the same comparison BY CONSTRUCTION rather than
  by a shared helper someone has to remember to keep shared." If the OS claims strictly more
  than the bridge routes, we re-introduce a two-gate disagreement at a larger scale, and every
  URL in the gap produces "app opens, sits on the current screen."
- **It closes the Picker hazard structurally on both platforms.** An `exclude` rule closes it
  on iOS only; Android intent-filters have no exclusion, so Android would need enumeration
  anyway. Choosing enumeration for both removes the platform asymmetry rather than documenting
  it.
- **It is future-proof in the right direction.** A host-wide claim silently captures every
  path added to the app host from now on. Enumeration means a new deep-linkable page is an
  explicit, reviewed line in one file.

**What "not only activities" is really asking for** is that the fix generalises past the one
path in the example. Enumerating all nine entity destinations plus the auth paths satisfies
that intent. The tracker's own Notes field already frames success as the
platform-appropriate outcome rather than an absolute.

## Approach

### 1. One source of truth, derived from a record — not a parallel array

`src/utils/entityDeepLink.ts` inverts: the map becomes data, and `entityDeepLink()` becomes a
lookup. A `Record<DeepLinkType, …>` makes omitting an entity a **compile** error, which is
strictly stronger than the exhaustiveness _test_ a parallel array would need.

```ts
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
 * ⚠️ THIS LIST NOW FEEDS AN OS-LEVEL CLAIM. Adding an entry widens what iOS and Android
 * may hand to the app. That cannot happen by accident: the tripwire test in
 * `src/constants/__tests__/deepLinkPaths.manifests.test.ts` fails until the AASA and the
 * AndroidManifest are updated to match. Read that test's docblock before adding a row.
 */
export const ENTITY_DEEP_LINKS: Record<DeepLinkType, { path: string; param: string }> = {
  activity: { path: '/activities', param: 'activity' },
  vacation: { path: '/travel', param: 'vacation' },
  todo: { path: '/todo', param: 'view' },
  // `/lists` opens `?view=<id>` straight into the list drawer — the same param
  // `useRecipeShoppingLists.openList` pushes, so a tapped reminder and an in-app
  // "open list" land in exactly the same place.
  list: { path: '/lists', param: 'view' },
  account: { path: '/accounts', param: 'view' },
  transaction: { path: '/transactions', param: 'view' },
  goal: { path: '/goals', param: 'view' },
  asset: { path: '/assets', param: 'view' },
  member: { path: '/family', param: 'edit' },
};

export function entityDeepLink(type: DeepLinkType, id: string): DeepLink {
  const { path, param } = ENTITY_DEEP_LINKS[type];
  return { path, query: { [param]: id } };
}
```

The file's docblock line "Adding a new linkable entity is a single switch case here" becomes
"a single record entry here" — the property it asserts (one place to add an entity) is
preserved, and the OS claim now comes along for free.
`src/utils/__tests__/entityDeepLink.test.ts` already asserts all nine mappings across its four
cases, so this refactor is covered before it is made; no test changes.

**The derivation coupling, walked through once and then closed.** Deriving the OS claim from
the entity map means a future `DeepLinkType` widens three things. Here is what actually
happens when someone adds `recipe → /cookbook?view=`:

- `EXTERNAL_DEEP_LINK_PATHS` gains `/cookbook`, so `ROUTABLE_PATHS` gains it _silently_.
  Harmless by construction: the bridge only ever sees URLs the OS hands it, and the OS will
  not hand it `/cookbook` until the manifests claim it. The PWA rung is scope-wide (`/`)
  regardless.
- The AASA and the AndroidManifest do **not** gain it, so the tripwire fails with a message
  naming both files. The OS claim therefore stays a reviewed, deliberate act — the property
  the enumeration decision exists for.

Two alternatives were considered and rejected, recorded so this is not re-opened:
an `external: true` flag per entity (adds a config dimension to buy a distinction nothing
needs today, and an internal-only entity is still reachable in-app either way); and
generating the AASA from TypeScript at build time (removes one hand-maintained list of two,
cannot touch the AndroidManifest at all, so it trades one mechanism for two and hides the
served file from the repo).

New module `src/constants/externalDeepLinkPaths.ts`:

```ts
import { ENTITY_DEEP_LINKS } from '@/utils/entityDeepLink';

/**
 * Every path an EXTERNAL link may open the app on. Single source of truth for three
 * layers that cannot import each other: this module (the in-app router allowlist),
 * `public/.well-known/apple-app-site-association`, and `AndroidManifest.xml`.
 * A tripwire test reads both manifests off disk and asserts they equal this list.
 *
 * NOT `constants/deepLinks.ts` (the in-app `/settings?open=…` contract) and NOT
 * `constants/settingsDeepLinks.ts` (that contract's query values). Those describe where
 * the app can send itself; this one describes what the OPERATING SYSTEM may hand us.
 *
 * ⚠️ ENUMERATED, NOT WILDCARD, AND NOT HOST-WIDE. `/oauth/callback` on this host is the
 * Drive Picker's WEB return path (`pickerRedirect.ts`); claiming it for the app breaks a
 * flow validated on a production iPhone on 2026-09-20. Adding a path here is a reviewed
 * decision, which is the point.
 *
 * ⚠️ EXACT PATHS, NO TRAILING SLASH, NO SUBPATHS — the same contract the bridge's
 * `ROUTABLE_PATHS` enforces. Every URL the app actually mints is exact
 * (`buildInviteLink` → `/join?…`, `recoveryKit` → `/welcome#…`, `eventDescription` →
 * `/activities?…`), so nothing in production needs prefix matching. A hand-typed
 * `/activities/` simply falls back to the browser, which is today's behaviour.
 *
 * Safe to import anywhere: `entityDeepLink` has zero imports of its own, so this stays
 * free of Vue, Capacitor and vue-router.
 */
const ENTITY_PATHS = Object.values(ENTITY_DEEP_LINKS).map((m) => m.path);

/**
 * `/family` is a pure redirect to `/pod` (`router/index.ts:237`). `entityDeepLink('member')`
 * emits `/family`, but a link copied from the address bar of a running app says `/pod` —
 * both are real, so both are claimed and both are routable. Deeper `/pod/...` routes are
 * deliberately NOT claimed: exact matching is the contract (see `inboundLinkBridge`).
 */
const REDIRECT_TARGETS = ['/pod'];

/** Pre-auth paths. NOT entity links — they carry their own marker semantics. */
const AUTH_PATHS = ['/join', '/welcome'];

export const EXTERNAL_DEEP_LINK_PATHS: readonly string[] = [
  ...new Set([...ENTITY_PATHS, ...REDIRECT_TARGETS, ...AUTH_PATHS]),
].sort();
```

`ENTITY_PATHS`, `REDIRECT_TARGETS` and `AUTH_PATHS` stay **module-local**. One export, one
consumer contract — an exported constant with no caller is API surface that later gets
imported for the wrong reason (the approval gate is pinned to the literal `/welcome`, and
must stay that way; see step 2).

### 2. Widen the in-app router allowlist — and stop the gate logging a firehose

```ts
const ROUTABLE_PATHS = new Set(EXTERNAL_DEEP_LINK_PATHS);
```

**Everything else in that file stays exactly as it is.** Exact matching stays (no prefix, no
`isRouteActive`). The approval-marker gate stays pinned to the `/welcome` literal — its
docblock explains that an approval riding on `/join` would raise the approval sheet over a
join flow, and that reasoning is unchanged by adding entity paths. The hash-forwarding rule,
the `markConsumed` omission on the warm path, and the launch-URL replay guard are all
untouched. `navigate()` keeps using `parsed.pathname` rather than the normalised path —
vue-router is non-strict, so `/activities/` still resolves, and changing it would alter
`/join` behaviour for no gain.

The docblock gains one paragraph: the set is now shared with the OS manifests, and exact
matching still holds for the same two-gate reason.

**⚠️ Do not extract `handle()` into a "classifier + effects" pair.** The gate is growing a
third branch and will look like a refactor candidate. It is not one. That function's safety
property is stated as a position in a linear read — "EVERYTHING BELOW IS AFTER the origin and
path checks, never before them" — and splitting it puts an untrusted URL into a returned
object that a second function must remember not to trust. The existing test harness already
drives the whole function through the Capacitor mock, so extraction buys no testability
either. Keep the new branch inline, in order, above that warning.

**The origin gate splits into three outcomes, not two.** Logging every rejected URL as
`foreign-origin` would be a false-signal firehose: `iosOpenInAdapter.ts:72-76` shows
`appUrlOpen` also delivers `file://` URLs for every iOS "Open in beanies" document, and those
reach this gate. An info event per shared document would drown the one event this work makes
alertable.

```ts
// Not an https URL at all: another appUrlOpen listener owns it BY CONSTRUCTION —
// `file://` belongs to iosOpenInAdapter, the custom scheme was already handled by
// `nativeOAuthTransport` above. Silent on purpose; logging here would emit an event
// for every shared document and bury `path-not-claimed`.
if (parsed.protocol !== 'https:') return;
if (parsed.hostname !== 'app.beanies.family') {
  // ⚠️ NO `routePath`. On a foreign host the path is not one of our routes and is
  // wholly attacker-supplied free text; `route_path` is an allowlisted field and
  // `deepLinkEvents.ts` records the incident where untrusted URL content leaked into
  // it. This event should never fire at all, so its VALUE is its existence, not its
  // detail — if it ever fires, the next step is the device, not the field.
  emitInboundLinkIgnored({ errorCode: 'foreign-origin' });
  return;
}
const path = normalisePath(parsed.pathname);
if (!ROUTABLE_PATHS.has(path)) {
  // Our own host: the path IS one of our URLs and is the actionable value.
  emitInboundLinkIgnored({ routePath: parsed.pathname, errorCode: 'path-not-claimed' });
  return;
}
```

An https URL on a host that is not ours should never happen, so it is `warn` and genuinely
anomalous. An unclaimed path on our own host is `info`, and it is the drift signal.

### 3. Route the inbound-link events through the `login-flow` facade

`src/services/telemetry/loginFlowEvents.ts:5` states the rule: no view or service calls
`logEvent` with a hand-typed `login-flow` event string, "the headline metric is only
trustworthy if payload shapes can't drift per call site." `inboundLinkBridge` predates that
rule and violates it four times, and `loginFlowEvents.ts:296` records a prior instance of
exactly this migration. Since this plan already rewrites three of those call sites, all four
move behind the facade — all four, so the end state is checkable by absence rather than by
inspection: **`inboundLinkBridge.ts` stops importing `logEvent` entirely.** (`reportError`
stays; it is a different import and a different surface contract.)

```ts
export function emitInboundLinkRouted(payload: { routePath: string }): void;
export function emitInboundLinkIgnored(payload: {
  errorCode: 'path-not-claimed' | 'foreign-origin';
  /** Our own host only — deliberately absent for `foreign-origin`. See the bridge. */
  routePath?: string;
}): void;
export function emitInboundLinkUnparseable(): void;
export function emitLaunchUrlReplaySuppressed(): void;
```

**Both shipped strings are preserved verbatim — `message` AND `action`.** Today the bridge
ships a prose `message` ("inbound link routed") alongside a snake_case `action`
(`inbound_link_routed`); the facade's other functions use the event name for both. The
migration keeps the bridge's existing pairs exactly as they are. `action` is the field
`docs/plans/2026-09-18-device-approval-deeplink-notification.md:40` and the CloudWatch filters
key on; `message` is what `logEvent`'s rate limiter buckets on (`logEvent.ts:85-86`,
`key = surface::normalizeMessage(message)`). Neither is worth churning for cosmetic
consistency. A one-line comment on the group records the deviation and why, so nobody
"tidies" it into a silent observability break.

The exact table the facade ships:

| function                                      | level | `message` (shipped)                                        | `action`                       |
| --------------------------------------------- | ----- | ---------------------------------------------------------- | ------------------------------ |
| `emitInboundLinkRouted`                       | info  | `inbound link routed` _(unchanged)_                        | `inbound_link_routed`          |
| `emitInboundLinkIgnored` / `path-not-claimed` | info  | `inbound link path not routable; ignored` _(unchanged)_    | `inbound_link_ignored`         |
| `emitInboundLinkIgnored` / `foreign-origin`   | warn  | `inbound link from a foreign origin; ignored` _(new)_      | `inbound_link_ignored`         |
| `emitInboundLinkUnparseable`                  | warn  | `inbound link was not a parseable URL` _(unchanged)_       | `inbound_link_unparseable`     |
| `emitLaunchUrlReplaySuppressed`               | info  | `launch url already consumed; not replaying` _(unchanged)_ | `launch_url_replay_suppressed` |

**⚠️ The two `ignored` reasons get DIFFERENT `message` strings on purpose, and the function
derives both `level` and `message` from `errorCode` rather than taking them as arguments.**
One shared message would put both reasons in one 50-events-per-minute rate bucket, so a device
tapping look-alike links could suppress the one genuinely anomalous `foreign-origin` warn —
the exact "bury the alertable signal" failure this step exists to avoid. Separate messages give
separate buckets and separate levels while `action` stays single-valued, so the CloudWatch
query is still one filter on `action = 'inbound_link_ignored'` with `error_code` as the
breakdown. The `errorCode` union stops a third spelling of the reason appearing later.

`route_path` is set from `parsed.pathname` and never from `href` or `fullPath` —
`deepLinkEvents.ts` records the incident where exactly that leaked a fragment into this
allowlisted field.

### 4. Regenerate the app-host AASA — with the warning inside the file

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["V2CKCNM3S7.family.beanies.app"],
        "components": [
          {
            "/": "/oauth/*",
            "exclude": true,
            "comment": "DO NOT REPLACE THIS LIST WITH A WILDCARD. /oauth/callback is the Drive Picker's WEB return path; handing it to the app breaks it. The enumeration below must equal EXTERNAL_DEEP_LINK_PATHS in src/constants/externalDeepLinkPaths.ts — a tripwire test enforces it."
          },
          { "/": "/accounts" },
          { "/": "/activities" },
          { "/": "/assets" },
          { "/": "/family" },
          { "/": "/goals" },
          { "/": "/join" },
          { "/": "/lists" },
          { "/": "/pod" },
          { "/": "/todo" },
          { "/": "/transactions" },
          { "/": "/travel" },
          { "/": "/welcome" }
        ]
      }
    ]
  }
}
```

AASA components are evaluated in order and the first match wins, so the exclusion must be
first. It is redundant given enumeration, and kept anyway: it is the one line that survives if
someone later "simplifies" the list to a wildcard.

`comment` is a documented, ignored-by-matching key on an AASA component, which is how this
repo's in-place-reasoning convention survives a JSON file that permits no `//`. The tripwire
reads only `'/'` and `exclude`, so the prose cannot break it.

**`public/.well-known/README.md` needs a correction, not just an addition.** It currently
states, under the `assetlinks.json` heading, _"There is no longer an
`apple-app-site-association` on this origin (it was `webcredentials`-only)."_ That sentence is
**false today** — the file exists on this origin and carries `applinks` for `/join` and
`/welcome`. It was true only between the ADR-029 passkey retirement and the shared-links work
that re-added the file, and nobody went back. Leaving a demonstrably wrong sentence in the
document that describes this directory, in the same commit that widens the file it denies
exists, is precisely the drift this repo guards against. The edit is:

- Replace that sentence with an accurate one: the `webcredentials` association was retired; an
  `applinks` association was later added on this origin for shared links and now for entity
  deep links.
- Add an `apple-app-site-association` row to the "two files on two origins" table so the
  app-origin AASA sits beside the apex one.
- Add the short maintenance section: the path list is pinned to `EXTERNAL_DEEP_LINK_PATHS`,
  adding a path means three edits (TS module, this file, `AndroidManifest.xml`), and the
  tripwire names all three when it fails.

`web/public/.well-known/apple-app-site-association` (the apex) is **not touched**.

### 5. Widen the Android intent-filter, and tighten it to exact paths

```xml
<data android:scheme="https" android:host="app.beanies.family" android:path="/activities" />
<!-- …one per path… -->
```

A deliberate tightening as well as a widening: today `pathPrefix="/join"` claims `/joinery` at
the OS layer and relies on the bridge to reject it. `android:path` makes the OS claim and the
bridge agree exactly. Query strings are not part of Android path matching, so
`/activities?activity=<id>` still matches `android:path="/activities"`. All `<data>` elements
stay inside the one existing filter, repeat scheme+host, and stay **one per line** — matching
the current file's shape, and keeping the tripwire a line scan rather than an XML parser
(step 7). The filter's existing comment gains a line pointing at
`src/constants/externalDeepLinkPaths.ts` as the list's owner.

**The narrowing was checked against every URL the app actually mints, not assumed safe.**
`inviteService.buildInviteLink` emits `${origin}/join?${search}`, `recoveryKit` emits
`${origin}/welcome#beanies-kit=…`, and `eventDescription.activityAppUrl` emits
`${origin}/activities?activity=…` — all exact paths, no trailing slash, no subpath. Fragments
and query strings are outside Android path matching, so both still match. The one shape that
stops being claimed is a hand-typed trailing slash (`/join/`), which falls back to the browser
— graceful, and not produced anywhere. Legacy hash-routed invites (`/#/join?…`, still accepted
by `parseInviteLink`) have pathname `/` and were never claimed by `pathPrefix="/join"` either,
so there is no regression there.

The apex `/oauth/native` filter, the custom-scheme filter and the share-target filter are
**not touched**.

⚠️ **This edit breaks an existing test.** `src/constants/__tests__/nativeOAuth.manifests.test.ts:84`
asserts `/android:host="app\.beanies\.family" android:pathPrefix="\/join"/`. Step 7 handles it
by moving that whole block rather than patching the regex. The _other_ `pathPrefix` assertion
in that file (`android:pathPrefix="/oauth/native"`, on the apex host) is untouched and must
stay.

### 6. Add the PWA rung

**Required — this is what requirement 4 needs:**

```ts
handle_links: 'preferred',
```

**Optional, and gated on manual test 14 being run before merge:**

```ts
launch_handler: { client_mode: 'navigate-existing' },
```

Both are typed in vite-plugin-pwa's `ManifestOptions` (`dist/index.d.ts:642` and `:646`), so
this is type-checked, not a cast.

`handle_links: 'preferred'` asks an installed PWA to capture in-scope links instead of opening
a browser tab. It touches nothing else and carries no regression path.

`launch_handler: navigate-existing` makes an already-open PWA window navigate to the tapped
link rather than spawning a second window. **It is the one field here that changes how _every_
launch reaches an already-open window — including the #64 share target.** Chromium's default
`auto` already resolves to navigate-existing for a standalone PWA in the common case, so this
field buys determinism rather than new behaviour. That asymmetry — bounded benefit, unbounded
blast radius — is why it is gated rather than bundled:

- **Ship it only if manual test 14 (share target, with the PWA already open) is run and passes
  before merge.** If that test cannot be run in this cycle, ship `handle_links` alone; nothing
  in requirement 4 depends on `launch_handler`.
- **Rollback is a single line**, and safe: deleting it restores `auto`, which is the behaviour
  shipping today. No code reads it and no test depends on it.

There is one place the two fields interact, and it argues mildly _for_ keeping
`launch_handler` once verified: if an installed PWA does capture the `/oauth/callback` return,
`navigate-existing` keeps that return inside the window that holds the picker's parked
`sessionStorage` selection, where a new window would lose it. That is why manual test 13 covers
the PWA and not only native — and it is the same test that would catch the opposite outcome.

**Honest limitation.** `handle_links` is an incubating member with partial support, and
Android's real PWA link capture comes from the WebAPK Chrome installs plus a user-controlled
"open supported links" toggle in system settings. Requirement 4 is therefore best-effort by
construction: these fields improve the odds, and unsupported browsers ignore them without
error, so there is no fallback branch to write and nothing to feature-detect. Do not write an
acceptance criterion claiming a guarantee the platform does not offer.

Because `scope` is `/`, link capturing is scope-wide and cannot be narrowed to
`EXTERNAL_DEEP_LINK_PATHS` — the one layer where enumeration is unavailable.

### 7. One tripwire test, not two — move, don't copy; and make its failure actionable

`nativeOAuth.manifests.test.ts`'s `describe('shared links open the app')` block **already**
asserts the app-host AASA claims `/join` and `/welcome`, that the entitlement claims the app
host, that Android claims the same host and path, and that the apex does not claim `/join`. A
second file asserting the same facts is duplication, and its Android assertion breaks under
step 5 anyway.

- `nativeOAuth.manifests.test.ts` keeps only what is about OAuth: the bridge scheme in
  `Info.plist` and `AndroidManifest.xml`, the apex `pathPrefix="/oauth/native"` filter, the
  zero-imports constraint, the Astro interstitial check, and the `OAuthNativeBridge` route-name
  pin. Its `describe('shared links open the app')` block is removed with a one-line pointer to
  its new home.
- New `src/constants/__tests__/deepLinkPaths.manifests.test.ts` becomes the single owner of
  shared-link claims, carrying the moved assertions plus:
  - The app-host AASA's non-excluded components equal `EXTERNAL_DEEP_LINK_PATHS`.
  - The AASA's first component is the `/oauth/*` exclusion.
  - The Android `app.beanies.family` filter's `android:path` values equal
    `EXTERNAL_DEEP_LINK_PATHS`, and it declares no `pathPrefix` (the tightening, pinned).
  - **The number of `android:host="app.beanies.family"` lines equals the number of paths
    extracted from them.** This guards the line scan's own premise: if someone ever folds the
    host onto a separate `<data>` element, the scan would quietly extract zero paths and a
    set-equality assertion against an empty list would need to fail loudly rather than the test
    silently stopping doing its job. A tripwire that can go green by finding nothing is worse
    than no tripwire.
  - No claimed path starts with `/oauth`, on either platform.
  - The entitlement still claims `applinks:app.beanies.family`.
  - The apex AASA still claims `/oauth/native` and still does not claim `/join`.

**Two constraints on how it is written, because a tripwire nobody can read is a tripwire
somebody deletes:**

- **Parse simply.** One local helper `aasaPaths(file)` — `JSON.parse` → `flatMap` components →
  keep entries without `exclude` → map `'/'` — used for _both_ the app-host and apex
  assertions (the file being moved currently repeats that flatMap twice; do not carry the
  duplicate across). It reads only `'/'` and `exclude`, so the `comment` prose cannot break it.
  For Android, scan lines containing `android:host="app.beanies.family"` and pull
  `android:path="…"` from each. There is exactly one such filter, so a line scan is equivalent
  to block-slicing and cannot rot the way an XML block parser does. Do not add an XML
  dependency.
- **Say what to do.** Every assertion uses the `expect(actual, 'message')` form already used in
  `inboundLinkBridge.test.ts`, and the message names the three files that must agree:
  `src/constants/externalDeepLinkPaths.ts`, `public/.well-known/apple-app-site-association`,
  `android/app/src/main/AndroidManifest.xml`. A failure six months from now should be a
  to-do list, not a regex to reverse-engineer.

`repoFile` moves to `src/test/repoFile.ts` — three suites now need it (both manifest tests and
the `welcomeGateTarget` call-site pin in step 8), `src/test/` already holds bare-`.ts` helpers
(`consentGrant.ts`), and vitest's `include` is `src/**/*.{test,spec}.ts` (`vitest.config.ts:17`),
so a bare `.ts` there is a helper, not a collected suite. The comment explaining _why_ it
resolves from `process.cwd()` rather than `import.meta.url` (happy-dom serves an `http://`
`import.meta.url` that `fileURLToPath` rejects) travels with it — that is the part worth not
duplicating.

`inboundLinkBridge.test.ts` gains: an entity path routing with its query preserved; a
look-alike (`/activitiesX`) rejected with `path-not-claimed` **and a `route_path`**; a foreign
https host rejected with `foreign-origin` **and no `route_path`**; `/oauth/callback` rejected;
a `file://` URL rejected with **no** event at all; and the approval marker still honoured only
on `/welcome`. Its existing `/settings` and `evil.example.com` cases still hold unchanged
(`evil.example.com` now additionally asserts the new warn), and its `logEvent` mock keeps
working through the facade untouched (the facade is not mocked; it calls the same mocked
`logEvent`).

### 8. Carry the deep link through sign-in — record it once, read it once

Without this, requirement 1 fails on exactly the journey the tracker describes, and the
original draft of this step fixed only half of it.

**Why half.** `router.beforeEach` (`router/index.ts:513-521`) is the only site that sets
`?next=`, and it bails at `if (!authStore.isInitialized) return;`. On a cold web load or a cold
native launch the store is not initialized yet, so the guard never runs for the deep link. The
redirect that actually fires is `App.vue:1337` — inside the `authStore.needsAuth` branch of
init, `router.replace('/welcome')`, no query. The intent is destroyed before anything could
read it. Consuming `?next=` alone would have shipped a fix that passes its unit test and does
nothing on a phone.

**Why both sites, and not just App.vue.** On native, `installInboundLinkListener` is called at
`App.vue:1832` during setup while `getLaunchUrl()` resolves asynchronously, so the bridge's
`router.replace` can land either side of init. Both orderings are covered only if both
redirects record the intent: if the bridge navigates first (store not yet initialized, guard
bails) App.vue's branch sees `/activities?activity=…` as `route.fullPath`; if it navigates
after init, App.vue has already gone to `/welcome` and the _guard_ is the one that fires on the
bridge's navigation. Neither site alone covers the race.

**Record it once.** Both redirect sites mean the same thing — "an unauthenticated visitor hit a
protected route; send them to the welcome gate." They are in different files and cannot be the
same comparison, so this is the case `inboundLinkBridge`'s "no shared helper" preference does
_not_ cover: there is no by-construction option, and two hand-written copies of the same query
literal is the exact drift class this whole plan exists to remove. One small pure function,
added to `src/utils/appChrome.ts` — which already owns the neighbouring unauthenticated-routing
question (`isPublicEntryRoute`, consulted one line above the App.vue redirect) and is already
imported by App.vue and `useNotifications`. `src/router/index.ts` references it in a comment
today and gains a real import; there is no cycle, because `appChrome` imports only vue-router
types plus `LOGIN_DESTINATION` from `services/auth/loginFlow.ts`, which is a pure state machine
with type-only imports.

```ts
/**
 * Where to send an unauthenticated visitor who hit a protected route, preserving their
 * intent as `?next=`.
 *
 * ⚠️ TWO CALL SITES, AND BOTH ARE LOAD-BEARING. `router.beforeEach` handles navigations
 * AFTER auth init; it bails while `!isInitialized`, which is every cold load and every
 * cold native launch — so `App.vue`'s `needsAuth` branch is the one that fires on a
 * tapped deep link. It used to `router.replace('/welcome')` and drop the path, which is
 * why a calendar link on a signed-out phone signed the user in and landed them on /nook.
 * On native the two orderings race (the inbound-link bridge's navigate can land either
 * side of init), so covering one site is covering half the time.
 *
 * `next` is omitted when it is already the default destination: `/` redirects to
 * `LOGIN_DESTINATION`, so without this EVERY ordinary signed-out app open would carry
 * `?next=/nook` — noise on the sign-in URL, and it would make `next` mean "any arrival"
 * rather than "an intent".
 */
export function welcomeGateTarget(fullPath: string): RouteLocationRaw {
  return fullPath === LOGIN_DESTINATION
    ? { name: 'Welcome' }
    : { name: 'Welcome', query: { next: fullPath } };
}
```

- `router/index.ts:513-521` → `return { ...welcomeGateTarget(to.fullPath), replace: true };`
  Its docblock's "the param is available for future use" line is replaced with what now
  consumes it.
- `App.vue:1337` → `router.replace(welcomeGateTarget(route.fullPath));`
  The surrounding `isPublicEntryRoute` guard and breadcrumb are unchanged, and it stays plain
  `router.replace` rather than `safeRouterReplace` — that hardened wrapper exists for the
  podless self-rescue loop, and borrowing it here would change failure semantics for no reason.

Each call site keeps its own replace semantics; the helper does one thing.

**The `?next=` value round-trips intact, checked against vue-router's encoder, not assumed.**
`encodeQueryValue` (`vue-router/dist/devtools-*.mjs:138`) is `encodeURI` plus explicit escapes
for `#`, `&`, `+` and space. So `?` and `/` stay literal and `&` becomes `%26`:
`/welcome?next=/activities?activity=abc` is what appears in the address bar, and
`/transactions?view=a&x=b` becomes `next=/transactions?view=a%26x=b`. `parseURL` splits on the
FIRST `?` and `parseQuery` splits on `&` before decoding, so a multi-param deep link survives
whole. **Do not "helpfully" add an `encodeURIComponent` at either end — that would double-encode
and is the classic way this breaks.** One unit case pins the multi-param round-trip through a
real router `resolve`, because a silently truncated intent is indistinguishable from a working
one on the single-param happy path.

**It also survives the Google redirect round-trip, which the dominant journey contains.**
A signed-out cold arrival that signs in with Drive leaves the origin.
`usePickBeanpodFile.currentReturnPath()` (`:105-107`) is
`window.location.pathname + window.location.search`, so `/welcome?next=…` is what goes into the
OAuth state and what `OAuthCallbackPage` navigates back to (after `isSameOriginReturnPath`,
which accepts it). Verified from source rather than left as an open risk — but confirmed on a
real device by browser check 9c, because this is the path the tracker's user actually walks.

**Read it once.** `src/pages/LoginPage.vue:784` `handleSignedIn` is documented as "the single
canonical arrival point for EVERY entry path — create, load, join, reconnect", which is why the
kept-recipe redirect already lives there rather than in a watcher.

```ts
// The auth gate records a signed-out arrival's intent as `?next=` (appChrome.welcomeGateTarget,
// set from BOTH the router guard and App.vue's init redirect). Nothing consumed it until now,
// so a tapped calendar link on a signed-out device signed the user in and then dropped them on
// /nook — the same "opened and went nowhere" failure the inbound-link bridge exists to prevent.
//
// `isSameOriginReturnPath` is the SAME open-redirect guard App.vue uses for the OAuth
// return path: `next` is attacker-supplied (`?next=//evil.example`), and this is the only
// thing standing between that and `router.replace`. It is a type guard, so the narrowing
// to `string` is what makes this compile — do not replace it with a truthiness check.
//
// `next` outranks `destination` because it is the user's intent and `destination` is a
// default: every `signed-in` emit site passes `LOGIN_DESTINATION`, so today the ordering is
// a no-op — it only starts to matter if a second destination ever appears, and then intent
// should still win.
const next = route.query.next;
const returnTo = isSameOriginReturnPath(next) ? next : destination;
router.replace(hasPendingKeptRecipe() ? KEPT_RECIPE_DESTINATION : returnTo);
```

`route` and `router` are already in scope (`LoginPage.vue:43-44`); the only new import is
`isSameOriginReturnPath` from `@/services/google/redirectState` (`redirectState.ts:150`). The
kept-recipe destination keeps precedence — that ordering is already argued in place and is not
disturbed. A `next` pointing at a permission-gated route is handled by the existing guards
(finance → `/no-access`, an informative page); nothing new is needed and nothing is invented.

**One drift pin, because the half-fix was invisible to unit tests.** `src/utils/__tests__/appChrome.test.ts`
gains a single assertion that `src/App.vue` and `src/router/index.ts` both call
`welcomeGateTarget(` — a source scan using the shared `repoFile` helper. This is a drift pin,
not a behaviour test, and it is written as one: the repo already accepts exactly this shape for
App.vue (`nativeOAuth.manifests.test.ts`'s `OAuthNativeBridge` block, whose docblock explains
that nothing in this repo mounts App.vue and the failure mode is drift between two files). The
regression it defends against — someone "simplifying" App.vue back to `router.replace('/welcome')`
— is the precise bug Pass 3 found, and no unit test can see it.

### 9. Correct the stale entitlements comment

`App.entitlements` says "One association:" while the array declares two
(`applinks:beanies.family` and `applinks:app.beanies.family`). Corrected to name both, with a
line saying the app-host association backs shared links and entity deep links and pointing at
`src/constants/externalDeepLinkPaths.ts`.

**The `<APPLE_TEAM_ID>` sentence in the same comment is corrected too**, reversing the draft's
position. It claims the AASA "currently holds the `<APPLE_TEAM_ID>` placeholder"; both AASA
files on disk carry the real `V2CKCNM3S7`, and `grep -rn '<APPLE_TEAM_ID>'` finds no placeholder
in `public/` or `web/public/`. `docs/plans/2026-08-06-ios-oauth-custom-scheme-bridge.md:92` and
`:439` already identified this sentence as stale and resolved to fix it; the fix never landed.
Leaving a known-false line inside a comment we are rewriting, and which a previous plan already
called out, is the drift this repo guards against. The correction is comment-only, touches no
entitlement value, and keeps the pointer to the submission runbook for the parts that remain
live. (Assumption 2 is updated accordingly.)

## Files Affected

**Created**

- `src/constants/externalDeepLinkPaths.ts`
- `src/constants/__tests__/deepLinkPaths.manifests.test.ts`
- `src/test/repoFile.ts`
- `src/pages/__tests__/LoginPage.deepLinkNext.test.ts` (matches the existing
  `LoginPage.<topic>.test.ts` convention in that directory)

**Modified**

- `src/utils/entityDeepLink.ts` — switch → exported `ENTITY_DEEP_LINKS` record; docblock lines
- `src/services/share/inboundLinkBridge.ts` — shared allowlist, three-way gate, facade calls,
  `logEvent` import removed, docblock note
- `src/services/telemetry/loginFlowEvents.ts` — four `emitInboundLink*` / `emitLaunchUrl*` functions
- `src/utils/appChrome.ts` — `welcomeGateTarget()`
- `src/router/index.ts` — guard returns `welcomeGateTarget(...)`; new `appChrome` import; docblock updated
- `src/App.vue` — `needsAuth` redirect uses `welcomeGateTarget(route.fullPath)`
- `src/pages/LoginPage.vue` — honour `?next=` in `handleSignedIn`
- `public/.well-known/apple-app-site-association` — enumerate + exclusion + `comment`
- `public/.well-known/README.md` — **correct the false "no AASA on this origin" sentence**, add
  the AASA row to the two-origin table, document the pinned path list and the three-file edit
- `android/app/src/main/AndroidManifest.xml` — enumerate, `path` not `pathPrefix`, one per line
- `vite.config.ts` — `handle_links` (required), `launch_handler` (gated on manual test 14)
- `ios/App/App/App.entitlements` — correct the stale comment (both associations; the
  `<APPLE_TEAM_ID>` line)
- `src/constants/__tests__/nativeOAuth.manifests.test.ts` — move the shared-link block out; adopt `repoFile` helper
- `src/services/share/__tests__/inboundLinkBridge.test.ts` — new cases
- `src/utils/__tests__/appChrome.test.ts` — `welcomeGateTarget` cases + the call-site drift pin

**Explicitly not touched**

- `web/public/.well-known/apple-app-site-association` (apex OAuth)
- `src/constants/nativeOAuth.ts`, the custom-scheme bridge, the share-target filter
- `nativeOAuth.manifests.test.ts`'s apex `android:pathPrefix="/oauth/native"` assertion
- `src/utils/__tests__/entityDeepLink.test.ts` — already pins all nine mappings

## Observability Coverage

**No new context key is required**, which removes the store-declaration burden entirely:
`route_path`, `action` and `error_code` are already in `ALLOWED_CONTEXT_KEYS`
(`src/utils/diagnosticContext.ts:61-69`). Nothing needs adding to the Lambda mirror,
`PrivacyInfo.xcprivacy`, the Data-Safety answers, or `privacy.astro`.

**Events** (all on the existing `login-flow` surface, all through `loginFlowEvents.ts`):

| Event                      | Level | When                                     | Context                                                   |
| -------------------------- | ----- | ---------------------------------------- | --------------------------------------------------------- |
| `inbound_link_routed`      | info  | a link was routed into the router        | `route_path`                                              |
| `inbound_link_ignored`     | info  | our host, path not claimed               | `route_path`, `error_code: 'path-not-claimed'`            |
| `inbound_link_ignored`     | warn  | https URL from another host              | `error_code: 'foreign-origin'` (no `route_path` — see §2) |
| `inbound_link_unparseable` | warn  | `new URL()` threw                        | `action` only                                             |
| _(no event)_               | —     | non-https URL (`file://`, custom scheme) | another adapter owns it                                   |

Changes to existing behaviour: `inbound_link_ignored` currently carries **no** `route_path` and
no reason, so today a rejected link is indistinguishable from any other rejected link. It gains
both on our own host. A foreign origin is currently a bare `return` with no event at all — the
one genuinely anomalous case gains a `warn`, in its own rate bucket so a flood of the info case
cannot suppress it.

**Failure modes and how each is triaged blind:**

- _Link opened the app and went nowhere_ — `inbound_link_ignored` / `path-not-claimed` with the
  offending `route_path` names it directly. If the OS claim ever drifts wider than the
  allowlist, this is what fires, and it is the alertable signal. Keeping `file://` silent is
  what keeps it alertable.
- _Link never reached the app at all_ — no event, by construction, because the app never
  launched. Not observable from the client; diagnosed on-device with
  `adb shell pm get-app-links family.beanies.app` (Android) or the Universal Links diagnostics
  (iOS). Stated rather than left as a false claim of coverage.
- _Deep link lost at sign-in_ — closed by step 8. If it regresses, `inbound_link_routed` fires
  with `/activities` and the user still reports landing on the Nook; that pairing is the
  fingerprint. No new event is added for it: the pairing is already sufficient, and a
  "next honoured" event would need a fifth context key for no triage gain.
- _Picker return hijacked_ — `inbound_link_ignored` with an `/oauth/callback` `route_path`
  would be the smoking gun, paired with a drop in `picker_redirect_returned_web`.
- _Consumer threw_ — unchanged; already `reportError` at `severity: 'error'`.

**Success-path signal:** `inbound_link_routed` already fires on success, so routed-versus-
ignored is a measurable _rate_, not just a failure count.

**Critical vs firehose:** nothing warrants `severity: 'critical'`. No user data is at risk and
every failure degrades to "the link opened in a browser," which is today's behaviour.

## Important Notes & Caveats

- **Do not "simplify" the AASA to a wildcard.** The enumeration is the mechanism that keeps the
  OS claim and `ROUTABLE_PATHS` identical. The tripwire test will fail, and the exclusion
  component's own `comment` field plus `externalDeepLinkPaths.ts` both say why.
- **Do not claim the apex for entity links.** The `AndroidManifest.xml` comment records why:
  `apex-cutover.js` 301s `/join` to the app host, and both platforms match the URL that was
  _tapped_ without following redirects, so an apex claim verifies and then never fires.
- **Adding a deep-linkable path is a three-file edit, on purpose.** TS module → AASA →
  AndroidManifest, with the tripwire naming all three. That is the cost of not claiming the
  host wide, and it is the cost the Picker hazard buys down.
- **Android App Link verification is per-DOMAIN, not per-path, and not instant.** It happens at
  install time against the live `assetlinks.json`. `pm get-app-links` reports
  `app.beanies.family` as verified or not — it does not list paths, so manual test 11 checks the
  domain and then proves the paths by tapping. A claim added here does nothing on a device until
  the app is reinstalled or `pm verify-app-links` is re-run.
- **The AASA is fetched through Apple's CDN and cached.** A production device may keep serving
  the old two-path file for up to ~24h after deploy. Install a fresh TestFlight build before
  concluding iOS is broken.
- **iOS fires Universal Links only on user-initiated taps.** A server-side redirect into a
  claimed URL inside `SFSafariViewController` does not hand off — documented in
  `src/constants/nativeOAuth.ts`, and precisely why the custom-scheme bridge exists. The Picker
  hazard is therefore smaller on iOS than on Android; the exclusion is kept regardless.
- **`launch_handler` is optional and gated.** It ships only if manual test 14 is run and passes;
  otherwise ship `handle_links` alone. Rollback is deleting the one line, which restores `auto`
  — today's behaviour.
- **Four of the claimed paths are finance-gated, not one.** `/accounts`, `/assets`, `/goals` and
  `/transactions` all carry `requiresFinance: true`; `/lists` carries `requiresFlag: 'familyLists'`.
  The finance guard redirects to `/no-access`, an informative page, not a silent drop. The flag
  guard redirects to `/nook` with no explanation — that _is_ silent, but `familyLists` is
  committed `true` (`featureFlags.committed.ts:14`), so it is unreachable today. If a future
  deep-linkable route is flag-gated, reuse the orphan quick-add guard pattern
  (`router/index.ts:600-618`), which strips the intent and shows a warning toast "so the user
  understands nothing opened silently." Do not invent a second mechanism.
- **Widening `ROUTABLE_PATHS` slightly widens what a crafted link can navigate to** — a
  malicious `https://app.beanies.family/transactions?view=<id>` would open the app on the
  transactions page. The harm ceiling is low: every route is `requiresAuth` (verified — all nine
  entity routes plus `/pod` carry `meta.requiresAuth: true`; `/family` is a bare redirect whose
  resolved target `/pod` carries it), the navigation is read-only, and it shows the user only
  their own pod's data. No key material, no approval marker, no destructive action.
  `/pod?invite=<id>` is the one query param on a claimed path that performs writes, and
  `MeetTheBeansPage.vue:271-291` already re-checks all three of the button's guards on the URL
  path for exactly this reason — read that docblock before assuming otherwise. Recorded as an
  accepted trade, not an oversight.
- **`?next=` is attacker-controllable.** Step 8 is only safe because it routes through
  `isSameOriginReturnPath`. Do not "simplify" it to a truthiness check, and do not wrap the
  value in `encodeURIComponent` at either end — vue-router already encodes it correctly and a
  second layer double-encodes.
- **Help Center coverage was assessed and is not required.** No existing article describes how a
  tapped link resolves, and this changes which surface opens rather than what the user can do.

## Assumptions

> Review before implementation.

1. ~~`/family` → `/pod` may drop the query string.~~ **Resolved statically, not an assumption.**
   vue-router's redirect handling (`node_modules/vue-router/dist/vue-router.mjs:1275-1279`)
   builds the target as `assign({ query: to.query, hash: to.hash, params }, newTargetLocation)`,
   and a string redirect contributes only `{ path, params }` — so `query` and `hash` survive.
   `/family?edit=<id>` reaches `/pod?edit=<id>`, which `MeetTheBeansPage.vue:296` consumes. No
   fix needed, and no unit test added: asserting it would be testing vue-router, not our code.
   Browser check 8 stays as a cheap confirmation.
2. ~~`V2CKCNM3S7` is the correct live Apple Team ID.~~ **Resolved.** Both AASA files on disk
   carry it and `grep -rn '<APPLE_TEAM_ID>' public web` finds nothing. The `App.entitlements`
   comment claiming otherwise is stale and is corrected in step 9.
3. The `assetlinks.json` SHA-256 fingerprints are current for the signing keys in use.
4. No path in `EXTERNAL_DEEP_LINK_PATHS` is served as a marketing page on `app.beanies.family` —
   that host is the SPA; marketing lives on the apex.
5. `handle_links` and `launch_handler` are ignored without error by browsers that do not support
   them. Typed in vite-plugin-pwa, so the build half is verified.
6. Attaching `?next=` to the welcome gate does not disturb the other `/welcome` consumers. They
   key on `route.path` / `route.name` or on the fragment (`main.ts`'s kit capture,
   `?resume=setup`, the already-authenticated bounce keyed on `to.path` via
   `ALREADY_AUTH_REDIRECT_FROM`), none on the absence of a query — and omitting `next` for the
   default destination keeps the ordinary signed-out URL unchanged. Confirmed by browser check 9b.

## Acceptance Criteria

- [ ] `ENTITY_DEEP_LINKS` is a `Record<DeepLinkType, …>`; `entityDeepLink` derives from it;
      omitting an entity is a compile error, not a test failure.
- [ ] `EXTERNAL_DEEP_LINK_PATHS` derives entity paths from `ENTITY_DEEP_LINKS`; no path hand-restated;
      it is the module's only export.
- [ ] `inboundLinkBridge` routes every path in the shared set, exact-match, query preserved.
- [ ] `/join` and `/welcome` behaviour is bit-for-bit unchanged: approval marker on `/welcome`
      only, recovery-kit hash forwarded, replay guard intact.
- [ ] `/oauth/callback` and `/oauth/native` are rejected by the bridge and claimed by neither
      the app-host AASA nor the Android filter.
- [ ] A `file://` URL produces **no** telemetry event.
- [ ] `foreign-origin` carries **no** `route_path`; `path-not-claimed` carries one. The two
      reasons ship distinct `message` strings (distinct rate buckets) and distinct levels, with
      one shared `action`.
- [ ] The app-host AASA and the Android intent-filter both enumerate exactly
      `EXTERNAL_DEEP_LINK_PATHS`; the Android filter declares no `pathPrefix` for the app host,
      and the apex `/oauth/native` `pathPrefix` is untouched.
- [ ] The apex AASA is byte-identical to its pre-change state.
- [ ] The PWA manifest declares `handle_links`. `launch_handler` is present only if manual
      test 14 was run and passed.
- [ ] There is exactly ONE test file asserting shared-link manifest claims, exactly one
      `repoFile` helper, and exactly one AASA-parsing helper inside that file.
- [ ] The Android tripwire cannot pass by extracting zero paths (host-line count is asserted).
- [ ] Every tripwire assertion carries a message naming the files that must agree.
- [ ] `inboundLinkBridge.ts` no longer imports `logEvent`; the shipped `message` and `action`
      strings for the four pre-existing events are unchanged from today.
- [ ] `?next=` is produced by exactly one function (`welcomeGateTarget`) and consumed at exactly
      one site (`handleSignedIn`); neither redirect site hand-writes the query literal, and a
      drift pin asserts both call sites still call it.
- [ ] A multi-query-param deep link round-trips through `?next=` without truncation.
- [ ] A signed-out arrival at `/activities?activity=abc` **through App.vue's init redirect**
      (not only through the router guard) reaches `/welcome?next=…` and lands on the activity
      after sign-in; `next=//evil.example` does not leave the origin; a signed-out arrival at
      `/nook` produces a bare `/welcome`.
- [ ] `public/.well-known/README.md` no longer claims this origin has no
      `apple-app-site-association`.
- [ ] `npm run validate` green.

## Testing Plan

**Automated**

1. Tripwire test: AASA, AndroidManifest and `EXTERNAL_DEEP_LINK_PATHS` agree; the Android host-line
   count matches the extracted path count; `/oauth` claimed by none; entitlement claims the app
   host; apex unchanged.
2. `inboundLinkBridge` units: entity path routes with query; `/oauth/callback` rejected;
   `/activitiesX` rejected with `path-not-claimed` **and** a `route_path`; `file://` rejected
   silently; foreign https host logs `foreign-origin` **without** a `route_path`; approval marker
   honoured on `/welcome` only and dropped-with-event elsewhere; kit hash still forwarded.
3. `welcomeGateTarget` units (pure, in the existing `appChrome.test.ts`): a protected path
   yields `{ name: 'Welcome', query: { next } }`; `LOGIN_DESTINATION` yields no query; a
   two-query-param path round-trips through a real `router.resolve` without truncation. Plus the
   one-line call-site drift pin on `App.vue` and `router/index.ts`.
4. `handleSignedIn` units: safe `next` honoured, unsafe `next` rejected, kept recipe wins.
5. `npm run validate`.

**Browser (Phase 4)** 6. `/activities?activity=<real id>` opens the activity modal — proves the destination half
independently of the OS claim. 7. The same for `/travel?vacation=`, `/todo?view=`, `/lists?view=`, `/accounts?view=`,
`/transactions?view=`, `/goals?view=`, `/assets?view=`. 8. `/family?edit=<member id>` — confirms Assumption 1's static resolution in a real router. 9. **Signed out, cold load** `/activities?activity=<id>` → the URL becomes
`/welcome?next=/activities?activity=<id>` (literal `?`, not `%3F` — see §8; this is the
App.vue path, not the guard, and it is the one that was silently dropping the intent). Sign
in → land on the activity, not the Nook.
9b. Signed out, cold load `/nook` → bare `/welcome`, no `next`, and the kit/`?resume=setup`
surfaces behave as today (Assumption 6).
9c. Signed out, cold load `/activities?activity=<id>`, then sign in via **Google Drive
redirect** (the leaves-the-origin path). Pass: the return lands back on `/welcome?next=…` and
the activity still opens. This is the dominant real-world journey and the one place `next`
leaves the app. 10. Light and dark, desktop and ~400px, on any surface that renders differently.

**Needs greg's hands (cannot be driven programmatically)** 11. Android: install a build, `adb shell pm get-app-links family.beanies.app` →
`app.beanies.family` verified. Tap the beanies link in a synced Google Calendar invite.
Pass: the app opens on that activity. Also tap a `/joinery`-style look-alike if one can be
produced: it must open the browser, proving the `path` tightening. 12. iOS: install via TestFlight (fresh install — the AASA is CDN-cached), tap the same calendar
link. Pass: the app opens on the activity. Platform limits may keep it in the browser from
some tap contexts; a known-acceptable outcome per the tracker's Notes. 13. **Drive Picker regression check — native AND installed PWA.** Run a joiner through the
Picker on each. Pass: the Picker completes as it did on 2026-09-20, the return is not
hijacked into the app, and `picker_redirect_returned_web` still fires on the web run. 14. **PWA share target regression check — GATES `launch_handler`.** `navigate-existing`
changes how a launch reaches an already-open window; share a photo into beanies with the PWA
open. Pass: `/share` opens with the file, as today (#64). Fail, or not run before merge →
ship without the `launch_handler` line; nothing else depends on it. 15. **Native cold-launch, signed out.** Force-quit the app, sign out first, then tap the
calendar link. Pass: the app launches, gates to welcome, and lands on the activity after
sign-in. This is the journey the guard never covered and check 9 only simulates on web. 16. PWA link capture: install the PWA (no native app present), tap a link. Pass: the PWA opens.
A browser tab is an acceptable outcome on browsers without link capturing — see §6.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from a full read of the three layers; settled the
  host-wide question in favour of enumeration; found that all nine entity receivers already
  exist and that no new telemetry key is needed.
- **Pass 2 (DRY + error handling)**: replaced the parallel type array + exhaustiveness test with
  an `ENTITY_DEEP_LINKS` record (compile-time exhaustiveness, one less list, one less test);
  caught that the `pathPrefix`→`path` tightening breaks `nativeOAuth.manifests.test.ts:84` and
  that the proposed new test duplicated its shared-link block — moved rather than copied, with a
  shared `repoFile` helper; routed the inbound-link events through `loginFlowEvents.ts` per that
  file's documented no-hand-typed-strings rule, keeping shipped strings identical; stopped the
  new `foreign-origin` event firing on the `file://` URLs `iosOpenInAdapter` receives, which
  would have buried the one alertable signal; added the missing fourth layer — `?next=` is
  captured by the auth guard and consumed by nothing, so a deep link tapped while signed out was
  silently discarded, fixed in `handleSignedIn` reusing `isSameOriginReturnPath`; resolved
  Assumption 1 from vue-router source; verified `handle_links`/`launch_handler` are typed and
  corrected the overclaim about PWA capture; added PWA Picker + share-target regression checks.
- **Pass 3 (Sustainability)**: found step 8 fixed only half the bug — `router.beforeEach` bails
  while `!authStore.isInitialized`, so on every cold load and cold native launch the redirect
  that actually fires is `App.vue:1337`'s bare `router.replace('/welcome')`, which never records
  the intent at all; consuming `?next=` alone would have passed its unit test and done nothing on
  a phone. Replaced the two hand-written redirect literals with one pure `welcomeGateTarget()` in
  the module that already owns the neighbouring question (`utils/appChrome.ts`), omitting `next`
  when it is the default destination, and added the cold-launch checks that would have caught it.
  Otherwise the pass was mostly about keeping the cost of this change flat over time: stated the
  derivation coupling explicitly with a walked-through "someone adds an entity" case and recorded
  the two rejected alternatives so they are not re-opened; pinned the tripwire to simple,
  readable parsing (one shared `aasaPaths` helper, a line scan rather than an XML block parser)
  with failure messages that name the three files to edit; moved the "do not wildcard" warning
  into the AASA itself via the component `comment` key and into `public/.well-known/README.md`,
  so the reasoning sits where a maintainer will meet it rather than only in a test; wrote an
  explicit prohibition on refactoring `handle()` into a classifier, since its linear order _is_
  the documented safety property; trimmed the new constants module to a single export; resolved
  the "byte-identical" ambiguity in the telemetry step (both `message` and `action` preserved,
  deviation from the facade's naming convention commented) and sharpened its criterion to
  "`logEvent` no longer imported"; and named `launch_handler` as an isolated rollback lever with
  the share-target check promoted to blocking.
- **Pass 4 (Fresh-eyes sweep)**: re-read every claim against source and found five things the
  earlier passes asserted rather than checked. (a) The telemetry step would have put both
  `inbound_link_ignored` reasons on one `message`, and `logEvent.ts:85-86` buckets its 50/min
  rate limit on `(surface, message)` — so a flood of the benign `path-not-claimed` could have
  suppressed the one anomalous `foreign-origin` warn the step exists to create; the facade now
  derives level _and_ message from `errorCode`, giving separate buckets under one `action`.
  (b) `foreign-origin` was carrying `parsed.pathname` from a host that is not ours — wholly
  attacker-supplied text into the allowlisted `route_path` field that `deepLinkEvents.ts`
  records an incident about; dropped, with the reasoning written where the decision lives.
  (c) Browser check 9 expected `/welcome?next=/activities%3Factivity=…`, but vue-router's
  `encodeQueryValue` is `encodeURI` plus escapes for `#`/`&`/`+`/space only, so `?` stays
  literal — a correct implementation would have looked like a failed test; corrected, and the
  `&`-escaping property pinned by a multi-param round-trip unit case, since a truncated intent
  is invisible on the single-param happy path. (d) Traced `?next=` across the Google redirect —
  `usePickBeanpodFile.currentReturnPath()` is `pathname + search`, so it survives — promoting
  the dominant real-world journey from unexamined risk to verified fact plus browser check 9c.
  (e) `public/.well-known/README.md` still states there is no `apple-app-site-association` on
  that origin, which the file's own existence contradicts; correcting it is now part of the step
  rather than an append. Also: reversed Pass 3 on the entitlements `<APPLE_TEAM_ID>` line (it is
  provably stale, `grep` finds no placeholder, and a 2026-08-06 plan already resolved to fix it);
  corrected the finance-gate caveat, which named one route where four are gated; verified the
  `pathPrefix`→`path` narrowing against every URL the app actually mints (all exact — no
  regression) and recorded the check instead of the assumption; noted that `router/index.ts`
  does not yet import `appChrome` and that the new import introduces no cycle; added a host-line
  count assertion so the Android tripwire cannot pass by silently extracting nothing; added a
  one-line call-site drift pin for `welcomeGateTarget` following the repo's existing App.vue
  source-scan precedent, because the Pass-3 bug was by definition invisible to unit tests; and
  demoted `launch_handler` from "ships with a blocking test" to "ships only if the test is run",
  since Chromium's `auto` already behaves this way and determinism is not worth an unverified
  change to how every launch reaches an open window.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (session start, tracker review)

> review the main issue tracker in notion and close out finished items and confirm everything
> in correct status. for the googel drive picker issue i've confirmed it works on ios

### Follow-up 1

> let's finish out #63 until it is complete and ready for testing/done - go ahead with
> /beanies-build-auto

</details>
