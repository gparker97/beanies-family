# R2 — Error classification, surfacing, collapsed readers, telemetry

> Range: `1f2e5d8b..6baba006` · Reviewed 2026-09-06 · Read-only review
> Scope: `UnsupportedBeanpodVersionError` / `payloadErrorKind`, the three tables,
> the collapsed file readers, `isStubBeanpod`, the silent-failure fix, `podAccess`
>
> - the join flow, telemetry and privacy, and anything newly able to fail quietly.

## Verdict

**SHIP WITH FIXES** — the correctness core is right. The error class, the
discriminator, the three tables, the classifier order, the join mapper and the
stub probe all do what the plan says, and the behaviour of the three
pre-existing payload kinds is byte-for-byte unchanged. The fixes are one new
user-visible regression on the Settings import surface (a cancelled picker now
shows a red error, and that error never clears), one observability mislabel the
refactor missed, and three smaller gaps.

---

## Findings, most severe first

### F1 — MEDIUM · Cancelling the Settings file picker now shows a red error

`src/pages/SettingsPage.vue:538-540` (the `else` arm is NEW in this range)
`src/services/sync/syncService.ts:2135-2138` (the `AbortError` arm)

The `AbortError` arm returns `{ success: false }`, which is **indistinguishable
from a genuine failure** — no `payloadError`, and `lastError` is deliberately
not touched. The new `else` arm therefore fires on a cancel:

```
} else {
  importError.value = syncStore.error || t('settings.importFailed');
}
```

and `importError` renders in a red slab at `SettingsPage.vue:1940-1941`.

**Reproduction.** Settings → Family Data Options → _Load another Family Data
File_ → confirm the dialog → press Escape / Cancel in the OS picker.
Result: a red box reading "That file could not be imported."
(If a prior attempt left `lastError` set, the **stale raw exception string**
renders instead, because the `AbortError` arm sets only `isSyncing:false` and
leaves `lastError` as it was — `syncService.ts:2138`.)

**User-visible consequence.** A deliberate cancel is reported as a failure. The
brief for this review names it explicitly ("a cancelled picker must not show an
error"); the arm inside `syncService` still returns silently, but the
information that it was a cancel is destroyed before the page can act on it.

**Fix.** Carry the fact out rather than inferring it: add `cancelled?: true` to
`OpenFileResult` (`syncService.ts:65-74`), set it on the `AbortError` arm and on
the two `if (!handle)` / `if (!file)` early returns, forward it through
`loadFromNewFile`/`loadFromDroppedFile`, and return early from the page handler
when it is set. That also fixes the same latent case in `LoadPodView`
(`:536-537`, shows `t('auth.fileLoadFailed')` on cancel) and `JoinPodView`
(`:206-209`), both of which are pre-existing but unpinned.

### F2 — MEDIUM · `importError` is never cleared on the load-from-file path, so the error latches

`src/pages/SettingsPage.vue:516-541`

Neither `handleLoadFromFileClick` (`:516-518`) nor
`handleLoadFromFileConfirmed` (`:520`) resets `importError.value = null`.
Only `handleManualImport` does (`:636`). Before this change the handler never
wrote `importError`, so it could not go stale from here; now it can.

**Reproduction.** Pick a 6.0 file → the red "saved by a newer version" box
appears. Press the button again and pick a valid encrypted file → `needsPassword`
returns early at `:524-527`, the decrypt modal opens, and the stale red error is
still on the page behind it. Same on a successful load: the `result.success` arm
(`:529-533`) sets `importSuccess` without clearing `importError`, so the green
and red slabs render together.

**Fix.** One line, `importError.value = null;` at the top of
`handleLoadFromFileConfirmed` (matching `handleManualImport`).

### F3 — MEDIUM (observability) · The login funnel reports every "update beanies" as `corrupted`

`src/composables/useLoginFlow.ts:444`, consumed at `:631-633`

```ts
stagedPayloadFailure = e.deviceCannotOpen ? 'too-large' : 'corrupted';
```

This is a **fourth hand-rolled ladder over the same question**, and the plan's
whole `PayloadErrorKind` refactor did not convert it. The user-facing copy on
this path is correct (`proveError.value = t(payloadErrorMessageKey(e))`,
`:455`), so this is telemetry only — but `emitOutcome(false, staged ?? 'transport')`
at `:633` is the boot-path login funnel, and a fleet-wide "everyone needs to
update" wave would read there as a fleet-wide **corruption** wave. That is
precisely the confusion the plan says the single discriminator exists to end
("a sixth kind fails the build in three places rather than taking a silent
default") — this site takes the silent default.

**Reproduction.** Boot with a 6.0 pod on Drive, trusted device, PIN path.
`loadFromFile` throws `UnsupportedBeanpodVersionError` → `ensureStaged`'s catch
→ funnel outcome `corrupted`.

**Fix.** `const kind = payloadErrorKind(e);` and add a `needs-update` funnel
code, or map through a table like the other three decisions.

### F4 — LOW/MEDIUM (observability) · Three of the five surfaces emit no event at all for a classified refusal

`src/services/sync/syncService.ts:2096-2103` (`openFileFailure`)

`openFileFailure` sets state and returns. Neither it nor `loadFromNewFile` /
`loadFromDroppedFile` (`syncStore.ts:1487-1556`) calls `logEvent`,
`reportError` or `reportPayloadFailure`. Coverage of the plan's five-surface
drill (Testing Plan §7):

| Surface                                       | Reaches CloudWatch?                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Drive poll / pre-save (`fetchAndMergeRemote`) | ✅ `warning`, `detail: version=6.0` (`syncService.ts:145-153`)                  |
| Drive rebind (`rebindPodFile`)                | ✅ `warning` via `POD_ACCESS_SEVERITY` (`syncStore.ts:4815`)                    |
| Join link, Drive path (`doPickAndLoad`)       | ✅ `warning` via `JOIN_ERRORS` (`useJoinFlow.ts:556-562`, `recordError` `:349`) |
| **Settings picker**                           | ❌ nothing                                                                      |
| **`LoadPodView` picker**                      | ❌ nothing                                                                      |
| **`JoinPodView` local drop zone**             | ❌ nothing (`handleDroppedFile` → `handleLocalLoadResult`, no `recordError`)    |

Not a regression (they emitted nothing before either), but the plan's
acceptance criterion "a 6.0 refusal reaches CloudWatch" is only met on the poll
path, and the drill as written cannot pass. One `reportPayloadFailure(e, {
source: … })` inside `openFileFailure` would close all three at once — it is
already silent for the `too-large` and `credential-stale` classes and, per
`PAYLOAD_IS_INCIDENT['needs-update'] === false`, silent for this one too, so it
would need a `logEvent` rather than a `reportError` to actually count them.

### F5 — LOW (privacy) · `blockDetail` forwards an unclamped, file-controlled string into the firehose

`src/types/sync.ts:392-394` · `src/services/sync/fileSync.ts:122-124` ·
`src/services/sync/syncService.ts:148-152`

`fileVersion` is `obj.version` taken straight off the parsed file and required
only to be a `string`. `blockDetail` interpolates it unchanged into
`version=<x>`, which `noteRemoteUnreadable` puts into the allowlisted `detail`
context key. `redactContext` truncates at `MAX_STRING_LEN = 200`
(`diagnosticContext.ts:321`, `:344-346`) but does **not** sanitise, so a
hand-crafted or corrupted `.beanpod` puts up to 200 characters of arbitrary
file-supplied text into a diagnostics event. The same string also lands verbatim
in `err.message` (`sync.ts:381`), which surfaces in the user's own diagnostic
blob (`payloadErrorDetail`).

Nothing user-identifying reaches the event by any _ordinary_ route — verified
below — so this is a hardening item, not a live leak. But the review brief asked
specifically about `blockDetail` as "a general mechanism a future subclass could
misuse", and today nothing gates it: the base getter's contract is prose only.

**Fix.** Clamp at the source: `this.fileVersion = String(fileVersion).slice(0, 16)`,
or emit `detail` only for a `/^\d+\.\d+$/` match and `version=unknown` otherwise.
Cheap, and it makes the mechanism safe by construction for the next subclass.

### F6 — LOW · `lastVersionDetail` survives `reset()`, so a family switch suppresses the first `pod-version`

`src/services/sync/syncService.ts:341` (declaration) · `:901-929` (`reset()`)

`reset()` clears `remoteBlocked`, `pendingMarker`, `currentProvider`,
`currentEnvelope`, `remoteBaseline`, `lastPersistedBytes`, `probeFailureReason`
… and not `lastVersionDetail`. After a sign-out / family switch in the same tab,
the first save of the new family emits **no** `pod-version` event when its
`version=…,seq=…` string matches the previous family's. Every family is
`version=4.0,seq=none` today, so that is most switches.

Contradicts the acceptance criterion "`doSave` emits `pod-version` on the first
save of a session". One line in `reset()`.

### F7 — LOW (i18n) · A new path renders a raw English exception string

`src/pages/SettingsPage.vue:539` renders `syncStore.error` verbatim, which is
the raw exception message set by `openFileFailure`'s non-blocker arm
(`syncService.ts:2103`) — `Invalid beanpod: missing familyId`,
`Invalid JSON in beanpod file` — or one of the two literals written earlier in
the readers, `'File is empty'` (`:2124`, `:2161`, `:2186`) and
`'Please select a .beanpod or .json file'` (`:2153`).

Before this change the Settings surface rendered nothing at all, so the change
_introduces_ a raw untranslated English string here rather than removing one.
The plan claims "no path now shows a raw English exception string to a user";
that holds for the blocker class only. `LoadPodView.vue:535` and
`JoinPodView.vue:207` do the same thing and are pre-existing.

### F8 — INFO (forward-looking) · No worker codec for `UnsupportedBeanpodVersionError`, and nothing enforces that it never crosses

`src/services/automerge/worker/protocol.ts:288-300` (registry), `:307-320`
(serialize/reconstruct) · `src/types/sync.ts:366-372` (the doc comment that
states the constraint)

**Today it genuinely cannot cross** — see VERIFIED list below. If a future
worker path ever parses an envelope, `serializeError` emits
`name: 'UnsupportedBeanpodVersionError'` with `data: undefined` (no registry
entry), and `reconstructError` (`:315-320`) degrades it to a generic
`DocWorkerError` carrying the name in its message. The consequences are not
cosmetic: `isRemoteBlocker` (`sync.ts:248-252`) would return `false`, so
`doSave` would take its "merge failed, save local anyway" branch and a
pre-guard-shaped document could be written over a newer pod. The class's own
comment names the constraint; nothing tests or lints it. The existing
`payloadCodec` does not fit (different constructor shape), so it needs its own
four-line codec or a test that asserts no worker module imports `fileSync`.

### F9 — INFO · Stale references to the deleted `detectFileVersion`

- `src/stores/syncStore.ts:1230-1233` — names the deleted function and quotes a
  message that no longer exists ("Unsupported beanpod version: X. Expected 4.0.";
  the real message is `Unsupported beanpod version: <x>`, `sync.ts:381`).
- `src/services/sync/fileSync.test.ts:9` — header still lists it.
- `src/stores/__tests__/syncStore.resume.test.ts:200` — comment only.

### F10 — INFO (not reproducible) · One observed cross-file test failure

The first run of
`payloadErrorKind + payloadFailureSurface + podAccess + joinCodeForBlocker + openFileVersion + connectStorage`
failed three assertions in `openFileVersion.test.ts` with
`(0 , __vite_ssr_import_5__.parseBeanpodV4) is not a function` — a symptom of a
module namespace that had not evaluated. It did **not** reproduce: the file
passes alone, pairwise with each of the other five, three consecutive times in
the same six-file combination, and once more after `rm -rf node_modules/.vite`.
Most likely contention with another agent running vitest in this working tree at
the same moment. Recorded only so a future reader who sees it once knows it has
been looked at.

---

## Checked and CORRECT

### 1. `UnsupportedBeanpodVersionError` and `payloadErrorKind`

- **VERIFIED** `sync.ts:378-395`: `step: 'parse'`, so it inherits
  `latches === false` (`:343-345`, `step !== 'parse'`) and
  `keyMayBeWrong === false` (`:291-293`, requires `step === 'decrypt'`);
  `deviceCannotOpen` inherits `false` (`:301-303`); `needsAppUpdate` overridden
  to `true` (`:387-389`); `blockDetail` overridden (`:388-390`). Extends
  `PayloadLoadError` directly, so it is **never** an
  `instanceof CorruptPayloadError`. All seven of these are asserted, not
  inferred, at `fileSync.test.ts:141-163`.
- **VERIFIED** `sync.ts:383`: `this.name = 'UnsupportedBeanpodVersionError'` is a
  string literal, not `new.target.name`, matching the rule at `:337-340` and
  pinned at `fileSync.test.ts:162`.
- **VERIFIED** the throw site (`fileSync.ts:122-124`) sits **before** the
  `familyId`/`familyName`/`keyId`/`encryptedPayload`/`wrappedKeys` checks, so a
  6.0 file with any other shape still classifies as newer, not as malformed. A
  missing or non-string `version` still falls to the plain
  `Invalid beanpod: missing version` (`:132-134`), pinned at
  `fileSync.test.ts:164-166`.
- **VERIFIED** arm order in `payloadErrorKind` (`sync.ts:453-458`):
  `keyMayBeWrong` → `needsAppUpdate` → `step === 'parse'` → `deviceCannotOpen`
  → `corrupt`. The load-bearing pair (`needsAppUpdate` before `parse`) is
  pinned at `payloadErrorKind.test.ts:28-33`, and a torn read still resolves to
  `unreadable` at `:35-37`.
- **VERIFIED** all five kinds reachable in production:
  `credential-stale` ← `docOps.ts:410` / `cache.ts:311` (decrypt);
  `needs-update` ← `fileSync.ts:123`;
  `unreadable` ← `syncService.ts:1573-1578` (the only `parse`
  `CorruptPayloadError` producer);
  `too-large` ← `docOps.ts:391` (allocation failure at load/materialize/decrypt);
  `corrupt` ← `docOps.ts:316`, `:322`.
- **VERIFIED — the worker-boundary question.** It never crosses.
  `parseBeanpodV4`'s only callers are `syncStore.ts:1234, 1966, 2333, 4463,
4750`, `syncService.ts:1563, 2062, 2131, 2165, 2190` and the node-only
  `beanpodProfile.spec.ts:104` — all main thread. No file under
  `src/services/automerge/worker/` imports `@/services/sync/fileSync` (grep:
  one mention, in a comment at `docOps.ts:304`). Errors only travel
  worker → main, so main-thread throws never reach `serializeError`. The
  degradation risk is recorded as F8.

### 2. The three tables

- **VERIFIED** `PAYLOAD_INLINE_KEY` (`sync.ts:473-479`),
  `PAYLOAD_OVERLAY_KEY` (`payloadFailureSurface.ts:61-67`) and
  `PAYLOAD_IS_INCIDENT` (`:83-89`) each carry all five rows under
  `as const satisfies Record<PayloadErrorKind, …>`.
- **VERIFIED** `satisfies` really enforces it: a scratch
  `{a,b} as const satisfies Record<'a'|'b'|'c', number>` fails with TS1360.
  (An _extra_ row is not rejected by `satisfies`, but the runtime
  `Object.keys(...).sort()` assertions at `payloadErrorKind.test.ts:61` and
  `payloadFailureSurface.test.ts:46-47` catch that.)
- **VERIFIED** `npx vue-tsc --noEmit` is clean on this tree, which also proves
  every `PodBlockMessageKey` is a real `UIStringKey` (`t()` is typed on it).
- **VERIFIED** every key named by the three tables exists in `uiStrings.ts` with
  both `en` and `beanie`: `podCredentialStale.inline` (`:4536`),
  `podNewerVersion.inline` (`:4377`), `podUnreadable.inline` (`:4524`),
  `podTooLarge.inline` (`:4225`), `podCorrupted.inline` (`:4541`),
  `resumeSetup.podCredentialStale` (`:4278`), `resumeSetup.podNewerVersion`
  (`:4382`), `resumeSetup.podCorrupted` (`:4203`), `resumeSetup.podTooLarge`
  (`:4215`). Also the new `podAccess.error.newerVersion` (`:4395`),
  `join.error.newerVersion` (`:4400`), `settings.importFailed` (`:4387`),
  `settings.importNeedsPassword` (`:4391`). Worth knowing: `t()` returns
  `UI_STRINGS[key]`, i.e. `undefined` for a missing key (`translationStore.ts:249-257`),
  not the key string — so the compile-time gate is the only gate, and it holds.
- **VERIFIED — no behaviour change for `too-large`, `credential-stale` or
  `corrupt`.** Diffed old against new:
  - old `reportPayloadFailure` returned early on `deviceCannotOpen` then on
    `keyMayBeWrong` (`1f2e5d8b:payloadFailureSurface.ts:59`, `:64`); new returns
    on `!PAYLOAD_IS_INCIDENT[kind]`, which is `false` for exactly
    `credential-stale`, `needs-update` and `too-large`.
  - old overlay ternary was `keyMayBeWrong → credentialStale`,
    `deviceCannotOpen → tooLarge`, else `podCorrupted`; the table reproduces all
    three (`unreadable` and `corrupt` both map to `resumeSetup.podCorrupted`,
    preserving the known mismatch under a comment naming it, `:55-59`).
  - The **only** divergence is a `deviceCannotOpen` error at `step === 'parse'`,
    which old code sent to `too-large` and new code sends to `unreadable`.
    Unreachable: the sole `PayloadTooLargeError` producer is
    `docOps.ts:391`, reached only from `payloadFailure` with `'load'`,
    `'materialize'` or `'decrypt'` (`docOps.ts:316`, `:322`, `:410`,
    `cache.ts:311`, `:404`, `applyAndProject.ts:1235`, `:1277`, `:1308`,
    `:1334`); and the wire codec defaults a missing step to `'load'`
    (`protocol.ts:257`). So behaviour is identical for all three pre-existing
    kinds.
- **VERIFIED** `payloadErrorMessageKey` keeps its name, signature and every
  consumer (`sync.ts:481-483`); the subclass adds **no** `inlineMessageKey`
  override, asserted structurally at `payloadErrorKind.test.ts:54-56`.

### 3. The collapsed readers

- **VERIFIED** `rawText` has no reader anywhere in `src/`, `e2e/` or `scripts/`
  — the single hit is the assertion that it is gone
  (`openFileVersion.test.ts:106`). Deleting it loses nothing.
- **VERIFIED** `detectFileVersion` is gone from all source; the only remaining
  hits are three comments (F9) and the prebuilt `ios/`/`android/` bundles.
- **VERIFIED** the `AbortError` arm still runs **first** in `openAndLoadFile`'s
  catch (`syncService.ts:2135-2138`) and still returns silently. (What it
  cannot do is tell the _caller_ it was a cancel — F1.)
- **VERIFIED** `openFileFailure` (`syncService.ts:2098-2105`) sets `lastError`
  to a translated string **only** for `isRemoteBlocker(e)`, and to
  `(e as Error).message` otherwise. The two channels (`payloadError` and the
  `lastError` mirror) therefore carry the same sentence when a blocker is
  involved, which is what makes the arm ordering in F below safe either way.
- **VERIFIED (with a caveat)** `useTranslationStore()` in `openFileFailure`.
  It is a `defineStore` (`translationStore.ts:30`) and would throw without an
  active Pinia. All three readers are reachable only from user-driven picker
  flows in a mounted app, and `syncService` already calls it at `:515`, so
  production is safe. Two notes: (a) if it _did_ throw, it would throw from
  inside the argument expression, so `updateState({ isSyncing: false, … })`
  would never run and the app would stay wedged in "syncing" — the raw-message
  path has no such exposure; (b) the new test mocks the store
  (`openFileVersion.test.ts:50-52`), so nothing pins the real-Pinia behaviour.
  Low risk; a `try { … } catch { fall back to e.message }` would make it
  structurally safe.

### 4. `isStubBeanpod`

`connectStorage.ts:256-260`. Ran the predicate over the adversarial set:

| input                    | result                          | consequence                                                                                                        |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `null` (zero-byte read)  | stub                            | pre-existing (old code identical, `1f2e5d8b:connectStorage.ts:246`)                                                |
| `''`                     | stub                            | pre-existing                                                                                                       |
| `'   \n\t'`              | stub                            | correct — not a pod                                                                                                |
| `'{}'`                   | stub                            | correct — `createNew` writes exactly this (`googleDriveProvider.ts:585`)                                           |
| `'{}\n'`                 | stub                            | correct                                                                                                            |
| `'{ }'`                  | **not** stub → `adopt-existing` | safe direction (confirm-gated)                                                                                     |
| `'[]'`                   | not stub → `adopt-existing`     | safe                                                                                                               |
| `'﻿{}'`                  | stub                            | correct — `String.trim` strips U+FEFF                                                                              |
| `'﻿{"version":"5.0"}'`   | not stub                        | correct                                                                                                            |
| 4.0 / 5.0 / 6.0 envelope | not stub                        | **the fix** — the old `!== '4.0'` sniff classed a 5.0 pod as an empty placeholder and overwrote it with no confirm |

**No real pod can be classified as a stub** unless the Drive probe returns
empty/whitespace for it. That single residual is _unchanged_ from before
(`if (!text) return true` was there already), a genuine read failure throws and
falls safe to `adopt-existing` (`connectStorage.ts:236-241`), and everything
non-empty other than `{}` now falls to the confirm-gated branch. Covered by
`connectStorage.test.ts:242-275` for 4.0/5.0/6.0 and for empty/whitespace/`{}`/null.

### 5. The silent-failure fix

- **VERIFIED** all four callers carry `payloadError`:
  `loadFromNewFile` (`syncStore.ts:1516-1518`),
  `loadFromDroppedFile` (`:1553-1555`),
  `manualImport` (`:2874-2882`),
  `loadFromGoogleDrive` (`:4487-4500`).
  `openFileFailure` sets it in all three service catches.
- **VERIFIED** the new arm sits **above** the `syncStore.error` arm at every
  site: `SettingsPage.vue:534` before `:538`; `LoadPodView.vue:530` before
  `:534`; `JoinPodView.vue:201` before `:206`. `syncStore.error` is a
  synchronous mirror of `lastError` (`syncStore.ts:500`, `updateState` notifies
  synchronously at `syncService.ts:703`), so below it the arm would indeed be
  dead.
- **VERIFIED** `manualImport`'s two bare English strings are routed through
  `t()` at the page (`SettingsPage.vue:645-651`), and the store keeps its
  developer string for logs only. `needsPassword` returns early from
  `loadFromNewFile` (`syncStore.ts:1501`), so the `settings.importNeedsPassword`
  arm is genuinely reachable and the `payloadError` arm cannot shadow it.
- Residual: F7 (the `else` arm still renders `syncStore.error` raw).

### 6. `podAccess` and the join flow

- **VERIFIED** `FILE_NEWER_VERSION` is in `PodAccessErrorCode` (`podAccess.ts:42-46`),
  `POD_ACCESS_ERRORS` (`:102-106`, under `as const satisfies Record<…>` at `:108`),
  `POD_ACCESS_SEVERITY` (`:125-126`, explicitly typed `Record<PodAccessErrorCode, …>`),
  and `ALL_CODES` in the test (`podAccess.test.ts:31`) — with the new
  completeness assertion at `:121-126` that makes a future omission fail rather
  than pass vacuously.
- **VERIFIED** `classifyDriveFailure`'s new arm is **first**, above the
  `navigator.onLine` check (`podAccess.ts:141-146`), and the ordering is pinned
  with `setOnline(false)` at `podAccess.test.ts:164-169`. That placement is
  genuinely load-bearing: below it, a connection blip mid-read would turn
  "update beanies" into "you are offline". Reads the base-class member, not an
  `instanceof` of the subclass. `podAccess.ts` gains a value import of
  `@/types/sync`, which has **no imports at all** — no cycle.
- **VERIFIED** the rebind report reads `POD_ACCESS_SEVERITY[code]` instead of
  the hardcoded `'critical'` (`syncStore.ts:4815-4817`).
- **VERIFIED** `joinCodeForBlocker` (`useJoinFlow.ts:96-105`) is the only place
  the narrowing happens; both call sites use it (`asJoinDecryptError` `:126`,
  `doPickAndLoad` `:557`), and it is exported for its own test
  (`joinCodeForBlocker.test.ts`, five cases including the lineage-block and
  `undefined` nulls). `JOIN_ERRORS.FILE_NEWER_VERSION` is
  `severity: 'warning'`, `recoveries: []` (`useJoinFlow.ts:220-225`).

### 7. Telemetry and privacy

- **VERIFIED** a 6.0 refusal on the poll path reaches CloudWatch at `warning`
  with `detail: version=6.0`: `latches` is `false` for `parse`
  (`sync.ts:343-345`), so `noteRemoteUnreadable` takes the non-latching branch
  (`syncService.ts:133-155`) and forwards `err.blockDetail`. A torn read is a
  `CorruptPayloadError` with `blockDetail === undefined`, the inherited base getter (`sync.ts:333-335`), so
  the spread adds nothing and the two are distinguishable. The `message` stays
  constant (`Remote pod not readable: Automerge parse`), so the dedup bucket is
  unchanged.
- **VERIFIED** nothing about a newer version pages Slack, at all four sites:
  `PAYLOAD_IS_INCIDENT['needs-update'] === false` → `reportPayloadFailure`
  returns before `reportError` (asserted, `payloadFailureSurface.test.ts:50-58`);
  `POD_ACCESS_SEVERITY.FILE_NEWER_VERSION === 'warning'`;
  `JOIN_ERRORS.FILE_NEWER_VERSION.severity === 'warning'`; and the
  `critical` branch of `noteRemoteUnreadable` (`syncService.ts:166-179`) is
  gated on `err.latches`, which is `false`. A genuine torn-read
  `CorruptPayloadError` at `parse` still pages (asserted,
  `payloadFailureSurface.test.ts:60-64`).
- **VERIFIED** the `authStore` sign-out `critical` (`authStore.ts:2446-2450`,
  `!deviceCannotOpen ? 'critical' : 'warning'`) cannot fire for this class:
  `remoteWasUnreadable` is `isRemoteBlocked()` (`:2366`, `:2531`, `:2643`),
  which is only ever set in `noteRemoteUnreadable`'s latching branch.
- **VERIFIED no new context key.** `src/utils/diagnosticContext.ts` is
  **byte-identical** across the range (empty diff). `detail` is allowlisted at
  `:185`, `build_sha` at `:98`, `family_id` at `:62`, `action`/`error_code`
  pre-existing. No store-declaration update is needed or was made.
- **VERIFIED no user-identifying data on any new event.** The `pod-version`
  event (`syncService.ts:1836-1847`) carries `action`, `detail`
  (`version=<2 chars>,seq=<int>`) and `family_id` (a UUID, explicitly non-PII
  per `diagnosticContext.ts:503-511`). No filename, no family name, no email, no
  document content. `family_name` and the owner email only ride
  `includeEmail: true` (the Slack path), which none of this touches. The one
  hardening item is F5.
- Note (minor, pre-existing shape): `recordError`'s `message` in the join flow
  becomes `FILE_NEWER_VERSION: <translated sentence>` (`useJoinFlow.ts:344-351`
  reading `storeError`, which is now the _translated_ `syncStore.error`), so the
  dedup bucket for that code varies by language and by beanie mode. Harmless
  here (`error_code` is the queryable field), but worth knowing before anyone
  builds an alert on `message`.

### 8. Newly-silent consumers — swept

- `rawText`: no readers (above).
- `detectFileVersion`: no production callers remained; the one load-bearing mock
  (`connectStorage.test.ts`) was rewritten against real envelope text.
- The three deleted `Unsupported file version: …` arms: replaced by a typed
  throw that all four callers now render.
- `reportPayloadFailure`'s two early returns → one table guard: proven
  equivalent above.
- Every other `deviceCannotOpen` / `keyMayBeWrong` dispatch site was checked for
  reachability by the new class: `App.vue:698`, `:867` and `syncStore.ts:935`
  are cache paths; `syncStore.ts:3546` is the sync-bar latch (`parse` never
  latches); `usePodCompaction.ts:203` is the backup-build path;
  `LoadPodView.vue:393`, `:421`, `:581`, `:663` and `useLoginFlow.ts:684`,
  `:877` gate on `keyMayBeWrong`, which is `false`, so they correctly latch
  "cannot open here" and correctly do **not** re-prompt for a password, and
  they all render copy through `payloadErrorMessageKey`. **No site wipes the
  cache**: the only self-heal that deletes is keyed on
  `instanceof CorruptPayloadError`, which this class is not.
  The single site that mislabels is `useLoginFlow.ts:444` — F3.

### Tests run

`payloadErrorKind.test.ts`, `payloadFailureSurface.test.ts`, `podAccess.test.ts`,
`joinCodeForBlocker.test.ts`, `openFileVersion.test.ts`, `connectStorage.test.ts`
— **64 passed**. `npx vue-tsc --noEmit` — **clean**. (See F10 for the one
non-reproducing anomaly.)

---

## Suggested fix list, in order

1. F1 — `cancelled?: true` on `OpenFileResult`, set on the `AbortError` /
   no-file arms, honoured by the three page handlers. _(user-visible)_
2. F2 — clear `importError` at the top of `handleLoadFromFileConfirmed`. _(one line)_
3. F3 — `useLoginFlow.ts:444` reads `payloadErrorKind`, plus a funnel code for
   `needs-update`. _(observability correctness)_
4. F4 — one `logEvent` in `openFileFailure` so the three picker surfaces are
   countable. _(closes the plan's own drill)_
5. F5 — clamp `fileVersion` in the constructor. _(hardening)_
6. F6 — clear `lastVersionDetail` in `reset()`. _(one line)_
7. F7 / F9 — translate the Settings `else` arm; fix the three stale comments.
8. F8 — a codec or a test that pins "no worker module imports `fileSync`".
