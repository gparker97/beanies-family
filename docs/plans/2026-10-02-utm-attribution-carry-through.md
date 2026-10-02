# Plan: Carry UTM attribution from the marketing site through to the app, Slack, the registry and Plausible

> Date: 2026-10-02
> Related issues: Notion tracker #118 (no GitHub issue; direct implementation)
> Plan file: `docs/plans/2026-10-02-utm-attribution-carry-through.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As the founder running a paid pilot, I want each new pod to carry the ad that brought it so that I can compute cost per acquisition per ad and stop the ones that don't convert.

## Context

The ChatGPT Ads pilot started 2026-10-02. Tagged links (`utm_source=chatgpt&utm_medium=cpc&utm_campaign=sg-pilot-oct26&utm_content=<angle>-<ad-slug>&campaign_id=…&ad_group_id=…&ad_id=…`) land on `beanies.family`, where Plausible records the UTMs natively. Nothing then joins that visit to the family that gets created on `app.beanies.family`: every CTA on the site links to a bare `${APP_URL}/welcome` (or `/create`, or the root), the app never reads `utm_*`, and the create-pod Slack message, the registry row and the app's Plausible `signup` event carry no acquisition source. ChatGPT strips the referrer, so even the landing visit reads as Direct when the tag is missing. Result so far: 4 joiners since the pilot started, 17 paid clicks, 0 attributed pods.

Hard constraints from the tracker row and the privacy page: first-party only, no pixel, no third-party cookie, and `privacy.astro` must stay true ("Plausible … without tracking anyone", "beanies.family does not use cookies"). Decisions taken at intake (greg, 2026-10-02): first-touch wins with a **30-day TTL**; the attribution **is** written to the DynamoDB registry row; `oppref` is captured and forwarded with the UTMs but **never sent** to OpenAI (the Conversions API stays out of scope). Needed before 2026-10-09, the week-1 review of the pilot.

## Requirements

1. **Marketing site capture.** On any page under `web/` that uses `BaseLayout` (plus the standalone `/download` page), read the landing URL once and, if it carries any of `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `campaign_id`, `ad_group_id`, `ad_id`, `oppref`, store them as one first-touch record on the device with a 30-day TTL. An existing unexpired record is never overwritten (first-touch wins).
2. **Marketing site forwarding.** Every anchor whose `href` points at the app origin (`APP_URL` from `@beanies/brand/nav`, i.e. `https://app.beanies.family` in prod, `http://localhost:5173` in dev) carries the stored record as query parameters by the time it is clicked. Links to `/login` are included (a sign-in is not a conversion, but a signed-out visitor who then creates a pod still deserves attribution). The store badges (`/ios`, `/android`, `/download` → store) are not decorated: store installs cannot carry a tag and the row records this as expected.
3. **App capture.** On first load, before the router can strip the query, the app reads the same parameter set from `window.location.search` and stores a first-touch record with the same 30-day TTL and the same first-touch rule. Native (Capacitor) builds have no landing URL and simply never capture.
4. **Survives the create-flow redirects.** The record must still be present when the pod is created after (a) the web OAuth redirect round-trip on iOS Safari / standalone PWA, where WebKit clears script-writable storage across the cross-site hop, and (b) the `/welcome?resume=setup` return path.
5. **Create-pod Slack message.** When a pod is created with a stored record, the Slack notification gains a line next to "Heard via": ``*Came from:* `<utm_source> / <utm_campaign> / <utm_content>` `` with the values inside one mrkdwn code span (omitting empty parts; the line is omitted entirely when there is no record). The charset admits `~`, `_` and `:x:`, which Slack would otherwise render as strike / italic / emoji; a backtick is outside the charset so nothing can break out of the span.
6. **Registry.** The signup registry write carries the record; the Lambda stores it on the family row as one `attribution` map attribute, write-once and gated on `isSignupEvent === true` (the `signupPlatform` precedent), validated (allowlisted keys, string values, bounded length and charset), preserved across later PUTs, and kept on the DELETE tombstone alongside `signupPlatform`.
7. **Plausible app site.** The existing `signup` event (`authStore.signUp`) sends `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` as custom props when a record exists, so the metrics dashboard's existing `plausible-app-utm` source starts counting.
8. **Consume once.** After a successful `createNewFile` (Slack + registry done), the record is cleared. It is also cleared by the tier-3 "Clear data" sign-out (the clean-device promise), and deliberately NOT by tier 2 or the eviction tiers.
9. **Survey option.** `CreatePodSurvey` gains a "ChatGPT ad" tile (id `chatgpt_ad`, Slack label `ChatGPT ad`), distinct from "ChatGPT / AI search", with `en` + `beanie` + `zh` strings.
10. **Metrics consumer.** `pull_registry.mjs` carries `attribution` into `enrich()` and `familiesFull`; `build_dashboard.mjs` gains a `registry-utm` pods source that counts registry rows per `utm_content` in the window, preferred over `plausible-app-utm` (it is the ground truth once this ships).
11. **Privacy stays true.** `privacy.astro`, the store-submission runbook table, the `PrivacyInfo.xcprivacy` header comment and the help-centre collection text are updated in the same change to describe the campaign tag (what it is, that it is first-party, that it does not identify anyone, 30-day device retention, kept on the family entry).
12. **Observability.** Capture, keep-first-touch, expiry, forward, consume and drop-invalid decisions are logged to the firehose on the app side using existing allowlisted keys only (`action`, `kind`, `count`). On the site, the existing Plausible CTA click event gains an `attributed: yes|no` prop so a dropped tag is visible without a repro.

## Important Notes & Caveats

- **Do not shorten `oppref` to `ref`.** `ref` is already an invite-link parameter (`parseInviteLink`) and is scrubbed from Plausible URLs by `plausible.ts` `transformRequest`.
- **Never put the record in the Automerge document** (out of scope by the row) and never send anything to OpenAI.
- **No new `ALLOWED_CONTEXT_KEYS`.** The firehose carries only `action` (decision), `kind` (the `utm_source`, a channel-level value) and `count`. Ad-level values (`utm_content`, ids, `oppref`) go to Slack, the registry and Plausible only. This avoids the telemetry Lambda mirror + pinned test churn.
- **The registry Lambda PUT is read-merge-write with a whole-item `PutItem`.** Any attribute not re-emitted in `item` is lost on the next PUT, so `attribution` must be carried with `existing.attribution ?? …`.
- **The Lambda has no field allowlist and no string bounds.** The attribution validator is the first; keep it self-contained and tested.
- **`createNewFile` must not grow an eighth positional parameter** (demo-mode plan, 2026-08-20). The store reads the record from the stash itself; the caller passes nothing new.
- **Plausible `signup` fires at the identity step, before the Drive redirect and before `createNewFile`.** That is fine for attribution (storage is intact at that point on every platform); it is why the props are peeked there and the record is consumed later.
- **Plausible's `track` props type is a closed union** (`PublicPropKey`); it must be widened explicitly, not cast around.
- **`assert-cta-tagged.mjs` keeps checking `data-cta` only.** Query strings are added at runtime, so the build-time guard cannot and should not look for them.
- **The static `/welcome` redirect stub in `web/dist` has no query passthrough**, but the live apex CloudFront Function 301s `/welcome` to the app with the query string preserved before the stub is reached, so no change is needed there.
- **Demo sessions** (`beaniesdemo`) suppress Slack, registry and analytics already; the record is simply not consumed there (it expires).
- Values are user-controlled input. Bound every value (≤ 100 chars, `[A-Za-z0-9._~:\-]` after trim; anything else drops that field) before it reaches Slack text, DynamoDB or a Plausible prop.
- **`next=` nesting is a non-issue.** `main.ts` captures from the raw URL before `app.use(router)` runs the guard that rewrites to `/welcome?next=<fullPath>` (`router/index.ts:528-536`); a later reload of that URL yields no attribution key (`URLSearchParams` does not recurse), so no event and no overwrite.
- **TTL across the hop.** The two origins stamp `capturedAt` independently, so a visitor who lands on day 1 and clicks through on day 20 gets an app envelope that expires on day 50 (worst case 60 days from first landing). Accepted: forwarding `capturedAt` would add a parameter for no pilot benefit.
- **Plausible URL scrub.** `plausible.ts` `transformRequest` currently scrubs `['t','m','fam','hint','fileId','ref']` from the reported pageview URL. Spread `NON_UTM_ATTRIBUTION_KEYS` into that array so a future non-UTM key is scrubbed without a second edit (`utm_*` stays out by construction): Plausible consumes `utm_*` natively (that is what makes the `visit:utm_*` breakdowns work), so the app does not report ad-click identifiers in page URLs (the site's landing pageview carries them natively, as Plausible's own UTM handling requires; the site loader is unchanged). One array edit plus one assertion in `plausible.test.ts`.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `@beanies/brand` is importable from the Vue app (`@beanies/brand/pricing` already is) and from Astro **frontmatter** (`Nav.astro:2`, `Footer.astro:2`, `Breadcrumbs.astro:3`, `ios.astro:13`). **No client-side Astro `<script>` imports `@beanies/brand` today.** The first implementation step is therefore a smoke build of the hoisted script importing `@beanies/brand/attribution` + `APP_URL` (`import.meta.env.DEV` must be substituted client-side). If Vite refuses the workspace TS import, the fallback is a `web/src/scripts/attribution.ts` that re-exports from the package, never a copy.
2. Vitest's `include` does not cover `packages/` (`vitest.config.ts:16-27`), and the repo's precedent for testing a `@beanies/brand` module is a test under `src/` that imports it (`src/services/billing/__tests__/pricing.test.ts:2` tests `@beanies/brand/pricing`). The attribution tests therefore live at `src/utils/__tests__/attribution.test.ts`; no vitest config change.
3. Vue Router 4 string redirects (`/` → `/nook`) preserve the query, but the signed-in/requiresAuth guards and App.vue's boot `router.replace` calls drop it; capture therefore happens in `main.ts` before `app.use(router)`, next to the existing synchronous pathname read.
4. The web create-flow return path is the fixed `RESUME_SETUP_PATH` built in `connectStorage.ts` `createReturnPath()`, and `decodeRedirectState` accepts any relative `returnPath` including a query string, so appending the attribution query to that path round-trips through OAuth `state` without bumping the state version.
5. OAuth `state` length is not a constraint at the sizes involved (the record serialises to well under 500 bytes).
6. The metrics skill's existing `plausible-app-utm` source (`query_plausible.mjs:283`) breaks the `signup` goal down by **visit-level** `visit:utm_campaign` / `visit:utm_content`, which Plausible sets from the landing URL. Requirements 2-3 (a tagged app URL) satisfy that on their own. The custom props in Requirement 7 are additive: they show in the Plausible UI and cover a create in a later, untagged visit; `registry-utm` supersedes both.
7. Storing a campaign tag in `localStorage` is compatible with the privacy page's "nothing is stored on your device to recognise you": the tag identifies the ad, not the person, and the page is updated to say so explicitly.
8. The DynamoDB tables need no Terraform resource change for a new non-key attribute; the Lambda zip rehashes from the source change and ships with `scripts/infra/tf-plan.sh -target=module.registry` + `tf-apply.sh`.
9. Registry Lambda and client can deploy in either order: an old Lambda ignores the unknown body key; an old client omits it.
10. A real `oppref` value has not been inspected. If it carries `=`, `+` or `/` the validator drops it silently on both sides and the acceptance row shows `oppref: null`. Greg's end-to-end ad click (Testing §4) is the check; if it fails the charset, widen _both_ twins and the shared fixture in one commit.

## Approach

### A. One shared pure module: `packages/brand/attribution.ts`

The parser, the key list, the bounds, the TTL envelope and the query serialiser live once and are imported by both the site and the app. No DOM access, no storage access, no throwing.

```ts
// Header comment in the file lists every site that must move with this list: the registry
// Lambda's twin allowlist, privacy.astro, the store-submission runbook row, the xcprivacy
// header comment, src/content/help/security.ts. Also: the same storage key is used on two
// origins (beanies.family and app.beanies.family); the two stores are independent by origin
// and nothing is shared through the key.
export const ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'campaign_id',
  'ad_group_id',
  'ad_id',
  'oppref',
] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
/** Non-UTM keys: scrubbed from the Plausible pageview URL (Plausible consumes utm_* natively). */
export const NON_UTM_ATTRIBUTION_KEYS = ATTRIBUTION_KEYS.filter((k) => !k.startsWith('utm_'));
export type Attribution = Partial<Record<AttributionKey, string>>;
export const ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ATTRIBUTION_STORAGE_KEY = 'beanies:attribution';
export interface AttributionEnvelope {
  v: 1;
  capturedAt: number;
  fields: Attribution;
}

/** The subset forwarded as Plausible custom props; `PublicPropKey` in plausible.ts is derived from it so the two cannot drift. */
export const PLAUSIBLE_ATTRIBUTION_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
] as const;

export function parseAttribution(search: string): Attribution | null; // allowlisted keys, trimmed, bounded, charset-checked; null when nothing valid
export function toSearchParams(a: Attribution): URLSearchParams;
export function appendAttribution(href: string, a: Attribution, appOrigin: string): string;
//   Implemented with `new URL(href)`; on-origin test is `url.origin === new URL(appOrigin).origin`; each key is
//   `searchParams.set` only when `!searchParams.has(key)`; the hash is preserved by construction; returns `href`
//   unchanged on a parse failure or off-origin. A bare `href={APP_URL}` (web/src/pages/from/*.astro) resolves to
//   `https://app.beanies.family/` and decorates too.
export function readEnvelope(
  value: unknown,
  now: number
): { state: 'none' | 'corrupt' | 'expired' | 'ok'; fields?: Attribution }; // takes the already-parsed value (storedJson / JSON.parse on the site)
export function makeEnvelope(fields: Attribution, now: number): AttributionEnvelope;
export function pickPlausibleProps(a: Attribution | null): Record<string, string> | undefined; // the four keys, only those present; undefined when none
```

Tests: `src/utils/__tests__/attribution.test.ts` importing `@beanies/brand/attribution` (the `pricing.test.ts` precedent): parsing, bounds, charset drop, TTL boundary at exactly 30 days, corrupt / wrong-version envelope → `corrupt`, append on app origin only, no double-append, `ref` untouched, `pickPlausibleProps` shape.

### B. Marketing site (`web/`)

- New component `web/src/components/AppLinks.astro`. Header comment: this component is the single owner of every app-bound-link concern on the site (tag capture, href decoration, the CTA click event); the CTA listener lives here _because_ its `attributed` prop reads the same envelope. Do not split it back into per-host inline copies. It contains one **hoisted module `<script>`** (a bare `<script>`, as `HelpSearch.astro:34-35` does to `import MiniSearch`; NOT `is:inline`, which cannot import) that imports `@beanies/brand/attribution` and `APP_URL` from `@beanies/brand/nav`:
  1. On module load: `parseAttribution(location.search)`; if non-null and `readEnvelope(JSON.parse(localStorage.getItem(KEY)), Date.now()).state !== 'ok'`, write `makeEnvelope(...)`. A corrupt or expired envelope is replaced; a valid one is kept (first-touch). The single read/write pair is wrapped in one try/catch (private mode, quota); on failure `console.warn('[attribution] localStorage refused — forwarding unattributed; check private mode/quota', err)` so a developer with DevTools open sees it. There is no firehose on the site; the `attributed` prop below is the production-visible signal.
  2. One `decorateAnchor(a: HTMLAnchorElement)` helper (`a.href = appendAttribution(a.href, fields, APP_URL)`, idempotent). On `DOMContentLoaded` it runs over every `a[href^="${APP_URL}"]` (the origin must be quoted in the selector or the `:` in `http://` breaks it; there is no `ClientRouter`/`ViewTransitions` in `web/src`, so one pass plus per-click is sufficient) (so hover preview, copy-link, ctrl-click and open-in-new-tab all carry the tag). In the capture-phase click listener it runs on `e.target.closest('a[href]')` only, which covers a late-inserted link without rescanning the document on every click.
  3. The capture-phase CTA click listener **moves into this component's module script** from `BaseLayout.astro:152-165` and `download.astro:98-116` (today two `is:inline` copies). It keeps `plausible(name, {props:{location}})` and adds `attributed: 'yes' | 'no'`, derived from the same `fields` constant the decorator uses, computed _after_ the capture write in step 1 (so a tag captured on this very page reports `attributed: yes`); no second `readEnvelope`. One listener, two hosts. The `<script async src="https://plausible.io/js/pa-….js">` loader and its stub queue stay `is:inline` in both hosts (no imports, must run before the module).
- `BaseLayout.astro` and `download.astro` both render `<Attribution />` immediately after their Plausible loader.
- `ios.astro` / `android.astro`: no change beyond deleting the stale "so links can carry UTM tags" header comments or pointing them at this plan.
- `assert-cta-tagged.mjs`: unchanged.
- `privacy.astro`: registry list gains "the campaign tag from the link that first brought you to beanies.family, if there was one (for example which of our own ads or posts); it identifies the ad, not you"; the Plausible section gains a short paragraph on the 30-day device-side tag and that it is first-party, cookie-free and **never shared with the ad platform** (not "never leaves the device": the landing pageview URL already reaches plausible.io); the tombstone sentence adds "and campaign tag"; `lastUpdated` bumped to 2 October 2026.

### C. App capture and persistence (`src/`)

- New `src/utils/attributionStash.ts` built on `storedJson.ts` (not on `recipeKeepStash.ts`, which carries its own try/catch and does not use `storedJson`). Three functions:
  - `captureAttributionFromUrl(search = window.location.search): void` — parses, applies the first-touch rule against the stored envelope, writes. Logs one `logEvent({ level:'info', surface:'attribution', message:'capture', context:{ action, kind, count } })` with `action ∈ captured | kept-first-touch | replaced-expired | replaced-corrupt | dropped-invalid`, `kind` = the **validated** `utm_source` (never the raw query value) `?? 'untagged'`, `count = number of fields`. When the URL carries no attribution key the function returns silently with no event: that is the healthy case on every boot of every user, and the repo's rule (`plausible.ts:193-199`) is to report only the anomalous branch.
  - `peekAttribution(): Attribution | null` — a pure read, **no firehose event** (it is called two or three times per create: `signup` props, registry payload, Slack; a debug event per read is noise, and "expired" is already visible as `capture replaced-expired` on the next boot and as `clear absent` at create).
  - `clearAttribution(reason: 'consumed' | 'sign-out'): void` — removes the envelope and logs `message:'clear'` with `action = reason` plus `kind`/`count` of what was removed, or `action:'absent'`.
    `readStoredJson`/`writeStoredJson`/`removeStoredJson` already never throw, already `console.warn` with key and label, and return `{kind:'corrupt'}` / `{ok:false,error}`, so the stash has **no try/catch of its own**: `kind:'corrupt'` → `replaced-corrupt`; `{ok:false,error}` → one `reportError({ surface:'attribution', severity:'warning', error, context:{ action:'storage-failed', stage:'read'|'write'|'remove' } })` and the fallback "proceed unattributed" (no second `console.warn`).
- `src/main.ts`: call `captureAttributionFromUrl()` right after `initAnalytics()` and before `app.use(router)` (web only; a no-op on native where `location.search` is empty).
- Redirect survival (Req 4): in `connectStorage.ts` `createReturnPath()`, on web, append `toSearchParams(peekAttribution())` to `RESUME_SETUP_PATH` when a record exists (`/welcome?resume=setup&utm_source=…`). The return URL then carries the tag; `main.ts` re-captures it on the post-redirect boot (first-touch rule makes this a no-op when storage survived, a restore when WebKit cleared it). `isPodlessRecoveryQuery` and the resume parsing read only `resume`, so extra keys are ignored. `isSameOriginReturnPath` resolves via `new URL(returnPath, PROBE_ORIGIN)` so a query passes (`redirectState.ts:150-156`), and `OAuthCallbackPage.vue` does a full `window.location.href = decoded.returnPath` load, so `main.ts` really does see the query. Tests: `src/services/google/redirectState.test.ts:123` already asserts `/welcome?resume=setup` round-trips; add one case with `&utm_source=x&oppref=y`. `createReturnPath` is private; cover it in `connectStorage.test.ts` by asserting the `returnPath` passed to the mocked `beginDriveAuthRedirectIfNeeded`.
- Sign-out: `clearAttribution('sign-out')` is added to `SIGN_OUT_CLEAR_STEPS` **only** (tier 3, the clean-device promise). It is deliberately NOT on tier 2 or the eviction tiers, and this differs from `clearKeptRecipe` on purpose: a recipe is content that would leak into another person's pod; the tag identifies an ad, not a person, and TTL + consume-once already bound it. The deciding evidence is that tier 2 runs _inside the create flow_: `LoginPage.vue:838-846` `handleStartOver()` calls `authStore.signOut()` (tier 2, `authStore.ts:3143`) then `router.replace('/welcome')`, so a tagged visitor who hits a Drive hiccup, taps "Start over" and then creates would lose attribution at exactly the moment it matters. It is not a `KEY_MATERIAL_STEPS` member. The step-list unit test gains `clearAttribution` in `CLEAR` only; the stash test asserts a tier-2 sign-out leaves the envelope. The impl in `authStore.buildSignOutStepImpls` (`:3133`) is a one-liner `() => clearAttribution('sign-out')`.

### D. Consumption at pod creation

- `authStore.signUp` (`:1246`): `const props = pickPlausibleProps(peekAttribution()); track('signup', props ? { props } : undefined)`. There is no `pick` helper in `src/`; the shared module owns the selection. `PublicPropKey` in `plausible.ts:84` becomes `'feature' | 'method' | 'action' | 'surface' | (typeof PLAUSIBLE_ATTRIBUTION_KEYS)[number]`, so the type and the list cannot drift.
- `syncStore.createNewFile` reads `const attribution = suppressRemote ? null : peekAttribution()` **once**, beside `heardVia` (signature at `:2988`, `suppressRemote` at `:3010`). `_registerCurrentFamilySync(attribution)` gains that one argument and passes it to `buildRegistryPayload({}, { isLoginEvent: true, isSignupEvent: true, attribution })`, which emits `attribution: opts.attribution ?? null` beside `signupPlatform` (`:2868-2871`). The Slack "Came from" line is added at `:3296-3301` as ``(attribution ? `\n*Came from:* \`${parts.join(' / ')}\`` : '')`` beside the `heardVia` term. `clearAttribution('consumed')` goes immediately after the `slackNotify(...)` call inside the same `if (!suppressRemote)`; because the registry write at `:3237` throws into the catch at `:3303`, a registry failure leaves the record untouched with no extra branch. `createNewFile`'s signature and `CreatePodResult` are unchanged.
- `RegistryEntry` (`models.ts:2292`, next to `signupPlatform` at `:2319`) gains `attribution?: Attribution | null` (typed from the shared module). `RegistryWritePayload` is `Omit<RegistryEntry, 'familyId' | 'updatedAt'> & {...}` (`registryService.ts:27`), so the wire type follows with no edit to the service.
- Registry Lambda `index.mjs`: `validAttribution(value)` sits beside `validPlatform` (`:59`). It returns `null` when `value` is not a plain object; otherwise it keeps each allowlisted key whose value is a string that passes the trim / ≤ 100 chars / charset rule, **drops any other key individually** (unknown keys silently, so a newer client with an added key is not nulled by an older Lambda; invalid values with a log), and returns `null` only when nothing valid remains. It is the intentional twin of the TS parser (a Lambda is its own zip and cannot import, `index.mjs:63-65`); each carries a comment pointing at the other, and `attribution.test.ts` and `index.test.mjs` share the same fixture strings (the 101-char value, the `<script>` value, the whitespace-padded value) so a rule change on one side fails the other. Item gets `attribution: existing.attribution ?? (body.isSignupEvent === true ? validAttribution(body.attribution) : null)`; tombstone keeps `attribution` (`:613` block). The PUT path has no structured log today (the only one is `entitlement_computed` on GET, `:176-186`); add a structured line on the drop branches only, since a healthy stamp is visible in the row itself: one `{ msg: 'attribution_dropped', family_id_hash: familyIdHash(familyId), key, reason: 'not-string' | 'too-long' | 'bad-charset' }` per dropped field, and one with `reason: 'not-object'` for the whole-record case, each with the same `eslint-disable-next-line no-console` comment. `not-object` fires only when `body.attribution` is present, non-null and not a plain object; an omitted or `null` body key (every legacy client, every login write) stores `null` silently, otherwise the PUT path would log on every write from an old client. The rule, stated once for both twins: the value after `trim()` must match `^[A-Za-z0-9._~:-]{1,100}$` (empty → dropped). README item shape updated. Tests mirror the `signupPlatform` block (stamps on signup, not on non-signup first write, never moves, never retroactive, non-object → null with the drop log; unknown key dropped silently while valid siblings are kept; oversize / bad charset / non-string field dropped with the per-field log; all fields invalid → null, null when omitted, survives a later PUT, survives DELETE).
- `CreatePodSurvey.vue`: insert `{ id: 'chatgpt_ad', labelKey: 'createSurvey.optChatgptAd', icon: '💬', slackLabel: 'ChatGPT ad' }` before `ai`. Strings: `en` "ChatGPT ad", `beanie` "a chatgpt ad", `zh` "ChatGPT 广告". Test case added to `CreatePodSurvey.test.ts`.

### E. Metrics skill

- `pull_registry.mjs`: `attribution` added to `enrich()` and `familiesFull` (with the "omitting a field pins coverage at 0" comment honoured).
- `build_dashboard.mjs`: `podsSource` is string-compared at nine sites (`:671, :716, :718, :754, :770, :772, :903, :906, :939-941`), so do not grow a fourth arm. Build the one `signupsByContent` map (`Map<utm_content, n>`) **per campaign**, exactly as `:661-664` does for Plausible (filter `attribution.utm_campaign === c.utm_campaign`, `createdAt` in the window, `deletedAt` absent, then key on `utm_content`, or a reused `utm_content` slug from another campaign leaks in), from `familiesFull` rows when any exist (`podsSource = 'registry-utm'`), else from `appPaid.signupsByContent` as today; every downstream site then tests a single `const fromSignups = podsSource === 'registry-utm' || podsSource === 'plausible-app-utm'`. Precedence `registry-utm` → `plausible-app-utm` → `manual` → `none`. `references/data-sources.md` §5 and `SKILL.md` lines on `podsSource` updated.

### F. Declarations

- `docs/runbooks/native-store-submission.md` §1: one new row `> | Campaign tag (utm_source/medium/campaign/content/term, campaign_id, ad_group_id, ad_id, oppref) | Family registry PUT (signup only) | Usage Data → Product Interaction | App activity → App interactions | Analytics (which of our own ads/posts produce families; first-party, never shared with the ad platform) | Yes² | No |`; §4a/§4b "four registry/Plausible rows" wording becomes "five".
- `ios/App/App/PrivacyInfo.xcprivacy`: header comment (a) lists the campaign tag under Product Interaction; no new collected-data type (ProductInteraction / Analytics already declared; `NSPrivacyTracking` stays false, no tracking domains).
- `src/content/help/security.ts` "What we collect": one sentence on the campaign tag.

## Files Affected

**New**

- `packages/brand/attribution.ts`
- `web/src/components/AppLinks.astro`
- `src/utils/attributionStash.ts`, `src/utils/__tests__/attribution.test.ts` (shared module), `src/utils/__tests__/attributionStash.test.ts`

**Modified**

- `packages/brand/package.json` (export `./attribution` + `files` entry)
- `web/src/layouts/BaseLayout.astro`, `web/src/pages/download.astro` (CTA listener removed from both, `<Attribution />` added), `web/src/pages/ios.astro`, `web/src/pages/android.astro` (stale comments), `web/src/pages/privacy.astro`
- `src/main.ts`, `src/services/sync/connectStorage.ts`, `src/services/auth/signOutSteps.ts`, `src/stores/authStore.ts` (sign-out step impl + `signup` props), `src/stores/syncStore.ts` (`buildRegistryPayload`, `_registerCurrentFamilySync`, `createNewFile`), `src/services/analytics/plausible.ts` (`PublicPropKey`, scrub list), `src/types/models.ts`
- `src/components/login/CreatePodSurvey.vue`, `src/services/translation/uiStrings.ts`, `src/services/translation/zh.ts`
- `infrastructure/lambda/registry/index.mjs`, `infrastructure/lambda/registry/index.test.mjs`, `infrastructure/lambda/registry/README.md`
- `.claude/skills/beanies-metrics/scripts/pull_registry.mjs`, `.claude/skills/beanies-metrics/scripts/build_dashboard.mjs`, `.claude/skills/beanies-metrics/references/data-sources.md`, `.claude/skills/beanies-metrics/SKILL.md`
- `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy` (comment), `src/content/help/security.ts`
- Tests: `src/stores/__tests__/createNewFile.test.ts`, `src/services/registry/__tests__/registryService.test.ts` (wire-shape assertion only), `src/components/login/__tests__/CreatePodSurvey.test.ts`, `src/services/google/redirectState.test.ts`, `src/services/sync/connectStorage.test.ts` (or the nearest existing suite that mocks `beginDriveAuthRedirectIfNeeded`), `src/services/analytics/plausible.test.ts`
- `CHANGELOG.md`, `docs/STATUS.md`, `docs/prompts/2026-10/2026-10-02-utm-attribution-118.md`

## Dark Mode Coverage

- **Surface**: one new tile in `CreatePodSurvey` (`chatgpt_ad`). It reuses the existing option-tile markup and classes verbatim, so it inherits the tile's `surface-raised` ground, `ink` label, `line` / `line-strong` border and the selected-state Heritage Orange with its `-lift` partner. No new background, accent or scoped style is introduced.
- **Adjacent defects**: none known on the survey; verified in the Phase 4 dark sweep (desktop + 400 px).

## Observability Coverage

- **Events (app, firehose, existing keys only)** — `surface: 'attribution'`:
  - `capture` (info): `action ∈ captured | kept-first-touch | replaced-expired | replaced-corrupt | dropped-invalid`, `kind = utm_source | 'untagged'`, `count`. No event when the URL carries no attribution key (healthy per-boot case).
  - `clear` (info): `action ∈ consumed | sign-out | absent`, `kind`, `count` of what was removed.
  - `peekAttribution` emits nothing (pure read; see Section C).
  - Storage read/write/remove failure (surfaced by `storedJson`'s result, never thrown): `reportError({ surface: 'attribution', severity: 'warning', error, context: { action: 'storage-failed', stage: 'read' | 'write' | 'remove' } })`, fallback: proceed unattributed.
- **Registry Lambda**: structured `{ msg: 'attribution_dropped', family_id_hash, key?, reason }` lines on the PUT drop branches only (the PUT path has no structured log today; a healthy stamp is visible in the row itself).
- **Site**: the CTA click Plausible event's `attributed: yes|no` prop makes "tag present on site but absent in app" diagnosable as a ratio in the Plausible dashboard; the landing pageview already records the UTMs natively. Site-side storage failures have no reporter; the component's single try/catch emits one `console.warn` with the recovery hint, and `attributed: 'no'` is the production-visible signal.
- **Failure modes covered**: tag never reached the site record (`attributed: no` while Plausible shows UTM visits); tag lost between site and app (site CTA clicks with `attributed: yes` vs app `capture captured` count over the same window); tag lost across the iOS hop (`capture captured` on a `/welcome?resume=setup` boot = restore path fired); expired before creation (`capture replaced-expired` on the next boot, `clear absent` at create); invalid values (`dropped-invalid`); Lambda rejection (`attribution_dropped` with `reason`).
- **Success-path signal**: `clear consumed` with `kind` is the per-source conversion counter; `capture captured` is the top of the funnel. Both are `logEvent` calls, so the `perfTiming` floor does not apply.
- **Critical vs telemetry**: nothing here is `critical`; a lost tag never blocks a user action.
- **Privacy/store gate**: no new `ALLOWED_CONTEXT_KEYS`. The registry field is new collected data, so the runbook table, `PrivacyInfo.xcprivacy` comment and `privacy.astro` are updated in this change (Section F).

## Acceptance Criteria

- [ ] Landing on `http://localhost:4321/?utm_source=chatgpt&utm_medium=cpc&utm_campaign=sg-pilot-oct26&utm_content=test-ad&oppref=abc` then clicking the hero CTA opens `http://localhost:5173/welcome?utm_source=chatgpt&…&oppref=abc`; a second landing with different UTMs within 30 days still forwards the first set.
- [ ] A direct landing (no UTMs) forwards nothing and the CTA click event carries `attributed: no`.
- [ ] In the app, `localStorage['beanies:attribution']` holds the envelope after the tagged arrival; the URL bar is unchanged by capture.
- [ ] Creating a pod from that state produces a Slack message with ``*Came from:* `chatgpt / sg-pilot-oct26 / test-ad` ``, a dev-table registry row with `attribution = {utm_source:'chatgpt', …, oppref:'abc'}`, and clears the envelope.
- [ ] The Plausible `signup` event request body carries `props.utm_content = 'test-ad'`.
- [ ] The web create-flow redirect return path is `/welcome?resume=setup&utm_source=…` when a record exists, and `decodeRedirectState` round-trips it.
- [ ] A later registry PUT (login event) leaves `attribution` unchanged; a DELETE tombstone keeps it; a non-signup first write stores `null`; invalid shapes store `null` and log `attribution_dropped` with a `reason`.
- [ ] The Plausible pageview URL reported from the app no longer carries `oppref`, `campaign_id`, `ad_group_id` or `ad_id` (scrub list extended; `utm_*` still passes through).
- [ ] The survey shows "ChatGPT ad" between "App store" and "ChatGPT / AI search" in `en`, `beanie` and `zh`; selecting it yields Slack `*Heard via:* ChatGPT ad`.
- [ ] Tier 3 (Clear data) removes the envelope; tier 2 and "Start over" leave it.
- [ ] `privacy.astro`, the runbook table, the xcprivacy comment and the help text describe the campaign tag; `assert-cta-tagged` still passes (`CTA guard: N tagged app link(s), 0 untagged`).
- [ ] `npm run validate` green including `src/utils/__tests__/attribution.test.ts` and the registry Lambda tests.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; no new allowlisted key).
- [ ] Every surface in **Dark Mode Coverage** checked in dark (desktop + phone).

## Testing Plan

1. Unit: `src/utils/__tests__/attribution.test.ts`, `attributionStash.test.ts` (TTL boundary at exactly 30 days, corrupt envelope replaced, first-touch kept, storage throw → warning + null), `createNewFile.test.ts` (payload carries `attribution`, Slack text has the line, envelope cleared on success and kept on registry failure, demo mode leaves it untouched), `registryService.test.ts` (wire shape), Lambda `index.test.mjs` (write-once block), `plausible.test.ts` (`signup` props), `CreatePodSurvey.test.ts` (new tile), redirect-state / `createReturnPath` round trip.
2. Browser (Phase 4 of build-auto): `npm run dev:all`; walk the tagged landing → CTA → app → create pod path on desktop Chromium, check the dev registry row via the Lambda GET, the Slack message in `#beanies-*` (or the mocked webhook in dev), the Plausible request in DevTools. Repeat with a second tagged landing (first-touch), a direct landing, and a stale envelope (edit `capturedAt` back 31 days). Dark + 400 px screenshots of the survey.
3. Infra: `scripts/infra/tf-plan.sh -target=module.registry` must show exactly one in-place Lambda function update (code hash); apply with `tf-apply.sh`.
4. Needs greg's hands: the iOS Safari / installed-PWA redirect hop (land tagged on the phone, create a pod via Drive; the Slack message must still show "Came from"); a real ad click end to end after the web deploy.

## Review Passes

- **Pass 1 (Initial draft)**: Shared pure module in `@beanies/brand`, site capture + CTA decoration component, app stash with URL round-trip through the OAuth return path, write-once registry map, Plausible `signup` props, survey tile, metrics `registry-utm` source, privacy declarations, firehose events on existing keys.
- **Pass 2 (DRY + error handling)**: Shared-module tests move under `src/` (the `pricing.test.ts` precedent, no vitest change); `registryService.ts` drops out (the wire type flows via `Omit<RegistryEntry>`); the stash collapses to capture/peek/clear on top of `storedJson` (no own try/catch, no per-read firehose events); the Astro component is a hoisted module script that replaces both inline CTA listeners; the Lambda gains a single `attribution_dropped` structured line (none existed on PUT); `PublicPropKey` derives from a shared `PLAUSIBLE_ATTRIBUTION_KEYS`; ad ids added to the Plausible URL scrub; the dashboard builds one `signupsByContent` map rather than a fourth `podsSource` arm; Assumption 6 corrected (the dashboard reads visit-level UTMs, not props).
- **Pass 3 (Sustainability)**: `none-in-url` dropped (healthy case fired every boot); Lambda validator made a per-field twin of the client (forward-compatible with a key addition, shared fixtures); `NON_UTM_ATTRIBUTION_KEYS` derives the Plausible scrub list and the key list carries its "edit here too" map; site decoration runs once plus per-clicked-anchor instead of a DOM rescan per click; the hoisted `@beanies/brand` client import is proved first (no precedent); sign-out step named on all five lists with the identity rationale.
- **Pass 4 (Fresh-eyes sweep)**: Sign-out clear narrowed to tier 3 after finding `handleStartOver` (`LoginPage.vue:843`) runs a tier-2 sign-out inside the create flow; Slack values rendered in a code span (charset admits `~`/`_`/`:`); `appendAttribution` pinned to `new URL`/origin compare with a quoted selector; `registry-utm` map filtered per campaign to match `:661`; Lambda drop log silenced for omitted/null; `oppref` shape and site-side Plausible URL wording made precise; test path typo fixed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (greg, 2026-10-02, mid `/good-morning`)

> we've had 4 new joiners since the chatGPT ads starts. let's run /beanies-pre-plan and /beanies-plan on notion #118 and once plan is done move directly to /beanies-build-auto. ask me any questions now

### Pre-plan answers (AskUserQuestion, 2026-10-02)

- TTL for the stored first-touch: **30 days**.
- Write the attribution into the DynamoDB registry row: **Yes**.
- `oppref`: **capture and forward, never send** (Conversions API stays out of scope).

### Pre-plan block (Notion #118, written back to the tracker)

See `beanies-plan prompt` on the Notion row; the Requirements above are its Scope items 1:1 plus the three resolved questions.

</details>

## Outcome

> 2026-10-02, built the same day in one session (`/beanies-build-auto`, five parallel implementation streams on the shared module).

- Shipped as planned, with these deviations: the Astro component is `AppLinks.astro` (a name a privacy filter list cannot match); the stash's expiry sweep lives in the per-boot `captureAttributionFromUrl` call and reads stay pure; `kind` is a closed channel enum (`chatgpt.com` → `chatgpt`); a separate `field-dropped` firehose message counts per-field drops; `readEnvelope` tolerates one hour of clock skew; the Lambda derives its length bound from the shared regex and a vitest imports both twins; dashboard rows tagged with a campaign but no `utm_content` go to `untaggedPods`.
- Registry Lambda applied to prod the same day. App and site not deployed at close.
- Verified: `npm run validate` green (10,848 tests); site build 305 tagged links / 0 untagged; 16 site Playwright checks; the app create-flow walk (four passes on a quiet machine; two failures while two production builds ran concurrently, cause not found); survey dark/400px screenshots.
- `/code-review high` twice (nine, then ten scoped findings); recorded, not fixed: tombstoned families leave the registry feed in `pull_registry.mjs`; pre-rollout `pods_manual` rows are not merged once a campaign flips to `registry-utm`.
- **Manual tests skipped (greg, 2026-10-02):** results are read from real ad clicks via the OpenAI ads panel, Slack, the registry and Plausible rather than a staged walk. Open check: the `oppref` shape (Assumption 10).
