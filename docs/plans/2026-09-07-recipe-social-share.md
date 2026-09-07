# Plan: Share a recipe to WhatsApp, Discord and anywhere else

> Date: 2026-09-07
> Related issues: None on GitHub — direct implementation. Notion tracker row **#92** (`3d4247d9-a99f-81eb-9a5d-d7d6a5770790`)
> Plan file: `docs/plans/2026-09-07-recipe-social-share.md`
> Mockup: `docs/mockups/recipe-share-2026-09-07.html` (Direction A chosen)

> **No GitHub issue created.** Approved for direct implementation.

## User Story

As someone who has just cooked something good, I want to send the recipe to a friend on
WhatsApp or Discord, so that they can read it straight away and, if they want, keep it in
their own cookbook without retyping it.

## Context

A recipe is the most naturally shareable thing in beanies and there is no way to send one.
Every share is also an introduction to beanies from someone the receiver already trusts,
which is the one acquisition channel the product does not have.

The constraint that shapes everything: **beanies has no server holding user data.** A share
is by definition content leaving the pod. Greg's decision is that the payload rides in the
URL **fragment**, which is never transmitted in an HTTP request, so the recipe reaches no
server and no log. The trade — a copy lives in the receiver's chat history forever — is
accepted for a recipe and explicitly NOT generalised to finance or health data.

## Requirements

1. A **Share** action on the recipe detail page, beside Edit and "I cooked this".
2. Choosing a channel sends **one** message containing the recipe as readable text **and**
   a link, so the message is a gift to someone who never taps it.
3. The recipe payload is encoded in the URL **fragment**. Nothing about the recipe reaches
   a server, a log, or an analytics event.
4. The link opens a **public** route that renders the real recipe with no session and no pod.
5. That page offers one action to keep the recipe: straight into the cookbook for a
   signed-in user, and through sign-up/pod-creation for everyone else — with the recipe
   carried across that round trip wherever the platform allows, and an honest, actionable
   recovery where it does not.
6. The shared recipe is the sharer's own version, including edits, and works identically
   for a recipe captured from a photo (no `sourceUrl`).
7. A documented size cap, with a defined and honest degradation when a recipe exceeds it.
8. The decoded payload is treated as **hostile input**.
9. All new user-visible text via `t()` with both `en` and `beanie`.
10. **Discord specifically must work.** Discord publishes no share-intent URL, so the paths
    are the OS share sheet and paste-from-clipboard — both must carry the whole message,
    not just the link.

## Important Notes & Caveats

- **The payload is attacker-controlled.** Anyone can hand-craft `app.beanies.family/recipe#…`
  with arbitrary content and send it to a beanies user. It must be validated for shape,
  type, count and length before it is rendered, and again before it is written to a pod.
  Vue's mustache interpolation escapes by default — **no `v-html` anywhere on this path**,
  and no binding of any decoded string into an `href`, `src` or `style`.
- **The fragment must never become a query parameter.** A `?` would send the recipe to the
  server in the request line and into access logs, defeating the entire design. Anything
  that rebuilds this URL must preserve `#`. This is also why the sign-up round trip cannot
  use the router's `?next=` mechanism to carry the recipe, and why it can never ride the
  OAuth `state` param (see the stash note below).
- **Never log the payload.** Not in telemetry `context`, not in `message`, not in a
  `reportError`. Sizes, counts and fixed enums only. This is the one rule whose violation
  would be a privacy incident rather than a bug.
- **`btoa` cannot encode a recipe.** It throws `InvalidCharacterError` on any codepoint
  above 255 — "Crème Brûlée", "Ramen 🍜", every non-Latin name. The wire format therefore
  goes through `TextEncoder` + `bufferToBase64url` (`utils/encoding.ts:116`) and back
  through `base64urlToBuffer` (`:121`) + `TextDecoder`. `redirectState.ts:26-30` is allowed
  its inline `btoa` only because it carries ASCII routing, and says so.
- **⚠️ `meta.requiresAuth: false` is NOT enough — this is the finding that would have made
  the feature silently not work.** Two boot-time redirects in `App.vue` throw the fragment
  away before the page ever renders:
  - `App.vue:1216-1228` holds a **hardcoded array of route NAMES** and does
    `if (!authPages.includes(route.name)) router.replace('/welcome')`. An unauthenticated
    receiver — the primary case — is bounced and the recipe is gone.
  - `App.vue:1243-1279` — an authenticated-but-podless user is
    `safeRouterReplace(RESUME_SETUP_PATH)`-ed, losing the fragment **and** paging Slack with
    a `critical` `app.onboardingZombieState` report on every share-link open.
    Fixed by **merging that inline array into the route-name predicate the codebase already
    has** (`PODLESS_EXPECTED_ROUTE_NAMES` / `isPodlessExpectedRoute` in `utils/appChrome.ts`).
    **No new route-meta flag** — see Approach §5.
- **⚠️ That inline array is ALREADY WRONG today, and it is the same bug — verified on
  `main`.** `/share` (`ShareTarget`) is declared `requiresAuth: false` with a comment
  explaining it _must_ mount for a signed-out user so the Cache-Storage stash is deleted:
  "_this page is the only code that deletes the stash… nothing sweeps it, there is no TTL,
  and sign-out clears IndexedDB but not `caches`_" (`router/index.ts:333-346`). But
  `'ShareTarget'` is **absent** from App.vue's `authPages`, so the router-level fix is
  defeated by the second gate and a signed-out document share leaks into Cache Storage
  permanently. One word in the merged list fixes it. This is the evidence that the mechanism
  must be ONE list, not a per-route boolean a route author can forget.
- **Route meta is `requiresAuth: false` + `noChrome: true` + `hideQuickAdd: true`** — the
  same three every other public route already sets. `App.vue` gates the chrome on
  `showLayout`, and the `v-else` branch renders a bare `<router-view />`.
- **Do NOT add the new path to `ALREADY_AUTH_REDIRECT_FROM`** (`router/index.ts:377`, today
  `{'/welcome','/login'}`). That set bounces signed-in users to `/nook`; a signed-in user
  opening a share link must land on the recipe.
- **Do NOT strip the fragment after decoding.** `LoginPage.vue:318-322` strips the
  `beanies-kit=` fragment because that value is a credential. Here the fragment _is_ the
  content: stripping it breaks refresh, back, and re-opening the link later.
- **`scrollBehavior` is already safe and must stay that way.** `router/index.ts` returns
  `savedPosition ?? { top: 0 }` and never reads `to.hash`, so a base64 fragment is never
  handed to `document.querySelector('#…')` (which would throw). Do not "improve" it into
  hash-aware scrolling.
- **`ShareChannelGrid` is invite-branded, not invite-coupled.** It takes `{ link, familyName,
memberName, hideExpiryNote? }` and emits `shared`. It has exactly **two** render sites —
  `ShareInviteModal.vue:83` and `InviteWizardModal.vue:660`. Generalise it additively —
  **do not fork it**.
- **`ShareChannelGrid` has a live `$`-interpolation bug.** `:31-38` uses
  `String#replace('{member}', value)`, which interprets `$&`/`` $` ``/`$1` in the _value_.
  A family named `Smith $& Co` renders garbled today. `utils/fillTemplate.ts` exists for
  exactly this. Fix it while generalising.
- **`useShareText` exists with zero callers.** It is the right primitive, but (a) its toast
  keys are hardcoded `mealPlanner.share.*` and its `reportError` surface is hardcoded
  `'meal-planner'`, and (b) it degrades to clipboard on native for a reason it does not
  state: `navigator.share` is **not implemented in either WebView**
  (`shareOrDownloadFile.ts:11-15`). Both are fixed as part of adopting it.
- **`utils/shareStash.ts` is not this.** It is the **inbound** Web Share Target reader —
  files a service worker stashed in Cache Storage from a POST, read once and deleted.
  Opposite direction, different storage. The new module is `recipeKeepStash.ts` and its
  header says so, so nobody later "consolidates" them.
- **⚠️ No web storage survives the iOS Drive OAuth hop, and the recipe can never ride the
  workaround.** WebKit's bounce-tracking protection clears **the initiating site's
  script-writable storage** across a cross-site OAuth redirect, independently of the
  "Prevent Cross-Site Tracking" toggle (`services/google/redirectState.ts:1-11`). That is
  `localStorage` as well as `sessionStorage` — the repo removed a `sessionStorage` stash for
  exactly this reason on 2026-06-20 (`CreatePodView.vue:262`, `ResumePodSetup.vue:198`). The
  app's workaround is to carry routing in the OAuth `state` param, and that is **not
  available to us**: `state` is documented NON-SECRET and transits Google, URLs and logs
  (`redirectState.ts:12-15`). Putting a recipe there would violate the whole design.
  Therefore: `localStorage` is used because it survives every _other_ journey (tab close,
  app backgrounding, local-file setup, an already-signed-in user), and the one journey it
  cannot survive — new user choosing Google Drive on iOS — is handled by an honest,
  actionable recovery, not by pretending. **The recovery is expected behaviour on that
  path, not an edge case.** See Approach §6.
- **⚠️ The size cap must be derived from Discord, not picked.** Requirement 10 makes
  paste-into-Discord a first-class path, and a Discord message caps at **2000 characters**.
  An 8000-character URL guarantees that paste fails for exactly the recipes worth sharing.
  There is ONE constant, `MAX_SHARE_MESSAGE_CHARS = 2000`, measured on the composed message.
- **No compression, and now for a hard reason rather than a preference.** The app targets
  **iOS 15** (`docs/STATUS.md`); `CompressionStream` is Safari 16.4+. A compressed format
  would have to be conditional on the _sender's_ platform, putting two wire formats in the
  wild simultaneously — exactly the trap the version byte exists to avoid.
- **`SharedRecipePage` must not be consolidated with `RecipeDetailPage` later.** They look
  similar and are not: the detail page renders a stored `Recipe` with photos, cook logs,
  permissions and a pod behind it; the shared page renders untrusted, photo-less,
  store-less, session-less fields. Sharing markup would drag pod-aware code onto a public
  route. Stated so a future DRY sweep does not "helpfully" merge them.

## Assumptions

> Verified at planning time against the files cited.

1. Router auth guard is `if (!to.meta.requiresAuth) return;` — true, but **not** the only
   gate; see the App-shell note above.
2. `ALREADY_AUTH_REDIRECT_FROM = new Set(['/welcome','/login'])` (`router/index.ts:377`).
3. `App.vue` renders a bare `<router-view />` when `showLayout` is false, driven by
   `meta.noChrome` via `shouldShowAppLayout` (`utils/appChrome.ts`).
4. `createRecipe(input): Promise<Recipe | null>` (`recipesStore.ts:46`) runs through
   `wrapAsync`, which already owns the failure toast **and** the error report.
5. `Recipe` (`src/types/models.ts:1699`) has `name, subtitle?, prepTime?, cookTime?,
sourceUrl?, servings?, ingredients[], steps[], notes?, course?, mealSlots?, tags?,
photoIds?`.
6. `RecipeFormModal` accepts `prefill?: RecipePrefill | null`, and `FamilyCookbookPage.vue`
   already hosts it with a `prefill` ref.
7. `RecipePrefill.fields` (`utils/recipeExtractionToRecipe.ts:22-33`) is already the
   canonical "untrusted externally-sourced recipe, not yet saved" shape.
8. `bufferToBase64url` (`encoding.ts:116`), `base64urlToBuffer` (`:121`), `boundText`
   (`boundText.ts:21`), `safeHttpsUrl` (`url.ts:171`) and `fillTemplate` all exist.
9. The app is in history mode, so `route.hash` yields the fragment.

## Approach

Mockup: `docs/mockups/recipe-share-2026-09-07.html`. Direction A (recipe first, sticky
offer) is the chosen receiving surface. Every token comes from the theme skill + CIG; the
warm paper is the cookbook's existing `#fbf3e3` / `surface-paper`.

Layers, one direction of dependency, and **no new types the codebase already has**:

```
utils/recipeShareLink.ts    pure: encode, decode, VALIDATE. No Vue, no store, no I/O.
utils/recipeShareText.ts    pure: the human-readable message body.
utils/recipeKeepStash.ts    the one handoff across sign-up.
components/ui/ShareSheetModal.vue    the share-sheet shell, extracted from ShareInviteModal.
components/pod/RecipeShareModal.vue  the recipe share sheet.
pages/SharedRecipePage.vue           the public receiving surface.
```

### 1. `src/utils/recipeShareLink.ts` — the wire format, and the guard

```ts
/** The version this build WRITES. */
export const SHARE_WIRE_VERSION = 1;
/**
 * The versions this build can READ. This set only ever GROWS — a share link lives in
 * someone's chat forever, so dropping a version breaks messages already sent. This is the
 * one place the contract differs from `redirectState.ts`, whose exact-match gate is safe
 * because its payload round-trips in seconds and the fallback is "retry".
 */
export const SUPPORTED_WIRE_VERSIONS: ReadonlySet<number> = new Set([1]);

/** Compact wire keys, declared once and pinned by a golden test. */
const WIRE_KEYS = {
  name: 'n',
  subtitle: 's',
  prepTime: 'p',
  cookTime: 'c',
  servings: 'y',
  ingredients: 'i',
  steps: 't',
  notes: 'o',
  sourceUrl: 'u',
  course: 'r',
  mealSlots: 'm',
} as const;

/** No new type: the decode target IS the existing prefill shape. */
export type SharedRecipeFields = RecipePrefill['fields'];

export type ShareDecodeFailure =
  | 'empty'
  | 'too-long'
  | 'bad-encoding'
  | 'bad-json'
  | 'not-an-object'
  | 'unsupported-version'
  | 'no-name';

export type ShareDecodeResult =
  { ok: true; fields: SharedRecipeFields } | { ok: false; reason: ShareDecodeFailure };

export function encodeRecipeShare(recipe: Recipe): string;
export function decodeRecipeShare(raw: string): ShareDecodeResult;
/** Adapter to the form's prefill envelope. No model was involved. */
export function sharedRecipeToPrefill(fields: SharedRecipeFields): RecipePrefill;
```

**Reuse, not re-derivation.** Four helpers already own the hard parts:

- `bufferToBase64url` / `base64urlToBuffer` (`encoding.ts:116`, `:121`) with `TextEncoder` /
  `TextDecoder`. This is a _correctness_ fix, not style: `btoa` throws on any non-Latin-1
  character, so `btoa(JSON.stringify(recipe))` fails on the first accented or emoji-bearing
  recipe name. `base64ToBuffer` also throws loudly on malformed base64, which is precisely
  the signal `decode` wants.
- `boundText` (`boundText.ts:21`) for every length cap. `slice(0, CAP)` splits surrogate
  pairs and leaves a `U+FFFD` in someone else's cookbook.
- `safeHttpsUrl` (`url.ts:171`) for the decoded `sourceUrl` — **not** `safeExternalHref`
  (`:161`), which permits `http:` and is for user-typed links. A decoded URL is
  machine-supplied by definition.
- `isRecipeCourse` / `isMealSlot`, following `recipeExtractionToRecipe.ts:78-99`'s rule:
  "⚠️ Never COERCE a near-miss. Blank is honest; wrong is not."

**Compact keys.** `{v,n,s,p,c,y,i,t,o,u,r,m}` rather than full field names — on a
20-ingredient recipe the names alone are ~400 wasted bytes, and no human reads this.

**What travels.** `name, subtitle, prepTime, cookTime, servings, ingredients, steps, notes,
sourceUrl, course, mealSlots`. `course` and `mealSlots` are included because requirement 6
says "the sharer's own version" and silently dropping two fields the sharer set is a loss;
they cost ~30 bytes and reuse validators that already exist. `tags` are excluded (one
family's private filing system, meaningless elsewhere) and `photoIds` by greg's decision.

**No compression, deliberately.** `CompressionStream` would make encoding async, add a
branch to decode, and add a Safari-16.4 floor — to solve a problem the cap already solves.
A typical recipe is 1–3 KB of JSON, so 1.4–4 KB of base64url; 8000 characters is far below
what browsers or chat apps handle. Rare oversize recipes degrade honestly (§4). Compression
can be added later behind the `v` byte with no format break — which is what it is for.

**`decodeRecipeShare` is a security boundary, not a parser.** It mirrors
`decodeRedirectState` (`services/google/redirectState.ts:81-131`) — same contract, same
exact-match version gate, same "an old client must never best-effort-parse a newer shape".
In order:

1. Reject on length before doing any work.
2. `decodeURIComponent` inside the `try` — some chat clients percent-encode a fragment.
3. base64url-decode + UTF-8 decode inside the same `try/catch`; any throw → `null`.
4. `JSON.parse` inside the same `try/catch`; any throw → `null`.
5. Reject unless the result is a plain object (`not-an-object`) whose `v` is in
   `SUPPORTED_WIRE_VERSIONS` (`unsupported-version`) — a **set membership test**, never
   `>=`, and never "best-effort parse a newer shape".
6. Build the result as a **fresh object literal, field by field, from an allowlist**. Never
   a spread, never `Object.assign` onto the parsed object — constructing a new literal is
   what actually neutralises `__proto__` / `constructor` keys, and makes "nothing outside
   the allowlist survives" true by construction rather than by a filter that can be forgotten.
7. Strings: `typeof x === 'string'` or the field is **dropped**, then `boundText(x, CAP)`.
   Arrays: `Array.isArray`, truncated to a max **count**, entries **rejected unless
   `typeof === 'string'`** — never `String(x)`, because `String({})` is `"[object Object]"`
   and would be persisted as an ingredient — each entry `boundText`-ed, empties removed.
8. `sourceUrl` through `safeHttpsUrl`; `null` → the field is dropped.
9. `course` / `mealSlots` through `isRecipeCourse` / `isMealSlot`; anything unrecognised is
   dropped, never mapped.
10. Require a non-empty `name` — a recipe with no name is not a recipe.

Returning `null` for every failure is deliberate: the caller has one honest response to a
bad link, and a "which part was malformed" signal _shown to the person holding the link_ is
an oracle. The developer still gets the detail — the rejection stage rides in the telemetry
`detail` key, which the attacker never sees.

### 2. `src/utils/recipeShareText.ts` — the message

`buildRecipeShareText({ fields, link, t })` produces the readable body: dish name, subtitle,
the time/servings line, ingredients (capped, with "and N more"), the first few steps, a warm
sign-off, and the link last. Pure; takes `t` as a parameter. Every substitution through
`fillTemplate`, every cap through `boundText`.

### 3. `ShareSheetModal.vue` + `RecipeShareModal.vue`

`ShareInviteModal.vue` is already 90% of a generic share sheet: `BaseModal` + a branded
gradient header with `title`/`subtitle` overrides **it already documents as being for reuse
outside the invite context** (`:12-19`). Hand-building a second one would duplicate ~55
lines of header markup and two dark-mode token sets. So, one small extraction now:

- **`src/components/ui/ShareSheetModal.vue`** (new) — `BaseModal` + the branded header.
  Props `{ open, title, subtitle }`, an `#art` slot and the default slot. No share logic,
  no invite vocabulary.
- **`ShareInviteModal.vue`** becomes a thin wrapper. Its one call site does not change.
- **`RecipeShareModal.vue`** = `ShareSheetModal` + `ShareChannelGrid` + the message preview
  - the privacy note + the oversize state.

The **message preview** is new and load-bearing: the message contains the user's own recipe,
so they should see exactly what will be sent before it leaves.

**`ShareChannelGrid` takes a MESSAGE, not four optional overrides.** An additive prop set
buys one round of zero-diff at the cost of a permanent eight-prop component in which
`familyName`/`memberName` are dead whenever `body` is supplied, with no type that can say so.
`errorKeyPrefix` is worse than cosmetic: `t(key: UIStringKey)` is typed, so a runtime-built
key needs `as UIStringKey` and silently opts the component out of the i18n key contract — and
the two strings it would switch are already channel-generic in _text_; only their key names
say "invite".

Final prop surface, one mode, every prop always meaningful:

| prop               | notes                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| `link`             | shown in the copy row; the URL channels deep-link to                           |
| `body`             | the message. Callers build it (`inviteShareText` / `recipeShareText`)          |
| `emailSubject`     | was hardcoded invite copy                                                      |
| `copyText?`        | defaults to `link`. **The Discord path** — the recipe passes the whole message |
| `showSystemShare?` | default `false`. The **More** tile → the OS sheet, the _other_ Discord path    |

`hideExpiryNote` becomes a `#footer` slot: the "link expires in 24 hours" line is invite
vocabulary. The result is a component with **zero invite vocabulary**, which is the real
answer to "will the two share paths drift?" — one channel implementation parameterised by a
message, and two message builders side by side in `utils/`.

Invite templating moves to a pure `utils/inviteShareText.ts`, which is where the live `$&`
`fillTemplate` fix actually lands — in a tested pure function rather than a component
computed. Cost of not being additive: three lines of `defaultProps` in the grid's test and
two call sites. The invite _behaviour_ is unchanged and pinned by the same suites.

The **More** tile calls `useShareText`, which has zero callers today and is therefore
**re-homed rather than parameterised**: its dead `mealPlanner.share.*` keys become neutral
`share.*` ones and `surface` becomes a required argument. One behaviour, no knobs. Its native
branch reuses the cancel detection that already exists — `shareOrDownloadFile.ts:63-75` owns
`isAbortError` and `isPluginCancel` ("_@capacitor/share rejects a dismissed sheet with a
MESSAGE rather than a DOM AbortError_") — moved to a shared `utils/shareCancel.ts`. A second
`/cancel/i` regex in a second file is a drift bug with a delay fuse.

### 4. One size budget, derived from the tightest real channel

```ts
/**
 * The whole composed message (text + link) must fit in one chat message. 2000 is
 * Discord's per-message ceiling — the binding constraint, because requirement 10 makes
 * paste-into-Discord first-class and Discord publishes no share-intent URL. `mailto:`
 * bodies cap around the same; WhatsApp, Telegram and SMS are well above it.
 */
export const MAX_SHARE_MESSAGE_CHARS = 2000;
```

The payload is encoded once, the link is built, and the message is composed to fit that one
number. The ladder is fixed, documented in the module header, and unit tested rung by rung —
**text is trimmed before the link is ever dropped**, because the link carries the whole
recipe and the whole acquisition loop:

1. drop `notes`
2. drop steps beyond the first three (replaced by one "full method in the link" line)
3. drop the remaining steps
4. cap ingredients with "and N more"
5. drop the subtitle
6. floor: dish name + one line + sign-off + link

If the **link alone** cannot fit beside the floor text, the modal does not silently truncate —
a half-recipe presented as whole is worse than no link. It shares the _full_ readable text
with **no** link (the whole budget is now available for text) and says so plainly.

The rung the composer stopped at ships as `detail` on `share_opened`, so we learn whether
2000 squeezes real recipes without ever logging a byte of one.

### 5. `SharedRecipePage.vue`, the route, and ONE public-entry list

```ts
{ path: '/recipe', name: 'SharedRecipe',
  component: () => import('@/pages/SharedRecipePage.vue'),
  meta: { titleKey: 'recipeShare.received.title', requiresAuth: false,
          hideQuickAdd: true, noChrome: true } }
```

**No new route meta.** `utils/appChrome.ts` already states the position in writing: the
public-route test is "_a DERIVED predicate keyed on the route NAME, deliberately NOT a second
`meta` flag… One source of truth, no overlapping booleans to drift._" A `noAuthRedirect`
boolean would be the fourth per-route flag on routes where three already always co-occur —
and, decisively, it is _forgettable_: a route author who sets `requiresAuth: false` and
nothing else gets a public route silently bounced at boot. That has already happened to
`ShareTarget`.

So `utils/appChrome.ts` gets **one** list and **one** predicate — `PUBLIC_ENTRY_ROUTE_NAMES`

- `isPublicEntryRoute` — consulted by all three consumers (both `App.vue` boot redirects and
  `useNotifications`' auto-open suppression), listing the onboarding entry points plus
  `ShareTarget` (fixing the leak above), `SharedRecipe`, and the dev spike.
  `isPodlessExpectedRoute` is renamed and its existing consumers updated.

Merging is behaviour-preserving for every route that exists today: the two lists were already
identical apart from `DevWorkerSpike`, which the podless branch never reaches because of its
`!route.path.startsWith('/dev')` guard.

**Net effect on `App.vue`: an 11-line inline array deleted and one predicate swapped.** For a
2245-line file carrying the app's boot sequence, "this feature made App.vue smaller" is the
outcome worth insisting on.

The page reads `route.hash`, strips the `#`, decodes. Four states: **decoded** (mockup
Direction A); **no fragment** and **malformed** (the same friendly dead-end, one string —
this is where the no-oracle rule is enforced); and **`unsupported-version`** (its own
actionable "refresh beanies and try again").

Rendering is entirely mustache interpolation. No `v-html`. `sourceUrl` was screened at decode
and is re-screened at the binding.

### 6. "Keep This Recipe"

**One code path for both cases, because the difference is only where the user goes next.**
`decodeRecipeShare` already returns `RecipePrefill['fields']`, so keeping is:

```
stashKeptRecipe(fields)  →  router.push(hasPod ? '/pod/cookbook' : '/welcome')
```

and `FamilyCookbookPage` — which already owns a `prefill` ref and a mounted
`RecipeFormModal` — consumes the stash on mount and opens the form. **No new modal, no new
mapper, no second write path into the pod.**

Two disciplines at that seam. **One open-the-form helper:** the page already does
`prefill / editing / modalOpen` inside `onRecipeReady`, and `openAdd()` documents the
`useFormModal` "onNew fires on the open TRANSITION only" trap — the stash consumer calls the
same local `openWithPrefill(p)` both paths share, never a third hand-rolled copy. **A named
adapter, not a fake AI envelope:** `RecipePrefill` requires `inferredIngredients`,
`inferredSteps`, `dishImage`, `taxonomyRejected` and `confidence` — extraction metadata, none
of which applies here. `sharedRecipeToPrefill()` fills the envelope with honest neutrals and
says in a comment that no model was involved, tested once, rather than an object literal full
of invented confidence scores inline in a page.

**Why the form and not a direct `createRecipe`.** The app already has a rule for untrusted
recipes arriving from outside, written at the inbound share boundary
(`useSharedDocumentIngest.ts:12-15`): _"nothing is persisted without the user confirming it
in a review modal."_ A share link is the same class of input. It also removes an error path:
`createRecipe` runs through `wrapAsync`, which already owns the failure toast **and** the
report, so a hand-rolled `reportError` beside it would double-page.

**`src/utils/recipeKeepStash.ts`** — the one handoff:

- **`localStorage`, with eyes open.** Neither `localStorage` nor `sessionStorage` survives
  the iOS Drive OAuth hop — WebKit clears _script-writable storage_ across a cross-site
  redirect (`redirectState.ts:1-11`), which is why the repo removed its `sessionStorage`
  stash in 2026-06. The app's workaround, the OAuth `state` param, is **unavailable to us**:
  it is documented non-secret and transits Google and logs. `localStorage` is chosen because
  it survives every _other_ journey — tab close, app backgrounding, local-file setup, an
  already-signed-in user — not because it beats the hop.
- Bounded by a **60-minute TTL** and **single-consume** (read-then-delete, including on an
  expired read).
- **Clearing on sign-out is scoped and costed, not assumed.** Sign-out is an ordered
  step-list with a unit-tested superset property (`services/auth/signOutSteps.ts`), so a
  teardown means a new `SignOutStepName`, an implementation, list membership and a test
  update. It is added to the **clear-data tier only**; the lower tiers are covered by the TTL
  and single-consume.
- Every access `try/catch`-ed (private mode, quota, disabled storage) with a `console.warn`
  naming the fix and a `warn` `logEvent` — never a bare `catch`.
- **A miss is never silent, and on the Drive-on-iOS path it is expected rather than
  exceptional.** The user gets an honest, actionable message — "we couldn't carry that
  recipe across sign-up; open the link again from your chat and tap Keep" — plus a `warn`
  event. The link is still in their chat, so the recovery is real and one tap long.

**Getting the user back to the recipe after sign-up — one line, no watcher.**
`LoginPage.handleSignedIn(destination)` (`LoginPage.vue:655-666`) is the documented "_single
canonical arm-and-register point for EVERY entry path — create, load, join, reconnect_" and
ends in `router.replace(destination)`. So:

```ts
router.replace(hasPendingKeptRecipe() ? KEPT_RECIPE_DESTINATION : destination);
```

That covers every sign-up and sign-in journey there is. A previously-planned
`useKeptRecipeHandoff` App.vue watcher on "authenticated **and** pod exists **and** stash
pending **and** not already on the cookbook" is **dropped**: a global watcher issuing
`router.push` on auth/pod transitions is precisely the failure mode `appChrome.ts:12-19` and
the 2026-06-15 onboarding-remount-race plan exist to prevent, it would run for every user
forever to serve a rare path, and it would add a fifth thing to App.vue instead of removing
one.

**The Drive-on-iOS recovery is stated BEFORE the hop, because after it the loss is
invisible.** Any marker saying "a keep was in flight" would live in the same script-writable
storage WebKit clears, so on the one path where the recipe is lost there is nothing left to
detect it with; a post-hop message would never fire. Instead the Keep affordance tells a
signed-out user up front that if the recipe is not waiting when they arrive, re-opening the
link from their chat and tapping Keep takes one second. `keep_stash_lost` telemetry stays,
honestly scoped to the _detectable_ race (present at sign-in, gone at cookbook mount: TTL,
eviction, a second tab).

Rejected and recorded: carrying a 1-bit "keep pending" flag in the OAuth `state`. It would
survive, but `redirectState.ts:19-25` requires a `v:2` bump plus a dual-accept release of a
security-sensitive shared payload — a real cost against a security boundary, to deliver a
message we can deliver for free before the hop.

### 7. The entry point

The Share button goes in the recipe hero action row — but **outside** its
`v-if="canEditActivities"` wrapper (`RecipeDetailPage.vue:302`). Sharing is not editing; a
view-only member must be able to send a recipe to a friend. Per the mockup it is the quiet
variant, not a third gradient button.

### 8. Copy

All under `recipeShare.*`, both `en` and `beanie`.

## Files Affected

**Created**

- `src/utils/recipeShareLink.ts`
- `src/utils/recipeShareText.ts`
- `src/utils/inviteShareText.ts` (lifted out of `ShareChannelGrid`; the `$&` bug fixed here)
- `src/utils/recipeKeepStash.ts`
- `src/utils/shareCancel.ts` (`isAbortError` + `isPluginCancel`, shared with `shareOrDownloadFile`)
- `src/components/ui/ShareSheetModal.vue` (extracted from `ShareInviteModal`)
- `src/components/pod/RecipeShareModal.vue`
- `src/pages/SharedRecipePage.vue`
- `src/utils/__tests__/recipeShareLink.test.ts` (incl. the golden wire-format fixture)
- `src/utils/__tests__/recipeShareText.test.ts`
- `src/utils/__tests__/inviteShareText.test.ts`
- `src/utils/__tests__/recipeKeepStash.test.ts`
- `src/pages/__tests__/SharedRecipePage.test.ts`

**Modified**

- `src/pages/RecipeDetailPage.vue` — Share action (outside the edit gate) + modal host
- `src/components/family/ShareChannelGrid.vue` — takes a message (`body` / `emailSubject` /
  `copyText?` / `showSystemShare?`); `hideExpiryNote` → `#footer` slot; invite templating removed
- `src/components/family/ShareInviteModal.vue` — composed over `ShareSheetModal`; props and
  call site unchanged; supplies body + subject + expiry footer
- `src/components/family/InviteWizardModal.vue` — supplies body + subject
- `src/components/family/__tests__/ShareChannelGrid.test.ts` — prop migration
- `src/composables/useShareText.ts` — neutral `share.*` keys + required `surface`; native
  branch using the shared cancel predicates
- `src/utils/shareOrDownloadFile.ts` — cancel predicates moved to `shareCancel.ts`
- `src/pages/FamilyCookbookPage.vue` — one `openWithPrefill()` helper; consume the keep stash
- `src/pages/LoginPage.vue` — one line in `handleSignedIn`
- `src/router/index.ts` — the public `/recipe` route (no new meta field)
- `src/utils/appChrome.ts` — `PUBLIC_ENTRY_ROUTE_NAMES` + `isPublicEntryRoute`; adds
  `SharedRecipe` **and** `ShareTarget`
- `src/utils/__tests__/appChrome.test.ts` — renamed predicate + the two added names
- `src/composables/useNotifications.ts` — renamed predicate import
- `src/App.vue` — **delete** the inline `authPages` array; both boot redirects use
  `isPublicEntryRoute`. Net: the file gets shorter and gains no new mounts.
- `src/stores/authStore.ts` + `src/services/auth/signOutSteps.ts` — one clear-data-tier step
- `src/services/translation/uiStrings.ts` — `recipeShare.*`, neutral `share.*`

**Explicitly NOT touched**

- `src/utils/shareStash.ts` — the inbound Web Share Target reader. Different direction.
- `src/composables/useSharedDocumentIngest.ts` / `src/services/share/*` — the inbound
  AI-extraction pipeline, rejected as a channel: it carries AI-consent and billing gating
  that does not apply to a decoded link. What _is_ reused is `RecipePrefill` and the
  `RecipeFormModal` review surface.
- `RecipeDetailPage`'s recipe body markup — deliberately not shared with `SharedRecipePage`.

## Observability Coverage

Surface: **`recipe-share`**.

- `logEvent({ level:'info', surface:'recipe-share', message:'share sheet opened', context:{ action:'share_opened', ingredient_count:N } })`
- `logEvent({ level:'info', …, message:'shared via channel', context:{ action:'share_sent', kind:<channel id> } })` — the success counter, so a share _rate_ is measurable.
- `logEvent({ level:'warn', …, message:'share degraded: payload over cap', context:{ action:'share_oversize' } })`
- `logEvent({ level:'info', …, message:'shared recipe opened', context:{ action:'received_opened', ingredient_count:N } })` — the other end of the funnel.
- `logEvent({ level:'warn', …, message:'shared recipe link could not be decoded', context:{ action:'received_undecodable', error_code:'bad-payload', detail:<stage> } })` — `detail` names which check rejected it. Server-side only, so a diagnostic and not an oracle.
- `logEvent({ level:'warn', …, context:{ action:'keep_stash_write_failed' | 'keep_stash_lost' } })` — the two ways the sign-up round trip can lose a recipe.

**No `reportError` on the keep itself.** The save runs through `RecipeFormModal` →
`createRecipe` → `wrapAsync`, which already toasts and reports. Adding one here would
double-page. Likewise `showToast('error', …)` auto-invokes `reportError`, so a paired manual
report is a duplicate.

**Privacy gate:** no new `ALLOWED_CONTEXT_KEYS` — `action`, `kind`, `error_code`, `detail`
and `ingredient_count` are all pre-existing. **Counts, fixed enums and byte sizes only —
never the recipe name, an ingredient, a URL, or any part of the payload**, in `context` or
in `message`. Stricter than the usual rule because the content is by definition private.

## Acceptance Criteria

- [ ] A shared recipe carries the sharer's edits, not the source website's version
- [ ] A recipe with an accented or emoji name ("Crème Brûlée 🍮") encodes, sends and decodes
      intact — the `btoa` failure mode is covered by a test
- [ ] A photo-captured recipe (no `sourceUrl`) shares identically
- [ ] `course` and `mealSlots` survive the round trip; `tags` and `photoIds` do not
- [ ] The URL never contains `?` — the payload is always after `#`
- [ ] A receiver with **no account and no session** reads the whole recipe, and the fragment
      is still in the address bar afterwards (no boot redirect ate it)
- [ ] An authenticated-but-podless receiver reads the recipe and does **not** trigger an
      `app.onboardingZombieState` report
- [ ] The recipe is visible before any invitation; no sign-in wall in front of content
- [ ] Keeping while signed out carries the recipe through a local-file sign-up and opens the
      review form; the Drive-on-iOS path shows the honest recovery instead of failing silently
- [ ] A hand-crafted or truncated fragment yields the friendly dead-end, never a crash
- [ ] A payload with unexpected fields, wrong types, absurd lengths, non-string array
      entries, a `__proto__` key, or a `javascript:` / `http:` `sourceUrl` is rejected or
      dropped, and nothing outside the allowlist is ever written to a pod
- [ ] An oversize recipe shares as text with no link and says so
- [ ] **More** opens the OS share sheet on web **and** both native apps, and **Copy** puts
      the whole message on the clipboard, so Discord works
- [ ] No recipe content appears in any telemetry event or error report
- [ ] A view-only member can share a recipe
- [ ] The invite flows are visually and behaviourally unchanged, and a family name
      containing `$&` now renders correctly
- [ ] Every new string has `en` + `beanie`; lint passes the i18n and dark-mode rules

## Testing Plan

1. `recipeShareLink.test.ts` — round-trip **including a non-Latin-1 name** (the `btoa`
   regression guard); every rejection path (over-length, percent-encoded, bad base64, bad
   JSON, wrong version, non-object, missing name, wrong types, non-string array entries,
   oversized arrays, `__proto__`); allowlist enforcement; `sourceUrl` screening
   (`javascript:`, `http:`, odd port, over-length all dropped); `<script>` round-trips as
   inert text; an unrecognised `course`/`mealSlot` is dropped, never coerced; a cap landing
   mid-surrogate does not emit `U+FFFD`.
2. `recipeShareText.test.ts` — ingredient capping, "and N more", no times, no subtitle, and
   a name containing `$&` (the `fillTemplate` guard).
3. `recipeKeepStash.test.ts` — write/consume/single-consume; TTL expiry; a throwing
   `localStorage` warns rather than throwing.
4. `SharedRecipePage.test.ts` — decoded, undecodable and empty-fragment states; keep for
   signed-in-with-pod, signed-in-podless and signed-out; the stash round trip; the
   stash-lost message.
5. Existing `ShareChannelGrid` / `ShareInviteModal` / invite suites stay green **unmodified**
   — that is the proof the generalisation is additive.
6. `npm run type-check`, `npm run lint`, full unit suite.
7. **Manual, both themes:** share to WhatsApp Web and read the message; paste into Discord
   from Copy; More on iOS and Android; open the link signed out, signed in, and
   signed-in-but-podless; open a corrupted link.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the approved mockup and verified router/App-shell/store facts; chose no-compression with a version byte; made `decodeRecipeShare` an explicit security boundary; added a stash for the signed-out funnel.
- **Pass 2 (DRY + error handling)**: Found a day-one crash (`btoa` cannot encode a non-ASCII recipe name) and, more seriously, that the feature **would not have worked at all** — `App.vue:1218-1231` holds a hardcoded route-name array and redirects the unauthenticated receiver to `/welcome`, destroying the fragment; the podless case additionally pages Slack `critical` on every open. Fixed with a declared `meta.noAuthRedirect` + `PODLESS_EXPECTED_ROUTE_NAMES`. Replaced the bespoke `SharedRecipe` type with the existing `RecipePrefill['fields']`, and the silent `createRecipe` with the `RecipeFormModal` review the app already mandates for untrusted inbound recipes — which also removed a double-report against `wrapAsync`. Adopted `boundText`, `fillTemplate`, `safeHttpsUrl`, `isRecipeCourse`/`isMealSlot`; fixed `ShareChannelGrid`'s live `$&`-interpolation bug in passing. Extracted `ShareSheetModal` rather than hand-building a second shell. Closed the Discord gap the title promised, and with it `useShareText`'s silent native degradation. **Corrected while applying:** Pass 2 proposed `localStorage` as surviving the OAuth hop; `redirectState.ts:1-11` says WebKit clears _script-writable_ storage, which is localStorage too, and the `state`-param workaround is non-secret so the recipe can never use it — so the stash is now justified on the journeys it does survive, with the Drive-on-iOS miss documented as expected behaviour with a real recovery.
- **Pass 3 (Sustainability)**: Removed three sources of long-term complexity and two reliability defects. **(1) The `meta.noAuthRedirect` flag is gone.** `appChrome.ts:31-38` already argues in writing against a second route-meta boolean, and `useNotifications` already reuses its name-list predicate; a fourth per-route flag is _forgettable_, and that has already bitten — **verified live on `main`**: `/share` is declared `requiresAuth: false` with a comment saying it must mount signed-out to delete its Cache stash, yet `'ShareTarget'` is missing from App.vue's inline `authPages`, so a signed-out document share leaks into Cache Storage permanently today. The two lists were the same set anyway, so they merge into one `PUBLIC_ENTRY_ROUTE_NAMES` + `isPublicEntryRoute`; the inline array is deleted and the pre-existing leak is fixed in one word. **(2) The `useKeptRecipeHandoff` App.vue watcher is gone**, replaced by one line in `LoginPage.handleSignedIn` — the documented single canonical post-sign-in seam. A global watcher issuing `router.push` on auth transitions is the exact failure mode the 2026-06-15 remount-race plan exists to prevent. **(3) `ShareChannelGrid` takes a message instead of four optional overrides** — `errorKeyPrefix` could not have worked (`t` is typed `UIStringKey`), and `body?` would have left two props dead in a combination nothing could check; invite templating moves to a pure `inviteShareText.ts`, which is where the `$&` fix now lands, and the component ends with zero invite vocabulary. **(4) The size cap was picked, not derived, and broke the flagship channel:** a Discord paste caps at 2000 characters, so an 8000-char URL guaranteed failure for exactly the recipes worth sharing; there is now one `MAX_SHARE_MESSAGE_CHARS = 2000` with a documented ladder that sacrifices text before the link. No-compression is upgraded from preference to constraint (iOS 15 floor vs Safari 16.4). **(5) The versioning story was incoherent:** copying `redirectState`'s exact-match gate would break every link already in a chat the day v2 ships — its round trip is seconds, ours is forever — so write-version and a never-shrinking read-set are now separate, pinned by a golden fixture, and `decodeRecipeShare` returns a discriminated reason rather than the `null` that could not have produced the telemetry `detail` the plan promised. **(6) Two free-looking lines that are not:** clearing the stash on sign-out costs a new step in a superset-tested list (now scoped and costed), and the post-hop "stash lost" message was unimplementable because its marker would live in the storage WebKit clears — so the recovery is stated _before_ the hop.
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's make some improvements to the recipe and cookbook features: Add social share for recipes. THis feature should allow you to share your recipe in beanies to any friend across whatsapp, discord, etc like a typical social share capability. the sharing should be fun and include a link to beanies to show where the share came from, as a way to encourage users to either start their own beanpod or login and add the recipe to their own beanpod
>
> For the share content, let's also make it very easy for a user receiving a recipe from beanies to add it to their own cookbook. perhaps we can add some text (i.e copy/paste/share this recipe to beanies to add it to your own cookbook) - or there may be a better way to encourage users to add to their own cookbooks - what are your thoughts?
>
> [plus: re-fetch affordance, and prep/cook/servings not populated — split into #93]
>
> Please review this and let me know if any questions. If all clear then create a new issue with /beanies-new-issue then move straight to /beanies-pre-plan and once done move to /beanies-plan

### Follow-up 1 (clarification asked by Claude, answered)

> what is the difference between payloud in the URL and text only with plain beanies link?

### Follow-up 2 (decisions)

> Share: "Payload in URL + readable text". Photo: "No photo, text and link only". Re-fetch: "Show a review step before applying". Scope: "Two issues".

### Follow-up 3

> yes [create issue #92]

### Follow-up 4

> yes. work autonomous as i will be going to sleep now. once done creating this issue, move to /beanies-plan and create the full plan for both issues. then move to implementation for both, starting with social share, the then moving to issue #92. for both issues, perform the full implementation. once done, run /code-review max against the changes … fix all issues found … run additional code reviews as needed … once complete, capture all context and run /end-session

### Follow-up 5

> correct, social share first, and then capture-quality issue is fine. for both issues, i am fine with your proposal to view and choose the best mockup as necessary and appropriate for the design. you can go straight to implementation once done

</details>
