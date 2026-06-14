# Plan: Fix all code-review findings from the 2026-06-14 batch review

> Date: 2026-06-14 · Related issues: None — direct implementation

## Context

A high-effort `/code-review` over the un-deployed batch (`6c77d8ad..HEAD`, 14 commits) — the #36 session-epoch guard, the per-member nudge DRY refactor, and the activity-taxonomy + invite-flow changes — produced **5 CONFIRMED bugs, 2 PLAUSIBLE issues, 8 cleanup/altitude items** via 9 finder angles → per-candidate verification → a gap sweep. Three candidates were REFUTED and are excluded (watcher-leak — watches are component-scoped; clearOnSignOut cross-member leak — sole reader is null-guarded; marketing-home button — `MARKETING_URL` resolves to the apex in prod).

Two findings are auth-critical: a Google **refresh token can survive sign-out** on disk / in the shared beanpod via a check-then-await TOCTOU window — these must land before the batch deploys. Work is grouped A→D in severity order. **Package A is the deploy blocker.**

This plan ran the mandatory 4-pass `/beanies-plan` discipline (draft → DRY/error-handling → sustainability → fresh-eyes); each pass was a fresh Plan subagent that read the actual code. Summaries are in the Review Passes section.

---

## Work Package A — Auth: close the epoch-guard windows (DEPLOY BLOCKER)

Files: `src/services/google/googleAuth.ts`, `src/services/google/driveTokenRecovery.ts`.

- **A1 (#1) — persist-ordering zombie token.** In `attemptSilentAuthCode`, `performPopupAuth`, `completeRedirectAuth`, `isSessionStillCurrent` runs _before_ `await storeGoogleRefreshToken(...)` with no re-check after. `storeGoogleRefreshToken` (db.put) and sign-out's `clearGoogleRefreshToken` (db.delete) are independent auto-committing IDB ops on the same key → a sign-out during the put leaves a token on disk for a torn-down session; cold-start `initializeAuth` reads it unguarded.
- **A2 (#8, the fix vehicle) — single commit chokepoint.** Extract `commitAcquiredToken({ tokens, interactive, epochAtStart, storageKey }): Promise<{committed:true; token} | {committed:false}>`. Body: re-check `isSessionStillCurrent` → assign in-memory (`accessToken`, `expiresAt`, `currentRefreshToken`) + `await storeGoogleRefreshToken(...)` when a refresh token is present → **post-persist re-check:** `if (epochAtStart !== sessionEpoch) { await clearGoogleRefreshToken(storageKey); accessToken=null; expiresAt=0; currentRefreshToken=null; logEvent('info','auth-epoch-discard','post-persist rollback'); return {committed:false}; }` → `scheduleAutoRefresh` → `notifyTokenAcquired(token, interactive, epochAtStart)`. The three seams delegate their commit to it. **Boundary:** the helper owns commit only — each seam keeps its pre-exchange scope check and `epochAtStart = sessionEpoch` snapshot. **Preserve** the existing `notifyTokenAcquired` `auth-epoch-leak` backstop (it is the "a guard was MISSED" signal). `storageKey` (`currentFamilyId ?? PENDING_FAMILY_KEY`) is resolved by the caller and passed in, so the rollback clears the exact key written. There is **no localStorage refresh-token mirror** — rollback is IDB + the three in-memory vars only.
- **A3 (#2) — reconcile mirror branch unguarded.** In `reconcileDriveTokenWithDoc`, the adopt branch is epoch-guarded but the local→doc mirror (`upsertDriveConnection`, `driveTokenRecovery.ts:207`) is not → a sign-out during the `Promise.all` read writes the revoked account's token into the synced `driveConnections` CRDT (propagates cross-device). Add `mirrorLocalToDoc(boundEmail, localTok, expectedEpoch)` symmetric with `restoreLocalFromDoc` (re-check `getSessionEpoch()` before `upsertDriveConnection`); call it from the branch. The B2 subscriber mirror (`:108`) stays untouched — it only fires after `notifyTokenAcquired`, which already stale-epoch early-returns before the subscriber fan-out.
- **A4 (#6, PLAUSIBLE) — redirect cross-reload zombie.** After a reload `sessionEpoch` resets to 0, so the guard can't bridge the redirect round-trip; the mitigation is `clearRedirectIntent()` (both epoch-bumping teardowns — `revokeToken`, `clearGoogleSessionState` — already call it, so no new wiring). Fix: make `clearRedirectIntent`'s `sessionStorage.removeItem` failure warn + `reportError('warning')` instead of swallowing; document the residual reload-bridge limit in-code (an in-memory counter inherently can't survive a reload — reduces, not eliminates).

## Work Package B — Nudge save contract (no silent failures)

Files: `src/composables/perMemberStore.ts`, `useCommunityNudge.ts`, `useBeanTips.ts`.

- **B1 (#3).** `writePerMemberState` swallows `localStorage.setItem` errors and `save()` returns `void`, so the `try/catch` in `useCommunityNudge.commit` and `useBeanTips.muteAllTips`/`enableTips` is **dead** — a quota/private-mode write failure leaves the UI showing success with no toast (violates the file's own docblock + the no-silent-failures rule). Fix: `writePerMemberState` → `boolean`; thread through `save: (next) => boolean`. **Document the contract in `save`'s docblock/type:** returns success; _background callers MAY ignore it, user-initiated callers MUST surface failure (toast + rollback)_.
  - Foreground (user-initiated `join`/`snooze`/`markJoined`, `muteAllTips`, `enableTips`): check the boolean via **one `commit`-style helper per file** (don't open-code the rollback/toast triple; `useBeanTips` must route both mutations through a single helper). On `false`: `state.value = prev` + `showToast('error', …)` with dev guidance. Drop the now-dead `try/catch`.
  - Background (`ensureNudgeIssued`, `ensureTodayTipIssued`): call `save`, ignore the boolean (the internal `reportError('warning')` is the signal) — no toast. Their outer try/catch (bad pure-core callback) stays.
  - `join()` opens Discord before committing — on save failure the rollback restores the `joined`/`activeNudge` flags so a retry works; the Discord nav already happened (acceptable).

## Work Package C — i18n / UX correctness

- **C1 (#4)** — `MonthChip.vue` `categoryLabel` (L71-73) feeds the chip `aria-label` from the raw constant name, bypassing i18n/beanie. Use `categoryLabel()` from `useActivityCategoryLabel`.
- **C2 (#5, WIDENED to the bug class)** — `String.prototype.replace('{token}', value)` interprets `$`-patterns (`$&`, `` $` ``, `$$`, `$1`) in the value. Recurs with family-creator/account-controlled values at: `JoinPodView.vue:35` (`{family}`) & `:91` (the `JOIN_ERRORS` `{key}` loop → `{actualEmail}`/`{hintEmail}`), `BiometricLoginView.vue:132` (`{name}`), `SetupProgressModal.vue:314`/`:472` (`{name}`), `LoadPodView.vue:503`/`:796` (`{familyName}`). Fix: one shared helper in `src/utils/` — `fillTemplate(template, vars)` using the function-replacer form (`replaceAll('{k}', () => String(v ?? ''))`) so values insert literally — and route all those sites through it. Numeric-only `{count}` sites carry no risk (optional).
- **C3 (#7, PLAUSIBLE, staging-only)** — token-mode "send us a message" link (`InviteGateOverlay.vue:203`) opens a form that dead-ends when `VITE_INVITE_WEBHOOK_URL` is unset (staging; prod injects it). Add `hasInviteWebhook()` (single env read); when absent, the link calls the existing `handleRequestOnDiscord` (no form). Pairs with D4.

## Work Package D — Cleanup / altitude

- **D1 (#9)** — memoize `getActivityCategoriesGrouped()`: build the locale-independent grouped+sorted structure once at module scope (`export const ACTIVITY_CATEGORIES_GROUPED = …`); labels are applied separately at render. Verify nothing mutates the returned arrays.
- **D2 (#10)** — `useActivityCategoryLabel` always calls `t()` for English, whose value mirrors the constant (a maintained duplicate). Add `isEnglish` to the `useTranslation` destructure; `categoryLabel`: `if (isBeanieMode.value) return name.toLowerCase(); if (isEnglish.value) return name; return t('planner.category.<id>') || name;`. **Keep the `planner.category.*`/`planner.group.*` keys in `uiStrings.ts`** (zh pipeline source) — only the runtime double-read + the en-mirror test assertion go; keep a key-presence assertion. Leave `groupLabel` on `t()` (few groups) with a one-line "intentional asymmetry" comment.
- **D3 (#11)** — two byte-identical Tailwind Discord CTA buttons in `InviteGateOverlay.vue` (L186-196, L292-301) → one **local** presentational button (label + click props). Not shared — `CommunityNudgeBody`/`OnboardingComplete` use scoped-CSS, not this gradient.
- **D4 (#12)** — delete orphaned `features.slackInvite` / `features.marketingUrl` + their `.env.example` / `vite-env.d.ts` / `docs/SELF_HOSTING.md` entries (`MARKETING_URL` reads the env var directly). Webhook presence = the single `hasInviteWebhook()` from C3.
- **D5 (#13)** — `NudgeDetailBody.vue`: drop the unused `#message` slot and the never-overridden `medallionSrc` prop + `withDefaults`; render `{{ message }}` and inline the medallion constant.
- **D6 (#14)** — one **local** `recordInviteRequest(method: 'discord'|'message')` helper in `InviteGateOverlay.vue`; both Plausible sites call it (keep it out of generic `utils/discord.ts`). Test asserts both methods.
- **D7 (#15)** — with A2's typed result, remove `performPopupAuth`'s `user_cancel` magic-string throw; map `{committed:false}` to its cancellation outcome. Leave `isUserCancellation`'s genuine matching intact.

---

## Don't reintroduce (REFUTED)

No `clearOnSignOut` on `useCommunityNudge`/`useBeanTips` (intentional; reader null-guarded); no install-once guard on `useMemberSync` (component-scoped watches dispose; store/init callers are one-time singletons); don't "fix" the marketing-home button.

## Critical files

`src/services/google/googleAuth.ts`, `src/services/google/driveTokenRecovery.ts`, `src/composables/perMemberStore.ts` · `useCommunityNudge.ts` · `useBeanTips.ts` · `useActivityCategoryLabel.ts`, `src/constants/activityCategories.ts`, `src/components/login/{InviteGateOverlay,JoinPodView,BiometricLoginView,SetupProgressModal,LoadPodView}.vue`, `src/components/planner/MonthChip.vue`, `src/components/notifications/NudgeDetailBody.vue`, `src/config/features.ts`, new `src/utils/<fillTemplate>.ts`.

## Verification

1. **`npm run validate`** green (type-check + lint + ~3240 tests) — the gate.
2. **Unit (A):** per persisting seam, advance `sessionEpoch` between the mocked persist resolve and assert no token in IDB, in-memory nulled, `auth-epoch-discard` logged; assert the `notifyTokenAcquired` backstop still fires (`__notifyTokenAcquiredForTesting`). `driveTokenRecovery.test.ts`: advance epoch during the reconcile read → no `upsertDriveConnection`.
3. **Unit (B):** mock `setItem` throw → `save` returns `false`; user action → toast + rollback; background tick → no toast, `reportError` called.
4. **Unit (C/D):** `fillTemplate` with `$`-special name/email inserts literally; `JoinPodView` subtitle + join-error context; MonthChip aria-label under zh + beanie; `InviteGateOverlay` webhook-unset → no form; `activityCategories.test.ts` (key-presence kept, en-mirror dropped); grouped identity stable.
5. **Manual smoke:** Google sign-in + Drive sync still works (no happy-path rollback); category picker (zh + beanie) + month calendar; community nudge + tip mute; a setup/biometric welcome with a normal family name.
6. Deploy A (minimum) or A–D on greg's go-ahead. Order: A → B → C → D.

## Review Passes

- **Pass 1 (draft):** four-package plan; REFUTED items excluded; #36 backstop preserved.
- **Pass 2 (DRY + error handling):** corrected rollback target (IDB + 3 in-memory vars; no localStorage mirror), rollback-before-notify, caller-resolved `storageKey`; A4 needs no new wiring; D2 keeps uiStrings keys (no zh assertion exists); D3 local-not-shared; D6 local; D4 marketingUrl genuinely orphaned.
- **Pass 3 (sustainability):** no structural rewrites (chokepoint + boolean `save` consolidate, not couple). Added guardrails: one `commit`-style helper per composable; the background-MAY/foreground-MUST contract in `save`'s docblock; the A2 responsibility boundary; the documented `categoryLabel`/`groupLabel` asymmetry.
- **Pass 4 (fresh-eyes):** widened C2 from one site to the whole `$`-pattern bug class via a shared `fillTemplate` helper (6 more attacker-influenced sites); pinned the D2 `isEnglish` destructure note; re-verified A3's two write sites, the dead B1 catches, and the `clearRedirectIntent` swallow against source.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (the code review that produced the findings)

`/code-review xhigh review all pending changes and commits made today`

### Plan request

`/beanies-plan prepare a plan to fix all of the above findings`

</details>
