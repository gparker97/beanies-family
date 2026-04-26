# Plan: Google account stickiness — cleanup on sign-out + defense-in-depth

> Date: 2026-04-26 (rev 2 — fresh-eyes pass)
> Severity: customer-impacting bug — confirmed by greg; reproduced by another family yesterday

## Context

When a user has two Google accounts on the same device (e.g. `gpsp2001@gmail.com` and `greg@grobrix.com`), signing out and signing back in with a different account silently routes the app to the _previous_ account's Drive. Symptoms:

1. Sign-in appears to succeed.
2. Red "we can't find your beanpod" banner shows.
3. Tapping "Pick from Drive" opens the Picker against the **wrong** Google account's Drive.
4. Even Settings → Family Data → Reconnect, with the right account chosen at Google's consent screen, still lands in the wrong Drive.

### Verified root cause

`signOut()` in `authStore.ts:496-520` and `signOutAndClearData()` in `authStore.ts:567-593` clear Pinia state and the per-family IndexedDB cache, but do **not** clean up Google-specific state:

- **In-memory token state in `googleAuth.ts:32-44`** — `accessToken`, `refreshToken`, `expiresAt`, `currentFamilyId`, `cachedEmail`, `refreshTimer`. None are cleared.
- **Refresh token in IndexedDB + localStorage** — `fileHandleStore.ts:186-202` writes to a separate "handle DB" (not deleted by `deleteFamilyDatabase`), with a localStorage backup at `beanies_grt_{familyId}`.
- **Folder cache in `driveService.ts:11-22`** — module-level `cachedFolderId` plus localStorage at `beanies_drive_folder_id`.

On the next sign-in, `requestAccessToken()` (`googleAuth.ts:201-208`) checks the in-memory `refreshToken` and, if present, attempts a silent refresh **before** opening the consent popup:

```ts
if (refreshToken) {
  const silentToken = await attemptSilentRefresh();
  if (silentToken) {
    if (!popup.closed) popup.close();
    return silentToken; // returns the WRONG account's token
  }
}
```

The user thinks they're signing in as account A, but the silent refresh returns an access token for account B. The Picker then queries B's Drive, the app looks for the family's `.beanpod` fileId in B's Drive, gets a 404, and shows the red banner.

### Existing infrastructure to leverage (DRY)

A pass over the codebase reveals shared infrastructure we should compose with, not duplicate:

- **`googleDriveProvider.disconnect()` already does `revokeToken()` + `clearFolderCache()`** (`googleDriveProvider.ts:214-217`). The exact Google-cleanup we need exists; sign-out just doesn't go through it.
- **`syncStore.providerAccountEmail`** is a reactive ref already exposed and consumed in 8+ places (`AppSidebar`, `SyncStatusIndicator`, `LoadPodView`, `BiometricLoginView`, etc.) — the canonical "current Google account email". Use this as the source of truth for banner messaging and account assertion.
- **`onTokenExpired(callback)` subscriber pattern** in `googleAuth.ts:422-428` — proven pattern in this codebase. Mirror it for `onTokenAcquired` to keep `googleAuth.ts` decoupled from stores (no cross-layer dependencies).
- **Existing tests:** `googleAuth.test.ts`, `driveService.test.ts`, `googleDriveProvider.test.ts` all exist. Extend them rather than creating new files.

### Token-acquisition call sites (all benefit from Phase 3 assertion via subscriber pattern)

- `composables/useGoogleReconnect.ts` — Reconnect button
- `composables/usePickBeanpodFile.ts` — Pick from Drive
- `composables/useEnsurePhotosPublic.ts:64` — photo public-link grants
- `components/login/JoinPodView.vue` (3 call sites) — invite/join flow
- `components/login/LoadPodView.vue` — login flow
- `pages/MeetTheBeansPage.vue:248,339` — in-app surfaces
- `pages/SettingsPage.vue` — sync settings
- `App.vue:491` — app boot (`completeRedirectAuth`)
- `OAuthCallbackPage.vue` — OAuth return

The subscriber pattern means we wire assertion in ONE place; every caller above benefits automatically. No per-caller changes.

## Approach

Four phases. Phases 1+4 ship as the customer-facing hotfix; Phases 2+3 are defense-in-depth. All phases share the same architectural commitments:

- **DRY:** extract reusable primitives, reuse existing infrastructure (`googleDriveProvider.disconnect`, subscriber pattern, `providerAccountEmail`).
- **Decoupling:** `googleAuth.ts` stays a pure token service. Stores subscribe to events; services don't import stores.
- **Defense in depth without redundancy:** each phase closes a different attack surface. None of them require the others to function.
- **Backwards-compatible migrations:** new fields populate lazily; missing values fail open (skip assertion, treat as cold cache) — never block sign-in.

---

### Phase 1 — Sign-out cleanup primitive (the hotfix core)

**Goal:** sign-out wipes every layer where Google account state can persist, using a primitive that's also shared with the existing `googleDriveProvider.disconnect()`.

**Step 1.1 — Extract shared primitive in `googleAuth.ts`:**

```ts
/**
 * Wipe all Google session state. Used by both:
 *  - googleDriveProvider.disconnect() (full provider disconnect)
 *  - authStore.signOut() / signOutAndClearData() (user-initiated sign-out)
 *
 * Local state is cleared synchronously and unconditionally. The network
 * revoke is best-effort and does not block — a failed revoke does not
 * leave state behind locally, and Google will expire the token anyway.
 *
 * Idempotent. Safe to call when no token / family is active.
 */
export async function clearGoogleSessionState(): Promise<void> {
  // Snapshot the access token so we can revoke it after clearing local
  // state (in case clearTokenState mutates the in-memory variable).
  const tokenSnapshot = accessToken;
  const familyIdSnapshot = currentFamilyId;

  // 1. Clear in-memory state immediately (synchronous, fast).
  clearTokenState();
  currentFamilyId = null;

  // 2. Best-effort fire-and-forget network revoke. Never await.
  //    Revoking is courteous to Google but not load-bearing — the
  //    refresh token's removal from our storage (step 3) is what
  //    actually prevents reuse.
  if (tokenSnapshot) {
    fetch(`${GOOGLE_REVOKE_URL}?token=${tokenSnapshot}`, { method: 'POST' }).catch(() => {
      // Network errors are expected (offline, slow, etc.) — best-effort.
    });
  }

  // 3. Clear persisted refresh tokens. Both the active family AND the
  //    "__pending__" key (used during login-page OAuth before family
  //    adoption — can leak across sign-out cycles otherwise).
  await Promise.allSettled([
    familyIdSnapshot ? clearGoogleRefreshToken(familyIdSnapshot) : Promise.resolve(),
    clearGoogleRefreshToken(PENDING_FAMILY_KEY),
  ]);
}
```

Notes:

- `clearTokenState()` already exists at `googleAuth.ts:432`. It clears `accessToken`, `expiresAt`, `refreshToken`, `cachedEmail`, the legacy `gis_token` localStorage key, and the refresh timer. We reuse it; don't duplicate.
- `PENDING_FAMILY_KEY` is already a const at `googleAuth.ts:29`. Keep using the same key.
- `clearGoogleRefreshToken` already wipes both IndexedDB AND the localStorage backup (`fileHandleStore.ts:228-236`). Single call covers both layers.
- We do NOT introduce a new module. This is one new export in `googleAuth.ts`.

**Step 1.2 — Refactor `googleDriveProvider.disconnect()` to use the primitive (DRY):**

Currently:

```ts
async disconnect(): Promise<void> {
  revokeToken();           // sync — does best-effort fetch + clearTokenState
  clearFolderCache();
}
```

New:

```ts
async disconnect(): Promise<void> {
  await clearGoogleSessionState();
  clearFolderCache();
}
```

`revokeToken()` and `clearGoogleSessionState()` overlap; the latter is the more thorough version. We deprecate `revokeToken()` (keep the export for backwards compat in case any tests use it, but route the canonical path through the new primitive). The provider keeps `clearFolderCache()` as a separate concern because the folder cache lives in `driveService.ts`, not `googleAuth.ts`.

**Step 1.3 — Wire into authStore.ts sign-out paths:**

Add a new bounded helper that mirrors `flushPendingSaveWithTimeout`:

```ts
async function clearGoogleSessionStateWithTimeout(timeoutMs: number): Promise<void> {
  try {
    await Promise.race([
      Promise.all([clearGoogleSessionState(), Promise.resolve(clearFolderCache())]),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (e) {
    console.warn('[authStore] Google cleanup error during sign-out:', e);
  }
}
```

Why a timeout: in the worst case, `clearGoogleRefreshToken` could hang on a stuck IndexedDB. We never want a sign-out to be blockable. 3000ms is generous (the only async work is two IDB deletes and a fire-and-forget fetch).

Call it in both sign-out paths after `flushPendingSaveWithTimeout`:

```ts
async function signOut(): Promise<void> {
  await flushPendingSaveWithTimeout(3000);
  await clearGoogleSessionStateWithTimeout(3000);
  // ... existing logic ...
}

async function signOutAndClearData(): Promise<void> {
  await flushPendingSaveWithTimeout(3000);
  await clearGoogleSessionStateWithTimeout(3000);
  // ... existing logic ...
}
```

**Trusted-device behavior (explicit):** trusted-device flag governs the per-family Automerge cache (passkey-driven fast re-login). It does NOT govern Google OAuth state. A user who explicitly signs out wants their session ended; they will re-consent on next sign-in regardless. Always wipe Google session state.

---

### Phase 2 — Account-bound folder cache

**Goal:** even if some future code path re-introduces a cleanup hole, the folder cache cannot be silently used against the wrong account.

**Step 2.1 — Replace string cache with tagged record in `driveService.ts`:**

```ts
type CachedFolder = { folderId: string; accountEmail: string };
let cachedFolder: CachedFolder | null = null;

// Restore from localStorage on module load — JSON-encoded.
try {
  const raw = localStorage.getItem(FOLDER_CACHE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.folderId === 'string' && typeof parsed.accountEmail === 'string') {
      cachedFolder = parsed;
    } else {
      // Schema mismatch — likely an old string-only entry from a previous
      // version. Treat as cold cache; will be re-discovered + rewritten.
      localStorage.removeItem(FOLDER_CACHE_KEY);
    }
  }
} catch {
  // Parse error or localStorage unavailable — treat as cold cache.
}
```

**Step 2.2 — Verify on every reuse:**

```ts
export async function getOrCreateAppFolder(token: string): Promise<string> {
  // Resolve the current account email — required for cache validation.
  // Cheap: cached after first call per token; falls back to userinfo fetch.
  const email = getGoogleAccountEmail() ?? (await fetchGoogleUserEmail(token));

  if (cachedFolder && email && cachedFolder.accountEmail === email) {
    return cachedFolder.folderId;
  }

  // Cache miss or mismatch — re-discover.
  // ... existing search logic ...
  return cacheFolderId(resolvedId, email ?? '');
}

function cacheFolderId(folderId: string, accountEmail: string): string {
  cachedFolder = { folderId, accountEmail };
  try {
    localStorage.setItem(FOLDER_CACHE_KEY, JSON.stringify(cachedFolder));
  } catch {
    // localStorage unavailable
  }
  return folderId;
}

export function clearFolderCache(): void {
  cachedFolder = null;
  try {
    localStorage.removeItem(FOLDER_CACHE_KEY);
  } catch {}
}

export function getAppFolderId(): string | null {
  return cachedFolder?.folderId ?? null;
}
```

**Edge case — email unknown:** if `email` is null (rare race condition before userinfo resolves), we skip the cache and re-discover. Safer than caching with an empty/unknown email.

**Edge case — old localStorage entries:** schema mismatch parsing logic above silently upgrades.

---

### Phase 3 — Account assertion + `googleAccountEmail` field

**Goal:** automatic, silent self-correction when a token is acquired for the wrong account.

**Step 3.1 — Two-email design on `FamilyMember`:**

```ts
// src/types/models.ts
export interface FamilyMember {
  ...
  email: string;                    // user-editable contact email — unchanged
  /**
   * The Google account email this member is bound to for Drive sync.
   *
   * Set automatically the first time the member's own OAuth completes
   * successfully. Read-only via normal forms — to change, the user must
   * use the explicit "switch Google account" flow in Settings → Family
   * Data, which forces a fresh consent screen and updates this field
   * only after the new consent succeeds.
   *
   * NEVER overwritten silently. May be undefined for members created
   * before this field was introduced; backfilled lazily on each member's
   * own next successful token acquisition. Until then, account assertion
   * is skipped (fail-open) for that member.
   *
   * Distinct from `email` — see ADR-0NN (account-stickiness fix) for the
   * two-email design rationale.
   */
  googleAccountEmail?: string;
}
```

**Backfill rule (greg's decision #2 verified by own consent only):**

We can only verify `googleAccountEmail` when the member is themselves authenticating. We do NOT infer it from the contact email, the invite metadata, or any indirect signal — only the member's own OAuth token-info response counts as verification.

In practice this means: when ANY member signs in successfully and we receive `email = userinfo.email`:

- If `currentMember.googleAccountEmail` is unset → write `email` (first-time backfill, verified by own consent).
- If it's set and matches → continue normally.
- If it's set and mismatches → **silent self-correction** (Step 3.3).

Other members' fields populate as each one signs in.

**Step 3.2 — Subscriber pattern on token acquisition:**

Add `onTokenAcquired(callback)` to `googleAuth.ts`, mirroring the existing `onTokenExpired` (`googleAuth.ts:422`). Fire from a single internal helper that all three acquisition paths funnel through:

```ts
type AcquiredCallback = (email: string | null, token: string) => void;
const acquiredCallbacks: AcquiredCallback[] = [];

export function onTokenAcquired(cb: AcquiredCallback): () => void {
  acquiredCallbacks.push(cb);
  return () => {
    const i = acquiredCallbacks.indexOf(cb);
    if (i > -1) acquiredCallbacks.splice(i, 1);
  };
}

async function notifyTokenAcquired(token: string): Promise<void> {
  const email = await fetchGoogleUserEmail(token);
  acquiredCallbacks.forEach((cb) => {
    try {
      cb(email, token);
    } catch (e) {
      console.warn('[googleAuth] tokenAcquired callback error:', e);
    }
  });
}
```

Wire `notifyTokenAcquired` into:

- `performPopupAuth` (after successful exchange — replace existing fire-and-forget `fetchGoogleUserEmail`)
- `performSilentRefresh` (after successful refresh)
- `completeRedirectAuth` (after successful exchange)

This is ONE wire-up. All eight token-acquisition call sites in the app benefit.

**Step 3.3 — Subscriber: assertion + backfill in authStore (or a new dedicated module):**

Create `src/services/auth/googleAccountAssertion.ts` that subscribes at app init:

```ts
import {
  onTokenAcquired,
  requestAccessToken,
  clearGoogleSessionState,
} from '@/services/google/googleAuth';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';

let registered = false;

/**
 * Register the subscriber that asserts every newly-acquired access token
 * matches the currently-authenticated member's googleAccountEmail.
 * Called once at app boot (after auth init).
 */
export function registerGoogleAccountAssertion(): void {
  if (registered) return;
  registered = true;

  onTokenAcquired(async (email) => {
    if (!email) return; // userinfo failed; can't assert

    const auth = useAuthStore();
    const fam = useFamilyStore();
    const memberId = auth.currentUser?.memberId;
    if (!memberId) return;

    const member = fam.getMemberById(memberId);
    if (!member) return;

    if (!member.googleAccountEmail) {
      // First-time backfill — verified by own OAuth response.
      await fam.updateMember(memberId, { googleAccountEmail: email });
      return;
    }

    if (member.googleAccountEmail === email) return; // match — no-op

    // Mismatch — silent self-correction.
    console.warn(
      `[accountAssertion] Token returned ${email}, expected ${member.googleAccountEmail}. Forcing re-consent.`
    );
    await clearGoogleSessionState();
    try {
      await requestAccessToken({ forceConsent: true, loginHint: member.googleAccountEmail });
      // The next acquisition will re-fire this subscriber. If it matches now, done.
      // If it still mismatches, the user picked the wrong account at the chooser —
      // we surface the toast then.
      showToast(
        'info',
        useTranslation().t('auth.accountSwitched.title'),
        useTranslation().t('auth.accountSwitched.body', { email: member.googleAccountEmail })
      );
    } catch (e) {
      console.warn('[accountAssertion] Re-consent failed:', e);
      // Silent — the user can manually trigger reconnect from Settings.
    }
  });
}
```

Called from `App.vue` after auth init. Single registration; auto-applies to every token acquisition app-wide. **DRY.**

**Step 3.4 — Settings → Family Data: "Switch Google account":**

In the Family Data modal in `SettingsPage.vue`, add a row beneath the existing "Reconnect" button:

```
Signed in with: gpsp2001@gmail.com   [switch account]
```

Button handler triggers `requestAccessToken({ forceConsent: true })` with `loginHint` cleared (so Google's chooser shows all available accounts, not the current one). On success, the existing subscriber catches the new email and:

- If it matches `member.googleAccountEmail` → no change (user picked the same account; no harm).
- If it mismatches → the assertion would force re-consent again. To break that loop, the "switch account" button needs to opt OUT of the assertion: it sets a transient flag (`pendingAccountSwitch = true`) before triggering auth; the subscriber checks this flag, and if set, treats the new email as the new ground truth and writes it to `member.googleAccountEmail` instead of asserting.

```ts
let pendingAccountSwitch = false;

export function startAccountSwitch(): void {
  pendingAccountSwitch = true;
}

// In the subscriber:
if (pendingAccountSwitch) {
  pendingAccountSwitch = false;
  await fam.updateMember(memberId, { googleAccountEmail: email });
  return;
}
```

Available to all members for their own record (greg's decision #3). No `canManagePod` gate.

---

### Phase 4 — Banner UX

**Step 4.1 — Show the email in the file-not-found banner:**

`SaveFailureBanner.vue` template — interpolate the email pulled from `syncStore.providerAccountEmail`:

```vue
<template #message>
  <template v-if="props.fileNotFound">
    {{
      t('googleDrive.fileNotFoundBody', {
        email: syncStore.providerAccountEmail || t('googleDrive.thisAccount'),
      })
    }}
  </template>
  <template v-else>
    {{ t('googleDrive.saveFailureBody') }}
  </template>
</template>
```

`uiStrings.ts` updates (en + beanie):

- `googleDrive.fileNotFoundBody`: `"We couldn't find your data file in {email}'s Drive. It may have been deleted, moved, or you may have signed in with a different account."`
- `googleDrive.thisAccount`: `"this account"` / `"this google account"` (beanie)

Already-supported `t()` interpolation pattern (used in many places in `uiStrings.ts`; verify in code).

**Step 4.2 — Route directly to Family Data modal:**

`SaveFailureBanner.vue:78-80`:

```ts
function goToSettings() {
  router.push({ path: '/settings', query: { open: 'family-data' } });
}
```

`SettingsPage.vue` — add a watcher on `route.query.open` (in `onMounted` + a `watch` so it works whether the user lands on Settings fresh or navigates from another route):

```ts
import { watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

function handleOpenQuery() {
  if (route.query.open === 'family-data') {
    showFamilyData.value = true;
    // Strip the query param so a refresh doesn't re-open it.
    router.replace({ path: '/settings', query: {} });
  }
}

onMounted(handleOpenQuery);
watch(() => route.query.open, handleOpenQuery);
```

Generalizable: future surfaces can use `?open=<card-id>` for any of the existing settings cards.

**Step 4.3 — Force consent on Pick from Drive:**

`usePickBeanpodFile.ts:46`:

```ts
token = await requestAccessToken({ forceConsent: true });
```

Rationale: `usePickBeanpodFile` is called only from recovery flows (currently the SaveFailureBanner during file-not-found). Forcing the consent screen ensures the user explicitly confirms which account they want to use. The cost is one extra click in the rare correct-account case; the benefit is "I picked A but landed in B" becomes impossible. Even with Phase 3 assertion in place, this is harmless and gives clearer UX in recovery contexts.

If `usePickBeanpodFile` is ever invoked from a non-recovery context (e.g. backups), revisit and parametrize. Until then, `forceConsent: true` is a safe default for this composable.

**Step 4.4 — `login_hint` plumbing:**

Add an optional `loginHint?: string` param to `requestAccessToken` and `buildAuthUrl` in `googleAuth.ts`:

```ts
function buildAuthUrl(clientId: string, codeChallenge: string, prompt: string, loginHint?: string): string {
  const params = new URLSearchParams({ ...existing... });
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}
```

Used by:

- The assertion-driven re-consent (Step 3.3) — passes the _expected_ email to pre-fill Google's chooser.
- `useGoogleReconnect.reconnect(loginHint?)` — accepts an optional hint, threaded through. SaveFailureBanner passes `syncStore.providerAccountEmail` so reconnect pre-fills with the current account.

---

## Files affected

### Phase 1 — sign-out cleanup (hotfix)

| File                                                                                           | Change                                                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/services/google/googleAuth.ts`                                                            | Add `clearGoogleSessionState()` export                                                              |
| `src/services/sync/providers/googleDriveProvider.ts`                                           | Replace `revokeToken()` call in `disconnect()` with `clearGoogleSessionState()` (DRY)               |
| `src/stores/authStore.ts`                                                                      | Add `clearGoogleSessionStateWithTimeout`; call from `signOut()` and `signOutAndClearData()`         |
| `src/services/google/__tests__/googleAuth.test.ts`                                             | New tests: `clearGoogleSessionState` invariants                                                     |
| `src/services/sync/providers/__tests__/googleDriveProvider.test.ts`                            | Update: assert `disconnect()` calls `clearGoogleSessionState` (not `revokeToken`)                   |
| `src/stores/__tests__/dataClearingSecurity.test.ts` (existing) or new `signOutCleanup.test.ts` | New tests: `signOut()` invokes the cleanup; subsequent `requestAccessToken` does not silent-refresh |

### Phase 2 — account-bound folder cache

| File                                                 | Change                                                                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/services/google/driveService.ts`                | Replace `cachedFolderId` with `cachedFolder: { folderId, accountEmail }`; update read/write/cache-miss paths; JSON localStorage serialization |
| `src/services/google/__tests__/driveService.test.ts` | New tests: cache hit on email match; miss on mismatch (re-discover); parse-error fallback; `clearFolderCache` wipes both layers               |

### Phase 3 — account assertion + new field

| File                                                         | Change                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/types/models.ts`                                        | Add `googleAccountEmail?: string` to `FamilyMember` with two-email doc-block                                                                                                                     |
| `src/services/google/googleAuth.ts`                          | Add `onTokenAcquired` subscriber registry; add `notifyTokenAcquired` internal helper; wire into popup/silent/redirect paths; add optional `loginHint` to `requestAccessToken` and `buildAuthUrl` |
| `src/services/auth/googleAccountAssertion.ts`                | NEW: subscriber implementation (assertion + backfill + switch-account flag)                                                                                                                      |
| `src/App.vue`                                                | Call `registerGoogleAccountAssertion()` once during boot                                                                                                                                         |
| `src/stores/familyStore.ts`                                  | Verify `updateMember` accepts partial updates including `googleAccountEmail`; no signature change expected                                                                                       |
| `src/services/translation/uiStrings.ts`                      | Add `auth.accountSwitched.title`/`body`, `settings.familyData.signedInAs`, `settings.familyData.switchAccount` (en + beanie)                                                                     |
| `src/pages/SettingsPage.vue`                                 | Add "Signed in with" row + "Switch account" button in Family Data modal                                                                                                                          |
| `src/services/auth/__tests__/googleAccountAssertion.test.ts` | NEW: assertion match/mismatch/unset; switch-account flag; toast firing                                                                                                                           |
| `src/services/google/__tests__/googleAuth.test.ts`           | Extend: `onTokenAcquired` fires from all three paths; `loginHint` builds correct URL                                                                                                             |

### Phase 4 — banner UX

| File                                                                          | Change                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/components/google/SaveFailureBanner.vue`                                 | Interpolate `{email}` in fileNotFoundBody; change `goToSettings` to push `?open=family-data`            |
| `src/pages/SettingsPage.vue`                                                  | Watch `route.query.open` on mount; open `showFamilyData` when set; `router.replace` to strip query      |
| `src/services/translation/uiStrings.ts`                                       | `googleDrive.fileNotFoundBody` interpolates `{email}`; `googleDrive.thisAccount` fallback (en + beanie) |
| `src/composables/usePickBeanpodFile.ts`                                       | Pass `forceConsent: true` to `requestAccessToken`                                                       |
| `src/composables/useGoogleReconnect.ts`                                       | Accept optional `loginHint` parameter; thread to `requestAccessToken`                                   |
| `src/components/google/__tests__/SaveFailureBanner.test.ts` (existing or new) | Test email interpolation; goToSettings query routing                                                    |
| `src/composables/__tests__/usePickBeanpodFile.test.ts` (new)                  | Test `forceConsent: true` is passed                                                                     |

---

## Test strategy

### Unit tests — required for merge

Phase 1:

- `clearGoogleSessionState`:
  - Wipes `accessToken`, `refreshToken`, `currentFamilyId`, `cachedEmail`, `expiresAt`, `refreshTimer`.
  - Calls `clearGoogleRefreshToken(currentFamilyId)` AND `clearGoogleRefreshToken(PENDING_FAMILY_KEY)`.
  - Best-effort revoke fires (mock `fetch`, assert call) but does not throw on network error.
  - Idempotent: callable when no token / family is active.
- `googleDriveProvider.disconnect()` calls `clearGoogleSessionState` (not `revokeToken`).
- After `clearGoogleSessionState`, a subsequent `requestAccessToken({ forceConsent: false })` does NOT short-circuit via silent refresh — it opens the popup (assert via mocked `openBlankPopup`).
- `authStore.signOut()` and `signOutAndClearData()` invoke `clearGoogleSessionStateWithTimeout(3000)`.

Phase 2:

- `getOrCreateAppFolder` — cache hit when `email === cached.accountEmail`.
- `getOrCreateAppFolder` — cache miss + re-discover when emails differ.
- Module load with corrupted localStorage entry (string instead of JSON) → cache cold.
- `clearFolderCache` wipes both module memory and localStorage.

Phase 3:

- `onTokenAcquired` fires after popup auth, silent refresh, redirect auth — with correct email.
- Multiple subscribers all fire; subscriber error doesn't break others.
- Assertion: `member.googleAccountEmail === email` → no-op.
- Assertion: `member.googleAccountEmail` undefined → backfilled via `updateMember`.
- Assertion: `member.googleAccountEmail !== email` → triggers `clearGoogleSessionState` + `requestAccessToken({ forceConsent: true, loginHint: expected })`.
- Switch-account flag: when set, the next acquisition writes the new email to the member record (no assertion).
- `buildAuthUrl(loginHint)` includes `&login_hint=<email>` in the URL.

Phase 4:

- `SaveFailureBanner` renders `{email}` from `syncStore.providerAccountEmail`; falls back to `thisAccount` translation when null.
- `goToSettings` pushes `{ path: '/settings', query: { open: 'family-data' } }`.
- `SettingsPage` opens `showFamilyData` modal when `route.query.open === 'family-data'`; calls `router.replace` to strip query.
- `usePickBeanpodFile` passes `forceConsent: true` to `requestAccessToken`.
- `useGoogleReconnect` threads `loginHint` to `requestAccessToken` when provided.

### Existing tests — verify still pass

- `useGoogleReconnect` tests (added in commit `ee7a233` — yesterday's work).
- `googleAuth.test.ts` existing cases.
- `googleDriveProvider.test.ts` existing cases.
- `dataClearingSecurity.test.ts` existing cases.
- All E2E (`google-drive.spec.ts` etc) — should be unaffected.

### Manual repro of the original bug — must verify before declaring Phase 1 done

1. Sign in with account A on a fresh browser session → confirm Drive operations target A.
2. Sign out → in DevTools, confirm:
   - `localStorage.getItem('beanies_drive_folder_id')` is `null`
   - `localStorage` has no `beanies_grt_*` keys
   - IndexedDB handle DB has no `googleRefreshToken-*` entries
3. Sign in with account B → confirm Drive operations target B.
4. Sign out → confirm same wipe.
5. Sign back in with account A → confirm consent popup appears (NOT silent), Drive operations target A, `.beanpod` is found, no red banner.

### Manual smoke (Phase 4)

- Trigger fileNotFound state (mock or real) → banner shows the email being checked → "Go to Settings" lands directly inside the Family Data modal.
- "Pick from Drive" always shows Google's chooser, even if there's a valid silent token.

### Cross-browser PWA verification (after deploy)

Repro the original bug on:

- Android Chrome standalone PWA (where yesterday's reconnect bugs originated).
- iOS Safari standalone (Add to Home Screen).
- Desktop Chrome (greg's primary).

### E2E (optional, defer)

Adding a Playwright multi-account scenario requires real OAuth or sophisticated mocking. Out of scope for this change. Consider after Phase 3 lands if account assertion needs lock-in coverage.

---

## Design alternatives considered & rejected

| Alternative                                                              | Why rejected                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always force `prompt=consent` on every login**                         | Adds friction on every sign-in. Doesn't address the same-session drift case. Phase 1 cleanup + Phase 3 assertion make it unnecessary.                                                                      |
| **Merge `email` and `googleAccountEmail` into a single field**           | Conflates two distinct concepts (contact identity vs. OAuth identity). Same pattern as GitHub (account email ≠ git author email). Breaks UX for users whose contact email differs from their Google email. |
| **Auto-overwrite contact email with Google email on every sign-in**      | Silently mutates user-entered data. Surprising and confusing. Doesn't match greg's "data should just work" principle (which applies to _correctly_ working, not silently overriding user choices).         |
| **Wipe Google session state in `disconnect()` but NOT sign-out**         | Sign-out is an explicit user action. The bug _is_ sign-out leaving residue. Don't keep state because of the trusted-device flag — trusted-device governs the data cache, not OAuth.                        |
| **Compare against `member.email` (contact email) instead of new field**  | Wrong concept. Contact email isn't the OAuth identity. Two separate fields, two separate purposes.                                                                                                         |
| **Validate the account in every individual token-acquisition call site** | Violates DRY. The subscriber pattern wires assertion ONCE; all 8 call sites benefit automatically.                                                                                                         |
| **Block sign-out on cleanup completion (no timeout)**                    | A user who can't sign out is much worse than a missed final cleanup. Mirrors the existing `flushPendingSaveWithTimeout` philosophy.                                                                        |
| **Migrate `googleAccountEmail` for all members in a batch on next sync** | We can only verify the field for the _currently-signed-in_ member. Inferring from contact email is the silent-overwrite pattern we explicitly rejected. Lazy backfill is the only sound design.            |
| **`canManagePod` gate on switch-account button**                         | Each member's Google account is their own identity. No pod-management implication. Available to all members for their own record.                                                                          |

---

## Resolved decisions (greg, 2026-04-26)

1. **Mismatch UX → silent.** Force re-consent silently; data should just work. A small toast is fine but not blocking.
2. **Backfill scope → as broad as possible, but only when verified.** Only the member's own OAuth response counts as verification. No inference from contact email or invite metadata.
3. **Switch Google account → available to all members for their own record.** No `canManagePod` gate.

---

## Sequencing & deployment

1. **Hotfix PR — Phase 1 + Phase 4** (the customer-facing fix). Manual repro must verify before declaring done.
2. **Defense PR — Phase 2 + Phase 3** (account-bound cache + assertion + Switch Account UI). Phase 3 references the `loginHint` plumbing introduced in Phase 4.

Within this implementation pass: greg directed all four phases land together. Order of work within the single pass: 1 → 4 → 2 → 3 (each builds on prior, minimizes test churn).

---

## Out of scope / explicit non-goals

- **Multi-tab sign-out propagation.** Today, signing out on tab A doesn't immediately clear tab B's in-memory state. Pre-existing issue; out of scope. (`storage` event listening could fix it but adds complexity.)
- **Backfill `googleAccountEmail` from invite metadata.** Inviter knows joiner's Google email at invite time, but capturing it would require schema changes to invite flow. Lazy backfill on first sign-in is sufficient.
- **`gcOrphanedDriveFiles` Drive-side sweep** — separate follow-up (already noted in STATUS).
- **Trusted-device flag semantic changes.** Trust governs data cache, not OAuth — clarified, but not redefined.
- **A new `signOutAndRevoke` variant.** Existing `signOut` and `signOutAndClearData` cover the user intents; adding a third would be premature abstraction.

---

## Risks & mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-out cleanup hangs on stuck IndexedDB                                             | 3s timeout + `Promise.allSettled` in cleanup → cleanup never blocks sign-out.                                                                                                                                                                                                                                      |
| Best-effort revoke fails (offline)                                                    | Local state is cleared regardless; refresh token is wiped from IDB+localStorage. Revoke is courtesy, not load-bearing.                                                                                                                                                                                             |
| Account assertion fires before family is loaded                                       | Subscriber checks `auth.currentUser?.memberId`; bails if unset. No-op until member context is available.                                                                                                                                                                                                           |
| Switch-account flag race (user clicks button twice)                                   | Flag is consumed exactly once on next acquisition. Second click without intervening acquisition either overwrites the flag (idempotent) or the second consent is treated as the new ground truth (correct behavior).                                                                                               |
| Existing tests fail because mocked tokens don't fire `notifyTokenAcquired`            | Tests in scope: update mocks where needed. Out-of-scope tests should be unaffected (the mocks bypass real auth).                                                                                                                                                                                                   |
| Folder cache JSON parse fails on old entries                                          | Schema-validated on load; falls back to cold cache. One extra Drive call on first session post-deploy. Acceptable.                                                                                                                                                                                                 |
| Loop: assertion forces consent, user picks same wrong account, assertion forces again | After first force-consent, the new email is asserted again. If still mismatched, we surface a toast and stop forcing. (No infinite loop because we only force-consent when called from the subscriber once per acquisition.) Add an explicit guard variable to prevent re-entry within the same acquisition cycle. |

---

## Author

Plan rev 2, fresh-eyes review 2026-04-26 — by Claude (Opus 4.7), reviewed and confirmed by greg.
