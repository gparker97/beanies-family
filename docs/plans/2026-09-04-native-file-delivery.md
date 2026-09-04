# Plan: Make file download and share actually work in the native apps

> Date: 2026-09-04
> Related issues: None — direct implementation. Notion tracker #89.
> Plan file: `docs/plans/2026-09-04-native-file-delivery.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt
> history is embedded under `## Prompt Log` below.

## User Story

As a parent using the beanies iOS or Android app, I want the files the app offers me — my
recovery kit, my meal plan, my family data export, a photo — to actually save when I ask for
them, so that I can keep the things the app tells me to keep.

## Context

Early adopters reported on Discord that the recovery-kit PDF and the meal-planner PDF do
nothing in the native apps. Investigation found the problem is wider and, in two places,
dangerous.

**There is no file-out mechanism in either native shell.** No `@capacitor/share`, no Android
`DownloadListener`, no iOS `WKDownloadDelegate`, and `navigator.share` is not implemented in
either WebView. So `shareOrDownloadFile` always falls through to `downloadFile`, whose
`anchor.click()` does nothing and never throws.

**It then reports success.** `downloadFile` returns `{outcome:'downloaded'}` on the strength
of the click not throwing (`shareOrDownloadFile.ts:30-50`). The meal planner therefore logs
`export-downloaded` — a false success — and CloudWatch shows a healthy export funnel while
every native export is a no-op. That is why none of this surfaced in telemetry.

Six affected paths, four of which were not in the original report:

1. **Recovery-kit PDF** — the worst case. `preferDownload: true` skips the share attempt
   entirely and goes straight to the dead anchor, and `RecoveryKitDisplay.vue:92-98` discards
   the returned result, so `{outcome:'failed'}` never reaches its `catch`. The error banner
   never renders and the user is invited to press "I've stored it" for a file that was never
   written. This is a master credential.
2. **Meal-planner PDF on Android** — `MealPlannerPage.vue:315-318` routes PDF to
   `downloadFile` for everything except iOS.
3. **`.beanpod` manual export and Export Readable Data JSON** — `fileSync.ts:240-254`
   `downloadAsFile`, a second copy of the same idiom, with a `void` return, no `try`/`catch`,
   and a `URL.revokeObjectURL` in the same tick as the click (`:253`) — the precise failure
   its sibling helper documents and defends against, so it can fail even on browsers where the
   click would otherwise work. `syncStore.manualExport` then stamps `lastSync` (`:2354`) as if
   the export succeeded, and `SettingsPage.handleManualExport` (`:537`) `await`s it inside a
   bare wrapper that shows the user nothing whether it worked or threw.
4. **The delete-family "export my data first" step** — `SettingsPage.vue:651` calls
   `handleExportAsJson()` with no `await` and no check, then deletes the Drive file and wipes
   local storage. On native the user ticks the box, receives nothing, and everything is
   destroyed. This is live, unrecoverable data loss. The surrounding `catch` (`:697-700`)
   only `console.error`s and clears `isDeleting` — a half-completed deletion presents to the
   user as a button that simply stopped.
5. **PhotoViewer photo download** — `PhotoViewer.vue:454-462`. Broken on _every_ platform for
   images, not just native: for an image `fullUrl` is `store.getPublicUrl(...)`
   (`PhotoViewer.vue:149`), a cross-origin `lh3.googleusercontent.com` URL, and the `download`
   attribute is spec-ignored cross-origin. (For a **PDF** `fullUrl` is a same-origin `blob:`
   URL from `getBlobUrl`, so the download attribute is honoured there — the two branches
   differ, which the fix must respect.)
6. **PhotoViewer "open in new tab"** — `:347-369`, a bare `target="_blank"` to a `blob:` URL,
   duplicated across two template branches, which in a WebView navigates the app away from
   itself with no way back.

Instructive contrast: `useShareText` handles a missing `navigator.share` correctly by falling
back to the clipboard, which genuinely works. The file path copied that shape but its fallback
is inert.

**No OTA.** `capacitor.config.ts` sets `webDir: 'dist'` with no `server.url`, and there is no
live-update plugin, so the native apps run bundled assets. A web deploy cannot reach them.
Any native fix requires new signed store builds — which means the previously-suggested staged
approach ("ship a JS-only fallback now as a web deploy, the real fix later") would help nobody
on native and is not worth doing.

## Requirements

1. On iOS and Android, requesting any file produces the real OS share sheet (offering "Save to
   Files", Drive, mail, etc.) and the file is genuinely written.
2. On web and installed PWA, delivery behaviour is unchanged — downloads already work there.
3. No delivery path may report success unless a file was actually delivered. `downloadFile`
   must not claim `downloaded` on a platform where the anchor is inert.
4. `preferDownload` must stop meaning "use the dead anchor" on native. On native it means the
   share sheet, because that is where "Save to Files" lives.
5. Cancelling the share sheet remains `cancelled` — distinct from both success and failure.
6. The single delivery seam absorbs the duplicates: `fileSync.downloadAsFile`, the
   `isIosOrIpadOs()` special case in `MealPlannerPage`, and the dead `downloadTranslationFile`.
7. `downloadAsFile`'s same-tick `revokeObjectURL` is fixed (deferred revoke, as the seam does).
8. `RecoveryKitDisplay` inspects the delivery result and shows its error banner on failure.
9. The delete-family flow awaits the export and aborts every destructive step if it produced
   nothing, telling the user why. A throw part-way through deletion is also surfaced.
10. `syncStore.manualExport`'s `lastSync` is stamped only on a delivered export, and its caller
    surfaces the failure.
11. PhotoViewer image download fetches the bytes through the store's authorised path and
    delivers them through the seam; "open in new tab" no longer strands the WebView.
12. Delivery telemetry records the mechanism chosen and the outcome, on the success path too,
    so the success _rate_ is measurable rather than only failures.
13. **Every** delivery failure produces exactly one user-visible message and exactly one
    structured report — no path is silent, and no path double-toasts.
14. No new telemetry context key is introduced unless an existing allowlisted key genuinely
    cannot carry the value (see Observability Coverage).
15. **The layering holds**: Pinia stores do not import the toast/delivery layer, the seam does
    not import telemetry, and no module gains a second reason to change. See Approach.

## Important Notes & Caveats

- **Directory.Cache only.** `android/app/src/main/res/xml/file_paths.xml` declares
  `<external-path>` and `<cache-path name="my_cache_images" path="."/>` but **no
  `<files-path>`**, so a `Directory.Data` file would throw `Failed to find configured root`.
  `Directory.Cache` maps to `getCacheDir()`, which the declared `<cache-path>` covers, and it
  is semantically right: the file is a transient hand-off to the share sheet, not app state.
- **The FileProvider question looks settled and favourable, but re-verify at install time.**
  Our manifest already declares `${applicationId}.fileprovider`
  (`android/app/src/main/AndroidManifest.xml:85-91`, Capacitor scaffold boilerplate from
  `14e0a509`, unused by any of our own Java), which is the authority `@capacitor/share`
  derives. The prior inspection of `@capacitor/share@8.0.1` found an **empty**
  `AndroidManifest.xml` (no provider declared) → no manifest-merger conflict. That inspection
  was of a package that is **not currently in `node_modules`**, and the sibling
  `@capacitor/filesystem@8.1.2` has since moved to Kotlin/IONFILE internals, so the cited
  `SharePlugin.java` line numbers may be stale. **Step 0 of the implementation re-reads the
  installed package** (`node_modules/@capacitor/share/android/src/main/AndroidManifest.xml`
  and the plugin source) before any other work. Do not remove our provider.
- **The Android plugin requires a `file://` URL**, not base64 and not a `content://` URI. Use
  the `uri` **returned by `Filesystem.writeFile()`** — a separate `Filesystem.getUri()` call is
  redundant, verified in the installed `@capacitor/filesystem@8.1.2`: Android returns
  `createWriteResultObject(uriSaved, mode)` → `createUriResultObject(uri)` for `writeFile` and
  the same `createUriResultObject` for `getUri` (`FilesystemMethodResults.kt:30-65`), and iOS
  returns `url.absoluteString` for both (`FilesystemOperationExecutor.swift:27` vs `:43`). Same
  string, one fewer bridge round-trip, one fewer stage that can fail. iOS takes the same
  `files: [url]` shape into `UIActivityViewController`.
- **`Filesystem.writeFile` takes base64 on native.** The v8 typings state plainly: _"Note: Blob
  data is only supported on Web."_ Pass a **bare** base64 payload (data-URL prefix stripped) —
  the web implementation tolerates a `data:` prefix (`web.js:201`) but the native path's
  tolerance is not visible in the shipped Kotlin, and bare base64 is unambiguously supported
  everywhere.
- **iOS has no `UIFileSharingEnabled`**, so writing into `Documents` would be invisible in the
  Files app. The share sheet is the route; do not add a directory write as a "fallback".
- **New native dependency → new signed store builds.** There is no way to reach native users
  with a web deploy. Plan the release accordingly.
- **Do not gate this.** Shipped ungated per the intake. Rollback is a store rollout halt plus a
  revert; the web/PWA path is untouched by construction, so a native regression cannot reach
  browser users.
- **Cache hygiene — sweep before the NEXT write, never delete straight after the share.** Files
  written for sharing accumulate in `Directory.Cache`. The obvious `finally { deleteFile }` is a
  real bug: on Android `Share.share` resolves when the chooser returns a chosen target, which is
  routinely BEFORE the receiving app (Gmail compose, Drive upload, Files) has read the stream
  through the FileProvider grant — deleting there hands the user a truncated or empty
  attachment, a fresh instance of the exact class of bug this plan exists to remove. Instead
  every delivery writes into a dedicated `Directory.Cache/shared/` folder and **sweeps that
  folder at the top of the next delivery**, when the previous share is unambiguously finished.
  At most one hand-off file is ever at rest, the sweep also collects whatever a mid-way failure
  left behind, and the OS may reclaim the cache at any time — so never treat the cached copy as
  the user's saved artefact. `<cache-path path="."/>` covers the subfolder, `writeFile`'s
  `recursive: true` creates it, and both Android auto-backup and iOS iCloud backup exclude
  cache directories, so the transient plaintext copy is never backed up.
- **Do not "fix" the PWA path.** `<a download>` works in browsers and the installed PWA; the
  change must not regress it.
- **Filenames crossing into the filesystem must be sanitised.** `PhotoViewer`'s filename comes
  from `photo.fileName` (Drive-supplied, originally user/other-app supplied). It becomes a
  `path` under `Directory.Cache`. Reuse `sanitiseAttachmentBase` (`src/utils/sanitiseFilename.ts`),
  which already exists for exactly this boundary and strips path separators and traversal.
- **`isNative()` is only ever read via `@/services/sync/capabilities`** (ADR-029: that file is
  the one place `Capacitor.isNativePlatform()` may appear). The seam consults it; nothing else
  in this change touches Capacitor directly except the lazily-imported plugins inside the seam.
- **Scope fence.** The following are explicitly _not_ in this change, so the plan cannot grow:
  recovery-kit invalidation (Notion #117), the ADR-021 `getBlobUrl` -> `getPublicUrl` migration,
  the pre-existing dropped `platform` context key in `capacitorFileProvider`, and any change to
  the PDF/PNG rasterisation pipeline.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have
> changed.

1. `@capacitor/share@8.x` is compatible with the project's Capacitor 8.5 core (all other
   `@capacitor/*` deps are `^8`). **Verified at Step 0, not assumed.**
2. `navigator.share` remains unimplemented in the Android System WebView. The implementation
   should not depend on this — the native branch is chosen by `isNative()`, not by feature
   detection — but it is why the current fallback is dead.
3. Base64 round-tripping a multi-MB blob through the Capacitor bridge is acceptable for the
   file sizes in play (meal-plan PNG, `.beanpod`, photos). Note the peak cost is ~2.4× the blob
   (the blob itself plus a ~1.37× base64 string). To be measured, not assumed; see Testing Plan.
4. The recovery-kit, meal-planner and export flows are otherwise correct — only _delivery_ is
   broken. The PDF/PNG rasterisation pipeline (`useSheetExport`) is untouched.
5. Notion #89 remains the tracking row; no GitHub issue is wanted.
6. Retiring the meal planner's own `export-shared` / `export-downloaded` / `export-cancelled`
   events in favour of the shared `file-delivery` surface does not break an existing dashboard.
   **Check the `beanies-metrics` skill's queries before deleting them**; `export-start` on
   `plan-export` is retained either way, and it is what the absence-detection triage keys off.
7. A family member who can _view_ a photo can also _download_ it via the authorised
   `alt=media` path. ADR-021 notes this is not guaranteed — the public-link grant is what makes
   viewing work for other-owned files, while `getFileBlob` needs `drive.file` coverage. Where it
   does not hold the download resolves to the existing missing-photo state **plus a toast**, not
   a dead button. Not blocking; confirm on a second-member device during testing.

## Approach

**Two layers, no third, and the dependency arrows only ever point down.** The pure
classification seam stays pure; a thin wrapper above it owns the telemetry, the toast and the
console guidance **once**, for all six call sites. Nothing else in the app touches an anchor or
a Capacitor plugin for file output, and nothing _below_ the wrapper imports it.

```
callers (pages + components only — never a store)
   │
   ▼
src/utils/deliverFile.ts        ← telemetry + toast + console guidance (ONE copy)
   │
   ▼
src/utils/shareOrDownloadFile.ts ← classify only: shared | downloaded | cancelled | failed
   │
   ├─ native  → Filesystem.writeFile → getUri → Share.share → deleteFile
   └─ web/PWA → navigator.share({files}) | <a download>   (unchanged)
```

**Stores stay out of it.** `syncStore` imports no toast and no UI today; `deliverFile` toasts.
So `manualExport` does **not** call `deliverFile` (see § 5) — the store hands back bytes, the
page delivers them. That keeps the "which layer may talk to the user" rule intact rather than
punching the first hole in it for a single call site.

### 0. Verify the dependency (before any code)

`npm install @capacitor/share`, then read the installed
`android/src/main/AndroidManifest.xml` (expect empty → no merger conflict) and the plugin
source to confirm it still resolves `${applicationId}.fileprovider` and still requires a
`file://` URL. Also re-confirm the third thing the design now leans on: that
`Filesystem.writeFile` returns the same `file://` uri as `getUri`
(`node_modules/@capacitor/filesystem/android/src/main/kotlin/.../FilesystemMethodResults.kt`
and `ios/Sources/FilesystemPlugin/FilesystemOperationExecutor.swift`). If any of the three has
changed, stop and re-plan the Android leg — everything downstream depends on it.

### 1. `shareOrDownloadFile` — the seam gains a native branch

Keep the existing exported names and the `ShareOrDownloadResult` contract, and keep the file's
existing "classifies but never toasts" comment true.

```
if (isNative())        → nativeDeliver(blob, filename, mimeType, title)
else if preferDownload → downloadFile(...)          // unchanged web behaviour
else if canShareFiles  → navigator.share(...)       // unchanged web behaviour
else                   → downloadFile(...)          // unchanged web behaviour
```

`preferDownload` is deliberately consulted **after** the native check: on native it must not
select the anchor. Document that inversion in the code, because it reads as surprising.

**Types, declared once here and imported everywhere else** — no parallel string unions:

```ts
export type DeliveryStage = 'plugin' | 'encode' | 'write' | 'share' | 'sweep' | 'anchor';
export type DeliveryMechanism = 'native-share' | 'web-share' | 'anchor';

export interface ShareOrDownloadResult {
  outcome: ShareOrDownloadOutcome;
  /** `shared` or `downloaded`. Computed ONCE here so no caller re-derives it —
   *  and so `cancelled` can never be mistaken for success at a destructive gate. */
  delivered: boolean;
  mechanism?: DeliveryMechanism;
  /** Present when `outcome === 'failed'` — which step gave way. */
  stage?: DeliveryStage;
  error?: unknown;
  /**
   * Milliseconds spent PREPARING the file (encode + write) — everything the app
   * controls, deliberately excluding the time the OS share sheet sat open waiting
   * for a human. `deliverFile` records this, and only this, as the perf sample.
   * The seam measures it because the seam is the only layer that knows where the
   * app's work ends and the user's begins; it is data, not telemetry, so the
   * "seam never imports telemetry" rule is untouched.
   */
  prepareMs?: number;
}
```

`delivered` exists because four of the six callers otherwise write
`outcome === 'shared' || outcome === 'downloaded'` by hand, and the delete-family gate is one
of them. One derivation, one place to be wrong.

`nativeDeliver` — **one** `try`/`catch` with a `stage` cursor, not six nested blocks. This is
the same idiom `MealPlannerPage.handleExport` already uses (`let stage` advanced before each
step), so the failure is attributable without a repro and the function stays one level deep:

```ts
const SHARE_DIR = 'shared'; // Directory.Cache/shared — see Cache hygiene

let stage: DeliveryStage = 'plugin';
const started = performance.now();
try {
  const { Share } = await import('@capacitor/share');
  const { Filesystem, Directory } = await import('@capacitor/filesystem');

  // Collect the PREVIOUS delivery's hand-off file (and anything a failed one
  // left). Never throws — it can only warn.
  await sweepShareDir(Filesystem, Directory);

  stage = 'encode';
  const base64 = (await blobToDataUrl(blob)).split(',')[1] ?? '';

  stage = 'write';
  // `sanitiseAttachmentBase` strips the extension BY DESIGN (it is shared with the
  // inbound share target, where a double extension is the attack), so re-attach the
  // original one — the share sheet picks the receiving app from it, and a `.beanpod`
  // with no suffix offers the user nothing useful.
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1];
  const safeName = `${sanitiseAttachmentBase(filename)}${ext ? `.${ext.toLowerCase()}` : ''}`;
  // No `encoding` option: omitting it is precisely what tells the plugin the data is
  // base64-encoded binary. The returned `uri` IS the `file://` URL to share (Step 0).
  const { uri } = await Filesystem.writeFile({
    path: `${SHARE_DIR}/${safeName}`,
    data: base64,
    directory: Directory.Cache,
    recursive: true,
  });
  const prepareMs = performance.now() - started; // stops BEFORE the sheet opens

  stage = 'share';
  await Share.share({ title, files: [uri] });
  return { outcome: 'shared', delivered: true, mechanism: 'native-share', prepareMs };
} catch (err) {
  if (stage === 'share' && isPluginCancel(err))
    return { outcome: 'cancelled', delivered: false, mechanism: 'native-share' };
  return { outcome: 'failed', delivered: false, mechanism: 'native-share', stage, error: err };
}
```

Notes on the shape, each one deliberate:

- **Dynamic imports**, inside the native branch: they keep the plugins out of the web bundle
  and out of every existing `shareOrDownloadFile.test.ts` case (no new `vi.mock` needed for the
  web paths). Matches the codebase's existing lazy-load idiom (`loadJsPdf`, `loadHtmlToImage`
  in `useSheetExport`).
- **Reuse `blobToDataUrl` from `src/utils/blobToDataUrl.ts`** — the existing shared `FileReader`
  promise wrapper, already used by `useSheetExport` and `documentExtractionService`. Do **not**
  write a new `blobToBase64`. Note in a comment that `base64ToFile` is the mirror of this at the
  inbound share-target boundary.
- **No `finally`, and therefore no `wrotePath` bookkeeping.** `sweepShareDir` runs at the TOP of
  the next delivery: it `readdir`s `Directory.Cache/shared`, deletes what it finds, and does all
  of that inside its own `try`/`catch` that only `console.warn`s (`stage:'sweep'`). It can never
  convert a successful share into a failure; it subsumes the "clean up after a mid-way failure"
  case for free (no `encode`-failure special case to get wrong); and, unlike a post-share
  delete, it cannot race the receiving app's read. The happy path reads straight down.
- **Cancel detection is narrowed to `stage === 'share'`.** `@capacitor/share` rejects a
  dismissal with a message (`"Share canceled"`) rather than a DOM `AbortError`; matching on a
  message is inherently fragile, so it is only consulted at the one stage where a cancel is
  possible. `isAbortError` stays for the web path. Both predicates unit-tested, both documented
  as "cancel is a user choice".

### 2. `downloadFile` stops lying

Guard at the top: if `isNative()`, return `{ outcome:'failed', delivered:false, stage:'anchor',
mechanism:'anchor', error: new Error('<a download> does not work in a WebView — route through
shareOrDownloadFile') }` rather than performing an anchor click that does nothing. Defence in depth — after the seam
change nothing should reach it on native — but it converts a whole class of future mistakes
from silent to loud. Keep the deferred `revokeObjectURL`.

### 3. `deliverFile` — the one place failure is handled

New `src/utils/deliverFile.ts`, modelled on the existing `src/utils/actionFailure.ts` (a util
that toasts + reports, so this layering already has precedent):

```ts
export type FileKind =
  'recovery-kit-pdf' | 'meal-plan-pdf' | 'meal-plan-png' | 'beanpod' | 'readable-json' | 'photo';

export async function deliverFile(opts: {
  blob: Blob;
  filename: string;
  mimeType: string;
  title: string;
  kind: FileKind;
  preferDownload?: boolean;
  /**
   * Who shows the user the error.
   *   'toast'  (default) — this module toasts (which auto-reports).
   *   'caller' — the caller renders its OWN visible error (the kit banner, the
   *              delete-family toast). This module still reports + logs guidance.
   * There is no third option: silence is not selectable.
   */
  errorUi?: 'toast' | 'caller';
  /**
   * Page a human for a failure here — `severity: 'critical'` on the ONE report this
   * module already fires, never a second report. Named after and behaving exactly
   * like `showToast`'s existing `critical` option, so the codebase keeps a single
   * escalation vocabulary. Set only by the delete-family gate, where a missing
   * backup immediately precedes a destructive, unrecoverable action.
   */
  critical?: boolean;
}): Promise<ShareOrDownloadResult>;
```

`errorUi: 'toast' | 'caller'` rather than an `ownsErrorUi` boolean: a boolean flag whose
correctness depends on an unenforced promise elsewhere is the kind of thing that quietly rots.
The union names the two real cases, is greppable, and cannot be set to "nothing happens".

It calls the seam, then, in one `switch`:

- `shared` / `downloaded` → `logEvent` success (§ Observability) + `perfTiming.record`.
- `cancelled` → `logEvent` cancel. No toast, no report — a dismissal is a choice.
- `failed` → `console.error` with stage-specific guidance, then **either** `showToast('error',
t('fileDelivery.failed'), t('fileDelivery.failedHelp'), { surface:'file-delivery', error,
context:{ action:'delivery-failed', kind, stage, detail, os } })` — one call that both tells
  the user and lands the structured report (`useToast` auto-invokes `reportError`; a separate
  `reportError` would double-report) — **or**, when `errorUi === 'caller'`, the identical
  `reportError` directly, so the telemetry is byte-identical either way. `critical: true` raises
  the severity of that one report to `'critical'`; it never produces a second one, which is what
  keeps Requirement 13 true at the delete-family gate.

The console guidance is an **exhaustive `Record<DeliveryStage, string>`**, not a `switch` with a
`default`:

```ts
const STAGE_GUIDANCE: Record<DeliveryStage, string> = {
  plugin: 'the @capacitor/share import failed — run `npx cap sync` and rebuild',
  encode: 'FileReader could not base64 the blob — check the size against perf_doc_bytes',
  write: 'Filesystem.writeFile to Directory.Cache/shared refused — disk full or cache evicted',
  share:
    'the share sheet failed to open, had no target, or the FileProvider refused the file — ' +
    'check <cache-path> in android/app/src/main/res/xml/file_paths.xml',
  sweep: 'the previous hand-off file could not be deleted (this delivery still succeeded)',
  anchor: '<a download> was reached on native — a caller bypassed shareOrDownloadFile',
};
```

TypeScript then makes it impossible to add a stage without adding its triage line. That is the
whole maintainability argument for the `Record`: the guidance cannot drift behind the code.

This is the DRY point of the whole plan: six callers, one failure policy, one copy string pair,
zero chance of a caller forgetting to check the result.

### 4. Collapse the duplicates

- `fileSync.downloadAsFile` is **deleted**; its two callers move to `deliverFile`. This removes
  the same-tick revoke bug by construction rather than fixing it twice. Six `syncStore` test
  files carry a `downloadAsFile: vi.fn()` entry in their `vi.mock('@/services/sync/fileSync')`
  factories (`syncAutoSave`, `syncStore.migrate`, `syncStore.verifyPodAccess`, `createNewFile`,
  `syncStore.bannerVisibility`, `syncStore.saveStatus`) — those entries are removed with it,
  otherwise they silently pin an export that no longer exists.
- `MealPlannerPage`'s `format === 'pdf' && !isIosOrIpadOs()` branch is **deleted** — the seam
  now makes the platform decision, which is the whole point of having a seam. Its direct
  `downloadFile` import goes with it, as do its three `export-shared`/`export-downloaded`/
  `export-cancelled` `logEvent`s (now emitted once, by `deliverFile`, on the `file-delivery`
  surface — see Assumption 6). `export-start` and the pre-delivery `ExportError` stages
  (`render`/`rasterize`/`pdf`) stay exactly as they are.
- `translationFiles.downloadTranslationFile` is **deleted** (no production callers; only a test
  mock in `useTranslation.test.ts` references it, which is updated).
- `PhotoViewer`'s two identical `target="_blank"` anchor blocks collapse to **one** action
  rendered once outside the `v-if`/`v-else` pair.
- `photoStore` gains one authorised-bytes primitive and the existing deprecated wrapper is
  rebuilt on it rather than duplicated (§ 6).

### 5. Callers, after the change

| Caller                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RecoveryKitDisplay.exportKitPdf`   | `await deliverFile({…, kind:'recovery-kit-pdf', preferDownload, errorUi:'caller' })`; `kitPdfError = result.outcome === 'failed'` (left clear on `cancelled`). Its existing `catch` keeps handling the _rasterisation_ failures; the delivery report now comes from `deliverFile`, so the duplicate `reportError` for the delivery leg is removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `MealPlannerPage.handleExport`      | `const r = await deliverFile({…, kind: format === 'pdf' ? 'meal-plan-pdf' : 'meal-plan-png' })`; `if (!r.delivered) return;` — no re-toast (`deliverFile` already did), no `ExportError('deliver')`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `syncStore.manualExport`            | **Split, and the store stays UI-free.** `manualExport()` becomes `buildExportEnvelope(): Promise<{ json: string; filename: string }>` — it throws (rather than setting `error.value` and returning) when there is no family key, so the caller cannot miss it — plus a separate `markExported()` that stamps `lastSync`. The store imports neither `deliverFile` nor `fileSync`. Rationale: `syncStore` has never imported the toast layer, and a store that can talk to the user is a boundary that is very hard to re-close later. There is exactly one caller, so the two-step protocol costs nothing.                                                                                                                                                                                                                                                                                                                                                                    |
| `SettingsPage.handleManualExport`   | Owns the whole sequence in one `try`/`catch`: `buildExportEnvelope()` → `deliverFile({ kind:'beanpod' })` → `if (result.delivered) syncStore.markExported()`. A throw (`docClient.exportEncryptedPayload` can reject, and so can the missing-key guard) is caught and toasted — today it swallows everything.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SettingsPage` readable-JSON export | **Split in three, because the existing function is bound directly to `@click` (`SettingsPage.vue:1802`).** Giving it an options parameter would hand it a `PointerEvent` as `opts` the moment a user clicks the button — a live bug, not a style point. So: `buildReadableExportJson(): { json: string; filename: string }` (pure, unit-testable, no I/O); `exportReadableJson(opts?: { errorUi?: 'toast' \| 'caller'; critical?: boolean }): Promise<boolean>` (delivers, forwards both flags verbatim to `deliverFile`, returns `result.delivered`); and `handleExportAsJson(): void` — a zero-argument `void exportReadableJson()` for the template.                                                                                                                                                                                                                                                                                                                      |
| `SettingsPage` delete-family        | `if (wantExport.value && !(await exportReadableJson({ errorUi: 'caller' })))` → abort **before** the Drive delete and the local wipe, call the existing `resetDeleteFamilyState()` rather than poking `isDeleting` by hand (it also clears `deleteConfirmText` and the checkboxes — leaving `deleteConfirmText === 'delete'` behind would re-arm the confirm button the instant the modal reopens), and show one toast (`settings.deleteFamilyExportFailed`) that says nothing was deleted and why. The critical severity rides `exportReadableJson({ errorUi: 'caller', critical: true })`'s single report; the caller fires **no** `reportError` of its own. A `cancelled` export aborts too — `delivered` is false for it, which is precisely why that flag is computed in the seam rather than at each gate. Its outer `catch` also gains a user-visible toast (`settings.deleteFamilyFailed`): a deletion that dies half-way must not present as a button that stopped. |
| `PhotoViewer`                       | See §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 6. PhotoViewer

**First, replace `photoStore.getBlobUrl` with one authorised-bytes primitive.** `getBlobUrl` is
`@deprecated` (pending the ADR-021 public-link migration) and — verified — has **exactly one
caller in the repo** (`PhotoViewer.vue:114`, the PDF branch) and **zero test references**. This
change moves that caller. So keeping it as a thin wrapper would leave a deprecated export with
no callers: dead code that the next reader has to prove is dead. Delete it and rename the body.
That is not the ADR-021 migration the scope fence excludes; it is removing a function this
change itself makes unreachable. Instead:

```ts
/** The single authorised `alt=media` download. Returns bytes, not a URL, so
 *  callers that want bytes stop round-tripping through an object URL. */
async function getFileBlob(photoId: UUID): Promise<Blob | null>;
```

`getFileBlob` holds the existing body of `getBlobUrl` (token → `downloadFileBlob` →
`DriveFileNotFoundError` → `markUnresolved`), minus the `URL.createObjectURL`. `blobUrlCache`
(`photoStore.ts:178`) becomes a `Map<driveFileId, Blob>` with the same lifetime: `deactivate()`
(`:213-214`) swaps its revoke loop for a `.clear()`, and `invalidatePhotoUrl` (`:633-637`) swaps
its revoke for a `.delete()`. Caching the Blob costs no more memory than caching its object URL
did (an object URL pins the blob anyway) and it lets the PDF branch and the save button share a
single download. Net effect: one download path, one deprecated export gone, and an entire class
of object-URL lifetime bugs deleted rather than moved.

**Then, in the component**, replace the `<a :href="fullUrl" :download>` (`PhotoViewer.vue:454`)
and the two `target="_blank"` anchors with **one** `<button>` → `handleSaveDocument()`. Its gate
becomes `v-if="!isMissing"` — the `&& fullUrl` must go: once the PDF branch stops minting an
object URL, `fullUrl` is image-only, and the old gate would silently hide the save button for
every PDF. That also makes `fullUrl`'s remaining meaning single ("the `<img>` src"), which is
worth stating in its declaration comment:

```ts
const blob = await store.getFileBlob(id); // authorised alt=media, cached per driveFileId
if (!blob) {
  showToast('error', t('photos.downloadFailed'));
  return;
} // existing missing state
await deliverFile({
  blob,
  filename: photo.fileName ?? `beanies-photo-${id}.jpg`,
  mimeType: blob.type || 'application/octet-stream',
  title: t('photos.download'),
  kind: 'photo',
});
```

This deliberately **does not** fetch `lh3.googleusercontent.com` directly: the previous draft
assumed those CDN URLs are CORS-readable, which is unverified and would fail closed on an
opaque response. It also does not go blob → object URL → `fetch` → blob, which is what the PDF
branch does today (`PhotoViewer.vue:121`); that branch moves to `getFileBlob` +
`blob.arrayBuffer()` in the same change, deleting the round-trip in both places. A `null`
return → the existing missing state, plus a toast rather than a dead button. See Assumption 7
for the `drive.file`-scope caveat.

The open-in-new-tab affordance is dropped rather than made platform-conditional: the PDF is
already rasterised inline by `pdfToPageImages`, and on native the share sheet's "Open in…" is
the same capability. **Confirm this UX call with greg during implementation** — the alternative
(keep it, web-only, behind `!isNative()`) is a one-line `v-if` if he wants it back.

### 7. Files removed vs added

One new module (`deliverFile.ts`), because six call sites sharing one failure policy is exactly
what a module is for. No new module for the native branch — it lives inside the seam, because it
_is_ the seam's job. No new base64 helper — `blobToDataUrl` already exists. No new photo
download path — `getFileBlob` is an extraction from `getBlobUrl`, not an addition beside it.

Net module count: **+1**, with three functions and one file deleted (`downloadAsFile`,
`downloadTranslationFile`, one duplicated template block, and the `isIosOrIpadOs` special case).

## Files Affected

**Modified**

- `src/utils/shareOrDownloadFile.ts` — native branch, `downloadFile` guard, `stage`/`mechanism`
  on the result, plugin-cancel predicate
- `src/services/sync/fileSync.ts` — remove `downloadAsFile`
- `src/services/translation/translationFiles.ts` — remove `downloadTranslationFile`
- `src/stores/syncStore.ts` — `manualExport` → `buildExportEnvelope` + `markExported`; drop the
  `fileSync.downloadAsFile` import; no new UI-layer imports
- `src/stores/photoStore.ts` — `getBlobUrl` **replaced** by `getFileBlob` (its only caller moves
  in this change, no test references it); `blobUrlCache` becomes a `Blob` cache, so
  `deactivate()` and `invalidatePhotoUrl` lose their `revokeObjectURL` bookkeeping
- `src/pages/SettingsPage.vue` — `buildReadableExportJson` / `exportReadableJson` /
  zero-arg `handleExportAsJson`; delete-family aborts on a non-delivered export;
  `handleManualExport` owns build → deliver → stamp and surfaces failures; delete-family
  `catch` toasts
- `src/pages/MealPlannerPage.vue` — drop the `isIosOrIpadOs` branch, the `downloadFile` import,
  the now-unused `isIosOrIpadOs` import (line 24 — line 316 is its only use in the file, so
  leaving it fails lint) and the three delivery `logEvent`s
- `src/components/auth/RecoveryKitDisplay.vue` — inspect the result; error banner; no duplicate
  delivery report
- `src/components/media/PhotoViewer.vue` — one save action via `getFileBlob`; the PDF branch
  uses the blob directly; the duplicated open-in-new-tab anchors removed
- `src/services/translation/uiStrings.ts` — `fileDelivery.failed` / `fileDelivery.failedHelp`,
  `photos.downloadFailed`, `settings.deleteFamilyExportFailed`, `settings.deleteFamilyFailed`
- `src/utils/diagnosticContext.ts` — **comment only.** The `kind` and `stage` comments are
  extended to document the file-delivery enum values. `ALLOWED_CONTEXT_KEYS` itself is
  **unchanged** (see Observability Coverage), so the Lambda mirror and the store declarations
  do not move.
- `package.json` / `package-lock.json` — add `@capacitor/share`
- `ios/App/App/…` + `android/…` — `npx cap sync` output (plugin registration)
- `src/composables/useTranslation.test.ts` — drop the `downloadTranslationFile` mock
- `src/stores/__tests__/{syncAutoSave,syncStore.migrate,syncStore.verifyPodAccess,createNewFile,syncStore.bannerVisibility,syncStore.saveStatus}.test.ts`
  — drop the now-stale `downloadAsFile: vi.fn()` mock entries
- `src/utils/__tests__/shareOrDownloadFile.test.ts` — add the native-guard case

**Added**

- `src/utils/deliverFile.ts`
- `src/utils/__tests__/shareOrDownloadFile.native.test.ts`
- `src/utils/__tests__/deliverFile.test.ts`

**Deliberately NOT modified**

- `infrastructure/lambda/telemetry/index.mjs`, `docs/runbooks/native-store-submission.md`,
  `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` — see Observability
  Coverage: this change introduces **no new context key**, so none of the privacy-declaration
  chain moves.

## Observability Coverage

Surface: **`file-delivery`** — one kebab-case surface for every path through `deliverFile`, so a
single CloudWatch filter isolates all file delivery.

**No new context keys.** The previous draft proposed five (`mechanism`, `outcome`, `kind`,
`stage`, `bytes`) and pointed at the wrong file for the allowlist. The allowlist lives in
`src/utils/diagnosticContext.ts` (`ALLOWED_CONTEXT_KEYS`), is **mirrored** in
`infrastructure/lambda/telemetry/index.mjs` and pinned by a Lambda test, and every addition also
drags the App Store / Play data-collection declarations. Every value we need already has an
allowlisted home:

| Value             | Key used         | Why it already exists                                                                                                                                                                                                                                    |
| ----------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| what happened     | `action`         | universal                                                                                                                                                                                                                                                |
| which file        | `kind`           | already an allowlisted PII-free enum (meal-planner). Extend its comment to cover the file kinds.                                                                                                                                                         |
| which step failed | `stage`          | already allowlisted (`plan-export` uses render\|rasterize\|pdf\|deliver). Extend its comment likewise.                                                                                                                                                   |
| which mechanism   | `detail`         | already allowlisted and already used this way by `iosOpenInAdapter` (`detail:'open_in'`)                                                                                                                                                                 |
| which platform    | `os`             | already allowlisted, set explicitly (`getPlatform()`), as `nativeBiometric` does. **Not** `platform` — that key is _not_ on the allowlist and is silently dropped today by `capacitorFileProvider` (pre-existing, out of scope, worth a follow-up note). |
| size              | `perf_doc_bytes` | already allowlisted; it is also the only size field `perfTiming.PerfContext` accepts                                                                                                                                                                     |

The only edit to `diagnosticContext.ts` is to those two comments. A diff to the _set_ means
something went wrong — see Acceptance Criteria.

**Events**

- `logEvent({ level:'info', surface:'file-delivery', message:'file delivered', context:{
action:'delivery-succeeded', kind, detail: mechanism, os } })` — on the **success path**, so the
  success _rate_ is measurable, not only failures. `detail` ∈ `native-share | web-share |
anchor`. No `stage` on this event: the result contract reserves `stage` for "which step gave
  way", and setting it on success would make the field ambiguous in every query that filters on
  it — `detail` already names how the file went out.
- `logEvent({ level:'info', …, context:{ action:'delivery-cancelled', kind, detail, os } })` —
  a dismissed share sheet. Explicitly _not_ an error, no toast.
- Failure → **one** `showToast('error', …, { surface:'file-delivery', error, context:{
action:'delivery-failed', kind, stage, detail, os } })`, which auto-invokes `reportError` at
  `severity:'error'`. Where `errorUi: 'caller'` is set, the identical `reportError` is called
  directly. `stage` ∈ `plugin | encode | write | share | sweep | anchor`.
- The **one critical**: the delete-family gate passes `critical: true`, which promotes that same
  single record to `severity:'critical'` — the user asked for a backup before a destructive
  action and did not get one, so it pages. Deliberately NOT a second `reportError` with its own
  `action`: two records for one failure is the exact double-reporting Requirement 13 forbids and
  it would read as two incidents in Slack. Triage filter:
  `surface:'file-delivery' AND severity:'critical' AND kind:'readable-json'`.
- `perfTiming.record('file-delivery', result.prepareMs, { perf_doc_bytes: blob.size })` — and
  **only** `prepareMs`, never the wall-clock of the whole `deliverFile` call. `Share.share` does
  not resolve until a human dismisses the sheet, so timing the whole call would measure user
  dwell time, push essentially every share past `WARN_FLOOR_MS = 1000`, and answer Assumption 3
  (the base64 bridge cost) with a number that has nothing to do with it. Skipped when
  `prepareMs` is undefined (a cancel, and the web paths). Signature matches `PerfContext`
  exactly. Two things to know
  when reading this back: `record` emits on the **`load-perf`** surface (it always does — it is
  a shared instrument, not per-feature), so filter on `perf_op:'file-delivery'`, not on the
  surface; and `TELEMETRY_FLOOR_MS = 250` means small files never escalate, which is fine — the
  concern is large ones.

**Never logged:** the filename. It can carry a family name or a kit id.

**Failure modes and how each is triaged blind**

| Failure                                                | Diagnosed by                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin missing / `cap sync` not run                    | `delivery-failed` `stage:'plugin'` — `STAGE_GUIDANCE` names the fix                                                                                      |
| Base64 encode OOM on a large blob                      | `stage:'encode'` + `perf_doc_bytes`                                                                                                                      |
| Cache write refused (disk full)                        | `stage:'write'`                                                                                                                                          |
| FileProvider path not covered                          | `stage:'share'` — `file_paths.xml` is consulted by the share plugin's `getUriForFile`, not by the write, so this is the share-stage regression signature |
| Share sheet unavailable / no target                    | `stage:'share'`                                                                                                                                          |
| A future caller reaches the dead anchor on native      | `stage:'anchor'`                                                                                                                                         |
| Photo bytes unreachable for a non-owner (Assumption 7) | `delivery-*` absent + the existing `[photoStore] getBlobUrl download failed` / unresolved state                                                          |
| Silent no-op regression returns                        | the **absence** of `delivery-succeeded` against a present `export-start` on `plan-export`                                                                |
| Sweep leak (cache growing)                             | `stage:'sweep'` at `warning` — never fails the delivery                                                                                                  |

## Acceptance Criteria

- [ ] On a real Android device: recovery-kit PDF, meal-plan PDF, meal-plan PNG, `.beanpod`
      export, readable JSON export and a photo download each open a share sheet and produce a
      file that exists afterwards
- [ ] The same six on a real iPhone
- [ ] Dismissing the share sheet reports `cancelled` — no error toast, no success state
- [ ] With delivery forced to fail, no path shows success: the kit renders its error banner,
      the meal planner toasts an error, CloudWatch shows `delivery-failed` and no
      `delivery-succeeded`
- [ ] Every forced failure produces **exactly one** toast and **exactly one** CloudWatch record
      (no double-report from a caller that also reports)
- [ ] Ticking "export my data first" in delete-family with a failing **or cancelled** export
      leaves the Drive file and the local database intact, and explains why
- [ ] `markExported` is not called when delivery fails, and `handleManualExport` shows the user
      something when any step throws
- [ ] Web and installed-PWA download behaviour is unchanged (verified on desktop Chrome and an
      installed PWA)
- [ ] PhotoViewer image download saves a file (image **and** PDF); no `target="_blank"` and no
      `:download` anchor remains in the component
- [ ] A photo whose Drive `fileName` contains `../` or `/` writes a safe cache path
- [ ] Sharing the recovery-kit PDF **to Gmail (compose) and to Google Drive** on Android
      produces a **non-empty** attachment — the specific race a post-share delete would lose
- [ ] `Directory.Cache/shared` holds at most one hand-off file, and the previous one is gone
      after the next delivery (including after a delivery that failed part-way)
- [ ] `git grep getBlobUrl src` returns nothing — the deprecated function is deleted, not kept
      as an unused wrapper
- [ ] The share sheet is the only thing timed out of the perf sample: a share left open for
      ~10s still records a `perf_op:'file-delivery'` duration in the tens of milliseconds
- [ ] `git grep` shows no remaining `a.download` / `createObjectURL` file-output idiom outside
      `shareOrDownloadFile.ts`
- [ ] **Layering holds**: `git grep -l "deliverFile" src/stores src/services` returns nothing,
      and `shareOrDownloadFile.ts` imports neither `useToast` nor `@/services/telemetry`
- [ ] `handleExportAsJson` takes **zero** parameters (it is `@click`-bound); the options-taking
      `exportReadableJson` is never referenced from a template
- [ ] `STAGE_GUIDANCE` is a `Record<DeliveryStage, string>` — adding a stage without guidance
      fails type-check
- [ ] Unit tests cover: the native branch, `preferDownload` on native, native cancel vs
      failure, `downloadFile`'s native guard, `deliverFile`'s toast/report/telemetry matrix, and
      the delete-family abort — with at least one test asserting the exact bytes handed to
      `Filesystem.writeFile` rather than only that it was called
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; the
      `ALLOWED_CONTEXT_KEYS` **set** is unchanged (only its comments) and the Lambda mirror is
      untouched (a diff to either set means a key crept in and the store declarations must be
      revisited)
- [ ] `npx cap sync` committed; Android and iOS both build

## Testing Plan

1. **Step 0 verification** — installed `@capacitor/share` manifest is empty and the plugin still
   derives `${applicationId}.fileprovider` from a `file://` URL.
2. **Unit** — new `shareOrDownloadFile.native.test.ts` with `@capacitor/share` and
   `@capacitor/filesystem` mocked and `isNative()` stubbed true: `writeFile` receives bare
   base64 (no `data:` prefix), no `encoding` option, `Directory.Cache`, `recursive: true` and a
   `shared/` path; `Share.share` receives **`writeFile`'s own returned `uri`** and `getUri` is
   never called; `deleteFile` is **never** called in the same delivery as the share it belongs
   to (the race guard) but the NEXT delivery sweeps the previous file, including after a
   `write`- or `share`-stage failure; a sweep rejection still leaves the outcome `shared`; a
   plugin cancel at the share stage → `cancelled`, the same message at any other stage →
   `failed`; each stage's rejection → `failed` with the right `stage`; `preferDownload: true`
   still takes the native path; `prepareMs` is present on success, is measured before
   `Share.share` resolves (assert with a deliberately slow `Share.share` mock), and is absent on
   cancel; `../evil.pdf` is sanitised to a safe base **with its `.pdf` re-attached**, and a
   filename with no extension produces no trailing dot.
3. **Unit** — new `deliverFile.test.ts`: success → one `logEvent`, no toast; cancel → one
   `logEvent`, no toast, no report; failure → one toast (auto-reporting) and no second report;
   `errorUi:'caller'` → no toast but the identical report still fires.
4. **Unit** — existing `shareOrDownloadFile.test.ts` extended: `downloadFile` returns `failed`
   when `isNative()` is true; the four web paths unchanged (they must need **no** new mocks —
   proof the plugin imports are genuinely lazy).
5. **Unit** — `SettingsPage`: `buildReadableExportJson` is pure and returns the expected
   collections (now testable without any DOM); delete-family with a failing export aborts before
   `deleteFile` and before `deleteLocalFamily` (assert neither is called); a **cancelled** export
   does the same.
6. **Unit** — `syncStore`: `buildExportEnvelope` throws when there is no family key, and
   `markExported` is the only thing that moves `lastSync`.
7. **Build** — `npx cap sync`, then a real Gradle build and an Xcode build. The Gradle build is
   the one that would surface a manifest-merger problem; Step 0 says there is none, but the
   build is the proof.
8. **Device — Android** and **9. Device — iOS**: walk all six delivery paths, plus a cancel,
   plus the delete-family abort. Confirm the file exists in Files/Drive afterwards, and that the
   cache directory is empty after. On iOS also do the photo download **as a second family member
   who does not own the file**, to settle Assumption 7.
9. **Regression — web** — desktop Chrome and an installed PWA: all six paths still download as
   before.
10. **Perf** — check `perfTiming` for `perf_op:'file-delivery'` on the largest realistic blob (a
    photo or a grown `.beanpod`) to validate Assumption 3.
11. **Telemetry** — confirm `delivery-succeeded` appears in CloudWatch for a real success and
    `delivery-failed` with the right `stage` for a forced failure, and that no context key was
    dropped by the redactor (a `[diagnosticContext]` console warning means a key is not
    allowlisted).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan intake plus a package inspection of
  `@capacitor/share@8.0.1` that settled the FileProvider question before drafting.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code. Reuse existing
  `blobToDataUrl` instead of a new `blobToBase64`; added a single `deliverFile` wrapper so six
  call sites share one toast/report/telemetry policy instead of each rolling their own;
  corrected the telemetry design to use only already-allowlisted keys (`action`/`kind`/`stage`/
  `detail`/`os`/`perf_doc_bytes`) in `diagnosticContext.ts` + its Lambda mirror — not the five
  new keys in the wrong file, which also removes the store-declaration churn; fixed
  `perfTiming.record`'s context shape; replaced the unverified `lh3` CORS-fetch in PhotoViewer
  with the store's existing authorised `getBlobUrl` path and collapsed its two duplicated
  open-in-new-tab anchors into one action; made the `@capacitor/share` import lazy so no
  existing test or web bundle changes; added filename sanitisation via `sanitiseAttachmentBase`;
  and caught three further silent failures (`handleManualExport` swallowing throws, the
  delete-family `catch` only `console.error`ing, `manualExport`'s unsurfaced `error.value`).
- **Pass 3 (Sustainability)**: Flattened `nativeDeliver` from six nested `try`/`catch` blocks to
  one `try` with a `stage` cursor + a `wrotePath`-guarded cleanup; kept `syncStore` free of the
  toast layer by splitting `manualExport` into `buildExportEnvelope` + `markExported` with the
  page owning delivery; caught a live bug — `handleExportAsJson` is `@click`-bound, so the
  planned options parameter would receive a `PointerEvent`, now split into a pure builder, an
  options-taking `exportReadableJson`, and a zero-arg handler; moved PhotoViewer onto a new
  non-deprecated `photoStore.getFileBlob` (extracted from, not added beside, the deprecated
  `getBlobUrl`) and removed the blob→objectURL→fetch→blob round-trip from the PDF branch too;
  replaced the `ownsErrorUi` boolean footgun with an explicit `errorUi: 'toast' | 'caller'`
  union; added `delivered` to the result so four callers stop re-deriving success and a
  `cancelled` export can never pass the delete-family gate; declared `DeliveryStage`/
  `DeliveryMechanism` once and made triage guidance an exhaustive `Record` so it cannot drift;
  narrowed plugin-cancel matching to the share stage; resolved the diagnosticContext
  modified/not-modified contradiction (comment-only edit, set unchanged); noted the six stale
  `downloadAsFile` test mocks, that `perfTiming` emits on `load-perf`, and the ADR-021
  `drive.file`-scope caveat for non-owner photo downloads; and added a scope fence plus
  layering-assertion acceptance criteria.
- **Pass 4 (Fresh-eyes sweep)**: Caught three defects the earlier passes' design would have
  shipped and one verified simplification. (1) The post-share `finally { deleteFile }` races the
  receiving app's read of the FileProvider stream on Android — `Share.share` resolves when the
  chooser returns, not when Gmail/Drive has read the bytes — so cleanup moved to a
  sweep-at-the-top-of-the-next-delivery in a dedicated `Directory.Cache/shared` folder, which
  also subsumes the mid-way-failure cleanup and removed the `wrotePath` bookkeeping entirely.
  (2) `perfTiming.record` over the whole call would have measured how long the user stared at
  the share sheet and escalated every share to `warn`; the seam now returns `prepareMs`
  (encode + write only) and `deliverFile` records that. (3) The delete-family gate would have
  fired two CloudWatch records for one failure, contradicting Requirement 13 — replaced by a
  `critical` flag on `deliverFile` that raises the severity of its single report. Verified in
  the installed `@capacitor/filesystem@8.1.2` Kotlin and Swift that `writeFile` returns the same
  uri as `getUri`, deleting a plugin call and the whole `geturi` stage; `cleanup` became `sweep`
  and the `file_paths.xml` triage signature moved to the `share` stage where it actually
  surfaces. Also: defined the missing `ext` (`sanitiseAttachmentBase` strips extensions by
  design, so it must be re-attached); found `photoStore.getBlobUrl` has exactly one caller and
  no tests, so it is deleted rather than kept as a dead deprecated wrapper, with `blobUrlCache`
  becoming a `Blob` cache; fixed the PhotoViewer save button's `v-if`, which would have hidden
  itself for every PDF once `fullUrl` stopped being set; made the delete-family abort call the
  existing `resetDeleteFamilyState()` so a stale `deleteConfirmText` cannot re-arm the confirm
  button; dropped the redundant `stage` from the success event; and noted the `isIosOrIpadOs`
  import that becomes unused in `MealPlannerPage`.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> ok - just to confirm, the wall mode supports both landscape and portrait modes… _(prior task;
> the file-delivery work begins below)_

> once done, let's address the more serious issue of not being able to download/share PDFs in
> the apps (at least in the android app - but liekly impacts both apps) which impacts meal
> planner pdfs, recovery kit, and potentially other surfaces.
>
> you can check status.md as some investigation was alrady done in a previous session so some
> context may be there.
>
> please do a full investigation into this issue and propose how it can be fixed and work
> reliably, as recovery kit downloads are important and should work on any surface, and PDF
> generation/download in general is used across the app.
>
> one additional question i had is related to recovery kits - you can generate an unlimited
> number it seems, but is it possible to delete or clear your recovery kits (to invalidate
> them)? for example, if they are lost? if not, i think this is an important feature to add
> while we are working on them
>
> please do a full investigation and propose the fix - once done we will move into
> /beanies-pre-plan and /beanies-plan to prepare the plan and implement.

### Follow-up 1

> ok let's put the recovery kit renovation work into 117 (but note that recovery kit and other
> pdf download and share in the native app should be done here) and go ahead to plan the rest.
> go to /beanies-pre-plan then go to /beanies-plan once implement directly and once
> implementation is complete run /code-review max against all code to ensure it is implemented
> as per the plan and no bugs, side effects, or security issues were introduced

### Follow-up 2 (intake decisions, via AskUserQuestion)

> **Data-loss path**: "Bundle it into the main plan" — the delete-family guard ships with the
> delivery work rather than as a separate hotfix.
>
> **GitHub issue**: "No, Notion row only".

</details>
