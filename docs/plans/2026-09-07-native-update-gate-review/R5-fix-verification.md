# R5 — adversarial verification of the fix round

> Verifying commit `a0f6555e` ("fix(native): the review round") against the 15 claims in
> `FIXES.md`. Reviewed commit under fix: `af38fe75`. Fresh context, no participation in
> R1–R4.
>
> **Checks actually run** (not asserted): `npm run type-check` (clean), full
> `npx vitest run` (**6703 passed / 2 skipped / 18 todo, 560 files**),
> `npx eslint` on every changed source file (0 errors, 3 pre-existing
> `detect-object-injection` warnings), `npm run translate` (**"✅ Up to date"**,
> `zh.json` byte-identical afterwards), `node -e JSON.parse(zh.json)` (valid),
> `npx esbuild src/services/appUpdate/storeUrl.ts` (checked the emitted import list),
> a standalone Vue script proving `effectScope.stop()` disposes the new watcher, and
> direct execution of `compareAppVersions` against 12 boundary versions.

---

## Fix verification

| #   | Claim                                                                   | Present | Effective                                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------- | ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `watch([docVersion, isOnline])` so the prompt can fire without a resume | PRESENT | EFFECTIVE                                 | `src/composables/useAppUpdate.ts:203`. `docVersion` is bumped by `bumpDocVersion()` (`src/services/automerge/projection.ts:113-116`), which sets `loaded = true` on the line **before** the bump, so the watcher's `isLoaded()` read is true when it runs. `useAppUpdate()` is called in `App.vue:1680` (setup body), i.e. before `onMounted`'s Step 5 load, so no bump is missed. Pinned by `useAppUpdate.test.ts:183-195`. See N1 for the half that is _not_ pinned.                                                                                                                                          |
| 2   | `prompt-deferred`, once per reason per session                          | PRESENT | EFFECTIVE                                 | `useAppUpdate.ts:98-137`; `suppressionsReported` at `:120`, cleared in the test seam at `:54`. Pinned by `useAppUpdate.test.ts:197-226`. Three of five gates reported — see O3.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | `getDeviceDiagnostics()` no longer runs per render                      | PRESENT | EFFECTIVE                                 | `src/App.vue:1605` `const fatalDiagnostics = computed(() => (initError.value ? getDeviceDiagnostics() : ''))`, bound at `:1889`. `getDeviceDiagnostics` has no other reader (grep: only `:1591`, `:1596` comment, `:1605`). With `initError === null` the computed returns `''` and never enters `storageWorks` (`src/utils/diagnostics.ts:36-55`). Caching analysed in N4 — benign.                                                                                                                                                                                                                            |
| 4   | Caption prints `action.url`, gated on the action alone                  | PRESENT | EFFECTIVE                                 | `src/components/common/FatalErrorOverlay.vue:150-152`. `v-if="action"`, `{{ action.url }}`. **Not an XSS risk**: mustache interpolation sets `textContent`; the value never reaches an `href` (the `<a>` at `:117-125` still uses the screened `actionHref`). Pinned by `FatalErrorOverlay.test.ts:88-96`.                                                                                                                                                                                                                                                                                                      |
| 5   | `confirmClearData()` closes before it emits                             | PRESENT | EFFECTIVE                                 | `FatalErrorOverlay.vue:67-70`, wired at `:165`. Emit name `clearData` (`:38`) reaches `App.vue:1891` `@clear-data="handleClearDataAndSignOut"` — Vue normalises the hyphenated listener, and `handleClearDataAndSignOut` (`App.vue:1623-1631`) carries no stale `showClearConfirm` reference. Pinned by `FatalErrorOverlay.test.ts:98-114`; see O6 on the test's framing.                                                                                                                                                                                                                                       |
| 6   | Panel resets on the whole fatal tuple                                   | PRESENT | EFFECTIVE                                 | `FatalErrorOverlay.vue:48-58`. Does **not** over-fire: `updateProps` writes through `shallowReactive`, which triggers only on `hasChanged`, and `initErrorDetail`/`initErrorClearHelps` have exactly two writers (`App.vue:226-235` store mirror, `:256-257` guarded generic setter), both of which are new-fatal events. Pinned by `FatalErrorOverlay.test.ts:116-129`.                                                                                                                                                                                                                                        |
| 7   | `classify()` matches real platform strings, defaults `unknown`          | PRESENT | EFFECTIVE                                 | `src/services/appUpdate/versionPolicy.ts:96-108`; `'unknown'` added to `FloorFailure` at `:34`. `SyntaxError` does **not** catch too much: the only `SyntaxError` source inside the `try` is `JSON.parse` at `:147` (`CapacitorHttp.get` rejects with a plain `Error` from the native layer). Pinned by `versionPolicy.test.ts:80-99` with 7 real strings. One new misclassification — see N3.                                                                                                                                                                                                                  |
| 8   | `storeUrlFor` moved out of the composable                               | PRESENT | EFFECTIVE                                 | `src/services/appUpdate/storeUrl.ts:22`; `payloadFailureSurface.ts:29` now imports from it. **`import type { getPlatform }` works and leaves no runtime import** — verified by transpiling: the emitted module contains exactly one import, `@beanies/brand/nav`. `@capacitor/app`, `useConfirm` and the telemetry queue are out of the chokepoint's graph.                                                                                                                                                                                                                                                     |
| 9   | `blocked` counted for the block, not the button                         | PRESENT | EFFECTIVE                                 | `src/utils/payloadFailureSurface.ts:186-203` — `if (kind === 'needs-update')` with `detail: storeUrl ? 'store-link' : 'no-store-link'`. `detail` is on the firehose allowlist (`src/utils/diagnosticContext.ts:185`), so no new privacy/store-declaration obligation. Pinned three ways: `payloadFailureSurface.test.ts:117-121` (ios), `:141-152` (web), `:154-161` (negative for every other kind).                                                                                                                                                                                                           |
| 10  | `compareAppVersions` called once                                        | PRESENT | EFFECTIVE                                 | `useAppUpdate.ts:69-71` — one `order`, `behind` and the undecidable branch both read off it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | Version grammar rejects padded / absurd fields                          | PRESENT | EFFECTIVE **but UNPINNED**                | `src/utils/compareAppVersions.ts:34-35`. Executed directly: `('0.09','0.9') → null`, `('0.016','0.16') → null`, `('9007199254740993','9007199254740992') → null`, 400-digit fields → `null`. **No legitimate version is rejected**: `0.16`, `1.0`, `10.0`, `0.16.10`, `0.15R10`, `0.9.4R1`, `0.16.0`, `999999.999999.999999R999999` all parse; `derive-store-version.mjs`'s own grammar (`/^\d+(\.\d+){0,2}$/` after stripping `R<n>`) is a superset only in the padded/absurd cases the fix deliberately closes. But `src/utils/__tests__/compareAppVersions.test.ts` is **untouched by the commit** — see O1. |
| 12  | `app-version-unparseable`, shape shared                                 | PRESENT | EFFECTIVE (code) / **INEFFECTIVE (test)** | `versionPolicy.ts:60,68-75` (`UpdateCheckFailure`, `reportCheckFailure`), called from `useAppUpdate.ts:77`. The reasoning holds: `fetchUpdateFloor` screens with `isComparableVersion` (`:153`), so a non-null floor always parses, so `order === null` ⇒ `APP_VERSION` is the bad side. The **test** drives it from the wrong end — see O2.                                                                                                                                                                                                                                                                    |
| 13  | Five `notNow`-family zh keys corrected                                  | PRESENT | EFFECTIVE                                 | `public/translations/zh.json` — `trust.notNow`, `pwa.installDismiss`, `passkey.promptDecline`, `communityNudge.snooze`, `appUpdate.prompt.notNow` all now `以后再说`. `grep -c 立即购买 → 0`. **No `hash` field was touched** (`git show … \| grep '^[+-].*hash' → 0 matches`), and `npm run translate` reports **"✅ Up to date"** with the file byte-identical afterwards (sha256 verified).                                                                                                                                                                                                                  |
| 14  | 15 brand-casing zh strings corrected                                    | PRESENT | EFFECTIVE                                 | Exactly 15 keys changed, including the 3 new `appUpdate.*` ones R3-F3 raised (`prompt.title`, `prompt.message`, `openStore`) plus 12 pre-existing. `grep -c 'Beanies' zh.json → 0`. JSON parses.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 15  | Two vacuous tests replaced                                              | PRESENT | EFFECTIVE                                 | `src/stores/__tests__/fatalErrorStore.test.ts:54-75` — the guarded `if (…) expect(…)` is gone, replaced by an explicit `holdsWithoutMessage()` implication asserted at all three steps. `src/utils/__tests__/appQuiet.test.ts` is new (66 lines, 4 cases) and its fourth case makes `useSyncStore()` **throw**, which is the only thing that exercises the `catch` at `appQuiet.ts:17-20`. Both genuinely fail if the behaviour regresses.                                                                                                                                                                      |

**Score: 15/15 present. 14/15 effective in the shipped code.** Fix 12's code is right and its
test is wrong; fix 11's code is right and has no test at all.

---

## New defects introduced

### N1 — MEDIUM (test-only): the new watcher's `isOnline` half is an invalid watch source, and the suite says so 20 times

`useAppUpdate.test.ts:42-44` stubs `useOnline` as `() => ({ isOnline: { value: gates.online } })`
— a plain object, not a ref. `watch([docVersion, isOnline], …)` (`useAppUpdate.ts:203`) therefore
receives one valid source and one Vue rejects. Running the file with `--reporter=verbose`:

```
stderr | useAppUpdate > asks once when the build is behind the floor
[Vue warn]: Invalid watch source:  { value: true } A watch source can only be a
getter/effect function, a ref, a reactive object, or an array of these types.
```

…once per case that reaches the watcher, and twice in the two `docVersion`-bumping cases
(the array getter re-evaluates and re-warns on each trigger).

Two concrete consequences:

1. **The `isOnline` trigger is completely unexercised.** The comment at `useAppUpdate.ts:200-202`
   specifically justifies putting `isOnline` in this watcher — "coming back online is the other
   gate that opens on its own" — and nothing pins it. Deleting `isOnline` from the array would
   leave every test green. Production is _correct_ (`useOnline` returns `readonly(isOnline)`,
   `useOnline.ts:25`, and `isRef(readonly(ref))` is true), so this is a coverage hole, not a
   shipped bug — but it is a hole in exactly the mechanism the headline fix added.
2. **Permanent Vue-warn noise** in a suite whose other 6700 tests are quiet.

Fix: `isOnline: readonly(ref(gates.online))` re-created per test, or make the stub a getter
(`isOnline: computed(() => gates.online)`), and add a case that flips it and asserts the prompt.

### N2 — LOW: the prompt's trigger widened from "launch / resume" to "any document mutation while quiet", and one z-order hole got easier to reach

`docVersion` is bumped by **every** `applyDelta` (`projection.ts:94-98`), not only by the load
barrier. So `maybePrompt` now runs after every mutation the worker applies — including
timer-driven ones (recurring items, calendar sync, notification writes) with no user gesture
behind them. Cost per call is negligible once `dismissedThisSession` is set, so this is not a
performance finding. It is a _reachability_ finding:

`isAppQuiet()` counts only `BaseModal`/`BaseSidePanel` (`src/utils/overlayStack.ts:11-28`). The
**fatal error overlay** (`FatalErrorOverlay.vue:75-78`, `z-[300]`) is rendered directly in
`App.vue` and registers nothing. So with the fatal overlay on screen, `isAppQuiet()` is `true`,
and a background delta now raises `ConfirmModal` at `z-250` **underneath** it: invisible,
undismissable, `hasOpenOverlays()` stuck true for the session, `dismissedThisSession` consumed
and a bogus `prompted` row emitted. That is precisely the failure the `isLoaded()` gate's comment
(`useAppUpdate.ts:103-107`) exists to prevent, reached through a different door.

This was already reachable in `af38fe75` via `resume`; the fix makes it reachable with **no user
action at all**. The boot-spinner half of the same hazard is closed by ordering —
`isInitializing.value = false` (`App.vue:1321`, Step 4) runs before `loadFamilyData()` (Step 5),
so `bumpDocVersion()` cannot fire under the spinner — but nothing closes the fatal-overlay half.

The cheap structural fix is to make `promptBlocker` ask the fatal store too
(`useFatalErrorStore().message !== null → 'busy'`), rather than to narrow the watcher.

### N3 — LOW: an ATS / TLS failure now reports as `offline`

`classify()`'s network branch (`versionPolicy.ts:104`) added `ssl|certificate` to the match set.
An iOS ATS refusal ("An SSL error has occurred and a secure connection to the server cannot be
made.") matches both `ssl` and `connect` and is bucketed `offline`. That is a **permanent,
fleet-wide, ours-to-fix** condition wearing the label that reads "people's networks are flaky" —
the same category of misattribution the fix was written to remove, in the opposite direction.
Before the fix it was `malformed`, which was also wrong but at least alarming.

Not worth a new class on its own; worth knowing that `detail: offline` on this surface no longer
means "the device was offline". (`host` also matches inside unrelated words — "ghost" — which is
harmless in practice.)

### N4 — NOT A DEFECT: the `fatalDiagnostics` cache does not show a stale fatal's diagnostics

Traced deliberately, because the shape invites the bug. `fatalDiagnostics`
(`App.vue:1605`) depends on `initError` alone, and a `ref` assignment only triggers on
`hasChanged`. So a second fatal carrying a **byte-identical** `message` leaves the computed
cached. That does not produce "fatal B shows fatal A's diagnostics", because
`formatDeviceInfo()` (`src/utils/diagnostics.ts:103-113`) contains **no per-fatal content at
all** — UA, WASM, crypto, IDB, SW, LS, SS. Two fatals on one device legitimately produce the same
string.

The only observable staleness is a device whose Web Storage availability changes between two
same-message fatals (quota exhaustion mid-session), where the copied blob would still say
`LS: true`. Narrow, and `initError` is never reset to `null`, so it cannot even be re-armed.
Accept as written.

### Explicitly checked and clean

- **Watcher lifetime.** Registered inside `scope.run()` (`useAppUpdate.ts:185-216`) so
  `getCurrentScope()` owns it. Verified empirically with a standalone Vue script: after
  `scope.stop()` a subsequent bump does not re-fire the callback. No leak, and no
  `immediate: true`, so it does not fire during the composable's own setup.
- **Infinite loop / duplicate prompt.** `maybePrompt` mutates neither watched source, and
  `watch` callbacks do not track (so the `useSyncStore().isSyncing` read inside `isAppQuiet()`
  cannot re-trigger). `dismissedThisSession = true` (`:146`) is set **synchronously** before the
  `await confirm(...)` at `:158`, with no await between the gate and the flag, so two entrants in
  one tick cannot both prompt.
- **Import safety.** `useAppUpdate` → `projection` is acyclic (`projection.ts` imports only vue +
  types), and `projection` is already in every bundle.
- **`suppressionsReported` lifetime.** Module-scoped, cleared in `__resetAppUpdateForTesting()`
  (`:54`) which every `beforeEach` calls, so no cross-test leak. It is deliberately **not** reset
  on sign-out — which is consistent with `dismissedThisSession`, its process-lifetime twin, and
  is what the "once per session" budget in the doc-comment means.
- **`action.url` as raw text.** Safe. Both `setFatal` call sites are in
  `payloadFailureSurface.ts` (`:205`, `:245`) and only the first passes an action, whose `url` is
  the `STORE_URL` constant. Even an attacker-controlled value would be inert as `textContent`.

---

## Overclaims

### O1 — fix 11 shipped with no test, and the record does not say so

Every other behavioural fix in `FIXES.md` names its pin ("Pinned by a test that…", "The test now
pins the real strings…"). Fix 11 is written in the same voice — "Each field is now `0` or an
unpadded number of at most six digits" — but `src/utils/__tests__/compareAppVersions.test.ts` is
**not in the commit's file list**, and its `returns null rather than throwing` case
(`:45-53`) tests `['', 'v0.16', '0.16-beta', 'latest', '0.x', '16.0.0.1', 'R2', '0.16R']` —
none of which is a padded or over-long field. Loosening `VERSION_RE` back to `(\d+)` today breaks
nothing. The claimed behaviour is real (I executed it), but it is unprotected.

### O2 — fix 12's test is driven from the wrong end, and R4's remediation only half-landed

R4 finding 6's fix was two-part: _"relabel the test for what it actually guards (a bad shipped
`APP_VERSION`) **and** give the two emitters distinct classes."_ Only the second half landed.
`useAppUpdate.test.ts:146-159` is still titled `says nothing when the floor is a typo, and reports
the reason`, still comments "A hand-edited, hand-deployed file WILL be mistyped one day", and
still sets `floor.value = 'v0.17-beta'` — while now asserting `app-version-unparseable`, the class
that by construction means _the floor was fine and `APP_VERSION` was not_. The test can only reach
that branch because `fetchUpdateFloor` is mocked past the very screening that makes the new label
true.

So the test pins the **string** and not the **semantics**: a future change that made a bad _floor_
emit `app-version-unparseable` — sending an operator to `appVersion.ts` for a typo in
`min-app-version.json` — would still pass. The honest pin is `vi.mock('@/constants/appVersion',
{ APP_VERSION: 'v0.16-beta' })` with a valid floor. This residue is not listed under "Not changed,
deliberately".

### O3 — "suppressed silently, five ways" reports three

The heading of fix 2 counts five gates; the body honestly describes three
(`offline`/`busy`/`booting`) and defends the three-row budget. Fine. But note that a **fourth**
silent return survives at `useAppUpdate.ts:140` (`if (!url) return;`) inside the function the
record says now explains itself. It is unreachable on native (the composable is native-gated at
`:182` and `storeUrlFor` only returns `null` for `'web'`), so it is harmless — but "every reason
not to interrupt now emits" is not quite what shipped.

### O4 — fix 1's pin covers `docVersion` and not `isOnline`

"Pinned by a test that keeps `docVersion` a real ref, because a stubbed number would make the
watcher fire never, which is the defect." True, and a good instinct. The same test file then hands
the _other_ half of that same watcher a stub that Vue rejects outright (N1). The record presents
the watcher as pinned; half of it is.

### O5 — the caption's own comment now contradicts its template

`FatalErrorOverlay.vue:145-149` still reads "THE URL AS SELECTABLE TEXT, **UNCONDITIONALLY**"
above a `v-if="action"`. The comment predates the fix and meant "regardless of screening", which
is now true; as written beside a conditional it reads as a claim the code does not make. Cosmetic.

### O6 — fix 5's test does not double-tap

`FatalErrorOverlay.test.ts:98-114` is titled "closes the destructive panel BEFORE the sign-out it
starts" and asserts `emitted('clearData')).toHaveLength(1)`, but it clicks _open_ then _confirm_ —
one confirm click, not two. It does pin the regression (without `confirmClearData` the
`not.toContain('clearConfirm')` assertion fails), and closing the panel is what makes a second tap
structurally impossible, so the coverage is adequate. The name promises a concurrency test that
is not run.

### Honest, for the record

- The "Not changed, deliberately" section is accurate on all four items I checked: the extraction
  markup, the reload demotion, the `.catch(() => undefined)` (`useAppUpdate.ts:214`), and the
  inferred accept.
- "Still owed, and none of it is CI-checkable" is correct and understates nothing — the floor's
  `LOAD` cannot be proven from this repo, and a fail-open CORS refusal is indistinguishable from a
  healthy fleet in the `checked` event as currently shaped.
