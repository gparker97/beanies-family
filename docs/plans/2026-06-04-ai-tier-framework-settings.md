# Plan: #133 Phase 4 — AI tier framework + Settings UI

> Date: 2026-06-04
> Related issues: #133 (Private AI — tiered architecture). Parent plan: `docs/plans/2026-06-02-private-ai-tiered-architecture-and-invitation-wedge.md` (Phase 4). ADR: `docs/adr/030-private-ai-tiered-architecture.md`.
> Plan file: `docs/plans/2026-06-04-ai-tier-framework-settings.md`
> **No GitHub issue created.** Approved for direct implementation; full prompt history embedded below.

## User Story

As a privacy-conscious family member, I want to choose how beanies AI processes my documents — the managed confidential-compute tier, my own provider key (BYOK), or (future) fully on-device — and understand what each choice means for my data, so that I stay in control of where my family's information goes.

## Context

#133 shipped the photo→activity wedge to prod, **flag-hidden** behind `isFlagEnabled('aiPhotoExtract')` (dev-on, prod-off + localStorage override). The wedge currently runs on a single implicit tier: `useAiCapability` _derives_ the tier from the legacy provider-keyed settings (`aiProvider`/`aiApiKeys`) and defaults to `managed`. That derivation is explicitly marked **INTERIM — Phase 4 replaces this** in `src/composables/useAiCapability.ts:14`.

Phase 4 makes the tier a **first-class, persisted, user-chosen** setting and gives it a Settings home:

1. **Model extension** — add a real `aiTier` field (`managed | byok | on-device`) with the upgrade-safe read-coalescing the parent plan calls out, replacing the INTERIM derivation.
2. **Settings UI** — a dedicated "beanies AI" card + modal: tier selection, BYOK provider/key entry with a "test key" action, a plain-language privacy explanation per tier, and the relocated "ask before photos" consent toggle (consolidating the whole AI surface into one place).

Phase 4 ships **independently of unhiding the feature**: the entire AI surface (wedge entry _and_ the new Settings card) stays gated behind the same dev flag, so nothing is exposed to users until the launch gates (Gate 2 DPA, Phase 5 help article) clear. This is a clean, self-contained build that removes the INTERIM seam and makes tier selection real.

## Requirements

1. **`aiTier` is a real, persisted setting.** Add `aiTier: AiTier` to the family `Settings`, default `'managed'` for new families, and **coalesce on read** (`settings.aiTier ?? 'managed'`) so the existing families whose stored settings object predates the field don't read `undefined` and crash the tier `switch`/`assertNever`.
2. **`AiTier` has a single canonical definition.** It currently lives in `src/services/ai/types.ts:13`. `Settings` (in `models.ts`) must not create a layering inversion or a duplicate union — define it once and re-export so existing import sites are untouched. (Verified safe: `models.ts` imports nothing — it is a pure leaf module — so the canonical definition belongs there and `services/ai/types.ts` re-exports it.)
3. **`useAiCapability` reads the persisted tier**, not the derived one. Public shape (`{ tier, byokConfig, isConfigured }`) stays identical so the wedge and its tests are unaffected.
4. **Managed tier holds no client key.** The Tinfoil key is server-side only (the Lambda). `aiApiKeys` holds BYOK keys only. This boundary is documented as an invariant in code + ADR-030 — it is the reason the proxy exists, not an unfinished feature.
5. **Settings UI** — a new "beanies AI" `SettingsCard` opening a **self-contained `AiSettings.vue` component** (see Approach §4), deep-linkable via `?open=ai` (existing `cardOpenMap` pattern at `SettingsPage.vue:92`), containing:
   - a tier selector (Managed recommended / BYOK / On-device shown but disabled "coming soon");
   - per-tier plain-language privacy explanation (reactive to selection), driven by a **single tier-metadata map** (see Approach §4b) — not a `v-if` ladder;
   - when BYOK is selected: a provider selector (OpenAI working; Claude/Gemini shown but disabled "coming soon", matching the honest `not_available` seams in `byokProvider`), a password key input, and a **"test key"** action that validates the key and surfaces a typed toast;
   - the **relocated** "Ask before photos" AI-consent toggle (moved out of the inline Quick Toggles section into this AI home).
6. **The entire AI Settings card is flag-gated** behind `isFlagEnabled('aiPhotoExtract')` — same flag as the wedge — so Phase 4 exposes nothing to users on prod.
7. **All user-visible text** goes through `uiStrings.ts` (`en` + `beanie`), regenerated via `npm run translate`. No hardcoded English. **Text-class rule (corrected):** the lint rule (`vue/no-restricted-class`) forbids only **`text-[Xpx]`** arbitrary classes; **`text-[Xrem]` arbitrary classes are the established house standard** (see STATUS 2026-05-10 rem migration) and are used throughout the Quick Toggles section. The relocated consent row therefore **keeps** its existing `text-[0.8rem]`/`text-[0.65rem]` rem classes verbatim — do **not** rewrite them to `text-sm`/`text-xs` (that would diverge from every sibling row). New markup follows the same rem convention.
8. **No silent failures** — every setter and the key-test path is try/caught with an informative toast + console diagnostic; tier dispatch uses an exhaustive `switch`/`assertNever(value, context)` (the helper requires the second `context` argument — `src/utils/assertNever.ts:25`).

## Important Notes & Caveats

- **The upgrade-path bug is the whole point of the field work.** `getSettings()` returns `doc.settings ?? getDefaultSettings()` (`settingsRepository.ts:41`) — it backfills only a _wholly-absent_ settings object, never a newly-added field on an existing object. So a family that already has settings will read `settings.aiTier === undefined`. The fix is a **single read-coalescing site** (the `aiTier` store getter — see Approach), not scattered `?? 'managed'` at every call site.
- **Do not store the managed key client-side.** Anyone adding a `tinfoil`/managed entry to `aiApiKeys` is deleting the privacy boundary. Code comment + ADR note enforce this.
- **`AiTier` import direction (verified).** `models.ts` has zero imports — it is a leaf types module. Importing from `services/ai/` would invert layering. Move the canonical `AiTier` definition **into `models.ts`** and re-export it from `services/ai/types.ts` (`export type { AiTier } from '@/types/models';`) so the existing `import type { AiTier } from '@/services/ai/types'` sites (`useAiCapability.ts:9`, `documentExtractionService.ts:25`) keep compiling unchanged.
- **`assertNever` takes two args.** `assertNever(value: never, context: string)` — the `useAiCapability.isConfigured` switch must pass a context tag (e.g. `'useAiCapability.isConfigured'`), matching the existing call at `documentExtractionService.ts:67` (`assertNever(opts.tier, 'aiTierDispatch')`). A one-arg call will not compile.
- **Type widths differ between the BYOK config and the store provider — and that's fine.** `ByokConfig.provider` is `AiProviderId` (`'tinfoil' | 'openai' | 'claude' | 'gemini' | 'on-device'`); `settingsStore.aiProvider` is `AIProvider` (`'claude' | 'openai' | 'gemini' | 'none'`). After narrowing out `'none'`, the remaining `'openai' | 'claude' | 'gemini'` is assignable to `AiProviderId`, so `byokConfig` builds a valid `ByokConfig` with no cast. Keep the explicit (non-dynamic-index) key access the current composable uses (`useAiCapability.ts:23`) for type-safety + lint-cleanliness.
- **BYOK reality.** Only `openai` actually extracts today; `claude`/`gemini` throw typed `not_available` in `byokProvider` (`byokProvider.ts:47-54`). The UI must reflect this honestly (disabled "coming soon" options), not offer a provider that silently fails. Per project rule: surface friction only where it's real — here it's real and known, so disabling is correct (not a predictive UA-sniff warning).
- **On-device is a future tier.** Its provider is a `not_available` stub. Show it in the selector for the privacy story but disable selection ("coming soon"). `isConfigured` is false for on-device.
- **`BaseSelect` cannot render disabled `<option>`s today (verified).** Its `Option` type is `{ value, label }` only and the template does not bind `:disabled` on `<option>` (`BaseSelect.vue:4-7,105`). The "coming soon, disabled" tier/provider options therefore require a **small, generic extension** to `BaseSelect` — add an optional `disabled?: boolean` to the `Option` interface and bind `:disabled="option.disabled"` on both the flat (`BaseSelect.vue:105`) and grouped (`BaseSelect.vue:92`) `<option>` renders. This is a one-component, backward-compatible change (existing callers omit the field) and is the DRY choice over hand-rolling a bespoke `<select>` in the modal. See Approach §4b.
- **No existing key-test helper to reuse (verified).** A grep for `v1/models` / `validateKey` / `testKey` finds nothing — `validateByokKey` is genuinely new, not a duplication. It must, however, **reuse** the OpenAI base URL and the abort/timeout discipline that already exist (see Approach §3), not re-declare them ad hoc.
- **"Test key" must not be free-form scope creep.** Scope it to a single cheap, definitive connectivity check (OpenAI `GET /v1/models` → 200 valid / 401-403 invalid), reusing the existing fetch + `AbortSignal.timeout` discipline (`openaiCompatible.ts:35-38`). For non-OpenAI providers the button is hidden (nothing to test yet).
- **Relocating the consent toggle** must preserve the existing `updateAskBeforePhotos` handler (`SettingsPage.vue:263`) and `data-testid="ai-consent-toggle"` so its current test keeps passing — only the markup moves (into `AiSettings.vue`). The testid falls through to the `ToggleSwitch` root element via Vue attribute fallthrough (ToggleSwitch defines no `inheritAttrs:false`), so it survives the move unchanged. The `updateAskBeforePhotos` handler (which calls `settingsStore.setSkipDocumentConsentPrompt(!ask)` — the toggle is `!skipDocumentConsentPrompt`, so ON = ask) moves into `AiSettings.vue` alongside the markup it serves.
- **Reuse the existing `settings.ai.*` keys.** `settings.ai.title`, `settings.ai.askBeforePhotos`, `settings.ai.askBeforePhotosHint` already exist (`uiStrings.ts:6513-6521`) — the relocated toggle reuses them as-is; only genuinely new copy (tier names, privacy explanations, test-key toasts, card title/desc) is added.
- **Border cleanup on the Quick Toggles card — none needed (reasoning corrected).** Each toggle row in the Quick Toggles card owns its **own** border independently: beanie-mode, sound, and the ai-consent row each carry `border-b`, while Daily Tips (the last row) carries none. Removing the ai-consent row therefore leaves a valid sequence — the sound row keeps its own `border-b` and becomes the second-to-last row, and Daily Tips remains the borderless last row. (Note: the consent row being removed _does_ carry a `border-b` today; borders are per-row, not inherited from a neighbor, so no surviving row needs a border edit.)
- **Do not unhide anything.** The flag stays prod-off. No CHANGELOG user entry, no help article goes live in this phase (both ride Phase 5 / the unhide).
- **Component extraction over a sixth inline modal (sustainability).** `SettingsPage.vue` is already **1781 lines** with five+ inline `BeanieFormModal`s, all of which are purely presentational (a few store-backed toggles/selects). The AI modal is **not** that — it carries real logic (tier metadata, BYOK provider/key state, the test-key async dispatch, and toast mapping). Inlining it would push a long file longer and bury the one genuinely stateful surface in the middle of it. The repo already has the right home and precedent: `src/components/settings/` extracts logic-bearing settings panels (`ExchangeRateSettings.vue`, `PasskeySettings.vue`, `ChangePasswordSettings.vue`), and `ExchangeRateSettings` ships with a **co-located test** (`src/components/settings/__tests__/ExchangeRateSettings.test.ts`). Phase 4 follows that pattern: the AI modal body lives in a self-contained `src/components/settings/AiSettings.vue`, leaving `SettingsPage.vue` owning only the card, the `showAi` ref, and the `cardOpenMap` entry. This also directly resolves the Testing-Plan concern that an inline modal would be "disproportionately heavy" to test — an extracted component is unit-testable in isolation.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-04); may drift.

1. The dev feature flag `isFlagEnabled('aiPhotoExtract')` from `src/config/flags.ts:35` is the correct gate for the whole AI surface (verified shipped this session).
2. `useAiCapability`'s public shape (`{ tier, byokConfig, isConfigured }`) is its only consumer contract; the wedge and `useDocumentToActivity` read only those (verified — they destructure these three; the existing test at `useAiCapability.test.ts` asserts only on these).
3. `BaseSelect`, `BaseInput` (password support — verified the `type` union includes `'password'` and `$attrs` is forwarded), `BeanieFormModal`, `SettingsCard`, `ToggleSwitch`, `BaseButton`, `useToast` (`showToast` named export), `useTranslation` all exist and are the right reusable primitives (verified present in repo). `BaseSelect` needs the small per-option `disabled` extension noted above.
4. BYOK keys persist in `Settings.aiApiKeys` keyed by provider (`claude`/`openai`/`gemini`) — the existing `setAIApiKey` path (`settingsRepository.ts:105`, `settingsStore.ts:336`) is reused as-is; no new key-storage shape is needed.
5. No E2E is warranted (config UI behind a flag fails the Three-Gate Filter — not a data-loss-critical journey). Unit/component tests cover it.

## Approach

### 1. Model layer — the `aiTier` field (the deliberate extension)

**a) Canonical `AiTier` in `models.ts`, re-exported from the service types.**

- In `src/types/models.ts` (next to `AIProvider`/`AIApiKeys`, ~line 1096): define the canonical union with the invariant comment:
  ```ts
  // AI tier selection (#133, ADR-030). Client settings hold the TIER choice + BYOK keys only.
  // The managed (Tinfoil) tier intentionally has NO client-side key — it lives server-side in
  // the ai-extract Lambda. That separation IS the privacy boundary, not an unfinished feature.
  export type AiTier = 'managed' | 'byok' | 'on-device';
  ```
- Add to `Settings` (after `aiApiKeys`, ~line 1121): `aiTier?: AiTier;` — **optional in the type** because pre-existing docs lack it; the default + the store getter supply `'managed'`. (Marking it required would lie about the on-disk shape and is the bug the read-coalescing exists to prevent.)
- In `src/services/ai/types.ts:13`: replace the local `export type AiTier = …` with `export type { AiTier } from '@/types/models';` — single source, all existing importers (`useAiCapability`, `documentExtractionService`) unchanged. (Preserve the `/** Preference-ordered tiers. See ADR-030. */` doc intent — fold it into the re-export line or the canonical definition so the doc comment is not lost.)

**b) Default for new families.** `getDefaultSettings()` (`settingsRepository.ts:15`): add `aiTier: 'managed'` (alongside `aiProvider: 'none'`/`aiApiKeys: {}` at `settingsRepository.ts:29-30`).

**c) Read-coalescing — ONE site.** Add a coalescing getter to `settingsStore`, mirroring the existing `aiProvider` getter (`settingsStore.ts:38`), and export it:

```ts
// Coalesced on read: pre-existing family docs predate the aiTier field, so the stored value
// can be undefined (getSettings() backfills only a wholly-absent settings object). Defaulting
// here — the single read site every consumer goes through — avoids scattering `?? 'managed'`.
const aiTier = computed<AiTier>(() => settings.value.aiTier ?? 'managed');
```

**Consumers read `settingsStore.aiTier`, never `settings.aiTier` directly.** (`AiTier` is imported into the store from `@/types/models`, alongside the existing `AIProvider` import at `settingsStore.ts:9`.)

**d) Persist.** `settingsRepository.setAITier(tier: AiTier)` → `saveSettings({ aiTier: tier })` (mirrors `setAIProvider` at `settingsRepository.ts:101`). `settingsStore.setAITier(tier)` wraps it.

**Setter error-handling — consistency note (sustainability).** The existing AI setters `setAIProvider` (`settingsStore.ts:324`) and `setAIApiKey` (`settingsStore.ts:336`) only set `error.value` and **do not toast or re-throw**, whereas `persistDualSetting` (`settingsStore.ts:266-289`) toasts + re-throws. To avoid introducing a _third_ divergent error contract among the AI setters, `setAITier` follows the **`persistDualSetting` shape** (try/catch → `error.value` + `console.error` + `showToast('error', …)` with `surface: 'settings-persist'`, `error`, `context: { field: 'aiTier' }` → **re-throw** so the modal can revert the selector). The two non-throwing siblings (`setAIProvider`/`setAIApiKey`) are reused as-is; the `AiSettings.vue` component is responsible for catching their (non-thrown) failures by reading `settingsStore.error` after the await and toasting there — so no AI setter is silent, and the divergence is owned in exactly one place (the component) with a comment, rather than scattered. This keeps the store change minimal (one new setter, matching an existing in-store pattern) instead of rewriting two stable setters.

### 2. `useAiCapability` — read the persisted tier (remove the INTERIM seam)

Replace the derived `tier`/`byokConfig` with reads off the persisted setting. Keep the explicit key access (no dynamic index). Import `assertNever` from `@/utils/assertNever`:

```ts
const tier = computed<AiTier>(() => settingsStore.aiTier); // persisted, coalesced
const byokConfig = computed<ByokConfig | null>(() => {
  if (tier.value !== 'byok') return null; // only BYOK uses a client key
  const provider = settingsStore.aiProvider;
  if (provider === 'none' || provider === undefined) return null;
  const keys = settingsStore.settings.aiApiKeys ?? {};
  const apiKey =
    provider === 'openai' ? keys.openai : provider === 'claude' ? keys.claude : keys.gemini;
  return apiKey ? { provider, apiKey } : null;
});
// managed = always selectable (proxy availability surfaces at call time); byok needs a key;
// on-device = future stub → not configured.
const isConfigured = computed(() => {
  switch (tier.value) {
    case 'managed':
      return true;
    case 'byok':
      return byokConfig.value !== null;
    case 'on-device':
      return false;
    default:
      return assertNever(tier.value, 'useAiCapability.isConfigured');
  }
});
```

Replace the INTERIM comment block (`useAiCapability.ts:14-17`) with one describing the persisted-tier read. Public return shape unchanged. **Update the existing test's store mock** (`useAiCapability.test.ts:4-10`) to add an `aiTier` field, since the composable now reads `settingsStore.aiTier` instead of deriving it (see Testing Plan).

### 3. BYOK key validation — `validateByokKey`

Add a small, typed connectivity check beside the BYOK provider. Scope: OpenAI only (the one working BYOK target). **No new constants that already exist** — reuse the OpenAI base URL and the abort/timeout pattern:

- File: `src/services/ai/providers/validateByokKey.ts`.
  - To avoid re-declaring `https://api.openai.com/v1`, **export `OPENAI_BASE_URL` from `byokProvider.ts`** (it is currently a private const at `byokProvider.ts:28`) and import it here — single source for the OpenAI base URL.
  - Signature: `async function validateByokKey(config: ByokConfig): Promise<{ ok: boolean; reason?: 'invalid_key' | 'network' | 'unsupported' }>`. Never throws — every failure is classified and returned (mirrors the `DocumentExtractionResult` no-throw discipline).
  - `openai`: `GET ${OPENAI_BASE_URL}/models` with `Authorization: Bearer <key>` and `signal: AbortSignal.timeout(…)` (same `AbortSignal.timeout` discipline as `openaiCompatible.ts:36`; use a short timeout, ~10s, since this is just a reachability check). `200` → `{ ok: true }`; `401|403` → `{ ok: false, reason: 'invalid_key' }`; any other non-2xx or a thrown/aborted fetch (caught) → `{ ok: false, reason: 'network' }`. The upstream body is never surfaced (matches `openaiCompatible.ts:81-86`).
  - `claude`/`gemini`/`tinfoil`/`on-device` → `{ ok: false, reason: 'unsupported' }` (the button isn't shown for these, but the function stays honest if called).
- The UI maps `reason` → a specific toast key; success → a success toast. No silent path.

### 4. Settings UI — the "beanies AI" card + extracted `AiSettings.vue`

**a) Card** (in the `SettingsCard` grid in `SettingsPage.vue`, flag-gated). Define `const aiSurfaceEnabled = isFlagEnabled('aiPhotoExtract')` once in `<script setup>` (import `isFlagEnabled` from `@/config/flags`); reuse the same const for the `cardOpenMap` guard so there is one source of truth for "is the AI surface on":

```html
<SettingsCard
  v-if="aiSurfaceEnabled"
  icon="🤖"
  :title="t('settings.card.ai')"
  :description="t('settings.card.aiDesc')"
  icon-bg="var(--tint-silk-20)"
  @click="showAi = true"
/>
```

Add `showAi = ref(false)` and register `ai: () => { if (aiSurfaceEnabled) showAi.value = true; }` in `cardOpenMap` (`SettingsPage.vue:92`) so `?open=ai` deep-links only when the surface is enabled (the wedge is the only thing linking here, and it's gated too — consistent). `SettingsPage.vue` renders `<AiSettings v-model:open="showAi" />` (or `:open="showAi" @close="showAi = false"`) — and owns **nothing else** about the AI surface. All the logic below lives inside `AiSettings.vue`.

**b) `AiSettings.vue`** (new, in `src/components/settings/`, following the `ExchangeRateSettings.vue`/`PasskeySettings.vue` precedent). It wraps a `BeanieFormModal` (mirroring the existing settings modals at `SettingsPage.vue:884+`). The modal is purely a "close" affair (every change persists immediately via store setters, like the Appearance card) — no `@save` beyond closing. The component owns its own toast/translation imports (`useToast`, `useTranslation`) and a single `loading` ref for the test action. Sections:

- **Single tier-metadata map (sustainability).** Define **one** module-level constant — not two parallel records that can drift — keyed by tier:
  ```ts
  const TIER_META: Record<AiTier, { nameKey: string; privacyKey: string; disabled: boolean }> = {
    managed: {
      nameKey: 'settings.ai.tier.managed',
      privacyKey: 'settings.ai.privacy.managed',
      disabled: false,
    },
    byok: {
      nameKey: 'settings.ai.tier.byok',
      privacyKey: 'settings.ai.privacy.byok',
      disabled: false,
    },
    'on-device': {
      nameKey: 'settings.ai.tier.onDevice',
      privacyKey: 'settings.ai.privacy.onDevice',
      disabled: true,
    },
  };
  const TIER_ORDER = ['managed', 'byok', 'on-device'] as const satisfies readonly AiTier[];
  ```
  `Record<AiTier, …>` makes a future tier a **compile error** if any of its name/privacy/disabled metadata is missing — exhaustiveness without a runtime switch, and one entry to add instead of edits in two maps. Selector options are built by `TIER_ORDER.map(tk => ({ value: tk, label: t(TIER_META[tk].nameKey) + (TIER_META[tk].disabled ? t('settings.ai.comingSoon') : ''), disabled: TIER_META[tk].disabled }))`.
- **Tier selector.** A `BaseSelect` bound to `settingsStore.aiTier` (the options from `TIER_META` above). On change → `await settingsStore.setAITier(value)` in a `try/catch`; on error the store toasts + re-throws, so the `catch` just lets the control re-read from the store (revert), exactly like the BaseSelect-revert pattern `setTheme`/`persistDualSetting` rely on. On-device's option is `disabled` (rendered via the new BaseSelect per-option `disabled` support).
- **Per-tier privacy explanation — driven by the map, not markup.** The template renders `{{ t(TIER_META[settingsStore.aiTier].privacyKey) }}` — one lookup, no `v-if` ladder.
- **BYOK config** (only `v-if="settingsStore.aiTier === 'byok'"`):
  - provider `BaseSelect` (OpenAI enabled; Claude/Gemini carry `disabled: true` + "coming soon") → `setAIProvider`. Because `setAIProvider` does not throw, after the await read `settingsStore.error` and toast on failure (the divergence-owned-in-the-component rule from §1d).
  - key `BaseInput type="password"` bound to the stored key for the selected provider, persisted via `setAIApiKey(provider, key)` on `@blur` (BaseInput emits `blur`, `BaseInput.vue:82`). Same post-await `settingsStore.error` check → toast on failure (the store `setAIApiKey` only sets `error.value`, `settingsStore.ts:336-346`; surface it here so a save failure is never silent).
  - "Test key" `BaseButton` → `await validateByokKey({ provider, apiKey })` inside a `try/catch` with the `loading` ref while testing → map `reason`/`ok` to a toast. Button is `v-if`-hidden unless provider is `openai` **and** a key is present.
- **Consent toggle (relocated).** Move the existing "Ask before photos" toggle row (`SettingsPage.vue:766-784`) into `AiSettings.vue` **verbatim** — bring the `updateAskBeforePhotos` handler with it, keep `data-testid="ai-consent-toggle"`, the reused `settings.ai.askBeforePhotos` / `settings.ai.askBeforePhotosHint` keys, **and its existing `text-[0.8rem]`/`text-[0.65rem]` rem classes** (these are the house standard, not a lint violation — do not rewrite). Delete the row cleanly from the Quick Toggles card in `SettingsPage.vue`. **No border edit on any surviving row is needed** — each Quick-Toggles row owns its own `border-b` independently; the sound row keeps its border and Daily Tips remains the borderless last row (see Important Notes — the removed row had a `border-b`, but borders are per-row, not inherited).

**c) i18n.** New copy under `settings.ai.*` (`settings.ai.tier.*` names, `settings.ai.privacy.*`, `settings.ai.comingSoon` suffix, `settings.ai.test.*` toasts) and `settings.card.ai` / `settings.card.aiDesc` in `uiStrings.ts` with `en` + `beanie`. **Reuse** the existing `settings.ai.title`/`askBeforePhotos`/`askBeforePhotosHint` keys (`uiStrings.ts:6513`). Run `npm run translate`; hand-correct `zh.json` where machine output is wrong (per project practice). No `t()` interpolation (per the uiStrings convention — distinct keys, no placeholders) — note the `comingSoon` suffix is its own key concatenated in code, not interpolated.

### 5. Sequencing

Pure additive + one relocation + one small generic `BaseSelect` enhancement + one new component. Order: (1) model field + re-export + default + store getter/setter, (2) `BaseSelect` per-option `disabled` support, (3) `useAiCapability` swap + test mock update, (4) `validateByokKey` (+ export `OPENAI_BASE_URL`), (5) `AiSettings.vue` component (tier map, BYOK config, test action, relocated toggle) + strings, (6) wire the card/`showAi`/`cardOpenMap` into `SettingsPage.vue` + remove the moved toggle, (7) tests, (8) `npm run validate`. No deploy in this plan — greg triggers deploys; the flag keeps it dark on prod.

## Files Affected

- `src/types/models.ts` — define canonical `AiTier` + invariant comment; add optional `aiTier?: AiTier` to `Settings`.
- `src/services/ai/types.ts` — replace local `AiTier` with a re-export from `models.ts` (preserve the doc-comment intent).
- `src/services/automerge/repositories/settingsRepository.ts` — `aiTier: 'managed'` in `getDefaultSettings()`; new `setAITier`.
- `src/stores/settingsStore.ts` — import `AiTier`; coalescing `aiTier` getter; `setAITier` wrapper (matches `persistDualSetting` shape: try/catch + toast + re-throw); export both. (`setAIProvider`/`setAIApiKey` unchanged.)
- `src/composables/useAiCapability.ts` — read persisted tier; `isConfigured` via exhaustive switch with `assertNever(value, 'useAiCapability.isConfigured')`; drop the INTERIM derivation + comment.
- `src/components/ui/BaseSelect.vue` — add optional `disabled?: boolean` to the `Option` interface; bind `:disabled="option.disabled"` on flat and grouped `<option>` renders (backward-compatible).
- `src/services/ai/providers/byokProvider.ts` — `export const OPENAI_BASE_URL` (was private) so the validator reuses it.
- `src/services/ai/providers/validateByokKey.ts` (new) — typed, never-throwing OpenAI key connectivity check reusing `OPENAI_BASE_URL` + `AbortSignal.timeout`. (+ unit test)
- `src/components/settings/AiSettings.vue` (new) — self-contained AI modal: tier selector + single `TIER_META` map, data-driven privacy explanation, BYOK provider/key/test, relocated consent toggle (+ `updateAskBeforePhotos` handler moved here). Follows the `ExchangeRateSettings.vue`/`PasskeySettings.vue` extraction precedent. (+ component test)
- `src/pages/SettingsPage.vue` — `aiSurfaceEnabled` const; new flag-gated AI `SettingsCard`; new `showAi` ref + guarded `cardOpenMap` entry; render `<AiSettings>`; remove the consent toggle (and its handler usage) from the Quick Toggles section. **No AI logic remains inline** — only the card + open-state wiring.
- `src/services/translation/uiStrings.ts` — `settings.card.ai`/`aiDesc`, `settings.ai.privacy.*`, `settings.ai.tier.*` names, `settings.ai.comingSoon`, `settings.ai.test.*` (en + beanie); reuse existing `settings.ai.*` keys.
- `public/translations/zh.json` — regenerated via `npm run translate` + hand-correction.
- `docs/adr/030-private-ai-tiered-architecture.md` — one line recording the client-tier/BYOK vs server-managed-key boundary invariant (if not already explicit).
- **Tests:** `src/services/automerge/repositories/__tests__/settingsRepository.test.ts` (or equivalent), `src/stores/__tests__/settingsStore*.test.ts`, `src/composables/__tests__/useAiCapability.test.ts` (update mock + assertions), `src/services/ai/providers/__tests__/validateByokKey.test.ts` (new), `src/components/settings/__tests__/AiSettings.test.ts` (new — mirrors `ExchangeRateSettings.test.ts`).

## Out of Scope (deliberate)

- **Unhiding the feature** — the flag stays prod-off. No CHANGELOG user entry.
- **Help Center article** — the AI help/privacy article and `PRIVACY_ARTICLE_LIVE` flip are **Phase 5** work, landing with the unhide (the feature is not user-visible in Phase 4, so no live doc is written now). Not a follow-up being dropped — it is owned by the next phase.
- **Claude/Gemini BYOK wire formats + on-device provider** — remain typed `not_available` seams (shown "coming soon"); implementing them is later #133 work.
- **Per-family server quotas** (DynamoDB token bucket) — Phase 2 deferral, unchanged.
- **Gate 2 (DPA) / Gate 3 (EHBP)** — launch gates tracked separately.
- **Refactoring the existing `setAIProvider`/`setAIApiKey` to the toast+re-throw shape** — deliberately not done here; they are stable and the component owns their failure surfacing. A future cleanup pass can unify all AI setters onto `persistDualSetting` if desired, but that is not Phase 4's job.

## Acceptance Criteria

- [ ] `Settings.aiTier` exists (optional); `getDefaultSettings()` returns `'managed'`; `AiTier` defined once in `models.ts` and re-exported from `services/ai/types.ts` (all prior importers compile unchanged).
- [ ] A family doc whose stored settings predate `aiTier` reads `settingsStore.aiTier === 'managed'` (read-coalescing verified by test) and does not break the tier switch.
- [ ] `settingsStore.setAITier` persists the choice and round-trips; failure path shows a toast + console error and re-throws (so the selector reverts).
- [ ] `useAiCapability` returns the persisted tier; `byokConfig` is non-null only for `byok` + a stored key; `isConfigured` correct for all three tiers via exhaustive switch with a two-arg `assertNever`; wedge tests still pass.
- [ ] Managed tier never reads/writes a client key (`aiApiKeys` untouched by tier selection).
- [ ] `BaseSelect` renders a disabled option when `option.disabled` is set; existing callers (no `disabled` field) are unaffected.
- [ ] AI Settings card renders only when `isFlagEnabled('aiPhotoExtract')`; `?open=ai` deep-links when enabled and no-ops when disabled. The AI modal lives in `AiSettings.vue`; `SettingsPage.vue` holds no AI logic beyond the card + open-state.
- [ ] Tier selector persists; privacy explanation updates per tier via the single `TIER_META` map; BYOK provider/key/test surface only for BYOK; on-device + Claude/Gemini shown disabled "coming soon".
- [ ] `setAIProvider`/`setAIApiKey` failures (which don't throw) are surfaced by `AiSettings.vue` via a post-await `settingsStore.error` toast — no silent save path.
- [ ] "Test key" validates an OpenAI key (200 ok / 401 invalid / network) with a typed toast each way; hidden for non-OpenAI providers or when no key is present; the validator never throws.
- [ ] Relocated consent toggle works (`ai-consent-toggle` test green); existing rem `text-[…]` classes preserved on the moved row; removed cleanly from the Quick Toggles section (no surviving-row border edit needed); `updateAskBeforePhotos` moved with it.
- [ ] All new strings have `en` + `beanie`; existing `settings.ai.*` keys reused (not duplicated); `npm run translate` parses; `zh.json` regenerated.
- [ ] `npm run validate` green (type-check, lint, format, unit tests, build).

## Testing Plan

1. **settingsRepository** — `getDefaultSettings().aiTier === 'managed'`; `setAITier('byok')` persists; a doc with a settings object lacking `aiTier` is unaffected on an unrelated save (no clobber of other fields).
2. **settingsStore** — `aiTier` getter coalesces `undefined → 'managed'` and reflects a stored value; `setAITier` success updates state; injected-failure path toasts + re-throws.
3. **useAiCapability** — **update the store mock to include `aiTier`** (the composable now reads it). Cases: `aiTier='managed'` → `tier='managed'`, `isConfigured=true`; `aiTier='byok'` + matching key → `byokConfig` set, `isConfigured=true`; `aiTier='byok'` without key → `byokConfig=null`, `isConfigured=false`; `aiTier='byok'` with the wrong provider's key → null; `aiTier='on-device'` → `isConfigured=false`. (The previous tests derived the tier from `aiProvider`; rewrite them to drive `aiTier` directly.)
4. **BaseSelect** — an option with `disabled: true` renders a disabled `<option>`; an option without the field renders enabled (regression guard for existing callers).
5. **validateByokKey** — mock fetch: 200 → `{ ok: true }`; 401/403 → `invalid_key`; thrown/aborted/other non-2xx → `network`; non-openai provider → `unsupported`. Assert it never rejects (no unhandled rejection).
6. **AiSettings (component)** — now a first-class, isolated component test (mirroring `ExchangeRateSettings.test.ts`): flag off → card absent in `SettingsPage` (light page test); component-level: switching to BYOK reveals the key field; test button hidden without a key; on-device option disabled; the single `TIER_META` map drives the right privacy copy per tier. Extraction makes this straightforward rather than "disproportionately heavy."
7. **Manual (`npm run dev`, flag on)** — pick each tier, watch the privacy copy change; enter a bad then good OpenAI key, hit Test, see both toasts; toggle "ask before photos" from its new home and confirm the wedge still honors it; reload with `?open=ai` deep-links; flag off → entire AI card gone.
8. **Beanie mode** — flip beanie mode, confirm all new AI copy is lowercase and translated (no raw keys, no Title Case leaks).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full Phase-4 plan grounded in the verified code state — canonical `AiTier` in `models.ts` (re-exported to avoid layering inversion), single read-coalescing getter, persisted-tier `useAiCapability`, a scoped `validateByokKey`, a flag-gated AI Settings card/modal consolidating tier + BYOK + the relocated consent toggle, with the managed-key-stays-server-side invariant and full test/i18n coverage.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against source and corrected four real issues: (1) the `assertNever` call was missing its required `context` arg — fixed to two-arg; (2) `BaseSelect` cannot render disabled options today, so specified a minimal generic `Option.disabled` extension instead of a bespoke select; (3) the "fix arbitrary `text-[Xrem]` classes" instruction was wrong — rem arbitrary classes are the house standard (only `text-[Xpx]` is lint-forbidden), so the relocated row now keeps its classes verbatim; (4) made `setAITier`/`setAIApiKey`/test-key failures surface a `showToast` (no silent path) and re-export `OPENAI_BASE_URL` so the new validator reuses it rather than re-declaring the URL/timeout. Also pinned: data-map privacy explanation (no `v-if` ladder), reuse of existing `settings.ai.*` keys, `aiTier` as optional on `Settings`, and the `useAiCapability` test-mock update.
- **Pass 3 (Sustainability)**: Extracted the logic-bearing AI modal out of the already-1781-line `SettingsPage.vue` into a self-contained `src/components/settings/AiSettings.vue` (following the existing `ExchangeRateSettings`/`PasskeySettings` precedent, making it isolation-testable); collapsed the two parallel `Record<AiTier,…>` maps into one `TIER_META` record so a future tier is one entry, not two that can drift; and resolved the setter-consistency tension by pinning `setAITier` to the existing `persistDualSetting` shape while leaving the stable `setAIProvider`/`setAIApiKey` untouched (the component owns their non-thrown failure surfacing), so no third error contract is introduced.
- **Pass 4 (Fresh-eyes sweep)**: Corrected the consent-toggle border-cleanup reasoning — the row being removed actually carries a `border-b` (the earlier "borderless" claim was wrong); clarified that Quick-Toggles borders are per-row, so the conclusion ("no surviving-row border edit needed") still holds. Also added: preserve the `AiTier` doc-comment on the re-export, and noted the `updateAskBeforePhotos` semantics (toggle = `!skipDocumentConsentPrompt`). All other reuse/layering/error-handling claims re-verified against source and confirmed accurate.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (this planning request)

> Plan Phase 4 with /beanies-plan

### Context provided to the skill (from the preceding conversation)

> Plan #133 Phase 4 — Settings UI + AI tier framework. This is the next self-contained build after the photo→activity wedge shipped flag-hidden to prod. Source of truth: docs/plans/2026-06-02-private-ai-tiered-architecture-and-invitation-wedge.md (Phase 4 section) and ADR-030. Scope: (1) Resolve the model-shape mismatch — existing persistence is provider-keyed and does NOT map onto the tier concept (managed | byok | on-device); add a deliberate aiTier field defaulted in getDefaultSettings() AND coalesced on read for pre-existing docs (settings.aiTier ?? 'managed'), because settingsRepository only backfills a wholly-absent settings object; without read-time coalescing every existing family reads aiTier === undefined and breaks the tier switch/assertNever (a real upgrade-path bug); keep aiApiKeys for BYOK keys; the managed (Tinfoil) key is NEVER stored in aiApiKeys — it lives server-side in the Lambda. (2) Settings UI — a tier-selection surface (managed/BYOK/on-device) + BYOK key entry, wired through useAiCapability; the wedge currently just defaults to the managed tier. Verified current state: aiTier does NOT exist in models.ts or settingsRepository.ts; no tier settings UI exists; useAiCapability is the reuse seam from Phase 3. The feature wedge remains hidden behind the dev flag isFlagEnabled('aiPhotoExtract') so Phase 4 ships independently without exposing anything to users yet. Honor the existing plan's caveats: read-time coalescing, deliberate model extension, managed key stays server-side, three-tier modal system + theme skill, all user-visible text through uiStrings.ts (en + beanie), tier dispatch via exhaustive switch/assertNever.

</details>
