# Plan: One writer per pinned actor — the device-actor lease

> Date: 2026-09-05
> Related issues: #90 (Tier 2, Phase A follow-up). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-09-05-device-actor-lease.md`
> Amends: `docs/plans/2026-09-05-pod-load-oom-tier2.md` (Phase A)

## Context

Phase A pins the Automerge actor to `SHA-256(deviceId, familyId)`. `deviceId`
lives in `localStorage`, which every tab of one browser profile shares, and the
doc worker is a per-tab `new Worker` with no tab lock. So two tabs on one family
(or on Android, the installed PWA plus a Chrome tab) now write under ONE actor in
TWO realms. Measured against Automerge 3.4.1:

```
error applying changes: duplicate seq 2 found for actor abcdef01…
```

Automerge refuses the merge. The throw is a plain `Error`, not a
`PayloadLoadError`, so `doSave`'s catch takes its "non-fatal, save local anyway"
branch and writes this tab's full base over the remote, destroying the other
tab's edits; the other tab then does the same back. Before Phase A every
`load()` minted a random actor per tab, so the collision was impossible and
`mergeDocs` could not throw on well-formed input. Nothing from the series is
deployed (prod is `c3a6be98`, which predates it).

## Requirements

1. At most ONE realm per browser profile may write under the device actor for a
   given family at any time. Any other realm gets `null` (Automerge mints a
   random actor, today's behaviour).
2. A browser without Web Locks cannot guarantee exclusivity, so it gets `null`.
3. `setFamilyKey` is called from six sites per session; re-asking for the same
   family must be idempotent (a re-request while we hold it ourselves would
   return "unavailable" and silently drop to a random actor).
4. A family switch releases the old lease before taking the new; `reset()`
   releases it.
5. Defence in depth: a merge that fails AFTER the remote bytes were read must
   refuse the save exactly as `PayloadLoadError` does, latch the breaker, show
   the sync-bar message, and report once. The "save local anyway" branch is for
   transport failures only.
6. Every decision is logged (`device-actor`: leased / contended / unavailable).

## Approach

**`src/services/automerge/actorLease.ts`** (new, main thread). `acquireActorLease(familyId): Promise<boolean>`
holds `navigator.locks.request('beanies-doc-actor:' + familyId, { ifAvailable: true }, …)`
for the realm's lifetime by returning a promise that resolves only on
`releaseActorLease()`. Memoised per family (idempotent); a different family
releases first. No `navigator.locks` → `false`. Never throws.

**`docClient.setFamilyKey`**: `docActor = (await acquireActorLease(familyId)) ? await deviceActorId(familyId) : null`.
`reset()` and `__resetDocClientForTesting()` release.

**`RemoteMergeError`** (`src/types/sync.ts`) implements `RemoteBlocker`
(`blockCode: 'merge'`, `inlineMessageKey: 'podMerge.failedInline'`, literal
`name`). `fetchAndMergeRemote`'s merge catch wraps any non-`PayloadLoadError`
into it and calls `noteMergeFailed` (latch + report once, `critical`: the family's
sync is blocked and the cause is unexpected). `doSave` refuses on it. `notePodUnopenable`
dispatches it.

**Copy**: `podMerge.failedInline` (en + beanie), tone matching `podLineage.*`.

## Files affected

- new `src/services/automerge/actorLease.ts`, `__tests__/actorLease.test.ts`
- `src/services/automerge/worker/docClient.ts`
- `src/services/automerge/worker/__tests__/docActor.test.ts` (pin the duplicate-seq behaviour)
- `src/types/sync.ts`, `src/services/translation/uiStrings.ts`
- `src/services/sync/syncService.ts`, `src/services/sync/__tests__/fetchAndMergeRemote.test.ts`
- `src/stores/syncStore.ts` (one dispatch line)
- `docs/lessons.md`, `CHANGELOG.md`, `docs/STATUS.md`, the Tier 2 plan's Outcome, prompt archive

## Observability Coverage

- `logEvent` `device-actor` debug: `action: 'leased' | 'contended' | 'unavailable'`, `family_id`. Rate of `contended` = how often a second tab is open; `unavailable` = browsers without Web Locks. Success path emits too.
- `reportError` `pod-merge`, `severity: 'critical'`, `action: 'blocked'`, `error_code: 'merge'`, once per latch, carrying the underlying error. A non-zero rate after this ships means another shared-actor path exists.
- No new context keys (`action`, `family_id`, `error_code` are already allowlisted).

## Acceptance Criteria

- [ ] Two realms, same family, same profile: the second gets `null`; the first keeps the device actor.
- [ ] No `navigator.locks` → `null`, logged.
- [ ] Repeated `setFamilyKey` for the same family keeps the actor; a family switch swaps leases.
- [ ] A merge throw after the remote was read → `save()` returns false, `provider.write` never called, breaker latched with `blockCode 'merge'`; a transport failure still saves (pinned).
- [ ] Automerge's duplicate-seq refusal is pinned by a test, so the reason for the lease is executable.
- [ ] Full suite green; lint + security-lint clean.

## Review Passes

Design reviewed in conversation (Opus 5 implementation, Fable 5.1 premise audit); a `/code-review max` of the whole series plus this fix runs after implementation.
