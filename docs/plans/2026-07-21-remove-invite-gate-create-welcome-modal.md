# Plan: Remove the invite gate, add a Create-Pod welcome modal + "how did you hear about us" survey

> Date: 2026-07-21
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md`
> Mockups: `docs/mockups/create-pod-welcome-modal-2026-07-21.html` (Part A), `docs/mockups/create-pod-survey-2026-07-21.html` (Part B)

> **Two workstreams in one plan.** **Part A** — remove the invite gate and add the welcome/"what to expect" modal at the _start_ of the Create path. **Part B** — add a brief, skippable "how did you hear about us?" survey near the _end_ of the Create flow, whose answer rides the existing "Family pod created!" Slack notification. Both replace facets of the retired invite gate (its "what's ahead" role and its intent-signal role, respectively) without gating anyone.

## User Story

As a **new visitor** who just tapped "Create a new pod," I want a warm, brief preview of what setup involves and reassurance that my data is private, **instead of** a locked "invite only / we're still building" gate — so I feel welcomed and confident to start, not filtered out.

## Context

The Android app is now live in production (Play Store: Active, 177 countries). beanies.family has moved past the closed-testing / "still building" stage. The invite gate — which blocks the Create path behind an invite code and shows "We're still building! You need an exclusive invite" — now sends the wrong message and strangles the top of the funnel at exactly the moment we need it wide open to learn from real users.

greg's decision (this conversation): **remove the hard gate and replace it with a welcome / "what to expect" modal** (Part A) that previews the three setup steps and calms security worries, **and add a brief "how did you hear about us?" survey** (Part B) near the end of the Create flow. The survey recovers the intent-signal/attribution the gate used to give greg (people had to DM/Discord for a code), but as an optional, skippable question rather than a wall — so it never re-introduces friction that blocks sign-up.

Key design decision, agreed in-conversation: **do not delete the invite-gate infrastructure — retain it behind its existing feature flag, switched off.** The gate is already fully feature-flagged: `features.inviteGate` is `true` only when the env var `VITE_INVITE_BEAN_HASHES` is a non-empty string (`src/config/features.ts:35`). Clearing that one prod variable disables the gate at runtime with zero code deletion, and re-adding it instantly re-gates (e.g. for a future closed cohort or paid beta). Deleting the gate would throw away that optionality for no benefit.

The current post-tap flow is: **Create tap → InviteGateOverlay (blocks) → CreatePodView (identity → storage) → ResumePodSetup (password → finalize → add members) → OnboardingWizard (financial details)**. Part A inserts the welcome modal where the gate is today (first thing on the Create path) and turns the gate into an optional outer layer that only appears when the flag is on. Part B inserts the survey **just before finalize** (after the password, before `createNewFile` writes the pod), so the answer threads into the existing `🎉 Family pod created!` Slack notification (`syncStore.ts:1509`, the "second Slack trigger") as an extra `*Heard via:* …` line — no new webhook, no new Slack message.

**Two Slack triggers in the create flow** (verified): (1) `🫘 New family pod started!` at the identity/sign-up step (`CreatePodView.vue:127`); (2) `🎉 Family pod created!` at the point-of-no-return file write (`syncStore.ts:1509`, inside `createNewFile`). The survey rides **#2**. Because #2 fires before the _optional_ add-members step, the survey is placed just before finalize (not after members) so it can ride the existing trigger without a separate send. (greg's stated placement preference — "end of setup, in the second Slack trigger" — resolves to this slot.)

## Requirements

1. On the Create path (`activeView === 'create'` in `LoginPage.vue`), a new **welcome modal** is shown as the intro before the `CreatePodView` wizard, replacing the invite gate as the default first surface.
2. The welcome modal faithfully implements the approved mockup (`docs/mockups/create-pod-welcome-modal-2026-07-21.html`): warm hero (family-icon mascot + handwritten "welcome home" eyebrow + title), a three-step "growing journey" preview (About you → Your Family Data File → Your family [Optional]), a Sky-Silk security-reassurance strip with a "how your data stays safe" link, a primary CTA ("plant my bean pod"), and a soft hint ("you can change anything later").
3. All modal display copy renders **all-lowercase** via CSS `text-transform: lowercase` — the underlying `t()` strings stay standard-cased (Title/Sentence) so the CI casing rule and screen readers are satisfied. (Same pattern the app already uses for CSS-uppercased section headers.)
4. Primary CTA ("plant my bean pod") **dismisses** the modal and reveals the `CreatePodView` wizard. It does not create anything or advance any wizard step — it is purely an intro.
5. A **cancel affordance** (top-right ✕) returns the user to the Welcome chooser (`activeView = 'welcome'`), mirroring the gate's `@cancel` — the user is never trapped.
6. The invite gate is **retained but flag-gated off by default**. When `features.inviteGate` is true, the gate appears first (unchanged behavior); once passed, the welcome modal appears; then the wizard. When the flag is off (the new prod default), no gate — the welcome modal is the first surface.
7. Prod removes the gate operationally by **clearing the `VITE_INVITE_BEAN_HASHES` deploy variable** — no code deletion.
8. All new user-visible strings go through `t()` with new `createWelcome.*` keys (each with `en` + `beanie`); `zh` is generated via `npm run translate`.
9. The security link opens the existing Help Center article `${MARKETING_URL}/help/security/zero-knowledge-architecture` in a new tab via the shared `openExternal` util.
10. The modal must not break the E2E create-pod journey — provide the same dev-only auto-dismiss seam the gate uses (`e2e_auto_auth`).
11. Diagnostic logging makes the welcome-modal funnel (shown → proceed / cancel, and security-link clicks) triageable and measurable from CloudWatch, reusing only already-allowlisted context keys.

### Part B — "how did you hear about us?" survey

12. A brief **single-question survey** ("how did you hear about us?") is shown **right after the password (identity) step** in the Create flow, before `createNewFile` writes the pod. (On desktop this is immediately before finalize; on the iOS/storage-picker branch, storage selection intervenes between the survey and finalize — the captured answer persists either way.)
13. It is **single-select** across the channel options (reddit, product hunt, substack / blog, google search, app store, chatgpt / ai search, a friend, somewhere else); selecting "somewhere else" reveals a **free-text** input.
14. It is **skippable and never blocks** — a "skip" link completes the flow with no answer, and the primary CTA works whether or not something is selected. Skip and finish are equivalent completion paths.
15. The answer (a stable English channel label, or the free text for "somewhere else") threads into `createNewFile(...)` and is appended to the existing `🎉 Family pod created!` Slack message as a `*Heard via:* …` line. Skipping appends nothing. No new Slack webhook or message.
16. All survey copy goes through `t()` with new `createSurvey.*` keys (`en` + `beanie`; `zh` via `npm run translate`), rendered all-lowercase via CSS (strings stay standard-cased).
17. The survey must not break the E2E create-pod journey — it defaults to a no-answer skip under the dev-only `e2e_auto_auth` seam so the create spec proceeds to finalize unchanged.
18. Diagnostic logging makes the survey funnel (shown → answered / skipped) measurable from CloudWatch, reusing only the already-allowlisted `action` key (the specific channel goes to Slack, greg's attribution sink — not to the firehose).

## Important Notes & Caveats

- **The beanie characters must not be redrawn.** The mockup uses emoji placeholders (🫘 / 🙈); the real build uses the brand PNGs already in `public/brand/`: hero → `beanies_family_icon_transparent_384x384.png`, security strip → `beanies_covering_eyes_transparent_512x512.png`.
- **"3 steps" is a conceptual journey, not literal wizard steps.** The real wizard is 2 steps in `CreatePodView` (identity → storage) then `ResumePodSetup` (password → members). The modal's three steps (About you / Your Family Data File / Your family) describe the user-perceived arc and are intentionally clearer than the literal step count. Do not try to bind them to `currentStep`.
- **Numbered steps are justified** — setup is a genuinely ordered sequence, so the 1/2/3 markers carry real information (per the frontend-design guidance). Step 3 is tagged "optional" because adding members can be skipped.
- **Once per `LoginPage` mount, not per-entry.** The latch is an in-memory `ref` (no `sessionStorage`), exactly mirroring `inviteGateLocked`'s lifecycle: the modal shows the first time the Create path is entered and stays dismissed after the user proceeds (CTA). If the user cancels (✕) without proceeding, it reappears on re-entry (they haven't seen the wizard). A hard route change that remounts `LoginPage` will re-show it — acceptable and consistent with the gate; **do not** add `sessionStorage` persistence (the design never wanted it). This falls out from a single `ref` set to `false` only on proceed.
- **Do not colour a single word of the translated title** (e.g. an orange "pod"). Splitting a sentence for per-word styling breaks i18n word-order. Keep the title one `t()` key; warmth comes from the eyebrow, mascot, and gradient CTA. (Minor, deliberate divergence from the mockup.)
- **Decorative glyphs beside text** (🌱 eyebrow sprout, → link arrow) render as separate `aria-hidden="true"` spans, not inside the translated string — keeps the i18n allowlist clean and avoids bare-string lint.
- **The gate's copy becomes stale-if-reused** ("we're still building"). Not fixed here — if greg ever re-gates for a different reason he'd revise it. Out of scope.
- **The `invite_request_click` Plausible funnel events disappear** with the gate (they only fire from the gate). The survey's attribution (Part B) is the intentional replacement for the gate's intent-signal.
- **Part B — Slack label vs. displayed label.** The user sees localized (`t()`) option labels, but the Slack `*Heard via:*` line must be a **stable English string** (greg reads Slack in English) — so map the selected option **id → a fixed English label** independent of the UI language; for "somewhere else" send the user's free text verbatim. Define the options **once** as a data array (`{ id, labelKey, icon, slackLabel }`) — single source of truth, no parallel lists.
- **Part B — free text goes to Slack only, never to CloudWatch.** The free-text "somewhere else" value is arbitrary user input; it may be posted to Slack (the same intent-signal channel the old invite-request form already used) but must **not** be logged to the telemetry firehose (only `action: 'answered' | 'skipped'` is logged). No PII beyond what the user volunteers; do not add a new context key.
- **Part B — the answer must be captured before `createNewFile` runs.** `createNewFile` (`syncStore.ts:1306`) is the point of no return and fires the second Slack; the survey is therefore captured in the `identity` phase (right after the password — the one node every create path passes through), holds the answer in a `heardVia` ref, and passes it through `finalizePod → createNewFile`. Do **not** reorder the members step or add a second Slack send.
- **Part B is optional-by-design, mirroring the welcome modal's "never trapped" ethos** — the whole point of removing the gate was to stop filtering users, so the survey must never be a soft gate.
- **Ship as two commits/PRs (sequencing).** Part A (welcome modal) touches only `LoginPage.vue` + a new presentational component + i18n — cosmetic, low blast radius, and shippable alone (it's the urgent "remove the gate" piece). Part B touches `ResumePodSetup.vue`'s finalize dispatch **and** `createNewFile`'s point-of-no-return contract — the two most safety-critical files in the create flow. Land **A first, B second** so the risky create-path surgery is reviewable and revertable independently of the modal, and the low-risk gate removal isn't held behind it. (Planning them together is fine; this is a commit/PR-boundary recommendation.)
- **`heardVia` param on `createNewFile` is a mild-but-accepted signature smell.** It mixes marketing attribution into the point-of-no-return write contract (positional args 5→6), but the alternatives are worse (a second Slack send breaks the "one message" constraint; pre-call `syncStore` state adds hidden temporal coupling the function's own comments warn against). One optional trailing param with a single production caller is the correctly-scoped choice. If a second attribution field ever appears, switch to a trailing `meta?: { heardVia?… }` object rather than a 7th positional — not worth churning the positional `createNewFile.test.ts` suite now.

## Assumptions

> **Review these before implementation.** Valid at planning time; may have changed.

1. `VITE_INVITE_BEAN_HASHES` is currently set in the prod deploy (gate ON in prod). Removing the gate in prod = clearing that variable in the deploy config / GitHub repo variables, alongside shipping this code.
2. **CONFIRMED** — `BaseModal.vue:107` gates the header on `title || $slots.header`; passing neither renders no header chrome (just the rounded white panel + the default body slot). With `closable:false`, backdrop-click and Escape are also inert, so the custom hero + custom ✕/CTA are the only chrome and the only exits. No `#header`/inline-overlay fallback needed.
3. **CONFIRMED** — `openExternal(url: string): void` (`src/utils/openExternal.ts:22`, synchronous, PWA-safe anchor-click) and `MARKETING_URL` (plain const, `src/utils/marketing.ts:1`). Import `@/utils/openExternal`, `@/utils/marketing` (precedent: `ActivityViewEditModal.vue:175`).
4. **CONFIRMED** — the Help Center slug `/help/security/zero-knowledge-architecture` exists (`src/content/help/security.ts:299`) and is the best "how your data stays safe" target — a broad privacy overview (nobody, us included, can read your data), not just the encryption mechanics. Same destination as the onboarding privacy link (`OnboardingAccount.vue`).
5. **CONFIRMED reusable** — `PageWelcomeSubtitle.vue:5,9` takes `:text` and renders a single Caveat, Heritage-Orange `<p>` with no baked-in page spacing; drops into a modal fine. It has **no slot**, so the `aria-hidden` 🌱 sprout renders as a **sibling span**, not through `:text` (keeps the glyph out of the translated string). Fixed `text-xl` Caveat — acceptable for the eyebrow.
6. **CONFIRMED none** — grep for `invite.only|exclusive invite|need an invite` across `src/content/help/` is empty; the getting-started "invite link" references are **family-member** invites (a different system, correct as-is). No Help Center edit needed. (Re-grep pre-merge as a cheap guard.)
7. The `action.close` i18n key exists (`uiStrings.ts:1210`, used by the gate) and is reusable for the ✕ aria-label. The step-3 "optional" tag reuses `onboarding.invite.optional` (`uiStrings.ts:6444`, `{en:'Optional',beanie:'optional'}`) — no new key.
8. **(Part B) RESOLVED — corrected insertion point.** There is **no single "just before `finishOnDrive`" chokepoint**: on desktop, finalize is reached without ever entering `storage`/`finishOnDrive`. `createNewFile` has exactly one caller — `finalizePod()` (`ResumePodSetup.vue:438`, calls `createNewFile` at `:450`) — itself reached from **four** call sites (`handleIdentityNext:389`, `finishOnDrive:565`/`:616`, `handleConnectLocal:695`; `handleConnectDrive` reaches it indirectly via `finishOnDrive`). The **one node every create path passes through is the `identity` phase** (password collected + validated there, `handleIdentityNext:364`; auto-load is for existing pods and never creates). So: capture `heardVia` in a component `ref<string|null>(null)`; enter `phase.value = 'survey'` in `handleIdentityNext` right after `rehydrateOwnerDoc` succeeds (`:369`); the survey's `@complete(payload)` sets `heardVia.value = payload` then calls the finalize dispatch; `finalizePod()` passes `heardVia.value` into `createNewFile` so **all five sites thread it with zero duplication**. Acceptable consequence: on the iOS/storage-picker branch the survey renders after password but before storage selection (the ref persists to the later `finalizePod`).
9. **(Part B) CONFIRMED** — `createNewFile(_podFileName, password, memberId, familyId, familyName)` (`syncStore.ts:1306`) is the single site that fires the second Slack (`:1509`); the only production caller is `ResumePodSetup.vue:450` (other `createNewFile(` hits are positional-arg tests in `createNewFile.test.ts`). An optional trailing `heardVia?: string | null` is safe; append `*Heard via:*` only when present.
10. **(Part B) RESOLVED** — (a) `action.skip` does **not** exist; reuse `onboarding.skip` (`uiStrings.ts:6477`, "Skip for now") — do not add a `createSurvey.skip` key. (b) **No** existing component fits an 8-option, 2-col, icon-tile single-select with a free-text "other" (`TogglePillGroup` is a 2–4-option inline segmented control; `EmojiPicker`'s model is the glyph itself; `FamilyChipPicker`/`GroupedChipPicker` are member/two-level pickers). Hand-rolling the grid **in `CreatePodSurvey.vue` is justified** (single use — extraction is premature), but **reuse existing style tokens**: the `rounded-[14px]` + `bg-[var(--tint-slate-5)]` tile shell and the selected `from-primary-500 to-terracotta-400` gradient from `TogglePillGroup.vue:27,35`, plus `EmojiPicker`'s grid+label button pattern. Do not invent new tile styling.

## Approach

### 1. New component — `src/components/login/CreatePodWelcome.vue`

A presentational intro modal built on the existing modal system (DRY — the CIG says never build modals from scratch).

- **Shell:** `BaseModal` (Tier 1), `:open="true"`, `:closable="false"` (we own both actions explicitly; backdrop/Escape are inert — see below). Renders no header (verified `BaseModal.vue:107`); all content goes in the default slot. **Size:** the content (hero + 3-step journey + security strip + CTA + hint) is dense — use `size="md"` (`max-w-md`, 448px) rather than `sm` (384px); confirm against the mockup before building.
- **Dismissal semantics:** with `closable:false`, Escape and backdrop-click do nothing — the only exits are the ✕ (→ `cancel`) and the CTA (→ `dismiss`). This is deliberate and matches the gate; the "never trapped" guarantee (Requirement 5) holds via the always-visible ✕. (If native Esc-to-close parity is later wanted, add a keydown→`cancel` handler; not required now.) `size="md"` is already `BaseModal`'s default (`BaseModal.vue:27`) — passed explicitly for legibility, not to override.
- **Accessibility — known limitation (accepted, out of scope).** `BaseModal` sets `role="dialog"` + `aria-modal="true"` (`BaseModal.vue:95-96`) but has **no focus trap** (`useFullscreenOverlay.ts:24` lists trap/inert as future hardening). Since `CreatePodView` stays mounted behind the backdrop, a keyboard user can Tab off the ✕/CTA into the form behind. This is an **app-wide `BaseModal` limitation shared by every modal** — a bespoke trap here would be inconsistent scope-creep, so accept it as consistent and out of scope. Do not assume a trap exists. (Pointer users are fully served by the always-visible ✕.)
- **Emits:** `dismiss` (CTA — proceed into the wizard) and `cancel` (✕ — back to the chooser). Two explicit intents, no ambiguous single "close."
- **Content (from the approved mockup, CIG-clamped):**
  - Hero: `<img>` of `beanies_family_icon_transparent_384x384.png` (~76px, `:alt="t('login.beaniesFamilyIconAlt')"`); the "welcome home" eyebrow via reused `PageWelcomeSubtitle` (or a local Caveat span per Assumption 5) with an `aria-hidden` 🌱; title `t('createWelcome.title')`; subtitle `t('createWelcome.subtitle')`.
  - Journey: three steps, each a squircle icon node (`rounded-[14px]`, tinted bg per CIG — orange-8 / silk-20 / success-10), a slate numbered pip, an Outfit title and Inter body. A dashed Sky-Silk "vine" connects them. The staggered rise-in is **pure CSS** — a keyframe `animation` + per-step `animation-delay` (or `transition-delay`), with **no** JS timers, `setTimeout`, mounted-driven refs, or per-step reactive state (keeps the component zero-logic-besides-emits). `@media (prefers-reduced-motion: reduce)` **removes** the animation entirely (not merely shortens it).
  - Security strip: Sky-Silk-10 tinted `rounded-2xl` row with `beanies_covering_eyes_transparent_512x512.png` (~40px, decorative `alt=""` `aria-hidden`), `t('createWelcome.safeText')`, and a link ("how your data stays safe" + `aria-hidden` → arrow) that calls `openSafetyHelp()`.
  - CTA: full-width Heritage-Orange→Terracotta gradient button, `rounded-2xl`, `t('createWelcome.cta')` ("plant my bean pod") → emits `dismiss`. Hint below: `t('createWelcome.ctaHint')`.
  - ✕: custom top-right button, `:aria-label="t('action.close')"`, emits `cancel`.
- **All-lowercase display:** a single `text-transform: lowercase` on the modal root (scoped, rem-safe — no font-size change). Underlying strings stay standard-cased.
- **`openSafetyHelp()`:** `openExternal` is `void` and gives no success/failure signal, so emit the `help_click` funnel event **unconditionally** (do not hang it off a return value or a success branch). Call `openExternal(\`${MARKETING_URL}/help/security/zero-knowledge-architecture\`)`inside a`try/catch`as cheap defense-in-depth — on a DOM exception,`reportError({ surface: 'create-welcome', severity: 'warning', message: 'safety help link failed', error })`. Note: with a compile-time-constant URL this catch is effectively unreachable (`openExternal.ts`only`console.error`s on an empty URL), so it's insurance, not a real branch — do **not** build a user-facing error surface for it; the link is informational.
- **E2E seam:** `onMounted` — if `import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true'`, `emit('dismiss')` **directly** (mirrors `InviteGateOverlay.vue:81` emitting `unlocked`) — _not_ routed through the CTA handler, so auto-dismisses inject no fake `proceed` conversions into the funnel telemetry. Note: unlike the gate's plain overlay, `BaseModal` has a `duration-200` leave transition (`BaseModal.vue:85-91`), so the backdrop lingers ~200ms after dismiss; Playwright's actionability auto-wait absorbs this — do **not** paper over a perceived race with a hard-coded `waitForTimeout`.
- **Reduced motion:** the vine/step animations are decorative; disable them under `prefers-reduced-motion: reduce`.

### 2. Wire into `src/pages/LoginPage.vue`

Replace the create block (currently 697-711):

```vue
<div v-else-if="activeView === 'create'" class="relative">
  <div :class="{ 'pointer-events-none blur-[0.1px]': inviteGateLocked }">
    <CreatePodView
      @back="activeView = 'welcome'"
      @signed-in="handleSignedIn"
      @navigate="handleNavigate"
      @finish-storage="handleFinishStorage"
    />
  </div>
  <!-- Optional invite gate: retained, flag-gated (off in prod). Unchanged. -->
  <InviteGateOverlay
    v-if="inviteGateLocked"
    @unlocked="inviteGateLocked = false"
    @cancel="activeView = 'welcome'"
  />
  <!-- New welcome intro: shown once the gate (if any) is passed. -->
  <CreatePodWelcome
    v-else-if="showCreateWelcome"
    @dismiss="showCreateWelcome = false"
    @cancel="activeView = 'welcome'"
  />
</div>
```

- Add `const showCreateWelcome = ref(true);` **co-located immediately under** `inviteGateLocked` (`~line 87`), with a shared comment making the precedence invariant explicit (the ordering is the _only_ thing preventing gate + welcome both showing, and today it lives solely in template `v-else-if` order):

  ```ts
  // Two mutually-exclusive create-path overlays over the always-mounted CreatePodView.
  // Precedence is encoded by v-if/v-else-if order below: the invite gate (only when
  // flagged on) OUTRANKS the welcome intro. Two independent once-per-mount latches:
  //  - inviteGateLocked: starts features.inviteGate; latched false on unlock.
  //  - showCreateWelcome: starts true; latched false ONLY on proceed (✕/cancel leaves
  //    it true so the intro re-shows on re-entry, since they haven't seen the wizard).
  const inviteGateLocked = ref(features.inviteGate);
  const showCreateWelcome = ref(true);
  ```

- **Contain the retained-but-off gate with a signpost.** Add a one-line comment at both the `inviteGateLocked` wiring and `features.inviteGate` (`features.ts:35`): _"Invite gate intentionally retained, flag-gated off in prod (VITE_INVITE_BEAN_HASHES cleared) — see docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md. NOT dead code: re-adding the env var re-gates. To fully remove: delete this + InviteGateOverlay/InviteDiscordButton/inviteToken.ts + the inviteGate._ strings."* This stops a future "remove dead code" sweep from either ripping out working optionality or re-deriving intent.
- `v-else-if` ordering guarantees: gate on → gate first, then welcome after unlock; gate off → welcome immediately. No manual blur needed for the welcome modal (BaseModal owns its backdrop); the existing blur binding stays scoped to `inviteGateLocked` only.
- Import `CreatePodWelcome`; the `InviteGateOverlay` import and `inviteGateLocked` ref stay.
- **Alternative considered — rejected.** Extracting gate+welcome+wizard into a dedicated `CreatePodFlow.vue` so `LoginPage` renders one child and owns neither latch. Rejected: (i) the gate is being retired, so building new orchestration around a dying surface is inverted investment; (ii) it would force forwarding four wizard events (`@signed-in`/`@navigate`/`@finish-storage`/`@back`) through an extra indirection layer; (iii) with the co-located precedence comment above, the inline form is already legible. Revisit only if a third create-path surface appears.

### 3. i18n — `src/services/translation/uiStrings.ts`

Add a `createWelcome.*` block (near the retained `inviteGate.*` block, ~6293). Every key gets `en` + `beanie`; run `npm run translate` to populate `zh`, then spot-check the zh output. Keys (final copy from the approved mockup; `en` standard-cased, `beanie` lowercase):

| Key                        | en                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `createWelcome.eyebrow`    | Welcome home                                                                                    |
| `createWelcome.title`      | Let's grow your family pod                                                                      |
| `createWelcome.subtitle`   | Three quick steps to your private family space — just a couple of minutes. Here's what's ahead. |
| `createWelcome.step1Title` | About you                                                                                       |
| `createWelcome.step1Body`  | Your name and a couple of details to set up your space.                                         |
| `createWelcome.step2Title` | Your Family Data File                                                                           |
| `createWelcome.step2Body`  | We create your private, encrypted file — the safe home for your family's data.                  |
| `createWelcome.step3Title` | Your family                                                                                     |
| `createWelcome.step3Body`  | Add your partner or little beanies whenever you're ready.                                       |
| `createWelcome.safeText`   | Your data is encrypted on your device and stored in a file only you can open — we never see it. |
| `createWelcome.safeLink`   | How your data stays safe                                                                        |
| `createWelcome.cta`        | Plant my bean pod                                                                               |
| `createWelcome.ctaHint`    | You can change anything later.                                                                  |

The step-3 "optional" badge reuses the existing `onboarding.invite.optional` key (`uiStrings.ts:6444`) — **do not add a `createWelcome.optional` key** (DRY).

Also add the `createSurvey.*` block (Part B):

| Key                             | en                                                            |
| ------------------------------- | ------------------------------------------------------------- |
| `createSurvey.eyebrow`          | One last thing                                                |
| `createSurvey.title`            | How did you hear about us?                                    |
| `createSurvey.subtitle`         | It helps us reach more families like yours. Totally optional. |
| `createSurvey.optReddit`        | Reddit                                                        |
| `createSurvey.optProductHunt`   | Product Hunt                                                  |
| `createSurvey.optSubstack`      | Substack / blog                                               |
| `createSurvey.optGoogle`        | Google search                                                 |
| `createSurvey.optAppStore`      | App store                                                     |
| `createSurvey.optAi`            | ChatGPT / AI search                                           |
| `createSurvey.optFriend`        | A friend                                                      |
| `createSurvey.optOther`         | Somewhere else                                                |
| `createSurvey.otherPlaceholder` | Tell us where…                                                |
| `createSurvey.cta`              | Finish setup                                                  |

The "skip" link reuses the existing `onboarding.skip` key (`uiStrings.ts:6477`, "Skip for now") — **do not add a `createSurvey.skip` key** (DRY, Assumption 10).

Proper-noun channel labels (Reddit, Product Hunt, Substack, Google, ChatGPT) are brand names — keep them as-is in `beanie`/`zh` (don't translate the proper noun; only surrounding words localize).

Verify `scripts/updateTranslations.mjs` parses the new block (it's a standard flat-key addition, so no parser change expected — but run `npm run translate` to confirm per the CLAUDE.md translation-sync rule).

### 4. Prod ops — disable the gate

Clear `VITE_INVITE_BEAN_HASHES` in the prod deploy configuration (GitHub repo variable consumed by `deploy.yml`), so `features.inviteGate` is false in the shipped bundle. Document this as a required release step — the code change alone leaves the gate available; the variable clear is what removes it from prod. (Staging/preview can keep or clear it independently.)

> **§§1–4 above are Part A (welcome modal). §§5–7 below are Part B (survey).**

### 5. New component — `src/components/login/CreatePodSurvey.vue`

A presentational, single-question step (from the approved `create-pod-survey-2026-07-21.html` mockup, CIG-clamped).

- **Options as a single data array** (co-located const, the single source of truth — no parallel lists):

  ```ts
  // id → localized label (labelKey) + emoji + STABLE English Slack label.
  const HEARD_OPTIONS = [
    { id: 'reddit', labelKey: 'createSurvey.optReddit', icon: '👽', slackLabel: 'Reddit' },
    {
      id: 'product_hunt',
      labelKey: 'createSurvey.optProductHunt',
      icon: '🚀',
      slackLabel: 'Product Hunt',
    },
    {
      id: 'substack',
      labelKey: 'createSurvey.optSubstack',
      icon: '📮',
      slackLabel: 'Substack / blog',
    },
    { id: 'google', labelKey: 'createSurvey.optGoogle', icon: '🔍', slackLabel: 'Google search' },
    { id: 'app_store', labelKey: 'createSurvey.optAppStore', icon: '📱', slackLabel: 'App store' },
    { id: 'ai', labelKey: 'createSurvey.optAi', icon: '🤖', slackLabel: 'ChatGPT / AI search' },
    { id: 'friend', labelKey: 'createSurvey.optFriend', icon: '👋', slackLabel: 'A friend' },
    { id: 'other', labelKey: 'createSurvey.optOther', icon: '✨', slackLabel: null }, // free-text
  ] as const;
  ```

- **UI:** warm card matching the login surface (`rounded-3xl` white card on `LoginBackground`), a Caveat "one last thing" eyebrow (reuse `PageWelcomeSubtitle`), title + subtitle, a 2-col grid of squircle single-select tiles, and — when `other` is selected — a free-text input. Primary CTA ("finish setup") + a subtle "skip" (reuse the `onboarding.skip` key, Assumption 10). All-lowercase via CSS; strings standard-cased. No existing tile component fits (Assumption 10), so the grid is local — but **reuse style tokens**: the `rounded-[14px]` + `bg-[var(--tint-slate-5)]` shell and selected `from-primary-500 to-terracotta-400` gradient from `TogglePillGroup.vue:27,35`, and `EmojiPicker`'s grid+label button pattern. Do not invent new tile styling.
- **Contract:** `emit('complete', payload)` where `payload` resolves to the **Slack string** or `null`:
  - a fixed option selected → its `slackLabel`;
  - `other` + non-empty free text → the trimmed free text (Slack only, never firehose);
  - `other` + empty text, or **skip**, or CTA with nothing selected → `null` (no `*Heard via:*` line).
    The host passes the resolved string straight into `createNewFile`. Keeping the resolution inside the component means the host and `syncStore` never see raw ids/free-text logic.
- **Telemetry:** `onMounted` → `logEvent({ surface: 'create-survey', message: 'shown', context: { action: 'shown' } })`; on complete → `action: 'answered'` (a channel was chosen) or `action: 'skipped'` (null). **The specific channel and any free text are NOT put in `context`** — they go only to Slack. No new context key.
- **E2E seam:** `onMounted` — if `import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true'`, `emit('complete', null)` directly (skip), so the create spec proceeds to finalize unchanged and injects no fake `answered` telemetry. Mirrors the welcome-modal seam. `ResumePodSetup` has **no** existing `e2e_auto_auth` seam — the new `survey` phase inserts the only stop, so this component-level auto-skip is what keeps the create spec green (it passes through `identity`, so the survey mounts and auto-skips).
- **Error safety (concrete mechanism — the "degrade to skip" guarantee):** a child render error is _not_ catchable by a parent `try/catch`, so implement it two ways: (i) inside `CreatePodSurvey.vue`, wrap the `onMounted` telemetry and the payload-resolution logic in `try/catch` and `emit('complete', null)` on error; (ii) belt-and-braces, add `onErrorCaptured` on the `survey` render in `ResumePodSetup.vue` to fall through to the finalize dispatch with `heardVia = null`. A broken survey must never be able to stop a pod from being created.
- **DRY note (judgment call):** the `e2e_auto_auth` seam + `shown` telemetry are now identical in `CreatePodWelcome` and `CreatePodSurvey`. A 3-line `useE2eAutoDismiss(cb)` composable would remove the duplication; at two call sites the value is marginal — extract only if a third such surface appears (avoid premature abstraction).

### 6. Wire the survey into `ResumePodSetup.vue` (Assumption 8)

Per Assumption 8, `createNewFile`'s single caller is `finalizePod()` (`:450`), reached from four call sites; the universal pre-finalize node is the `identity` phase. So: add a `heardVia = ref<string|null>(null)` to `ResumePodSetup`; in `handleIdentityNext`, after `rehydrateOwnerDoc` succeeds (`:369`), set `phase.value = 'survey'` **instead of** dispatching straight to finalize. The survey's `@complete(payload)` sets `heardVia.value = payload` then calls `proceedToFinalize()`. `finalizePod()` passes `heardVia.value` into `createNewFile`, so every finalize path threads it with **zero duplication**. The survey is presentational; `ResumePodSetup` owns the one-line state + transition + `onErrorCaptured` fall-through. No new store state.

**⚠️ Critical — `proceedToFinalize()` must reconstitute the full safety envelope, not lift a fragment.** The `:387–421` finalize dispatch currently runs _inside_ `handleIdentityNext`'s protective wrapper: the `busy.value = true` latch (`:367`), the `try/catch` that reports + sets `phase = 'storage'` on failure (`:421–430`), and the `finally` that clears `busy` + repairs a stuck `finishing` phase (`:431–434`). The survey's `@complete` fires on a **later tick after an indefinite user pause**, so if `proceedToFinalize()` is the bare inner fan-out, the point-of-no-return dispatch would run with no busy latch, no try/catch, and no repair — a reliability regression on the app's most safety-critical path. Specify `proceedToFinalize()` as a **peer of `handleConnectDrive` (`:643`) / `handleConnectLocal` (`:669`)** — which already model the exact shape: `if (busy) return; busy = true; phase = 'finishing'; try { …dispatch… } catch { reportError; phase = 'storage' } finally { busy = false; repair }`. `handleIdentityNext` sets `phase = 'survey'` and returns; the survey drives `proceedToFinalize()` with its own complete envelope. Net result is a genuine improvement: three sibling finalize entry points with one identical error-handling shape.

**Keep the phase machine's self-documentation true.** Adding `survey` obligates four edits so the file stays supportable: the phase-reachability table in the header comment (`:44–58`, create row → `… → identity → survey → (storage | connected) → finishing`), the `Phase` doc comment (`:96–103`), the `Phase` union type (`:104`), and reconciling the footer's `v-if="phase !== 'finishing' && phase !== 'members'"` gate (`:880`) with the new `survey` render branch. Stale invariant docs on this surface are exactly how a future phase-reachability bug gets introduced.

### 7. Thread the answer into the second Slack (Assumption 9) — `src/stores/syncStore.ts`

Extend `createNewFile(_podFileName, password, memberId, familyId, familyName, heardVia?: string | null)`. In the success block (`:1509`), append `${heardVia ? \`\n*Heard via:* ${heardVia}\` : ''}`to the existing`🎉 Family pod created!`text. The param is optional and trailing, so the second create caller passes it and every other caller/test is unaffected. No new webhook; the`slackNotify`fire-and-forget contract (already non-silent — warns on failure,`slackNotify.ts`) is unchanged.

## Files Affected

**Part A (welcome modal):**

- **New:** `src/components/login/CreatePodWelcome.vue` — the welcome/intro modal.
- **New:** `src/components/login/__tests__/CreatePodWelcome.test.ts` — component tests.
- **Modify:** `src/pages/LoginPage.vue` — create-block wiring + `showCreateWelcome` ref + import.
- **Modify:** `src/services/translation/uiStrings.ts` — add `createWelcome.*` (en + beanie); `zh` via `npm run translate`.
- **Ops (no code):** clear `VITE_INVITE_BEAN_HASHES` prod deploy variable.

**Part B (survey):**

- **New:** `src/components/login/CreatePodSurvey.vue` — the single-question survey step + `HEARD_OPTIONS` data.
- **New:** `src/components/login/__tests__/CreatePodSurvey.test.ts` — component tests.
- **Modify:** `src/components/login/ResumePodSetup.vue` — add the `survey` phase (+ `Phase` type, phase-reachability header comment, `Phase` doc comment, footer `v-if` gate); `heardVia` ref; extract `proceedToFinalize()` with the full busy/try-catch/finally envelope; `onErrorCaptured` fall-through; pass `heardVia` to `finalizePod → createNewFile`.
- **Modify:** `src/stores/syncStore.ts` — `createNewFile` gains an optional `heardVia` param appended to the `🎉 Family pod created!` Slack line.
- **Modify:** `src/services/translation/uiStrings.ts` — add `createSurvey.*` (same file as Part A).

**Shared:**

- **Retained, unchanged:** `InviteGateOverlay.vue`, `InviteDiscordButton.vue`, `src/utils/inviteToken.ts`, `src/config/features.ts`, and the gate tests — all kept, flag-gated off.
- **Reuse (no change):** `BaseModal.vue`, `PageWelcomeSubtitle.vue`, `LoginBackground`, `openExternal` (`@/utils/openExternal`), `MARKETING_URL` (`@/utils/marketing`), `slackNotify` (`@/utils/slackNotify`), `logEvent`/`reportError` (import `logEvent` from `@/services/telemetry`, not the `logEvent.ts` file), `onboarding.invite.optional` + `action.close` + `login.beaniesFamilyIconAlt` (`uiStrings.ts:8057`) i18n keys, existing brand PNGs in `public/brand/`, and any reusable single-select tile component (Assumption 10).
- **Approved mockups (record):** `docs/mockups/create-pod-welcome-modal-2026-07-21.html`, `docs/mockups/create-pod-survey-2026-07-21.html`.

## Help Center Coverage

The welcome modal is a self-explanatory intro screen and needs no new article. Two verification items only:

- **Action:** `verify / update existing`
- **Category:** `getting-started`
- **Scope:** Grep the Help Center for any copy stating the app itself is "invite only" / requires an invite to access (distinct from the family-member invite-link flow, which is correct and stays). **Verified at plan time: none found** (grep `invite.only|exclusive invite|need an invite` over `src/content/help/` is empty) — no article work. Re-grep pre-merge as a cheap guard; if one appears, update it to reflect open sign-up.
- **Notes:** The security link target (`/help/security/zero-knowledge-architecture`) already exists — no article work, just confirm the slug resolves.

## Observability Coverage

Surface: **`create-welcome`** (kebab-case, greppable). Reuses only the already-allowlisted `action` context key (`diagnosticContext.ts:68`) — **no new `ALLOWED_CONTEXT_KEYS`, no privacy-manifest / store-declaration churn.** Import `logEvent` from `@/services/telemetry` (`index.ts:12`), not the `logEvent.ts` file directly.

- **Events (via `logEvent`, level `info`):**
  - `{ surface: 'create-welcome', message: 'shown', context: { action: 'shown' } }` — emitted `onMounted` (success/exposure signal; lets us measure how many reach the welcome modal — the top of the create funnel).
  - `…context: { action: 'proceed' }` — on CTA dismiss (the conversion signal: welcome → wizard).
  - `…context: { action: 'cancel' }` — on ✕ (bounce signal).
  - `…context: { action: 'help_click' }` — on the security-link tap (measures whether the reassurance link is used).
  - Emitting both `proceed` and `cancel` (not just failure) makes the **proceed rate** measurable for future alerting/funnel analysis — directly replacing the visibility lost when the gate's `invite_request_click` Plausible events go away.
- **Failure modes covered:** the only failure path is `openSafetyHelp()` (external-link open). Wrapped in try/catch → `reportError({ surface: 'create-welcome', severity: 'warning', message: 'safety help link failed', error })` (firehose + console, no Slack page, no user block — it's informational). No bare `catch {}`. No data-at-risk path exists in this modal, so **no `severity: 'critical'`**.
- **Analytics note:** removing the gate drops the `invite_request_click` Plausible funnel events; the `create-welcome` `action` telemetry above is the replacement funnel signal.

Surface: **`create-survey`** (Part B). Same allowlisted `action`-only pattern — no new context key.

- **Events (via `logEvent`, level `info`):**
  - `{ surface: 'create-survey', message: 'shown', context: { action: 'shown' } }` — `onMounted` (exposure signal — how many reach the survey).
  - `…context: { action: 'answered' }` — a channel was chosen (measures answer rate).
  - `…context: { action: 'skipped' }` — skip / empty completion.
  - Emitting both `answered` and `skipped` makes the **answer rate** measurable. **The chosen channel and any free text are NEVER in `context`** — they go only to the Slack `*Heard via:*` line (greg's attribution sink); logging them would need a new allowlisted key + privacy-manifest churn, which we deliberately avoid.
- **Failure modes covered:** the survey has no failing path of its own; the Slack send reuses `slackNotify`'s fire-and-forget contract, which already `console.warn`s on failure (not silent). If the survey throws, it **degrades to skip** — implemented concretely (a child render error isn't catchable by a parent `try/catch`): `try/catch` around the survey's `onMounted` + payload resolution → `emit('complete', null)`, plus `onErrorCaptured` on the `survey` render in `ResumePodSetup` → finalize with `heardVia = null`. A survey must never be able to stop a family from being created.

## Acceptance Criteria

- [ ] Tapping "Create a new pod" with the gate off shows the welcome modal (not the invite gate) as the first surface, matching the approved mockup on desktop + mobile, light + dark.
- [ ] All modal copy renders lowercase; DevTools shows the underlying strings standard-cased; `npm run lint` (casing rule) passes.
- [ ] "plant my bean pod" dismisses the modal and reveals the `CreatePodView` wizard; nothing is created and no wizard step is skipped.
- [ ] ✕ returns to the Welcome chooser; re-entering Create re-shows the modal (until proceeded), then goes straight to the wizard after a proceed.
- [ ] Setting `VITE_INVITE_BEAN_HASHES` locally re-enables the gate; gate → unlock → welcome modal → wizard all work in order.
- [ ] Security link opens `/help/security/zero-knowledge-architecture` in a new tab; a failure logs a `warning` (no crash, no Slack page).
- [ ] All strings are `t()`-keyed with `en` + `beanie`; `npm run translate` populates `zh`; zh spot-checked.
- [ ] Reduced-motion disables the step/vine animation.
- [ ] E2E create-pod journey passes (auto-dismiss seam works under `e2e_auto_auth`).
- [ ] Help Center grep done; any "invite-only access" copy corrected (or confirmed none).
- [ ] Diagnostic events (`create-welcome`: shown/proceed/cancel/help_click) fire with the stated `context`; funnel is triageable from CloudWatch without a local repro; no new context key shipped.
- [ ] **(Part B)** The survey appears right after the password (identity) step; single-select; "somewhere else" reveals free-text; matches the mockup (desktop + mobile, light + dark).
- [ ] **(Part B)** When `createNewFile` fails on the survey-driven `proceedToFinalize()` path, the phase returns to `storage`/`retry` and `busy` clears (the full envelope is preserved — same recovery as the connect-handler paths).
- [ ] **(Part B)** Selecting a channel and finishing adds a `*Heard via:* <label>` line to the `🎉 Family pod created!` Slack; skipping (or empty) adds no line and does not block finalize.
- [ ] **(Part B)** The Slack label is stable English regardless of UI language; free text is passed verbatim to Slack and never to CloudWatch.
- [ ] **(Part B)** A thrown error in the survey degrades to skip and still creates the pod (survey never blocks creation).
- [ ] **(Part B)** `create-survey` events (shown/answered/skipped) fire with only the `action` key; no channel/free-text in `context`.
- [ ] **(Part B)** E2E create-pod spec passes (survey auto-skips under `e2e_auto_auth`).
- [ ] `npm run type-check`, `npm run lint`, `npm run build`, full test suite green.

## Testing Plan

1. **Unit (`CreatePodWelcome.test.ts`):** renders hero/steps/security/CTA; CTA emits `dismiss`; ✕ emits `cancel`; `openSafetyHelp` success calls `openExternal` with the correct URL and logs `help_click`; `openSafetyHelp` failure logs a `warning` and does not throw; `onMounted` logs `shown`; `e2e_auto_auth` auto-dismiss seam fires in DEV.
2. **Wiring (LoginPage):** gate-off → welcome shows first; gate-on → gate first then welcome after unlock; `dismiss` reveals wizard; `cancel` returns to welcome and re-entry re-shows (until proceed).
3. **Manual, gate off (`npm run dev`):** walk Create → welcome → proceed → full create/setup completes; dark mode + mobile widths; security link; reduced-motion (OS setting); lowercase rendering.
4. **Manual, gate on:** set `VITE_INVITE_BEAN_HASHES` → confirm gate → unlock → welcome → wizard order intact.
5. **i18n:** switch to beanie mode and zh; confirm all welcome + survey copy localized, no bare English, no console i18n warnings; proper-noun channel labels stay untranslated.
6. **Unit (`CreatePodSurvey.test.ts`):** single-select behaviour; "other" reveals free-text; `complete` resolves the correct Slack string for a fixed option / free text / empty-other / skip / nothing-selected (null in the last three); `shown`/`answered`/`skipped` telemetry with only `action`; no channel/free-text in `context`; `e2e_auto_auth` auto-skip.
7. **Survey wiring + Slack:** `heardVia` reaches `createNewFile`; the `🎉 Family pod created!` text gains the `*Heard via:*` line when present and omits it when null; a thrown survey error degrades to skip and still creates the pod; **and the inverse — a `createNewFile` failure on the survey-driven `proceedToFinalize()` path recovers via the full envelope (phase → `storage`/`retry`, `busy` cleared)**, matching the connect-handler behaviour.
8. **E2E:** run the create-pod spec (Chromium) — green with the welcome auto-dismiss and survey auto-skip seams. Log any change in `docs/E2E_HEALTH.md` per ADR-007.
9. **Build gates:** `npm run type-check`, `npm run lint`, `npm run build`, `npm run translate`, full unit suite.

## Review Passes

> **Round 1** covered Part A only (welcome modal). **Round 2** re-ran passes 2–4 on the combined plan after Part B (survey) was folded in — a substantial edit per the skill's re-run rule.

- **Pass 1 (Initial draft):** Drafted Part A from the approved welcome mockup, then folded in Part B (survey) from its approved mockup — new `CreatePodSurvey.vue` before finalize, `heardVia` threaded through `ResumePodSetup → createNewFile` onto the second Slack, `createSurvey.*` i18n, `create-survey` observability (action-only), skippable-never-blocks.
- **Pass 2 (DRY + error handling):** _R1:_ verified all Part-A assumptions in code; removed a duplicate `createWelcome.optional` key (reuse `onboarding.invite.optional`); right-sized `openSafetyHelp` error handling; `size="md"`; fixed `logEvent` import; documented inert-Escape. _R2 (combined):_ corrected the survey insertion point (no `finishOnDrive` chokepoint → capture in `identity`, thread via the single `finalizePod()` caller with zero duplication); confirmed `createNewFile` signature extension is safe; dropped a duplicate `createSurvey.skip` (reuse `onboarding.skip`); confirmed no reusable tile component exists but pinned survey styling to `TogglePillGroup`/`EmojiPicker` tokens; made "degrade to skip" concrete (`try/catch` + `onErrorCaptured`, since child errors escape parent try/catch); noted the marginal `useE2eAutoDismiss` DRY option.
- **Pass 3 (Sustainability):** _R1:_ self-documented the two-latch precedence; signposted the retained gate; pinned animation to pure CSS; recorded the rejected `CreatePodFlow` extraction; tightened "once per `LoginPage` mount." _R2 (combined):_ required `proceedToFinalize()` to reconstitute the full busy/try-catch/finally envelope (as a peer of the connect handlers) rather than lift a fragment — closing a point-of-no-return regression on the later-tick survey callback; listed the four phase-machine self-doc edits the new `survey` phase obligates; recommended a two-commit split (cosmetic Part A first, safety-critical Part B second); confirmed the `heardVia` param is the correctly-scoped choice with a `meta`-object escape hatch noted.
- **Pass 4 (Fresh-eyes sweep):** _R1:_ confirmed internal consistency; focus-trap note; added `login.beaniesFamilyIconAlt`; direct-`dismiss` E2E seam; flagged the 200ms leave transition. _R2 (combined):_ fixed a stale `finishOnDrive → createNewFile` caveat (corrected to `finalizePod`, captured in `identity`); corrected the "five sites" count to four; reworded Requirement 12/AC to "right after the password step" with the iOS-branch caveat (matching Assumption 8); added AC + test coverage for the inverse safety case (finalize failing on the survey-driven path recovers via the full envelope). Plan confirmed implementation-ready.

## Prompt Log

> No GitHub issue created — this plan is for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial context (earlier this session)

greg confirmed the Android app is fully live in production (Play Console: Active, latest release beanies.family 12 / 0.9.5, 177 countries, 1 install) and raised removing the invite gate during onboarding — keeping intent-signal friction was appealing, but the "we're still building" message is no longer right. Proposed replacing the gate screen with a brief onboarding preview (what to expect: basic details → create family file → provide family info + a "why it's safe" link) and a "how did you hear about us" survey in place of the gate. Asked for my thoughts, noting he was back and forth on removing the friction.

### /beanies-plan invocation

> prepare a plan to remove the gate. As you proposed I agree we can add the survey question later. I'm thinking to add it at the end of the setup process dring the family creation part, since then we can include it in the second slack message trigger. we could also add it at the end fo the onboarding, where we already ask the user to join discord. what are your thoughts?
>
> /frontend-design:frontend-design can you prepare a mockup and proposal for the new welcome message / modal as per my thoughts above. the modal should be very invitiging, welcoming, and engaging, and the main purpose is to give users an idea of what to expect in the upcomgin setup process and assuage their worries about security. it should be kept extremely brief but still clearly show the user what is coming up in a fun and clear way

### Mockup approval + tweaks

> Design is good, just a slight copy tweak for step 3 - rather than "add your beans whenever you're ready" -> "add your partner or little beanies whenever you're ready..." and you can remove "or just straight in" - also be sure to keep to the theme as all words should be lower case.
> (Step detail: Keep 3 steps with descriptions. CTA: "plant my bean pod".)

### Scope confirmation

> keep them separate, finish the invite-gate plan first use /beanies-plan to plan
> (Re: adding the Google Play badge to the homepage — agreed to keep that as a separate task, done after this plan.)

### Survey folded in (Part B added)

> pls include the how did you hear about us survey question in the plan also as per the proposal above. you can prepare a mockup firat

Survey placement rationale (agreed): **end of family creation, tied to the second Slack trigger** — the universal completion event (onboarding is skippable), consolidates into one Slack notification, captures freshest attribution. Kept separate from the end-of-onboarding Discord ask. I built the survey mockup (`docs/mockups/create-pod-survey-2026-07-21.html`); greg confirmed behaviour and one content change:

> For the survey, replace discord with "chatgpt / ai search". [Behaviour:] Keep it skippable, Single-select, Free-text 'somewhere else'.

Placement resolved to **just before finalize** (the recommended option) so the answer rides the existing `🎉 Family pod created!` Slack (which fires before the optional add-members step) without a separate send.

### Mid-session assets

> note that i've copied the google play official badge to /tmp/google_play_badge_web_english.png … copy this to the appropriate location on the repo
> note i've also added the app store badge as well to /tmp/apple_app_store_badge_english_white_00217.svg

Both stashed for the separate homepage-badge task: `web/public/brand/google-play-badge-en.png`, `web/public/brand/app-store-badge-en.svg`.

</details>
