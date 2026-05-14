# Plan: Capture family country in the DynamoDB family registry

> Date: 2026-05-14
> Related code: `src/types/models.ts:1205`, `src/stores/syncStore.ts:2137`, `infrastructure/lambda/registry/index.mjs`

## Context

The Vue app now captures a family's country during onboarding (first-run wizard) and in Settings → Country & Holidays. It lives in two places:

- **Family Automerge doc** — `Settings.country` (`models.ts:1093`); shared across all members, drives public-holiday display.
- **Device mirror** — `GlobalSettings.country` (`models.ts:47`); dual-persisted so a new device can resolve holidays before the family doc syncs.

The DynamoDB family registry currently stores `{ familyId, provider, fileId, displayPath, familyName, createdAt, ownerEmail, subscribeNewsletter, updatedAt }` (`models.ts:1205-1215`). Greg wants `country` reflected in the registry too — primarily for ops introspection (which families are in which countries, troubleshooting holiday issues, future regional analytics).

This is intentionally a **denormalized copy**, not the source of truth. Automerge remains canonical; the registry copy is a best-effort mirror written fire-and-forget.

## Approach

Mirror the existing `subscribeNewsletter` pattern exactly. It's the closest analog: optional, settable post-hoc, preserved across writes that don't include it. Everything follows established conventions — no new abstractions.

### Two-write trigger model

1. **At every existing `registerCurrentFamily()` call** (sync-config changes, pod-create, ensureRegistered) — include `country` in the payload.
2. **On country change** — fire `ensureRegistered()` via a Pinia watcher inside `syncStore` (watches `settingsStore.country`).

Why a watcher and not a hook in `setCountry()`: `syncStore` already imports `settingsStore` (line 22). Adding the reverse direction would close a circular import. Putting the watcher inside `syncStore` keeps imports one-way and decouples settings UI from registry concerns. Any code that mutates `settings.country` (not just `setCountry`) gets the registry write for free.

### File-by-file changes

#### `src/types/models.ts` — 1 line

Add optional `country` field to `RegistryEntry` (after `subscribeNewsletter`, before `updatedAt`):

```ts
country?: CountryCode | null; // mirror of family Settings.country — denormalized for ops introspection
```

`CountryCode` is already imported / used elsewhere in this file; no new import.

#### `src/stores/syncStore.ts` — ~10 lines

1. In `registerCurrentFamily()` (line 2137-2158), add `country` to the payload:

   ```ts
   country: useSettingsStore().country ?? null,
   ```

   (No extension to the `overrides` parameter type — the watcher fires the function fresh, reactive read picks up the new value.)

2. Add a Pinia watcher inside the store setup function that fires `ensureRegistered()` when country changes:
   ```ts
   // Keep the registry's `country` field in sync with the family doc.
   // Fire-and-forget; uses the same non-critical path as every other registry write.
   const settingsStoreForCountry = useSettingsStore();
   watch(
     () => settingsStoreForCountry.country,
     (next, prev) => {
       if (next !== prev) ensureRegistered();
     }
   );
   ```
   Placement: alongside `ensureRegistered` / `registerCurrentFamily` definitions in the store body. `watch` import added to existing `vue` import line.

#### `infrastructure/lambda/registry/index.mjs` — ~5 lines

In the PUT handler's `item` object (line 93-106), add `country` with the same **preserved-merge pattern** as `subscribeNewsletter`:

```js
country:
  typeof body.country === 'string'
    ? body.country
    : (existing.country ?? null),
```

This preserves the existing value when a write omits the field (e.g. an old cached Vue PWA on someone's device that pre-dates this change). One-line comment above noting the same nuance as `subscribeNewsletter`.

#### `src/stores/__tests__/syncStore.country-registry.test.ts` — new, ~50 lines

Focused new test file. Three cases:

1. `registerCurrentFamily()` includes `country: 'US'` when `settingsStore.country === 'US'`.
2. `registerCurrentFamily()` includes `country: null` when `settingsStore.country` is unset.
3. Changing `settingsStore.country` triggers a fresh `registerFamily` call with the new value (the watcher path).

Reuses the existing `vi.mock('@/services/registry/registryService', ...)` pattern from `syncStore.migrate.test.ts:148`. No new test utilities.

Lambda has no existing test harness — the inline comment + the preserved-merge unit test on the frontend is the verification layer for now. Adding a Lambda test framework is out of scope.

## Files affected

- `src/types/models.ts` — modify
- `src/stores/syncStore.ts` — modify
- `infrastructure/lambda/registry/index.mjs` — modify
- `infrastructure/lambda/registry/lambda.zip` — regenerate (a build step, not hand-edited)
- `src/stores/__tests__/syncStore.country-registry.test.ts` — new

## Multi-pass review

### Pass 1 — DRY audit

- ✅ `subscribeNewsletter` is the exact pattern being reused (preserved-merge in Lambda, optional in `RegistryEntry`, written via `registerCurrentFamily`).
- ✅ `CountryCode` type already exists — no new type.
- ✅ Watcher uses Vue's standard `watch()` — no new helper or composable.
- ✅ Test mocks reuse the existing `registerFamily: vi.fn(async () => {})` pattern seen in 4 existing test files.
- ✅ No new error-reporting surfaces — `[registry] registerFamily failed — registry unavailable` already covers this code path.

### Pass 2 — Sustainability

- Adding more optional fields later (region, timezone, language) follows the same 3-line `RegistryEntry` extension + Lambda preserved-merge + (optional) watcher pattern.
- DynamoDB schemaless storage means **no schema migration** ever needed for new fields — they just start appearing on next write.
- No tooling debt — no new test harness, no new abstractions.
- Watcher pattern scales: if 5 fields end up needing registry-on-change behaviour, they collapse into one `watch([s.country, s.region, ...], ...)` block.

### Pass 3 — Fresh-eyes correctness

- **Backward compat:** Old cached Vue PWAs (pre-deploy) call `registerFamily` without `country`. Lambda preserves existing value. ✓
- **Forward compat:** New rows have `country` only after the family hits any registerFamily code path. Existing rows pick up `country` on their next normal write (which fires on every sync-config change — typically within hours/days of any active family).
- **Multi-device:** When a member device receives a synced country change, its `syncStore` watcher fires too, producing an extra (idempotent) registry write. Worst case N writes per change for an N-member family; in practice 1–4. Lambda serializes them; cost is negligible.
- **Clearing country:** `setCountry(null)` → frontend sends `country: null` → Lambda's `typeof body.country === 'string'` check skips the null → existing country preserved. **This is the same semantics as `subscribeNewsletter`'s typeof check.** Registry value lags the cleared local state. **Acceptable** because the registry is for ops, not authoritative; if hard-clearing matters later, a follow-up PR can add a `country: ''` sentinel or an explicit `clear` API. Will document this nuance inline in the Lambda comment.
- **Race / timing:** The watcher fires after Pinia state updates, which happens synchronously inside `persistDualSetting`'s body before the async repo writes complete. So `settingsStore.country.value` is hot by the time `ensureRegistered → registerCurrentFamily` reads it. ✓
- **Initial-load fire:** The watcher fires once on initial load when country goes from `null` → its persisted value. That's an idempotent registry write — harmless, and arguably useful (backfills existing rows during normal operation).
- **`activeFamilyId` guard:** `registerCurrentFamily` already early-returns if `!ctx.activeFamilyId` (line 2141). So the watcher firing before a pod is set up does nothing. ✓
- **Lambda CORS / auth:** No changes — same endpoint, same API key, same UUID-validated path param.

## Verification

1. **Type-check + lint + tests:**

   ```
   npm run validate
   ```

   New unit test must pass; existing 2213 tests stay green.

2. **Local end-to-end smoke (manual):**
   - Run `npm run dev` against the **dev** DDB table (`tableForOrigin` routes `localhost:5173` to dev).
   - Create a fresh family, complete onboarding with a country selected.
   - Confirm DynamoDB dev row contains `country` field:
     ```
     aws dynamodb get-item --table-name <DEV_TABLE> --key '{"familyId":{"S":"<uuid>"}}'
     ```
   - Change country in Settings → confirm registry row updates within seconds.
   - Toggle country to a different value → confirm same.

3. **Backward-compat smoke:** Manually POST a PUT to the dev Lambda **without** the `country` field on a row that already has one (use `curl` against the dev endpoint). Confirm the existing `country` value is preserved.

4. **Prod deploy steps (when greg approves):**
   - Frontend rides next Vue prod deploy (`Deploy beanies PROD` workflow).
   - Lambda: rebuild zip from `infrastructure/lambda/registry/index.mjs`, then `terraform apply` from `infrastructure/terraform/`. **Greg-driven, not automated by this plan.**
   - Post-deploy: spot-check one prod row via the AWS console to confirm `country` appears on next write.

## What this plan deliberately does NOT do

- No DDB schema migration (DynamoDB is schemaless for non-key attributes).
- No backfill job — existing rows pick up `country` on their next normal registerFamily call, which happens on every sync-config change for any active family.
- No Lambda test harness — out of scope; the preserved-merge logic is verified by the frontend integration test + manual backward-compat smoke.
- No country-change audit log — registry is not an event log; the latest value is what's stored.
- No region/timezone capture — separate future ask if needed; same pattern would apply.
- No automatic prod deploy — greg authorizes both the Vue deploy and the terraform apply.
