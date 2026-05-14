# Plan: Simplify Create Pod wizard Step 3 (Add your family)

> Date: 2026-05-14
> Related code: `src/components/login/CreatePodView.vue:932-1132` (template), `:64-73` (state), `:387-446` (handlers); `src/services/translation/uiStrings.ts:3137-3188`

## Context

Step 3 of the Create Pod wizard ("Add your family") currently pre-opens an empty member form alongside the owner card, with the orange "Finish — take me to the Nook" CTA always visible at the bottom. Greg flagged that this is presumptuous — the user hasn't been asked whether they want to add anyone, the form just appears. Three layered issues fall out of that:

1. The pre-opened form makes the screen ambiguous (read "Add your family", see an empty form, guess at the ask).
2. "Finish — take me to the Nook" (orange CTA, always visible) and "Skip — just me for now" (small grey link, conditional) do the same job. Redundant + cluttered.
3. The in-form field order is **Name → Birthday → Role** with a code comment defending "easiest/least committal first" — sound for a cold-start always-open form, weakened the moment the user has already chosen Adult vs Child to open the form.

Plus: `loginV6.parentBean` is labelled `"Parent / Adult"` (en) and `"parent beanie"` (beanie). A grandparent, uncle, or co-parent is an adult but not always a parent — the role classification is age-based, not relationship-based.

Greg confirmed the design direction in conversation and chose copy: chip buttons read **"Add an adult"** / **"Add a little bean"**.

## Approach

Four coupled changes. They share one state principle: **`showMemberForm` (true/false) is the single source of truth for the bottom of the screen** — when closed, the chip-row + Finish CTA are visible; when open, the form + its own Cancel/Add row are visible. No state has both.

### Change 1 — defer form-open, reuse the existing "Add another" prompt

- **`CreatePodView.vue:73`** — flip `const showMemberForm = ref(true)` → `ref(false)`. Drop the misleading `// Pre-opened for first member` comment.
- **`CreatePodView.vue:1011`** — the existing "Add another beanie" prompt block already has the exact UI we want for the empty state (dashed border card + two role chips). Broaden its `v-if` from `!showMemberForm && addedMembers.length > 0` → just `!showMemberForm`. No new component.
- Make the prompt's heading conditional on `addedMembers.length`:
  - **Empty (`length === 0`)**: no heading at all — the chips ("Add an adult" / "Add a little bean") carry the verb themselves, the screen state (owner card + chips) is self-evident.
  - **Post-first-add (`length > 0`)**: existing heading "Add another family member?" stays.
- Chip button labels (lines 1024 + 1031) update from `t('loginV6.parentBean')` / `t('loginV6.littleBean')` to **`t('loginV6.addAnAdult')` / `t('loginV6.addALittleBean')`** — full verb-phrase labels in both empty and post-first-add states. Consistency wins over compactness here.

### Change 2 — context-aware Finish CTA, remove the separate Skip link

- **`CreatePodView.vue:1100-1107`** — `Cancel` button currently `v-if="addedMembers.length > 0"`. Drop that condition; Cancel is **always** visible while the form is open. Lets the user back out of the first add as cleanly as the second.
- **`CreatePodView.vue:1121-1123`** — wrap the Finish CTA in `v-if="!showMemberForm"`. While the form is open, the Finish CTA is **hidden** (not just disabled — disabling it at the bottom of an open form is visual noise that competes with the form's own Add Member button).
- **`CreatePodView.vue:1124-1131`** — **delete the separate "Skip — just me for now" link**. The Finish CTA in the form-closed state IS the skip path; one CTA, one job. Cleaner.

End-state matrix (no traps, every state has exactly one primary path forward):

| Form state | Members added | Visible bottom                                           | What user can do                                  |
| ---------- | ------------- | -------------------------------------------------------- | ------------------------------------------------- |
| closed     | 0             | "Add an adult" / "Add a little bean" chips + Finish CTA  | open form, or finish to Nook                      |
| open       | 0             | form + Cancel / Add member row                           | cancel back to closed-empty, or fill + add        |
| closed     | ≥1            | "Add another family member?" prompt + chips + Finish CTA | open form, or finish to Nook                      |
| open       | ≥1            | form + Cancel / Add member row                           | cancel back to closed-with-members, or fill + add |

### Change 3 — reorder form fields: Role → Name → Birthday

- **`CreatePodView.vue:1036-1098`** — move the role chip row (currently lines 1073-1098) to **immediately under the form's opening `<div>`**, before Name. Name and Birthday stay in that relative order.
- **`CreatePodView.vue:1036-1040`** — replace the existing "intentional order" code comment with one defending the new order: "Role first (pre-selected from the chip click that opened the form; acts as confirm/override). Name and birthday follow."

The existing `openAddMemberForm(role: 'parent' | 'child')` (lines 439-446) already pre-selects role from the click that opened the form — no handler change needed.

### Change 4 — rename "parent beanie" → "adult beanie"

- **`uiStrings.ts:3137`** — value change only, key stays as-is:
  ```ts
  'loginV6.parentBean': { en: 'Adult', beanie: 'adult beanie' },
  ```
  (Dropping "Parent /" prefix; renaming beanie value.) Key rename would touch 8 usages across `CreatePodView.vue`, `JoinPodView.vue`, `PickBeanView.vue` for zero semantic benefit — values-only is enough.
- **`uiStrings.ts`** — add two new keys near the existing `loginV6.add*` cluster (around line 3182):
  ```ts
  'loginV6.addAnAdult': { en: 'Add an adult', beanie: 'add an adult' },
  'loginV6.addALittleBean': { en: 'Add a little bean', beanie: 'add a little bean' },
  ```
- **`public/translations/zh.json`** — regenerate via `npm run translate` (per the established workflow).

Beanie-mode discipline check: both new keys have proper `en` (Title-Case-ish — these are full short phrases, "Add an adult" is fine) + lowercase `beanie` variants. ✓ No existing Title Case strings around this surface to clean up.

### Test impact

There is **one existing E2E** that depends on the old behaviour: `e2e/specs/setup-flow.spec.ts:8-60`. Line 20 fetches the "Add member" button immediately after `navigateToSetupStep3()` — under the new flow that button doesn't exist yet (form is closed).

- **`setup-flow.spec.ts`** — add one chip click before the existing assertions:
  ```ts
  // Open the form by clicking the "Add an adult" chip — the form is no
  // longer pre-opened (the empty state shows chips only, per 2026-05-14
  // step-3 simplification).
  await page.getByRole('button', { name: ui('loginV6.addAnAdult') }).click();
  ```
- **`docs/E2E_HEALTH.md`** — log this as **(b) intentional change**, not (a) bug-caught and not (c) flake. Per the ADR-007 workflow.

No unit tests exist for `CreatePodView.vue` (only `LocalFileSyncWarning.test.ts` lives in `src/components/login/__tests__/`). Adding one means scaffolding auth/sync/router mocks for what's essentially template-state-machine changes; not a great cost/value trade. The E2E + manual smoke covers correctness end-to-end. **Out of scope for this PR**: a new unit test file.

## Files affected

- `src/components/login/CreatePodView.vue` — template re-org + 1 ref init flip + comment update (~40 lines net)
- `src/services/translation/uiStrings.ts` — 1 value change, 2 new keys (~5 lines)
- `public/translations/zh.json` — regenerated automatically by `npm run translate`
- `e2e/specs/setup-flow.spec.ts` — 1 chip click added (~3 lines)
- `docs/E2E_HEALTH.md` — log the intentional E2E change (~5-line entry)

## Multi-pass review

### Pass 1 — DRY audit

- ✅ Existing "Add another beanie" prompt block (lines 1011-1034) reused for the empty state — no new component or duplicated UI.
- ✅ Existing `openAddMemberForm(role)` (line 439) already supports role pre-selection — no handler change.
- ✅ Existing `showMemberForm` ref becomes the single source of truth for chip/Finish-CTA visibility — no new state.
- ✅ String values updated in place rather than renaming keys — no scatter-touch across 3 files for cosmetic benefit.
- ✅ The Cancel button's existing `showMemberForm = false` handler (line 1105) already handles state reset correctly; no logic change needed.

### Pass 2 — Sustainability

- The bottom-of-screen state machine collapses from 3 independent toggles (`showMemberForm`, `addedMembers.length > 0` for Cancel, `addedMembers.length === 0` for Skip) to 1 (`showMemberForm`). Less branching = fewer corners for future bugs to hide in.
- Removing the separate "Skip" link permanently retires `loginV6.skip` from this surface (still used elsewhere? grep at implementation time and decide).
- The "Add an adult" / "Add a little bean" labels generalise — if a future redesign moves the chips to a different surface (settings, etc.), the labels read correctly without context.
- Field-order rationale moves into a code comment that ties to the broader UX (chip-click pre-selects role) — future refactors that change the click-to-open flow will surface this dependency.

### Pass 3 — Fresh-eyes correctness

- **Cancel from empty-first-add (no members yet, form open):** under new behaviour Cancel is now visible (was `v-if="addedMembers.length > 0"`). Clicking it sets `showMemberForm = false` → screen returns to owner-card + chips + Finish. No trap.
- **Cancel from form-open-with-members:** existing behaviour unchanged — `showMemberForm = false` returns to "Add another?" prompt + chips + Finish.
- **Finish-from-form-open:** impossible by construction — Finish CTA is hidden while `showMemberForm` is true. No trap.
- **Form fields persist across Cancel/reopen:** `openAddMemberForm(role)` (line 440-445) explicitly clears `newMemberName` / `dobMonth` / `dobDay` / `dobYear` on each open. ✓ No stale data carries over.
- **Role pre-selection:** `openAddMemberForm('parent' | 'child')` writes `newMemberRole.value = role`. The chip row at the new top-of-form position binds to `newMemberRole`. User opens via "Add an adult" → role chip shows Adult selected. ✓ Override works (clicking the other chip just re-binds the ref).
- **E2E impact contained:** only `setup-flow.spec.ts` exercises step 3. The 3 other E2E specs (`google-drive`, `trusted-device`, `cross-entity`) that matched on the broad `CreatePod\|addMember` grep are mocked-out or test different code paths (verified at implementation time).
- **i18n / beanie mode:** new keys have both `en` + `beanie` variants per the convention. `npm run translate` regenerates zh.
- **String-rename radius:** `loginV6.parentBean` VALUE changes; KEY stays. All 8 consumers (`CreatePodView.vue` ×5, `JoinPodView.vue` ×1, `PickBeanView.vue` ×1, plus the `<option>` at `CreatePodView.vue:608`) pick up the new label without code changes. The `<option>` at line 608 lives in the "edit owner role on Step 1" section — confirm "Adult" reads correctly there too (it should; same age-classification semantics).
- **Backward compat:** no breaking changes to component props, route shapes, persisted data, or registry payloads. Purely visual + i18n.

## Verification

1. **Type-check + lint + tests + build:**

   ```bash
   npm run validate
   ```

   Existing 2216 unit tests stay green (no new ones added). Build OK.

2. **Run translate:**

   ```bash
   npm run translate
   ```

   Generates zh values for the 2 new keys (`addAnAdult`, `addALittleBean`) + the updated `parentBean` value.

3. **Run the affected E2E:**

   ```bash
   npx playwright test e2e/specs/setup-flow.spec.ts --project=chromium
   ```

   Passes with the new chip-click prepended.

4. **Manual smoke on localhost:5173** — walk through the state matrix above. Each of the 4 (form state × members added) combinations should render exactly the elements listed in the table.

5. **Beanie-mode smoke:** flip beanie mode on, walk Step 3 again, confirm all new strings render lowercase.

6. **Dark-mode smoke:** flip dark mode on, confirm the empty-state chip row + form fields render correctly (no new styles introduced, but the chip-row repositioning could expose a missed dark variant).

## What this plan deliberately does NOT do

- No new component files.
- No new unit-test scaffolding for `CreatePodView` (the heavy mock graph isn't worth it for template-state changes; the E2E + manual smoke covers correctness).
- No rename of the `loginV6.parentBean` translation key (values-only change keeps the 8 consumers untouched).
- No change to the data model — `FamilyMember.ageGroup` still tracks `'adult' | 'child'`; this is purely a label change.
- No reordering of Step 1's "edit owner role" select at line 608 (the same `parentBean` value flows through; behaviour unchanged).
- No automatic prod deploy — greg authorises the deploy after manual smoke.
