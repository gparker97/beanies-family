---
date: 2026-09-15
category: security
issue: Notion tracker #82
plan: docs/plans/2026-09-15-ios-keychain-orphan-reconcile.md
tags: [auth, security, ios, android, keystore, keychain, telemetry, observability]
---

# iOS keychain orphans — key material that outlived every deletion path

## Prompts

**2026-09-15 (after the Notion tracker cleanup and the pricing research)**

> ok - let's move on to some of the high priority bugs / /beanie-pre-plan #82 - once competle move
> directly onto /beanies-plan and once complete move to /beanies-build-auto - work autonomously. if
> you have questuons let me know now or ping me when you need my help.

Pre-plan resolved the row's two flagged unknowns from source rather than assumption:

- iCloud sync is a NON-ISSUE. The item is `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, so it
  never syncs and cannot be restored onto other hardware. This also corrected the row's own claim
  that orphans sit in the user's encrypted device backups in a restorable form.
- The keychain is ITSELF an enumerable registry. One fixed service, and the account encodes both
  ids, so a query by service alone recovers every pair. "Beyond any code path" was true of the
  plugin's API surface, not of the platform. No separate durable registry was needed.

**2026-09-15**

> can you pls just give me a very simple, layman's summary of exactly what this issue is and why we
> need to fix it, and it what situations it applies?

Answered with the hotel-key analogy: the app hands the key to Apple's keychain and keeps its own
list of which keys it left there; deleting the app wipes the list but not the keys. Honest severity:
biometry-gated, one device, not a break-in. It applies only to the iPhone/iPad app, and only after
someone deletes and reinstalls it. The reason to fix it is that a key you cannot delete is a promise
the app cannot keep.

## Outcome

Four independently-green commits on `main`, none pushed by this skill:

- **A** `4cab4373` — the plugins stop reporting deletes they did not do, on both platforms.
- **B** `b548ebad` — clear-all-data sweeps the whole keystore service, with a `deleteKey`-only
  fallback for the #74 unregistered-method class.
- **C** `bafe831e` — enumeration, the account parser, adopt-on-resolve, union reclaim.
- **D** `23549099` — the roster reconcile and the `memberName` backfill.

Four plan review passes ran. Pass 4 caught two severe defects the earlier passes carried: the roster
reconcile would have deleted other families' live enrolments, and a missing `deleteAllKeys` would
have made clear-all-data a silent total no-op while reporting success.

Two defects were found in the plan during implementation and fixed in the code:

1. The plan's reclaim snippet added the legacy target unconditionally after the record loop. For a
   legacy-SCHEME record, whose account IS the bare familyId, that overwrites the record-derived
   entry in an account-keyed Map, drops its credentialId, and leaves a registry record pointing at
   a deleted blob. Now added only when absent, pinned by a test.
2. The plan's `reconcileDeviceKeysWithRoster` signature carried member ids only, but its own
   `memberName` backfill is not constructible from ids. The signature carries `{ id, name }`.
   Consequence worth recording: member names now cross from the store into the auth service layer.
   Contained — the name is only ever written to `PasskeyRegistration.memberName`, the same privacy
   class, and never reaches telemetry.

**Owed to greg, and only doable on hardware:** reproduce the orphan on a physical iPhone or iPad
before/after, and confirm the enumeration returns access-controlled items without a Face ID prompt.
Nothing in CI and no simulator reset reproduces either.
