# ADR-028: Redirect auth always forces consent, and refresh tokens self-heal from `__pending__`

> **2026-08-28 (ADR-034 / login rethink Phase 5):** NO sign-out tier revokes the Google grant any more (the sole revoke site is the explicit Settings "Disconnect Google Everywhere" action); trusted-device sign-out keeps local tokens, untrusted clears them locally. The `prompt=consent` invariant here is unchanged — with grants surviving sign-out, the consent screen is now rarely reached.

> Date: 2026-05-20
> Status: Accepted
> Plan: `docs/plans/2026-05-20-google-refresh-token-persistence-fix.md`
> Follows: [ADR-026](026-ios-redirect-oauth.md) (iOS / standalone-PWA redirect auth)

## Context

Installed PWAs (Android + iOS) and iOS WebKit use full-page **redirect** OAuth (ADR-026). Users on those platforms saw the "Google Drive disconnected" toast on **every** force-close/restart, while desktop was fine. The new diagnostic firehose (ADR-027) pinpointed it: every `offline-queue-flush` failure carried `silent_refresh_had_refresh_token: false` — silent refresh never even attempted, because there was **no refresh token under the family-scoped key**. Two compounding bugs:

1. **Wrong-key persistence.** All token writes use `currentFamilyId ?? PENDING_FAMILY_KEY`. On a redirect reconnect, `completeRedirectAuth()` runs at `App.vue` Step 2b **before the family is bound** (and `getActiveFamilyId()` is also unset that early and not persisted), so the token is written under `__pending__`. `initializeAuth` read only the family key and never rescued `__pending__`; `migratePendingRefreshToken` ran only on the pod-load path, never on a plain reconnect/cold-boot. The token was orphaned.

2. **No refresh token re-issued on reconnect.** Every reconnect path used `prompt=select_account`, but Google only returns a `refresh_token` with `prompt=consent` + `access_type=offline`. So reconnect obtained an access token but **no refresh token**, and the code silently accepted it. Desktop "worked" only because its original consent-issued token was still valid under the family key (popup binds the family before storing).

## Decision

Two invariants, enforced in code (single source of truth each):

1. **`startRedirectAuth` always uses `prompt=consent`** (`googleAuth.ts`). Every redirect-auth caller — reconnect, connect-pod, switch-account, re-pick a `.beanpod` — establishes offline Drive access and needs a refresh token. Forcing consent in the one redirect entry point means no per-call-site flag to forget. The popup path forces consent at the connect/reconnect call sites (`useGoogleReconnect` popup branch, `connectDriveStorage`'s `createNew`), since popup `requestAccessToken` is also used for incidental access-token top-ups where consent would be annoying.

2. **`migratePendingRefreshToken` migrates `__pending__` → family key only when the family key is empty** (never clobber a good token), and **`initializeAuth` calls it on every bind**. Because `initializeAuth` runs on every cold boot (`syncStore.initialize()`), a token the redirect flow stored under `__pending__` self-heals onto the family key on the next boot — including already-orphaned devices. The previously-explicit `migratePendingRefreshToken` calls in `syncStore`'s pod-load path were removed (redundant — single source of truth).

Plus: any interactive auth that completes without a `refresh_token` now reports `auth-no-refresh-token` (no silent loss), and `initializeAuth` emits `auth-init` firehose events (`rescued …` / `no refresh token …`) for per-platform confirmation.

## Consequences

- Refresh tokens persist under the family key and survive force-close/restart on **all** platforms (desktop popup, iOS/Android/desktop-PWA redirect). The fix is platform-agnostic — no new platform branches; `shouldUseRedirectAuth()` routing is unchanged.
- Reconnect now shows Google's consent screen each time — the correct, documented way to guarantee a refresh token; reconnect is interactive and rare, so the friction is acceptable.
- Already-orphaned devices self-heal on the next app open (after one consent-forcing reconnect to obtain a fresh token).
- Downstream recovery is automatic: once the token loads, `notifyTokenAcquired` → offline-queue flush + `handleGoogleReconnected` clears the banner — no manual step.
- **Do not** reintroduce a `select_account`/conditional prompt in `startRedirectAuth`, or migrate `__pending__` over a populated family key — both invariants are load-bearing and documented in-code.
