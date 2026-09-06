# R1 — the version derivation, the worker boundary, the restore stamp

> Reviewer: R1 (correctness core)
> Range: `1f2e5d8b..6baba006`, read at `HEAD` = `bcf58d06` (tree identical to `6baba006` apart from this review's own docs)
> Date: 2026-09-06

**Verdict: SHIP WITH FIXES** — the correctness core is sound. Every write path derives
the version from the document, the worker boundary describes exactly the bytes it
exports on both the worker and the inline path, and the restore stamp is set, composed
and installed correctly. The fixes are three observability defects (one of which
silently disables the very signal the plan calls its central invariant) plus two
low-severity hardening gaps. Nothing found writes a malformed file or corrupts a
lineage for a family on the current build.

Legend: **VERIFIED** = I read the code (or ran it). **INFERRED** = I reasoned about it
and say so.

---

## Findings, most severe first

### F1 — MEDIUM. `reset()` does not clear `lastVersionDetail`, so the `pod-version` transition memory leaks across families

**VERIFIED.**

- `src/services/sync/syncService.ts:341` — `let lastVersionDetail: string | null = null;`
- `src/services/sync/syncService.ts:1837-1838` — the only read and the only write.
- `src/services/sync/syncService.ts:901-930` — `reset()` clears `currentProvider`,
  `currentProviderFamilyId`, `currentFamilyKey`, `currentEnvelope`, `noKeyWarnedOnce`,
  `remoteBaseline`, `lastPersistedBytes`, `probeFailureReason`, `probeFailureCount`,
  the save-failure counters and the cache-persist banner. It does **not** clear
  `lastVersionDetail`. (Grep confirms three occurrences of the identifier in the file,
  none in `reset()`.)

**Sequence that produces it.** Sign in to family A, save (emits
`detail: version=4.0,seq=none`). Switch family (or sign out and open a second family in
the same tab) — `reset()` runs, `lastVersionDetail` survives — and family B derives the
same string, so B's first save emits **nothing**. The same suppression hits the case
that actually matters: A compacted at seq 1 (`version=5.0,seq=1`), B later compacts and
also derives `version=5.0,seq=1` — identical string, event suppressed. The `detail`
string carries no family identity, and `family_id` rides in a sibling context key that
the memo never looks at.

**Consequence.** No user-visible effect; the damage is to the one diagnostic the plan
calls "the plan's central invariant and the one field failure it has no other signal
for" (plan R1.8). In CloudWatch, "when did family B become 5.0" has no event for that
session, and the acceptance criterion "`doSave` emits `pod-version` on the first save of
a session" is false after any family switch.

**Fix.** One line in `reset()` (`lastVersionDetail = null;`), or memoise on
`` `${currentEnvelope.familyId}:${versionDetail}` ``. The second is better — it also
covers a family switch that does not route through `reset()`.

**Why the suite does not see it.** `src/services/sync/__tests__/savePathVersion.test.ts:110-113`
calls `vi.resetModules()` per test with the comment "Real `syncService` per test, so the
module-level transition memory is fresh". The workaround is correct for the tests it
writes and is precisely why the leak is invisible.

---

### F2 — MEDIUM (observability). The stated alarm for a dropped `lineage` cannot fire: both halves of `detail` come from the same optional

**VERIFIED.**

`src/services/sync/syncService.ts:1836`:

```ts
const versionDetail = `version=${beanpodVersionFor(lineage)},seq=${lineage?.seq ?? 'none'}`;
```

`beanpodVersionFor` returns `'4.0'` exactly when `lineage` is falsy
(`src/services/sync/fileSync.ts:61`), which is exactly when `lineage?.seq ?? 'none'`
prints `none`. So the string named as the alarm in three places —

- the plan, R1.8: "is any device writing `version=4.0` while `seq` is present … is
  therefore the alarm for a dropped `lineage` across the worker boundary";
- the module comment, `src/services/sync/syncService.ts:334-340`;
- the test's own title, `src/services/sync/__tests__/savePathVersion.test.ts:222-227`,
  "reports what the WRITER chose, so a dropped lineage is visible as version=4.0 with a
  seq" (the body asserts `version=5.0,seq=3`, i.e. it does not test the claim)

— is **unreachable by construction**. A `lineage` dropped across the worker boundary
yields `version=4.0,seq=none`, byte-identical to a never-compacted family.

**Consequence.** If a stale/partial worker double ever omits `lineage` — a failure mode
this codebase explicitly anticipates elsewhere ("an older or partial worker double omits
`heads`", `src/services/sync/syncService.ts:1876-1879`) — the resulting compacted payload
labelled 4.0 (the one artefact the format bump exists to prevent) is **not** detectable
by the single-filter query the plan promises. What _is_ detectable is a per-family
regression: a `family_id` that logged `version=5.0,seq=N` later logging
`version=4.0,seq=none`. That needs cross-event correlation rather than one filter — and
F1 can suppress even that when the device has switched families.

**Fix.** Correct the comment and the test title to describe the real detector (a 5.0→4.0
transition per `family_id`), and fix F1 so that per-family history is complete. A
genuinely independent boundary check is not available from this call site: any second
read of the lineage reads the same value.

---

### F3 — LOW/MEDIUM. `pod-version` is emitted before the write, and the memo is committed even when the write fails

**VERIFIED.** The event block is `src/services/sync/syncService.ts:1836-1849`; the
upload is `const ack = await providerAtWrite.write(fileContent);` at
`src/services/sync/syncService.ts:1872`.

**Sequence.** A family's first post-compaction save fails at the provider (offline, 403,
quota, token expiry). "pod written at version … `version=5.0,seq=1`" is already in the
firehose and `lastVersionDetail` is already `5.0`, so every later _successful_ save at
the same version emits nothing.

**Consequence.** The firehose records a 5.0 write that never landed and never records the
one that did, so "when did this family become 5.0" can be arbitrarily early. Diagnostic
only. Fix: emit below the ack (both `lineage` and `versionDetail` are still in scope at
`:1872`), or compute `versionDetail` where it is now and assign `lastVersionDetail` only
after the ack.

---

### F4 — LOW. A pod compacted by the retired Tier-2 code now writes 4.0 with a history-less payload

**VERIFIED (mechanism), INFERRED (population).**

Such a pod carries its lineage on the **envelope** only. The envelope reader was written
and deliberately removed (`src/types/syncFileV4.ts:100-112`, and the long comment at
`src/services/automerge/worker/applyAndProject.ts:807-833`), so `docLineage` answers
`null` (`src/services/automerge/worker/docOps.ts:75-77`) and `beanpodVersionFor(null)`
returns `'4.0'` (`src/services/sync/fileSync.ts:61`). The file written is a compacted,
history-less payload labelled 4.0 — which the deployed build parses happily
(`git show c3a6be98:src/services/sync/fileSync.ts`, the `obj.version !== '4.0'` throw at
its `:73-75`) and merges across lineages. That is exactly the artefact the format bump
exists to make impossible.

The affected population is named in the code as one dev family
(`applyAndProject.ts:821-823`: "the entire affected population is one dev family
(`podCompaction` is OFF and has never shipped enabled)"), and the stated mitigation is
"resetting the one affected dev family before soaking" (`:832`). The gap is that the
plan's Caveats discuss only the **merge** consequence of the removed reader, never the
**version** consequence — and the affected pod is greg's own, which is what Testing Plan
step 8.4 runs the on-device acceptance against. State it beside the deploy sequence.

---

### F5 — LOW. The lint rule that keeps `guardLineage` to one caller does not cover a dynamic `import()`

**VERIFIED empirically** (probed with `eslint --stdin --stdin-filename` against the real
config; no files were created):

| form                                                                        | result                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `import { guardLineage } from '@/services/sync/podLineage'`                 | error ✓                                                                                             |
| `import * as pl from '@/services/sync/podLineage'`                          | error ✓ ("* import is invalid because 'guardLineage,compareLineage,lineageAction' … is restricted") |
| `const m = await import('@/services/sync/podLineage'); m.guardLineage(...)` | **no error**                                                                                        |

The rule is `eslint.config.js:371-399`. ESLint's `no-restricted-imports` registers only
`ImportDeclaration`, `ExportNamedDeclaration`, `ExportAllDeclaration` and
`TSImportEqualsDeclaration`
(`node_modules/eslint/lib/rules/no-restricted-imports.js:816-826`); `ImportExpression` is
not handled.

This matters because `await import(...)` is a house idiom in exactly these layers (e.g.
`src/stores/syncStore.ts:1664`, `:1693`, `:1723`), and the structural backstop
(`src/services/sync/__tests__/lineageInDocument.test.ts:74-79`) greps only
`src/stores/syncStore.ts` and `src/services/sync/syncService.ts`.

**Consequence.** A future author can reintroduce a second guard call site outside the
worker with no gate firing — the failure ADR-036 exists to prevent. Cheap hardening:
widen `lineageInDocument.test.ts`'s grep to every `src/**` source file except
`applyAndProject.ts` and `podLineage.ts` (it already reads files off disk), or add a
`no-restricted-syntax` entry for `ImportExpression[source.value=/podLineage/]`.

---

### F6 — LOW. Two devices restoring the same backup before syncing now reach a latched `conflict`, described as "two devices compacted this pod at the same time"

**VERIFIED (reachability), and the copy is R3's to own.**

Newly reachable because of R4's mint. Each device stamps independently
(`src/services/automerge/worker/applyAndProject.ts:976-980`), so if A and B both hold
seq 1 and each restores the pre-compaction copy before syncing, both land at seq 2 with
different ids — `compareLineage` calls that `conflict`
(`src/services/sync/podLineage.ts:138-140`) and `POLICY` blocks it under `clean`/`dirty`
(`src/services/sync/podLineage.ts:177`).

It is not a dead end: the lineage banner's `user-file` action maps `conflict × user-file`
to `adopt` with no mint (`podLineage.ts:177`; the stamp condition at
`applyAndProject.ts:861` requires the `ours-newer` verdict), so B adopts A's restore and
converges. And the block is arguably the _correct_ answer — before R4 the two restores
would have converged silently on the backup's null lineage, which is the failure R4
exists to remove.

The defect is the copy: `PodLineageError.inlineMessageKey` returns
`podLineage.conflictInline` (`podLineage.ts:123-125`) and the verdict's `WHY` string is
"two devices compacted this pod at the same time" (`podLineage.ts:188`) — the wrong
cause, shown on the recovery path a family only reaches when something has already gone
wrong. One sentence of copy, or a line in the plan's Caveats.

---

## Observations (not defects)

- `stampNewGeneration`'s first conjunct is redundant.
  `applyAndProject.ts:861` reads
  `act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file'`, but
  `ours-newer × user-file` is `adopt` by the table (`podLineage.ts:176`), so the `act`
  test can never independently fail. Harmless and defensive; noted so a future reader
  does not treat it as load-bearing. (The plan's "each of the three is necessary" is
  strictly not true; the two that carry the meaning are the verdict and the context.)
- `Automerge.change` at `applyAndProject.ts:977` passes no change message, unlike
  `migrateDoc`'s `'migrate: add missing collections'` (`docOps.ts:99`). A named message
  would make a restore visible in a change dump. Cosmetic.
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts:263` stamps
  `nextLineage(null)` rather than `nextLineage(docLineage(doc))`, so a diagnostic copy of
  an already-compacted pod is labelled seq 1. Env-gated, never published, harmless —
  but `compactDoc`'s own idiom (`applyAndProject.ts:1252`) would be free.
- The offline queue (`src/services/sync/offlineQueue.ts:61-66`, `:98-101`) persists a
  whole derived envelope to `sessionStorage` and can flush it after a reload. That
  content carries the version derived when it was enqueued, which still matches its own
  payload, so it cannot produce the forbidden artefact; it is the ordinary "stale
  straggler overwrite" the plan already accounts for. No change needed.
- `src/content/help/security.ts:245` still tells the user the envelope's `version` field
  is `"4.0"`. True for every family today, false the moment one compacts. R3's
  territory; flagged because it is the only remaining prose asserting a version.

---

## Checked and found CORRECT

So that the absence of a finding above is meaningful, here is what I read and what I
concluded. All **VERIFIED** unless marked.

### 1. `beanpodVersionFor` and the writers

- `src/services/sync/fileSync.ts:57-62` — `return lineage || opts?.compactionBackup ? COMPACTED_VERSION : LEGACY_VERSION;`
  - `null` → 4.0. Any non-null object → 5.0, so `seq: 0`, a negative `seq`, and a
    malformed `{}` all resolve to 5.0 — the **safe** direction (a suspect document is
    refused by old builds rather than offered to them). `nextLineage` can never mint
    `seq ≤ 0` anyway (`docOps.ts:92-94`: `(prev?.seq ?? 0) + 1`).
  - `undefined` → 4.0, the unsafe direction, and reachable only through a runtime type
    lie. That is exactly the boundary the shared `ExportedPayload` type closes (see 2);
    the residual risk is F2's detectability, not the derivation.
  - `compactionBackup` cannot express a downgrade (it is an intent, not a version), and
    `beanpodVersionFor(lineage, { compactionBackup: true })` is still 5.0
    (`fileSync.test.ts:88-92`).
- **There is no fourth writer.** `JSON.stringify` over an envelope exists at exactly two
  places, both in `fileSync.ts` (`:97` in `createBeanpodV4`, `:273` in
  `reEncryptEnvelope`); a repo-wide grep for `JSON.stringify` in `src/services/sync`,
  `src/stores/syncStore.ts`, `src/services/google` and `src/services/native` finds no
  other envelope assembly. The four production `provider.write`/`aux.write` call sites
  are `syncService.ts:1872` (from `reEncryptEnvelope`), `syncStore.ts:2318` (from
  `createBeanpodV4`), `usePodCompaction.ts:236` (from `buildExportEnvelope`), and
  `offlineQueue.ts:101` (re-writing content already derived by `doSave`).
- **Zero version literals outside the derivation.** A grep for `'4.0'`/`'5.0'` across
  `src/**` (excluding tests/spec) returns only `fileSync.ts:25-26` (the two constants),
  the `BeanpodVersion` type and its doc comment (`syncFileV4.ts:55-63`,`:83`), a
  `connectStorage.ts:247` comment, a Help Center string (`security.ts:245`, see
  Observations), and two unrelated `placeholder="5.0"` interest-rate inputs.
- **Nothing reads a version off an envelope except the validator.** A grep for `.version`
  reads across `src/**` finds only `fileSync.ts:122-127` inside `parseBeanpodV4`. So the
  IndexedDB envelope cache saying 4.0 for a compacted document (plan Assumption 3) is
  genuinely inert.
- All four `reEncryptEnvelope` callers pass the lineage in position 3 (the parameter was
  appended, not inserted, so no shift was possible): `syncService.ts:1832`,
  `syncStore.ts:2855`, `beanpodProfile.spec.ts:269`, and the two writer-version tests
  (`fileSync.writerVersion.test.ts:31`, `:50`).
- `createBeanpodV4` **did** gain a positional parameter in the middle (4th of 8), and
  every caller is correct: `syncStore.ts:2292-2305` passes
  `(familyId, familyName, payload, lineage, wrappedKeys, {}, {}, {recoveryKeys})`;
  `fileSync.test.ts:49`, `:64-72`, `:121`, `:122` and
  `fileSync.writerVersion.test.ts:12` all pass `null`/a lineage in slot 4. The remaining
  references are bare `vi.fn()` mocks, which cannot shift anything.
- `createNewFile` derives rather than assumes (`syncStore.ts:2291-2299`), so a future
  reuse over an existing document cannot write a compacted payload labelled 4.0.
- `parseBeanpodV4` (`fileSync.ts:104-143`) has the only reader of
  `KNOWN_BEANPOD_VERSIONS`, accepts 4.0 and 5.0, throws the typed
  `UnsupportedBeanpodVersionError` for a _string_ version it does not know, and still
  throws the plain "missing version" for a non-string. `KNOWN_BEANPOD_VERSIONS` is typed
  `ReadonlySet<string>` so `.has(obj.version)` needs no cast.
- Premise re-checked against the deployed build: `git show c3a6be98:src/services/sync/fileSync.ts`
  throws `Unsupported beanpod version` for anything but exactly `'4.0'`, before every
  field check and before any decrypt.

### 2. The worker boundary

- `src/services/automerge/worker/protocol.ts:34-39` — `ExportedPayload` is one exported
  interface with `payload`, `heads`, `lineage`. It is referenced by the worker function
  (`applyAndProject.ts:1063`, declared return type) and the client wrapper
  (`docClient.ts:1318`, declared return type), both importing it from `protocol.ts`
  (`applyAndProject.ts:24`, `docClient.ts:57`). **A dropped field is a compile error on
  the worker side**, which is the side that could silently produce 4.0. Confirmed by a
  full `npx vue-tsc -b --force --noEmit`, which exits 0.
- `applyAndProject.ts:1064-1073` reads `heads` and `lineage` from the **same `doc` const**
  and before the `await`, and `encryptDocPayload(doc, key)` serialises that same const
  (`docOps.ts:420-421`, `saveDoc(doc)`). Lineage, heads and bytes therefore describe one
  value.
- **The inline fallback returns the identical shape.** `docClient` routes inline calls to
  `inlineExecutor` (`docClient.ts:617-635`), which is
  `src/services/automerge/worker/inlineBridge.ts:54-62` → `dispatch(method, args)` →
  `applyAndProject.ts:1387-1388`, `case 'exportEncryptedPayload': return { result: await exportEncryptedPayload() }`.
  One implementation, two realms — a low-memory device on the inline path gets the
  lineage, not a 4.0 write. This was the specific hazard called out in the brief; it is
  closed.
- The worker path posts `result` whole (`docWorker.ts:48-49`) and `requestCore` returns
  `res.result` unaltered (`docClient.ts:679`). I confirmed empirically with the repo's
  installed Automerge that `docLineage(doc)`'s value is a plain, own-enumerable,
  `Object.prototype`-backed object that `structuredClone`s cleanly, both alone and inside
  the full `{payload, heads, lineage}` result — so `postMessage` cannot drop or throw on
  it. (This mattered because `docOps.toPlain` exists precisely because some Automerge
  values are not clone-safe.)
- Pinned by `src/services/automerge/worker/__tests__/compactDoc.test.ts:111-127` — null
  before `compactDoc`, `{id, seq: 1}` after, asserted on the real export.

### 3. `doSave`'s `pod-version` event

- Emitted once per transition (`syncService.ts:1837-1849`), pinned by
  `savePathVersion.test.ts:186-217` (three identical saves → one event; a version change →
  a second).
- **Context keys are all allowlisted.** `family_id` (`src/utils/diagnosticContext.ts:62`),
  `action` (`:68`) and `detail` (`:185`) are all in `ALLOWED_CONTEXT_KEYS`; no new key was
  added, so the store-declaration rule is not triggered (plan Assumption 7 holds).
- **Nothing user-identifying rides in `detail`.** Its value is
  `version=<4.0|5.0>,seq=<integer|none>` — no name, email, path, or entity id. `family_id`
  is an opaque UUID already stamped on many surfaces.
- `familyId` is conditionally spread, so an envelope without one omits the key rather
  than logging `undefined`.
- Defects: F1 (family leak), F2 (the claimed alarm), F3 (emitted pre-ack).

### 4. The restore stamp

Every item the brief asked for, with lines:

- **The flag can only be set inside the guarded block.** `let stampNewGeneration = false;`
  at `applyAndProject.ts:853`; the sole assignment at `:861`, inside
  `if (currentDoc && basis.kind !== 'no-local-document')` (`:855`); the sole read at
  `:976`. The first-load adopt reaches the install branch through
  `installWholesale = !currentDoc || basis.kind === 'no-local-document'` (`:834`) without
  ever entering the guarded block, so the flag is false there — pinned by
  `rebase.test.ts` "mints NOTHING on a first-load adopt with no local document".
- **The condition.** `:861` is
  `act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file'`.
  `verdict` and `lineageCtx` are each necessary: `conflict × user-file` is also `adopt`
  (`podLineage.ts:177`) and must not mint; `ours-newer` under `clean`/`dirty` is
  `publish-local` (`:176`) and returns at `:862-874` before the install. `act === 'adopt'`
  is redundant (see Observations). The `user-file` _rebase fallback_ (`:936-942`,
  `installWholesale = act === 'adopt' || act === 'rebase'`) mints nothing for free,
  because it can only be reached under the `adopt-remote` verdict. All four cases are
  pinned in `rebase.test.ts:772-864`.
- **Compose, then one assignment.** `:975-980`: `const adopted = migrateDoc(remote);`
  then `currentDoc = stampNewGeneration ? Automerge.change(adopted, …) : adopted;`. I
  confirmed with the installed Automerge that a throw inside the `change` callback
  propagates out of `change`, so `currentDoc` is never assigned and the old document
  stays installed.
- **`priorLineage` is captured from the LOCAL document before anything is replaced**:
  declared `:854`, assigned `:857` (`priorLineage = docLineage(currentDoc)`), immediately
  before the guard call at `:860` and long before the install at `:975`. It is the right
  input to `nextLineage` (`docOps.ts:92-94`), which returns
  `{ id: fresh uuid, seq: prior + 1 }` — so the restore lands one generation _ahead_ of
  what this device held, which is what makes peers read `adopt-remote`.
- **`dirty` is true, and the caller publishes.** `:1004`,
  `dirty: !headsEqual(remoteHeads, heads)`; I verified with the installed Automerge that
  `Automerge.change` moves the heads even for a byte-identical write, and the stamp
  writes a fresh UUID, so `dirty` is guaranteed. `syncStore.ts:982` —
  `if (merged.dirty) syncService.triggerDebouncedSave();`. `reloadAllStores` cancels the
  pending publish and **re-arms it in a `finally`** (`syncStore.ts:2910`, `:3004`), so the
  restore is not silently dropped.
- **The Drive baseline still commits the UNMIGRATED remote's heads.** `remoteHeads` is
  captured at `:954` from `remote`, before `migrateDoc` and before the stamp, and is what
  the install branch returns (`:1006`). The caller commits exactly that
  (`syncStore.ts:1308`, `:1327`, then `syncService.commitRemoteBaseline(driveHeads)` at
  `:1368`).
- **Nothing else is disturbed.** `resetDocCursors()` (`:981`), `headsOf(currentDoc)`
  (`:982`), `schedulePersist()`/`scheduleSnapshotPersist()` (`:983-984`) and
  `pushProjection(doc)` (`:986-988`) all run against the stamped document, in the same
  order as before. `podLineage` is a `NON_COLLECTION_KEY`, so it is not part of the
  projection and no Pinia store mirrors it.
- **The context is right for a restore with unknown heads.** `lineageContextFor`
  (`:741-751`) returns `'user-file'` for a `user-file` basis regardless of `heads`, so the
  Settings restore still stamps when `baselineHeads` is `null`.
- **The restore then publishes cleanly.** `doSave` runs `fetchAndMergeRemote()` first; the
  fleet's compacted pod is at seq 1, ours at seq 2, so `ours-newer × clean|dirty` →
  `publish-local` → `kept-local`, and the write carries our restored document, derived at
  5.0 because it is now stamped (`fileSync.ts:61`). Pinned end-to-end by
  `savePathVersion.test.ts:134-166`.

**Restore twice, and concurrent restores** (the question the brief asked and the plan does
not answer):

- _Same device twice_: after the first restore the device holds `{Y, 2}`; restoring the
  (lineage-less) backup again compares `ours-newer` again → adopt → `{Z, 3}`. Monotonic,
  correct, and it keeps working indefinitely.
- _Two devices, sequentially_: A restores → seq 2; B adopts A's restore → `{Y,2}`; B
  restores → `{W,3}`; A adopts. Monotonic.
- _Two devices, concurrently_ (both still at seq 1): both mint seq 2 with different ids →
  `conflict` → block. See **F6**. Handled and recoverable, wrong copy.

### 5. `guardLineage`'s new return shape

- `src/services/sync/podLineage.ts:202-215` returns
  `{ action: Exclude<LineageAction,'block'>; verdict: LineageVerdict }`, throwing on
  `block` before returning.
- **Exactly one production caller**, `applyAndProject.ts:860`. A repo-wide grep for
  `guardLineage` finds it, the module itself, the eslint ignore comment in
  `docClient.ts:36`, and test files only.
- The lint rule fires (probed live — see F5 for the one form it misses). The structural
  test `lineageInDocument.test.ts:63-79` additionally asserts the guard runs after the
  decrypt and that `syncStore.ts`/`syncService.ts` contain neither `guardLineage(` nor
  `compareLineage(`.
- **No test double returns the old bare-string shape.** The only module mock is
  `src/services/automerge/worker/__tests__/lineageBasis.test.ts:26-38`, whose hoisted
  `guardHook.force` is typed as `{action, verdict} | null` (`:27-31`) and set to
  `{ action: 'rebase', verdict: 'adopt-remote' }` at `:135`. The file the plan flagged as
  the silent-pass risk is correct. (Minor deviation: the hook is a hand-written literal
  union rather than `ReturnType<typeof actual.guardLineage>`, so a new `LineageAction`
  member would not be a compile error there. Cosmetic.)
- The three suites that assert on the result all read `.action`
  (`podLineage.test.ts:100-102`, `lineageProtectsPeerEdits.test.ts:113`, `:132`) and
  `podLineage.test.ts:107-117` pins the `.verdict` half, including the
  `ours-newer × user-file` vs `conflict × user-file` distinction the stamp depends on.

### 6. Side effects in code the plan did not name

- Signature changes: covered above — `createBeanpodV4`'s mid-signature parameter and
  `reEncryptEnvelope`'s appended one both check out at every production and test call
  site. Nothing lands in `wrappedKeys`.
- `generateUUID` and its non-secure-origin warning moved to `docOps.ts:20-26`; the
  `nextLineage` helper sits at `:79-94` with the three-caller doc comment, and
  `compactDoc` uses it (`applyAndProject.ts:1252`) instead of an inline literal.
- `beanpodProfile.spec.ts:258-269` stamps through `nextLineage` and passes the lineage to
  `reEncryptEnvelope`, so the diagnostic can no longer emit a compacted 4.0.
- `usePodCompaction.ts:336-342`'s "NO ENVELOPE STAMP" note is updated and now true for the
  stronger reason; the compaction publishes via `syncStore.syncNow(false)`
  (`usePodCompaction.ts:344`) → `doSave` → derived 5.0. The pre-compaction pair is built
  once with `{ compactionBackup: true }` (`usePodCompaction.ts:188`) and used for both the
  manual export (`:208`) and the Drive safety copy (`:236`), so both are 5.0.
- `usePodExport.ts:84` passes no options and stays purely derived.
- `envelopeMerge.preserveLocalKeyDicts` still spreads `...incoming` including `version`,
  pinned deliberately at `src/services/sync/__tests__/envelopeMerge.test.ts:198-206` with
  a "do not fix this" comment. Correct: the derivation, not the spread, is the protection.

### Gate

- `npx vue-tsc -b --force --noEmit` → exit 0. (Note for anyone re-running: the first
  non-forced `npm run type-check` in this tree replayed a **stale cached diagnostic** from
  `.tsbuildinfo` — `usePodCompaction.test.ts(47,8) TS1360`, a property the file plainly
  has at `:44`. A second run and the forced run are both clean. Not a defect; worth
  knowing so it is not chased.)
- `npx vitest run src/services/sync src/services/automerge` → 52 passed, 1 skipped
  (the env-gated beanpod profile), 679 tests.
- `npx vitest run src/stores src/composables` → 161 files, 1957 passed.

---

## Suggested fix list (this reviewer's half)

1. **F1** — clear or family-key `lastVersionDetail` (`syncService.ts:341`, `:901-930`,
   `:1837`). One line; it restores the acceptance criterion.
2. **F3** — move the `pod-version` emit (or just the `lastVersionDetail` assignment) below
   the write ack (`syncService.ts:1836-1849` vs `:1872`).
3. **F2** — correct the alarm's description in `syncService.ts:334-340`, in
   `savePathVersion.test.ts:222-227`'s title, and in the plan's R1.8, to the detector that
   actually exists (a 5.0→4.0 regression per `family_id`).
4. **F4** — add the version consequence of a retired-Tier-2 pod to the plan's Caveats,
   beside the deploy sequence.
5. **F5** — widen `lineageInDocument.test.ts`'s grep to all of `src/**` bar the two
   allowed files, or add a `no-restricted-syntax` entry for the dynamic import.
6. **F6** — one sentence of copy (R3) or a Caveat noting that a double restore is now a
   `conflict`, and that the conflict message names compaction rather than restore.
