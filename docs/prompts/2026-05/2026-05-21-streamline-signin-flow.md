---
date: 2026-05-21
category: enhancement
issue: null
plan: docs/plans/2026-05-21-streamline-signin-flow.md
tags: [sign-in, login, google-drive, reconnect, oauth, loadpodview, viewstate, refactor, ux]
---

# Streamline returning-member sign-in (kill the duplicate provider + file selection)

## Prompts

**[discussion]** Issue with the sign-in process: any user signing in to a host with an existing file (or >1 file) has to select the family data file twice. Flow: sign out / open without a valid token → "sign in" → "which beanies" (file select if >1; skipped if 1) → immediately redirected to "load your pod" with Google Drive + local options — (1) why ask provider when we know it's Drive (registry + cache indicate it)? (2) why have credentials expired when we just signed out a minute ago? → after Drive consent, presented with beanpod files to select again (already chose in step 1) → then member-select / password decrypt (OK from here). Review/analyze the flow and propose a plan to reduce duplication, improve token re-use, reduce friction.

**[decision]** Keep sign-out fully clearing/revoking the token (privacy + wrong-account safety); rely on a token-aware, config-driven fallback to remove the duplicate selection. (Chose this over a "Lock vs Sign out" split or preserving tokens.)

**[/beanies-plan + scope decision]** Wrote the plan through the 4-pass discipline (twice — choosing to do the `LoadPodView` `viewState` refactor now was a substantial scope expansion that re-triggered Passes 2–4).

**[implementation follow-up — UX]** After reconnect + Google consent, the "Reconnect" button stayed visible for a few seconds (no spinner, not disabled) before the member-select screen loaded — looked like the next action was to tap again (which would trigger another consent). Ensure the path is 100% clear: spinners shown while loading/decrypting, and buttons disabled once they shouldn't be pressed.

## Outcome

Implemented on `main`. Plan (with full 4-pass record): `docs/plans/2026-05-21-streamline-signin-flow.md`.

**Root cause:** `LoginPage.handleFamilySelected` already re-inits the picked family's provider and attempts a silent auto-load — the duplicate selection was the _fallback_ when that load fails. After sign-out it fails because `authStore.signOut` deletes/revokes the refresh token (intentional, for wrong-account safety), so `loadFromFile()` returns failure and the old code dropped into the generic provider+file picker.

**Fix (token-aware, config-driven fallback):**

- `syncStore.loadFromFile()` now returns a typed `reason` ('auth' | 'not-found' | 'error'), classified via the existing `isAuthTransientSyncError` matcher (single `/silent refresh failed/i` source of truth; `TokenExpiredError` got a coupling comment). `loadFromGoogleDrive()` classifies a vanished file structurally (`e instanceof DriveApiError && e.status === 404` → `reason: 'not-found'`, mirroring the existing idiom).
- `LoginPage.handleFamilySelected`: on `reason === 'auth'` + a Drive `providerConfig` with a `driveFileId`, set `reconnectDriveFile` and route to a focused reconnect (no generic cards/picker); otherwise the generic fallback. New shared `resetLoadPodState()` / `enterGenericLoadFallback()` de-dup the ~9 reset sites and guarantee `reconnectDriveFile` can't leak.
- `LoadPodView`: **(a)** refactored the 6 overlapping mode booleans into a single `viewState` discriminated union (`decrypt > reconnect > auto-loading > permission-grant > empty > cards`) — resolving the in-code `TODO(state-machine-refactor)`; `decrypt` keys off `showDecryptModal` alone (preserves the biometric handoff), `lastDriveCheckEmpty`/`selectedSource` stay card-local. **(b)** new `reconnectDriveFile` prop → focused reconnect panel; handler composes `useGoogleReconnect()` (popup/desktop, redirect/iOS) → loads the known fileId directly via `handleDriveFileSelected` (now returns its result) → decrypt; 404 → graceful picker fallback.
- New string `loginV6.reconnectToLoad` (en + beanie; zh regenerated).

**UX follow-up fix:** the reconnect button could sit static/re-tappable during the post-consent load because `viewState` precedence keeps `reconnect` above `auto-loading`. Fixed with an `isReconnectBusy` flag covering the whole consent→load sequence (button spins + disabled the entire time it's visible) **and** by setting `reconnectDismissed = true` the instant consent succeeds, so the view transitions reconnect-panel → loading-spinner → decrypt with no flash and no ambiguous button. Verified the decrypt submit button already binds `:loading="isLoadingFile"` (handleDecrypt sets it), and `BaseButton :loading` spins + disables + no-ops clicks.

**Net UX:** sign-out → sign-in is now pick family → one consent → decrypt; refresh-token-present is pick family → decrypt (silent).

**Verification:** new `loadFromFileReason.test.ts` (4 cases — both `TokenExpiredError` variants → 'auth', 404 → 'not-found', else → 'error'); `npm run type-check` + eslint clean; full suite **2542 passed**. Test-coverage note: the `loadFromGoogleDrive` 404 classification mirrors the already-tested idiom and would require mocking the whole `googleAuth` module surface; `LoginPage`/`LoadPodView` have no unit-mount harness in this repo (consistent with the other onboarding views). Per the plan, those are **manually verified** — greg is actively running the build (which is how the reconnect-button gap was caught). Recommended manual matrix: desktop sign-out→sign-in (one consent), refresh-token-present (no consent), iOS redirect return, multi-family, renamed/trashed Drive file (404 → picker), local permission-grant intact, and the `viewState` regression matrix (each pre-existing screen still appears).
