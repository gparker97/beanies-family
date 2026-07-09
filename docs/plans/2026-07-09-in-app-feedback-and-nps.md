# Plan: In-app feedback & NPS collection

> Date: 2026-07-09
> Related issues: Notion #45 (no GitHub issue — direct implementation)
> Plan file (on save): `docs/plans/2026-07-09-in-app-feedback-and-nps.md`
> Mockup: `docs/mockups/feedback-nps-modal-2026-07-09.html` (approved, committed)

## Context

Aside from Discord members and people who email greg directly, there's no way to hear from existing users. This adds a low-friction in-app feedback path — an NPS "would you recommend" score plus one optional adaptive free-text answer — pushed to a private `#beanies-feedback` Slack channel. It's the **non-coding** feedback path (per commit `5f358cd2`, GitHub issues stay coding-only) and never mirrors raw feedback anywhere; Discord liveliness comes from a post-submit "join us" CTA. Design is the approved warmth-track mockup; every style token comes from the CIG, the mockup supplies layout + interaction intent only.

This plan was produced via `/beanies-pre-plan #45` → `/beanies-plan` and has been through all four review passes (draft → DRY/errors → sustainability → fresh-eyes). Pass 4 caught and fixed a real placement bug in the auto-open trigger. A subsequent coordinator review pass (see `## Coordinator Review`) hardened the newly-added single-interruption coordinator.

## User Story

As a beanies.family user, I want a quick, low-friction way to tell the team how I feel about the app and whether I would recommend it, so my feedback reaches the people building it; and as the maker, I want it captured where I will see it (Slack) so I can act on it and follow up when invited.

## Requirements

1. **Feedback form** (`BeanieFormModal`, ~10s): NPS 0–10 "would you recommend" as a required **warmth track** (pale peach at 0 → Heritage Orange at 10; selected step lifts + Sky Silk ring; no separate rating). ONE optional free-text whose label adapts to the band — 0–6 "What's letting you down? What would make it better?", 7–8 "What's one thing you wish beanies could do?", 9–10 "What do you love most? (and anything you wish it did?)". Optional collapsed contact (name+email), "only used if you want a reply".
2. **Submit → Slack** `#beanies-feedback` via existing `slackPost` + new `VITE_FEEDBACK_WEBHOOK_URL`. Attach version + platform + family_id — never financial data, never raw text via telemetry.
3. **Thank-you state** in-modal (promoter warm / detractor constructive), each with an `openDiscord` CTA.
4. **Permanent "Share feedback" entry** in the desktop sidebar footer + mobile hamburger footer.
5. **Periodic auto-prompt**: modal auto-opens on app load (non-podless route, not onboarding/first-session, not E2E). 30-day cadence (re-ask 30 days after a prompt whether or not they responded; closing counts as asked). 7-day account-age gate. Settings opt-out. State (opt-out + last-prompted) **per-family, synced** via `Settings`.
6. **i18n** en+beanie+zh, rem-based, three-tier modal, brand theme.
7. **Graceful failure**: missing/misconfigured webhook must not silently drop the action — dev warning + user flow still completes.
8. **At most one auto-interruption per session (new shared rule).** No unsolicited "look at me" surface may stack on or immediately follow another within a single tab-load. The feedback survey is the lowest priority and yields to anything already shown; a shared coordinator also stops the _other_ session-start popups (what's-new drawer, install prompt, PWA-reinstall, passkey/trust) from layering on each other. Security/onboarding win; engagement popups yield. User-initiated opens (the "Share feedback" button, action-driven celebrations, state-driven toasts/banners) are exempt — the rule governs only _unsolicited, auto-appearing_ surfaces at session start.

## Approach

**Resolved open question:** `slackPost` is `no-cors` fire-and-forget (opaque response) → **optimistic send** is the only workable model; no queued-retry.

### Data (`src/types/models.ts` + `settingsRepository.ts`)

Two optional synced fields on `Settings` (beside `calendarClashNudgeEnabled`): `feedbackOptOut?: boolean`, `feedbackLastPromptedAt?: ISODateString` (the single cadence clock — set on auto-open and on submit). Seed `feedbackOptOut: false` in `getDefaultSettings()`; add two one-line setters (`setFeedbackOptOut`, `setFeedbackPromptedAt`) delegating to `saveSettings({...})` (mirrors `setCalendarClashNudgeEnabled`, proxy-safe).

### Store (`src/stores/settingsStore.ts`)

- `feedbackOptOut` computed; `setFeedbackOptOut(v)` via existing `persistAiSetting` (toast + console + re-throw so the toggle reverts) — no new persist helper.
- `recordFeedbackPrompted()` — background family-only write of today's date; guard `isDocLoaded()`; try/catch → `reportError(severity:'warning')` on failure (never silent, never throws into render). Only record action.

### Cadence brain (pure) `src/utils/feedbackCadence.ts`

`decideFeedbackPrompt(state, nowMs, {minAccountAgeMs:7d, intervalMs:30d})` → false if optOut / account younger than 7d / within 30d of last prompt; else true. Pure + unit-tested (clone of `useCommunityNudge`'s `decideIssue` shape).

### Shared open-state `src/composables/useFeedbackModal.ts`

Module-singleton `{ isOpen, source, openFeedback(source), close() }` + `maybeAutoPromptFeedback()` (try/catch-wrapped auto-trigger). DRY answer to two entry surfaces + one auto trigger without touching `NAV_ITEMS`.

### Single-interruption-per-session coordinator (new) `src/composables/useSessionInterruption.ts`

There is **no shared coordinator today** — each auto-popup has a private gate and they can stack (what's-new + install at +30s; passkey + what's-new same tick). Introduce a module-singleton (same idiom as `useCommunityNudge`), in-memory, scoped to the tab-load (matching the existing `autoOpenedThisSession` "session = load" semantics — resets on full reload, **no persistence** — so a surface can never be permanently suppressed across sessions):

- `claimInterruption(id: string): boolean` — first caller this load wins (sets `claimedBy=id`, returns true); any later _different_ caller gets `false`; a same-id re-check returns `true` (idempotent, so a re-render / re-fired watch doesn't self-block).
- `wasInterrupted(): boolean` getter (for tests/telemetry).

**Universal call-site rule — claim only at the moment you are actually going to show.** Every retrofit below must place `claimInterruption(...)` at the _exact_ point where the surface would set its visible flag, gated behind that surface's own "should I show?" predicate, so a branch that ultimately shows nothing never consumes the session's single claim.

**First-wins by fire-order = priority** (no preemption of an already-open surface — that would be worse UX than a rare deferral). The natural session-start fire order already approximates the desired priority:

- **Onboarding wizard** (`OnboardingWizard.vue`, mounted by `FamilyNookPage.vue` via `v-if="!onboardingCompleted"`) — full takeover; call `claimInterruption('onboarding')` in the wizard's `onMounted` (it only mounts when actually shown, so this satisfies the claim-only-when-showing rule; onboarded users never mount it / never claim). It already blocks `ready()`; the claim additionally ensures that when onboarding _completes_ mid-session (flipping `onboardingCompleted → true`, satisfying `ready()`), the survey/what's-new **do not** immediately follow — directly fixing greg's "onboarding → survey" case. **Deliberate, non-lossy consequence:** a passkey/trust prompt that would fire in the same tab-load as first-run onboarding defers (re-offered next fresh sign-in; reachable in Settings).
- **Passkey / Trust modal** (`App.vue` ~1349/1358) — the watch has branches that decide _not_ to show. Claim **at each show-site**, folded into the show condition, so a no-show branch never claims: `if (claimInterruption('auth-prompt')) { showPasskeyPrompt.value = true; return; }` and likewise for `showTrustPrompt`. Same-id idempotency lets the passkey→trust fallback in one watch run resolve under `'auth-prompt'`. On a failed claim neither flag is set and nothing is lost (`passkeyPromptDismissed` stays false; re-evaluates next `freshSignIn`; reachable in Settings).
- **Notifications auto-open** (`notificationsStore.openToLatestAutoOpen`) — keep the existing early returns first, then claim, then latch/open:
  ```
  if (autoOpenedThisSession) return;
  const latest = latestUnseenAutoOpen.value;
  if (!latest) return;                              // nothing to show → don't claim
  if (!claimInterruption('notifications')) return;  // yielded → leave item unread in the bell
  autoOpenedThisSession = true;
  openTo(latest.id);                                // markRead happens ONLY when actually shown
  ```
  Preserves the `autoOpenedThisSession` latch and `openTo → markRead` exactly; a yielded item stays unread and reachable via the bell.
- **InstallPrompt** (`InstallPrompt.vue`, +30s timer) — claim last in the existing predicate: `if (canInstall.value && !isInstalled.value && !isDismissed() && claimInterruption('install')) showPrompt.value = true;`.
- **PwaReinstallModal** (`PwaReinstallModal.vue`) — `openModal` is a **`computed`**; `claimInterruption` must NOT be called inside it (side effect in a pure computed). Rename the pure predicate to `eligible` (existing `shouldShow` + E2E guard) and add a one-shot `const showReinstall = ref(false)` driven by `watch(eligible, …, { immediate: true })` that flips true once when `eligible && claimInterruption('pwa-reinstall')`. Bind the modal `open` to `showReinstall`; dismiss sets it false.
- **Feedback (lowest)** — see below; claims last.

**Rare same-tick race** (passkey vs what's-new): whichever resolves first shows; the other defers — still one popup, so no arbitration machinery needed. **Excluded** (not unsolicited session-start interrupters): `CelebrationOverlay` (action-driven), toasts/banners (`SaveFailureBanner`, `OfflineBanner`, `GoogleReconnectToast`), post-PWA-update toast.

### Auto-prompt trigger (`src/composables/useNotifications.ts`)

Call `maybeAutoPromptFeedback()` **inside the session-ready watcher's `!isPodlessExpectedRoute(...)` block, right after `store.openToLatestAutoOpen()`** — inheriting the `ready()` gate + `e2e_auto_auth` suppression + onboarding guard. **NOT** on the day-roll watcher (no podless guard → would pop mid-session). `maybeAutoPromptFeedback` reads settings, no-ops if the modal is already open, then `if (decideFeedbackPrompt(...) && claimInterruption('feedback')) { recordFeedbackPrompted(); openFeedback('auto'); }` — eligibility is checked _before_ `claimInterruption` so an ineligible session never consumes the claim (leaving it free for the +30s install prompt), and placement after `openToLatestAutoOpen()` makes notifications claim first → survey is strictly lowest priority. Whole body try/catch → `reportError` like `ensureNudgeIssued`. The nav-button path `openFeedback('nav')` is user-initiated and does **not** call `claimInterruption`.

### Submission `src/utils/feedbackSubmit.ts`

- `buildFeedbackText(input)` — pure Slack `text` formatter: score+band, adaptive answer (or "—"), optional name/email, diagnostic footer from `getFullVersionLabel()` + platform + `family_id` (read directly, not via allowlist).
- `submitFeedback(input)` — `slackPost(import.meta.env.VITE_FEEDBACK_WEBHOOK_URL, {text}, 'feedback')` in a try/catch that `reportError`s (warning, no raw text) only on an unexpected build/post throw. Missing-URL is **not** re-handled — `slackPost` already no-ops + `console.warn`s (satisfies req 7, DRY).

### Components `src/components/feedback/`

- `NpsScale.vue` — 11-segment continuous CIG gradient warmth track; selected lifts + Sky Silk ring; slate numerals on light, white on 8–10; `v-model:number|null`; keyboard-operable; rem-based; standard Tailwind classes.
- `FeedbackModal.vue` — dual-view (read/edit precedent): **form** → `BeanieFormModal` with `NpsScale` + adaptive `BaseTextarea` (label = band computed) + `ConditionalSection` contact via `BaseInput`; save disabled until score. **thanks** → `BaseModal` + band copy + `openDiscord('feedback')`. Reuse `useFormModal` for `isSubmitting` + reset-on-open. On save: `submitFeedback` → `recordFeedbackPrompted` → thanks view.

### Wiring & surfaces

- `App.vue` mounts one `<FeedbackModal>` (with `TrustDeviceModal`/`NotificationsDrawer`), bound to `useFeedbackModal()`.
- `AppSidebar.vue` + `MobileHamburgerMenu.vue` — "Share feedback" `<button>` in the pinned/footer block → `openFeedback('nav')` (reuses pinned-item markup; opens a modal, not a route).
- `src/utils/discord.ts` — add `'feedback'` to `DiscordSurface` (one-line, for clean Plausible segmentation).
- `SettingsPage.vue` Quick Toggles — one `SettingToggleRow` (ON = prompt enabled → `optOut = !enabled`), handler `await settingsStore.setFeedbackOptOut(...)` (store toasts/reverts), mirroring `CalendarSyncSettings.onToggleClash`.
- Env/CI — `VITE_FEEDBACK_WEBHOOK_URL` in `vite-env.d.ts` + `.env.example` + `.github/workflows/deploy.yml`.
- i18n — `feedback.*` group in `uiStrings.ts` (en+beanie) → `npm run translate` + zh spot-check.

### Help Center

New `features`/how-to article, slug `sharing-feedback` (per `beanies-help-docs`): the sidebar entry, the occasional prompt, optional reply-only contact, opt-out in Settings; states plainly no financial data is included. Ships in the same change.

## Critical Files

**New:** `src/utils/feedbackCadence.ts`, `src/utils/feedbackSubmit.ts`, `src/composables/useFeedbackModal.ts`, `src/composables/useSessionInterruption.ts` (shared one-per-session gate), `src/components/feedback/NpsScale.vue`, `src/components/feedback/FeedbackModal.vue`, tests (`feedbackCadence`, `feedbackSubmit`, `NpsScale`, `FeedbackModal`, `useSessionInterruption`, settings-store), Help article.
**Modified:** `src/types/models.ts`, `src/services/automerge/repositories/settingsRepository.ts`, `src/stores/settingsStore.ts`, `src/composables/useNotifications.ts`, `src/utils/discord.ts`, `src/App.vue`, `src/components/common/AppSidebar.vue`, `src/components/common/MobileHamburgerMenu.vue`, `src/pages/SettingsPage.vue`, `src/vite-env.d.ts`, `.env.example`, `.github/workflows/deploy.yml`, `src/services/translation/uiStrings.ts` (+ `zh.json`).
**Modified for the coordinator (retrofit `claimInterruption` at the true show-site):** `src/stores/notificationsStore.ts` (`openToLatestAutoOpen`), `src/App.vue` (passkey/trust show-sites), `src/components/common/InstallPrompt.vue`, `src/components/common/PwaReinstallModal.vue` (computed→one-shot ref), `src/components/onboarding/OnboardingWizard.vue` (`onMounted` claim).
**Reused (no change):** `slackPost` (`slackNotify.ts`), `BaseTextarea`/`BaseInput`/`ConditionalSection`/`BeanieFormModal`/`BaseModal`, `useFormModal`, `SettingToggleRow`, `getFullVersionLabel` (`diagnosticContext.ts`), `errorReporter.ts`, `openDiscord` (`discord.ts`).

## Assumptions (review before implementing)

1. Per-family synced state is acceptable (greg's choice) — the prompt is family-coordinated, not per-member.
2. 7-day account-age gate via `Settings.createdAt` is the engagement proxy (no true metric exists).
3. 30-day interval from prompt-shown; submit-via-entry also stamps the clock.
4. Optimistic send.
5. `#beanies-feedback` channel + webhook created and `VITE_FEEDBACK_WEBHOOK_URL` provisioned (dev + CI); absent → inert (form works, submit warns to console, user still thanked).
6. Auto-open fires on app-load session-ready only, not mid-session day-roll.
7. **Coordinator is per-tab-load, first-wins, no preemption, claim-only-when-showing.** "Session" = this page load (in-memory, resets on reload, never persisted → no cross-session suppression). Retrofitting `claimInterruption` into what's-new/passkey/install/pwa-reinstall is an intended behavior change: those surfaces now defer (bell / next session / Settings) instead of stacking. Security/onboarding retain effective priority via fire-order; a same-session passkey prompt yielding to first-run onboarding is intended and non-lossy. The rare passkey-vs-what's-new same-tick race resolves to whichever fires first (still one popup).

## Verification

1. **Unit** `feedbackCadence`: opt-out / <7d / within-30d → false; eligible → true; 7d & 30d boundaries.
2. **Unit** `feedbackSubmit`: text includes score/band/answer/contact/diagnostics, no financial data; calls `slackPost` w/ scope `'feedback'`; missing URL → no-op + `console.warn`, no throw; build throw → `reportError(warning)` no raw text, still returns.
3. **Component** `NpsScale`: emits score; band mapping; keyboard; aria labels. `FeedbackModal`: save gated on score; submit → `submitFeedback` + `recordFeedbackPrompted` + thanks; reopen resets; Discord CTA fires.
4. **Store**: `setFeedbackOptOut` writes + re-throws on failure; `recordFeedbackPrompted` sets date, `reportError(warning)` on failure, no-op when `!isDocLoaded()`.
5. **Unit** `useSessionInterruption`: first `claimInterruption` wins (true); a different second caller gets false; same-id re-check returns true; `wasInterrupted()` reflects state. Regressions: `openToLatestAutoOpen` still no-ops **without claiming** when nothing is unseen, and when it yields does NOT set `autoOpenedThisSession` / NOT `markRead` / leaves the item unread; ineligible feedback session does NOT consume the claim; a passkey no-show branch does NOT consume the claim.
6. **Manual (dev, real webhook)**: submit → verify Slack message; toggle opt-out; simulate cadence via `feedbackLastPromptedAt`; confirm no auto-open during onboarding or on a podless route. **Coordinator manual checks:** complete onboarding → survey/what's-new do NOT follow same session; a passkey prompt that yielded to onboarding re-appears on the next fresh sign-in; force an unseen what's-new → survey yields (drawer wins, item stays unread if it loses); fresh sign-in with a passkey prompt → what's-new/survey do not stack; +30s install prompt does not pop over a load-time popup; PwaReinstall shows at most once and never over another load-time popup.
7. **i18n**: beanie strings present; `npm run translate`; zh spot-check.
8. `npm run validate` green (type-check + lint + tests). No E2E (ADR-007 three-gate — not a data-loss-critical journey).

## Post-approval bookkeeping

- Save this plan to `docs/plans/2026-07-09-in-app-feedback-and-nps.md` (with the full four-pass Review Passes log + Prompt Log) and commit.
- Write the `plan file url` back to Notion #45 (deferred `/beanies-pre-plan` step): `https://github.com/gparker97/beanies-family/blob/main/docs/plans/2026-07-09-in-app-feedback-and-nps.md`.

## Review Passes

- **Pass 1 (draft)**: full feature — synced Settings state, pure cadence util, shared open-state composable, auto-open via the `useNotifications` ready() seam, `slackPost` submission, dual-view `FeedbackModal` + `NpsScale`, two footer entries, Settings opt-out, env/CI/i18n/Help Center; resolved optimistic-send.
- **Pass 2 (DRY + errors)**: dropped the duplicate missing-webhook branch (delegated to `slackPost`), reused `BaseTextarea`/`BaseInput`/`useFormModal`, routed opt-out through `persistAiSetting`, isolated the auto-trigger, added `'feedback'` `DiscordSurface`.
- **Pass 3 (sustainability)**: collapsed the write-only `feedbackLastSubmittedAt` field/action into the single `feedbackLastPromptedAt` clock (3 synced fields → 2).
- **Pass 4 (fresh-eyes)**: fixed the auto-open placement bug (retargeted to the guarded session-ready `!isPodlessExpectedRoute` seam; dropped the day-roll call).
- **Coordinator review (post-greg)**: added the one-per-session coordinator; fixed the `PwaReinstallModal` computed side-effect (→ one-shot ref) and the passkey claim-at-show-site; confirmed the notifications latch/markRead and no-cross-session-suppression properties. See `## Coordinator Review`.

## Coordinator Review

Reviewed `useSessionInterruption` against live code (`useNotifications.ts`, `notificationsStore.ts`, `App.vue` passkey/trust watch, `InstallPrompt.vue`, `PwaReinstallModal.vue`, `OnboardingWizard.vue`/`FamilyNookPage.vue`):

- **Confirmed** claim semantics: first-wins, same-id idempotent, in-memory singleton, resets per tab-load → no deadlock, no cross-session suppression.
- **Confirmed** notifications gating: claim after the `!latest` early-return and before the latch/`openTo` preserves `autoOpenedThisSession` + `markRead`; a yielded item stays unread/reachable.
- **Changed** passkey/trust: claim moved to the exact show-sites so no-show branches don't waste the claim; yield is non-lossy.
- **Changed** PwaReinstallModal: `openModal` computed → pure `eligible` + one-shot `showReinstall` ref via `watch(...,{immediate:true})` (claim is a controlled side effect at the show-site).
- **Confirmed** onboarding `onMounted` claim fixes onboarding→survey without suppressing anything that should show during onboarding.
- **Confirmed** no deep nesting / no priority-queue; single boolean at each show-site; nav button + action/state-driven surfaces exempt; `claimInterruption` is pure/in-memory and cannot throw.

## Prompt Log

<details><summary>Full prompt history</summary>

- Pre-plan handoff: assembled `=== BEANIES PRE-PLAN ===` block for Notion #45 (feature, high, all platforms, overall+settings) with the approved warmth-track mockup and resolved decisions (adaptive single-prompt, NPS-only, 30-day cadence, per-family synced opt-out, auto-opening modal), GitHub SKIP, gate NO, one open question (optimistic vs queued).
- "/beanies-plan prepare the plan for implementation"
- "show me the plan in plan dialog"
- Correction: "make sure this doesn't pop up ON TOP of an additional pop-up … at most there is one … they do not duplicate or layer over each other" → added the single-interruption-per-session coordinator (scope confirmed: full coordinator).

</details>
