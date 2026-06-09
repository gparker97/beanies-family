# Plan: Dev-only feature-flags admin UI (committed source-of-truth for prod)

> Notion #31 (Beanies Main Issue Tracker) · No GitHub issue (direct implementation) · on approval, saved to `docs/plans/2026-06-09-feature-flags-admin-ui.md`

## Context

greg builds beanies on `main` and wants to push early/often without long-lived feature branches and their merge conflicts. The need: a simple, **private** way to view/enable/disable features, where a feature can sit on main behind a flag (off in prod) until it's flipped on. The repo already has a minimal dev-flag system (`src/config/flags.ts`: `DevFlag` union + `isFlagEnabled`/`setFlagOverride`/`clearFlagOverride`; per-browser localStorage override → else `import.meta.env.DEV`), but **no UI** (toggling means hand-editing localStorage) and **no way to set prod state**. Both existing flags (`aiPhotoExtract`/`aiTravelExtract`) are dormant, so changing the read model has no live effect.

**Decisions (greg, 2026-06-09):** (1) the UI is the **source of truth for prod** — toggling persists committed state that ships to prod, so flip + deploy enables a feature for all prod users with no code edit; (2) access = dev builds **AND** owner/admin; (3) reload-to-apply; (4) **UI lives as a dev-only card inside the existing Settings page** (not a separate route/page) — less surface, no new route/guard/sidebar link.

## Approach

**One committed source of truth.** `src/config/featureFlags.committed.ts` — `export const COMMITTED_FLAGS: Record<DevFlag, boolean> = { aiPhotoExtract: false, aiTravelExtract: false }` (both seeded `false` = today's prod-off behaviour). Git-committed, shipped in the prod bundle. Typed `.ts` (not JSON) because `resolveJsonModule` is off in every tsconfig and we won't widen it for one file. This file is pure data — it legitimately ships to prod and is independent of the editing UI.

**Read model (`flags.ts`), call-time DEV branch preserved.**

```
isFlagEnabled(flag):
  override = readOverride(flag); if (override !== null) return override   // unchanged
  return import.meta.env.DEV ? true : COMMITTED_FLAGS[flag] === true
```

Dev → every flag on (build everything on main); prod → committed-true only. `import.meta.env.DEV` stays **inside** the function (preserves the `vi.stubEnv('DEV')` test contract — `flags.test.ts:4-6`). Add pure `listFlags()` (registry + committed state) for the card. Keep `set/clearFlagOverride`. `flags.ts` imports no card/writer — confirmed independent, safe in prod.

**Registry = single source of truth.** `FLAG_REGISTRY: readonly { id; label; description }[]`; `DevFlag = (typeof FLAG_REGISTRY)[number]['id']` replaces the hand-written union. Module-load invariant (mirroring `src/constants/navigation.ts`'s `throw` style): duplicate registry id → throw; stale committed key not in registry → warn-and-ignore. A registered flag missing from `COMMITTED_FLAGS` is a **compile** error via `Record<DevFlag, boolean>`.

**Dev-only write mechanism (Vite plugin).** In `vite.config.ts`, a plugin with `apply: 'serve'` + `configureServer` adds `POST /__feature-flags` ({flag, enabled}). It calls the pure core, then regenerates the committed file from a **deterministic full-file template** (sorted keys, prettier-clean) — not a surgical string edit, so output never depends on parsing the prior body and stays lint-clean. Every branch responds (200 / 4xx / 5xx); I/O wrapped in try/catch with server-side `console.error` + fix guidance. Because `apply:'serve'`+`configureServer` only run in the dev server, **the endpoint is absent from prod builds**. The committed file path is resolved server-side (never from client input).

**Pure core, shared + tested.** `src/config/featureFlagWrite.ts`: `applyFlagWrite(currentState, flag, enabled) → { ok:true; source } | { ok:false; error }` (id validation + template generation, no I/O). Imported by the plugin via a **relative** path (`./src/config/featureFlagWrite` — `@/` alias doesn't exist while vite.config loads) and by tests. Its import graph must stay **Vue-free** (depend only on the flag-id list + plain TS) so `vite.config.ts` keeps loading; if `flags.ts` carries runtime imports, factor the bare id list into a tiny leaf module both import.

**Client transport (dev-only).** `src/services/featureFlags/devFlagWriter.ts`, guarded like `src/services/e2e/dataBridge.ts` (`if (!import.meta.env.DEV) return;` belt-and-suspenders). `setProdFlag(flag, enabled)` POSTs to `/__feature-flags`; on non-2xx/network error it **throws** (stays pure transport) — the card owns the UI consequence. Imported ONLY by the dev card (so it rides the dev-only exclusion); never imported by `flags.ts`.

**Dev-only Settings card (the UI).** This is the changed part vs. the first draft — no route/page/guard/sidebar link.

- NEW `src/components/settings/DevFeatureFlagsCard.vue` (`<script setup>`): renders one `SettingToggleRow` per `listFlags()` entry (verified props `modelValue/title/hint/disabled/testid/divider`, emits `update:modelValue`). Inline explainer stating the **dev-vs-prod distinction**: "These control PRODUCTION availability — toggling rewrites the committed config; commit + deploy to apply. In development every flag is always on. Changes apply after reload." Flat handler:
  ```
  onToggle(flag, value):
    prev = local; local = value                       // optimistic
    try { await setProdFlag(flag, value); showReload = true }
    catch (err) { local = prev; showToast('error', …guidance…, { surface:'feature-flags-write', error: err, context:{flag,enabled:value} }) }
  ```
  `showToast` already logs to console + reports to Slack (no silent failure). One persistent "Reload to apply" `BaseButton` (→ `window.location.reload()`) after any success. Dev-only → **inline literal copy, no i18n keys** (keeps dev strings out of the prod translation payload).
- CHANGE `src/pages/SettingsPage.vue` (which already destructures `usePermissions()` → `isOwner, canManagePod`, line 68): add `defineAsyncComponent` to the line-2 vue import and, at module scope:
  ```ts
  const DevFlagsCard = import.meta.env.DEV
    ? defineAsyncComponent(() => import('@/components/settings/DevFeatureFlagsCard.vue'))
    : undefined;
  ```
  Render gated: `<component :is="DevFlagsCard" v-if="DevFlagsCard && (isOwner || canManagePod)" />` (placed after the Quick Toggles block). In prod the const folds to `undefined`, the dynamic `import()` is dead-code-eliminated, and the card + `devFlagWriter` + `setProdFlag` never enter the prod graph — the exact mechanism `main.ts:96-98` uses for `dataBridge`. No `<Suspense>` needed (`defineAsyncComponent` self-handles). **Do NOT** statically import the card (a static import ships regardless of `v-if`), and **do NOT** route the exclusion through `isFlagEnabled()` (it reads DEV at call time, not a build-time fold).

**Apply-on-reload.** `flags.ts` reads `COMMITTED_FLAGS` at module load; after a successful toggle the card prompts a reload (explicit `BaseButton`). Vite may HMR on the file change, but the explicit reload is the deterministic path.

## Files Affected

- `src/config/flags.ts` — registry, committed import, registry-derived `DevFlag`, call-time read model, `listFlags`, load-time invariant
- `src/config/featureFlags.committed.ts` — NEW committed data literal (both flags `false`)
- `src/config/featureFlagWrite.ts` — NEW pure `applyFlagWrite` (validation + full-file template); leaf-clean graph
- `src/config/flags.test.ts` — extend; preserve `vi.stubEnv('DEV')` contract
- `src/config/__tests__/featureFlagWrite.test.ts` — NEW
- `vite.config.ts` — NEW dev-only `apply:'serve'` plugin; relative import of the core
- `src/services/featureFlags/devFlagWriter.ts` — NEW dev-only transport (runtime DEV guard)
- `src/services/featureFlags/__tests__/devFlagWriter.test.ts` — NEW
- `src/components/settings/DevFeatureFlagsCard.vue` — NEW dev-only card (reuses `SettingToggleRow`, `BaseButton`, `useToast`; inline copy)
- `src/pages/SettingsPage.vue` — add `defineAsyncComponent` dev-only conditional card render (no other change)
- (possible NEW leaf module for the bare flag-id list, if needed to keep the vite-config graph Vue-free)

_Removed vs. the first draft: no `FeatureFlagsPage.vue`, no `src/router/index.ts` route/guard change, no `AppSidebar.vue` change._

## Acceptance Criteria

- [ ] A dev-only Settings card lists all flags + committed state with a toggle each (from `listFlags()`, reusing `SettingToggleRow`).
- [ ] Card shows only in dev builds AND to owner/admin (`v-if="DevFlagsCard && (isOwner || canManagePod)"`; `DevFlagsCard` is `undefined` in prod).
- [ ] All features available in dev; only committed-true in prod.
- [ ] Toggling regenerates `featureFlags.committed.ts` (deterministic, prettier-clean); commit + deploy flips prod for all users, no code edit.
- [ ] Prod build contains no dev card, write transport, or `__feature-flags` endpoint (grep `dist/` for `setProdFlag` / the endpoint path → zero hits).
- [ ] Unknown/removed flags, mismatches, localStorage failures degrade safely; missing committed key = compile error; duplicate registry id throws at load.
- [ ] Every write failure → `showToast('error', …)` with guidance AND reverts the optimistic toggle.
- [ ] No new toggle/card primitive; no tsconfig change; no new i18n keys; no route/guard/sidebar change; SettingsPage otherwise untouched.
- [ ] `vite.config.ts` still loads (relative import resolves; graph stays Vue-free). `npm run validate` green.

## Verification

1. **Unit:** `flags.ts` (dev all-on; prod committed-only; override precedence; unknown key safe; `listFlags` shape; localStorage-throws warns; duplicate-id invariant). `applyFlagWrite` (valid write → deterministic sorted prettier-clean source; one value changes; unknown flag / non-boolean → error; idempotent). `devFlagWriter` (success resolves; HTTP/network error rejects) + card handler (error toast + revert on reject; success sets reload prompt).
2. **Manual (dev):** Settings → toggle a flag → reload → feature appears/disappears; stop `npm run dev`, toggle → error toast + reverted switch; sign in as a non-owner/admin → card absent.
3. **Manual (prod build):** `npm run build` → grep `dist/` confirms the dev card, `setProdFlag`, and `__feature-flags` endpoint are all absent.
4. `npm run validate` green (incl. prettier/eslint on the regenerated committed file); `npm run dev` still boots (relative-import sanity).

## Review Passes

- **Pass 1:** committed source-of-truth + dev Vite write plugin + dev-only editing UI.
- **Pass 2 (DRY/errors):** reuse `SettingToggleRow`/`showToast`; preserve call-time DEV; pure `applyFlagWrite`; revert optimistic toggle on failure.
- **Pass 3 (sustainability):** typed `.ts` over JSON (no tsconfig change); consolidated `src/config` surface; flat `onToggle`.
- **Pass 4 (fresh eyes):** relative import in vite.config (no `@/`); Vue-free write-core graph; full-file template regeneration; dev-vs-prod explainer; no i18n for dev tool; both flags seeded `false`.
- **Pass 5 (UI-location change → Settings-embedded validation):** confirmed the `import.meta.env.DEV ? defineAsyncComponent(...) : undefined` dead-branch import tree-shakes the card + transport from prod (precedent: `main.ts:96-98` dataBridge); static import would leak (rejected); exclusion must NOT route through call-time `isFlagEnabled()`; `flags.ts`/committed data ship to prod safely; no `Suspense` needed; dropped the route/guard/page/sidebar in favor of one dev-only Settings card.

## Prompt Log

<details><summary>Full prompt history</summary>

- **Pre-plan (Notion #31):** "let's review and implement issue #31 in notion for feature flags" → resolved 3 TBC fields + 3 decisions (prod source-of-truth · dev+owner/admin · reload-to-apply) → assembled prompt written back to Notion #31.
- **Plan:** "create plan and fix the one line you mentioned above" (one-line fix = beanies-pre-plan write-back-ordering wording, committed `50701190`).
- **Plan:** "show me the plan"
- **Plan (UI fork):** "will we be creating a new view (sidebar) or captured in the settings page? Would it be easier to just create this in the settings page?" → chose **dev-only card in Settings**; plan revised accordingly.

</details>
