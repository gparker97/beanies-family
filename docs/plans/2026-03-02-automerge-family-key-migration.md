# Plan: Automerge CRDT + Family Key Encryption Migration

> Date: 2026-03-02
> Epic: Data layer migration from IndexedDB + file-based sync to Automerge CRDT + family key encryption

## Context

The current sync architecture uses a single `.beanpod` JSON file as the source of truth, with IndexedDB as an ephemeral cache. This approach is fundamentally fragile for multi-device sync because:

- **No atomic read-modify-write** — two devices can overwrite each other
- **Polling-based** — 10-second blind window for change detection
- **Whole-file operations** — every change reads/writes the entire dataset
- **Password-based encryption** — inherently insecure for shared family access
- **Hand-rolled merge** — fragile custom code (mergeService, tombstoneStore, settingsWAL)
- **Google Drive OAuth friction** — GIS implicit grant gives ~1-hour tokens with no refresh, requiring constant re-authentication

**Solution:** Replace with Automerge CRDT for automatic conflict-free merging, a random family key (AES-256-GCM) for encryption, and OAuth PKCE for long-lived Google Drive sessions. No backward compatibility needed — no production users exist.

**Rollback:** All work on feature branches. `main` stays at the last working commit (`3f22717`). If everything breaks, `git checkout main`.

---

## Architecture Overview

```
UI (Vue Components) — unchanged
        |
Pinia Stores (reactive query layer) — same API, different backend
        |
Automerge Repository Factory — replaces createRepository.ts
        |
Automerge Document (in-memory) — replaces IndexedDB entity stores
        |
    +---+---+
    |       |
Encrypted   Encrypted
IndexedDB   Cloud Storage
(local       (Google Drive via
 cache)      OAuth PKCE / local file)
```

**Key decisions:**

- Core `@automerge/automerge` library (not automerge-repo)
- One Automerge document per family
- Module-level singleton for doc management (mirrors current `database.ts` pattern)
- `docVersion` shallowRef bridges Automerge → Vue reactivity
- Repos wrapped in `Promise.resolve()` to preserve async store API signatures
- `changeDoc()` triggers debounced save (replaces multi-store Vue watcher)
- Full `Automerge.save()` for persistence (not incremental — simplicity first)
- Settings split: synced settings in Automerge doc, device-local in registry IndexedDB
- Google Drive OAuth PKCE with refresh tokens (replaces GIS implicit grant)
- Invite links (magic link pattern) with 32-byte token for family key sharing

---

## Issue Dependency Graph

```
Issue 1 (Automerge Foundation) ──┐
Issue 2 (Family Key Encryption) ─┤── Issue 4 (Core Migration) ── Issue 5 (Auth & Onboarding) ── Issue 6 (UI Updates) ── Issue 7 (Cleanup & Docs)
Issue 3 (OAuth PKCE) ────────────┘
                                                                                                                          Issue 8 (Key Rotation) [follow-up]
                                                                                                                          Issue 9 (Push Relay) [future]
```

Issues 1, 2, and 3 can be implemented in parallel. Issue 4 depends on all three.

---

## Issues

### Issue 1: Automerge Foundation — Document Service & Repository Factory

Install Automerge, configure Vite for WASM, create document service and repository factory.

### Issue 2: Family Key Encryption Service

Family key management, wrapping per member, invite link generation, QR code support.

### Issue 3: Google Drive OAuth PKCE Migration

Replace GIS implicit grant with Authorization Code + PKCE flow for long-lived sessions.

### Issue 4: Core Migration — Data Layer & Sync Switchover

Atomic switchover: replace IndexedDB repos with Automerge, rewrite sync layer, remove old code.

### Issue 5: Auth & Onboarding for Family Key Model

Update auth flows, family creation, member joining, passkey management for family key model.

### Issue 6: UI Updates & Family Key Management

Update UI components for new encryption model, add invite/join UI.

### Issue 7: Cleanup, Documentation & Final Verification

Dead code removal, documentation updates, final test pass.

### Issue 8: Family Key Rotation (Follow-Up)

Key rotation on member removal or device compromise.

### Issue 9: Push Relay for Real-Time Sync (Future)

WebSocket relay for sub-second cross-device sync.

---

## File Impact Summary

### Files DELETED (~930 lines)

| File                                                             | Replaced by                        |
| ---------------------------------------------------------------- | ---------------------------------- |
| `src/services/sync/mergeService.ts`                              | Automerge.merge()                  |
| `src/services/sync/settingsWAL.ts`                               | Automerge doc persistence          |
| `src/stores/tombstoneStore.ts`                                   | Automerge native deletion tracking |
| `src/services/indexeddb/createRepository.ts`                     | automergeRepository.ts             |
| `src/services/indexeddb/repositories/accountRepository.ts`       | Automerge repo                     |
| `src/services/indexeddb/repositories/transactionRepository.ts`   | Automerge repo                     |
| `src/services/indexeddb/repositories/assetRepository.ts`         | Automerge repo                     |
| `src/services/indexeddb/repositories/goalRepository.ts`          | Automerge repo                     |
| `src/services/indexeddb/repositories/budgetRepository.ts`        | Automerge repo                     |
| `src/services/indexeddb/repositories/recurringItemRepository.ts` | Automerge repo                     |
| `src/services/indexeddb/repositories/todoRepository.ts`          | Automerge repo                     |
| `src/services/indexeddb/repositories/activityRepository.ts`      | Automerge repo                     |
| `src/services/indexeddb/repositories/familyMemberRepository.ts`  | Automerge repo                     |
| `src/services/indexeddb/repositories/settingsRepository.ts`      | Automerge repo                     |
| `src/services/indexeddb/repositories/index.ts`                   | Not needed                         |

### Files CREATED

| File                                            | Purpose                              |
| ----------------------------------------------- | ------------------------------------ |
| `src/types/automerge.ts`                        | FamilyDocument type definition       |
| `src/types/syncFileV4.ts`                       | BeanpodFileV4 envelope types         |
| `src/services/automerge/docService.ts`          | Document lifecycle management        |
| `src/services/automerge/automergeRepository.ts` | Generic CRDT repository factory      |
| `src/services/automerge/persistenceService.ts`  | Encrypted IndexedDB persistence      |
| `src/services/automerge/repositories/*.ts`      | 10 entity-specific repos             |
| `src/services/crypto/familyKeyService.ts`       | Key generation, wrapping, encryption |
| `src/services/crypto/inviteService.ts`          | Invite link create/redeem            |
| `src/utils/qrCode.ts`                           | QR code generation                   |
| `src/components/settings/InviteMemberModal.vue` | Invite member UI                     |
| `src/components/login/JoinFamilyView.vue`       | Join family UI                       |

### Files MODIFIED (major)

| File                                          | Change                                                    |
| --------------------------------------------- | --------------------------------------------------------- |
| `vite.config.ts`                              | WASM plugins                                              |
| `src/services/sync/syncService.ts`            | Rewrite for Automerge + family key                        |
| `src/services/sync/fileSync.ts`               | New v4.0 format                                           |
| `src/stores/syncStore.ts`                     | Remove password state, add family key, simplify auto-save |
| `src/stores/authStore.ts`                     | Family key gen, invite flow, passkey auth                 |
| `src/services/auth/passkeyService.ts`         | Wrap family key instead of password                       |
| `src/services/crypto/encryption.ts`           | Adapt for family key                                      |
| `src/services/google/googleAuth.ts`           | OAuth PKCE rewrite                                        |
| `src/services/indexeddb/database.ts`          | Remove family-scoped DB                                   |
| `src/stores/settingsStore.ts`                 | Synced settings via Automerge                             |
| All 9 entity stores                           | Import from Automerge repo, remove tombstone calls        |
| `src/pages/SettingsPage.vue`                  | Remove encryption UI, add family key UI                   |
| `src/pages/LoginPage.vue`                     | Family key decryption flow                                |
| Login components (4 files)                    | Updated for family key model                              |
| `src/components/settings/PasskeySettings.vue` | Family key wrapping                                       |
| `src/types/models.ts`                         | Update types                                              |
| `src/services/translation/uiStrings.ts`       | Update strings                                            |

### Naming Convention Migration (`gp-` → `beanies-`)

| Old                                  | New                       | File                    |
| ------------------------------------ | ------------------------- | ----------------------- |
| `gp-family-finance` (legacy)         | Removed entirely          | `database.ts`           |
| `gp-family-finance-{familyId}`       | `beanies-data-{familyId}` | `database.ts`           |
| `gp-finance-registry`                | `beanies-registry`        | `registryDatabase.ts`   |
| `gp-finance-file-handles`            | `beanies-file-handles`    | `fileHandleStore.ts`    |
| (new) `beanies-automerge-{familyId}` | —                         | `persistenceService.ts` |

---

## Verification Plan

1. **After Issue 1:** `npm run build` succeeds, Automerge WASM loads, `docService.test.ts` + `automergeRepository.test.ts` pass
2. **After Issue 2:** `familyKeyService.test.ts` + `inviteService.test.ts` pass — key gen/wrap/unwrap/encrypt/decrypt round-trips work
3. **After Issue 3:** `googleAuth.test.ts` rewritten and passing — PKCE code generation, token exchange, silent refresh. Manual test: Google Drive connects without GIS popup
4. **After Issue 4:** `npm run test:run` passes — all store tests updated for Automerge repos, `persistenceService.test.ts` + `fileSync.test.ts` pass, no dead imports. Manual test: CRUD through Automerge, save/load encrypted files, merge across browsers
5. **After Issue 5:** `authStore.test.ts` + `passkeyService.test.ts` + `passwordCache.test.ts` + `dataClearingSecurity.test.ts` pass. E2E: `01-setup-flow` (no encryption pw), `06-magic-link-join` (invite links), `07-trusted-device` (family key cached)
6. **After Issue 6:** `InviteMemberModal.test.ts` + `JoinFamilyView.test.ts` pass. E2E: all setup/login/invite/join specs pass. Manual: create pod → login → invite member → join → verify data. No old encryption UI visible.
7. **After Issue 7:** `npm run validate` clean, `npm run test:e2e` passes all specs on all browsers, docs accurate, no dead code
