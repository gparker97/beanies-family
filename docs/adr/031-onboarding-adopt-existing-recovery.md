# ADR-031: Onboarding adopt-existing recovery & trusted-device sign-out grant

> **2026-08-28 (ADR-034):** the trusted-device sign-out grant semantics referenced here are superseded by the three-tier logout (switch person / sign out / sign out & clear) — see ADR-034; the adopt-existing recovery flow itself stands, now PIN-based on the finish surface.

> Status: Accepted
> Date: 2026-06-19
> Related: ADR-026 (iOS redirect OAuth), ADR-028 (refresh-token persistence consent), ADR-029 (Capacitor native distribution)
> Plan: `docs/plans/2026-06-19-onboarding-hardening.md`

## Context

A real iPhone (iOS 18.7 Safari) onboarding session failed after 4+ attempts and never succeeded. A max-effort code review traced it to a cluster of iOS-specific dead-ends. Two warranted recorded decisions.

### 1. Onboarding had no idempotent recovery for its own prior-attempt state

On iOS, onboarding uses full-page redirect auth. `GoogleDriveProvider.createNew` physically creates the `.beanpod` on Drive (as an empty `{}` placeholder) _before_ the flow registers a `fileId`. If anything downstream throws (e.g. an opaque WebKit "Script error."), the attempt aborts but the file persists. Every retry then hits `createNew`'s pre-create collision check, throws `FileNameCollisionError`, and the UI offered only "pick a different name" or re-ran the same colliding call — a permanent loop. There was no path to recognize "this is the user's _own_ file from 30 seconds ago" and adopt it.

### 2. Trusted-device sign-out leaves the Google grant live (flagged as a possible regression)

`clearGoogleSessionState({ preserveRefreshToken })` skips the network token-revoke on trusted devices. The review flagged this as a security regression (sign-out doesn't revoke the grant at Google).

## Decision

### Adopt-existing recovery

When onboarding hits a same-name `.beanpod` collision, classify and resolve it (single helper `resolveExistingBeanpod`, orchestrated by `resolveDriveCollision`):

- **Owned + empty stub** (the `{}` placeholder from an aborted attempt) → **adopt silently**: install a provider on the existing `fileId` and continue creating (the real pod overwrites the empty placeholder). No duplicate, no dead-end.
- **Owned + populated** (a real envelope) → **confirm**, then **load** it (never create over it).
- **Owned-by-a-different-account** → **never adopt**; keep the "pick a different name" guidance.

Ownership is read from the Drive `ownedByMe` file metadata. Stub-vs-populated is decided **structurally** (`'{}'` / non-V4 vs. a V4 envelope) **without decryption**, sidestepping the "orphan encrypted with a different key" risk. Any read/inspect failure falls **safe to confirm** and is never re-thrown (a throw escaping the resolver would re-trap the user in the loop).

A transient Drive _list_ failure during the collision pre-check now throws a typed `CollisionCheckUnavailableError` (retryable) instead of being swallowed and blind-creating a second orphan.

### Trusted-device sign-out grant: keep current behavior (no change)

Preserving the grant on a trusted device is **intentional** — it is the whole point of trusted-device convenience (commit `1e8090f7`) and mirrors the preserved IndexedDB cache. The user-facing "revoke everything" escape hatch already exists: **`authStore.signOutAndClearData()`** calls `clearGoogleSessionState` _without_ `preserveRefreshToken` (full network revoke) and additionally deletes the local cache and resets the trust flag. Shared/untrusted devices already get the full teardown on a normal sign-out. This is documented in code at the revoke site; no behavior change.

## Consequences

- The iOS create/resume flows recover from their own orphaned files instead of looping; the recovery screen reaches parity with the create wizard on collisions.
- `connectStorage` stays free of crypto/UI concerns: the one decrypt-to-classify site is `resolveExistingBeanpod`; the confirm()+load orchestration lives in the `useDriveCollisionRecovery` composable.
- The trusted-device grant decision is now explicit and discoverable, so a future reviewer doesn't re-flag it as an accidental regression.
