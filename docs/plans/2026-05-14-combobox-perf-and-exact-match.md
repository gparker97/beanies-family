# Plan: BaseCombobox perf cap + exact-badge promotion

> Date: 2026-05-14
> Related code: `src/components/ui/BaseCombobox.vue:123-132` (filter), `:30-43` (props); `src/utils/vacation.ts:789-803` (airport option shape); `src/constants/airports.ts` (4046 entries)

## Context

The travel/vacation flows recently expanded the airport list to **4046 entries** (auto-generated from OurAirports, `src/constants/airports.ts`). Two user-visible problems followed:

1. **Old/cheap Android phones hang or freeze when the airport picker opens.** Root cause is in `BaseCombobox.vue:123-132`: when the dropdown opens with no query, `filteredOptions` returns the entire 4046-element array, and Vue's `v-for` then renders 4046 DOM nodes up-front. DOM node creation at that volume is the bottleneck on weaker hardware — not the filter, which only kicks in once the user types.
2. **Searching the IATA code is too fuzzy.** Today's filter is `label.toLowerCase().includes(q)`. The airport label is `"Singapore - Singapore Changi (SIN)"`, so `SIN` (or `sin`) matches Singapore — but it also matches Singen, Sincelejo, Sindelfingen, and any airport with "sin" anywhere in the label. The exact-code match gets buried under fuzzy noise.

Greg's framing: don't trim the airport list (punishes families with unusual destinations to paper over a render-perf bug); fix the code. Also: make the exact-code promotion case-insensitive — both `SIN` and `sin` should surface Singapore Changi at position 0.

`buildAirportOptions()` (`src/utils/vacation.ts:789-803`) already puts the IATA code in `rich.badge`. The component has the data it needs structurally; the filter just doesn't use it yet.

## Approach

Make `BaseCombobox` itself smarter — applies generally (per greg's confirmation), so every callsite benefits: airport, airline, currency, country, account-type institutions, etc.

Three layered changes, all inside `BaseCombobox.vue`:

### Change 1 — `maxVisibleResults` prop, default 50

New prop with a sensible default. The filter result is always **rendered** capped to `maxVisibleResults`; the underlying filter universe stays full. When the filtered count exceeds the cap, render a small footer hint inside the dropdown: `Showing 50 of 4046 — keep typing to narrow`. Solves the render-hang in a single move — instead of 4046 DOM nodes on open, you mount 50.

Behaviour matrix:

| Total options | Empty query                | Query (matches 12) | Query (matches 200)         |
| ------------- | -------------------------- | ------------------ | --------------------------- |
| ≤50           | render all, no hint        | render 12, no hint | (impossible)                |
| >50           | render 50, hint with total | render 12, no hint | render 50, hint "50 of 200" |

### Change 2 — pre-built search index (computed)

Replace the per-keystroke `o.label.toLowerCase()` with a memoised index keyed off `props.options`:

```ts
const searchIndex = computed(() =>
  props.options.map((o) => ({
    option: o,
    searchKey: o.label.toLowerCase(),
    badgeUpper: o.rich?.badge?.toUpperCase() ?? null,
  }))
);
```

Built once when `props.options` changes (in practice: once per component mount for static lists like AIRPORTS), reused per keystroke. Filter becomes:

```ts
const matches = searchIndex.value.filter((idx) => idx.searchKey.includes(q));
```

Marginal perf gain on fast devices, meaningful on slow ones (4046 × `toLowerCase()` per keystroke → 4046 × `toLowerCase()` once).

### Change 3 — exact-`rich.badge` promotion (case-insensitive)

After substring-filtering, find an index whose `badgeUpper === query.toUpperCase().trim()`. If one exists and isn't already at position 0, splice it out and `unshift` it to the front. O(n) find + O(1) splice; doesn't perturb the rest of the order.

```ts
const upperQ = searchQuery.value.toUpperCase().trim();
if (upperQ) {
  const exactIdx = matches.findIndex((m) => m.badgeUpper === upperQ);
  if (exactIdx > 0) {
    matches.unshift(matches.splice(exactIdx, 1)[0]);
  }
}
```

`SIN` and `sin` both normalise to `"SIN"`, and match against `badgeUpper` which was uppercased at index time. Both queries route to the same exact match.

Partial badge match (`SI`, `SI*`) does NOT trigger promotion — only a full equality match does. This keeps the behaviour predictable: `SIN` jumps to top, `SI` just falls through to substring ranking.

### One small i18n addition

Cap-hint string needs translation keys (one for the footer body, using `{visible}` + `{total}` slots — same pattern as `family.hub.stats.summary` already in `uiStrings.ts`).

```ts
'combobox.showingHint': {
  en: 'Showing {visible} of {total} — keep typing to narrow',
  beanie: 'showing {visible} of {total} — keep typing to narrow',
},
```

Run `npm run translate` afterward to regenerate zh.

## Files affected

- `src/components/ui/BaseCombobox.vue` — new prop, computed search index, capped filter with exact-badge promotion, hint footer template (~50 lines net change)
- `src/services/translation/uiStrings.ts` — 1 new key
- `public/translations/zh.json` — regenerated automatically by `npm run translate`
- `src/components/ui/__tests__/BaseCombobox.test.ts` — NEW unit-test file with ~7 focused cases (~120 lines)

No caller changes. All existing BaseCombobox consumers (`OnboardingAccount.vue`, `TravelSegmentEditModal.vue` ×6, `AccountModal.vue` ×2, `TransportationEditModal.vue`, `VacationStep2.vue` ×2, `VacationStep4.vue`, etc.) automatically benefit from cap + exact-badge promotion.

## Tests

New file `src/components/ui/__tests__/BaseCombobox.test.ts` using `@vue/test-utils`. Focused cases:

1. **Cap kicks in**: 200 options + default 50 cap → renders 50 visible, hint footer present with "50 of 200" interpolation.
2. **No cap needed**: 10 options → renders all 10, no hint.
3. **Empty query + cap**: 4046 options + no query → renders first 50 alphabetically, hint shows "50 of 4046".
4. **Exact badge match — uppercase**: options include `{value:'SIN', rich:{badge:'SIN'}}`. Query `SIN` → SIN at position 0 even if multiple substring matches exist.
5. **Exact badge match — lowercase**: same options, query `sin` → SIN still at position 0 (case-insensitive promotion).
6. **Partial badge match does NOT promote**: query `SI` → no promotion; SIN ranked by alphabetical position in substring matches.
7. **Options without `rich.badge`**: behave identically to today (substring filter, no promotion logic fires).

## Multi-pass review

### Pass 1 — DRY audit

- ✅ Reuses existing `ComboboxOption.rich.badge` field — no new option shape.
- ✅ Single new prop (`maxVisibleResults`), single new translation key. No new abstractions.
- ✅ `buildAirportOptions()` already populates `rich.badge` with the IATA code — zero caller changes needed.
- ✅ Cap-hint string follows the existing `family.hub.stats.summary` `{slot}` interpolation pattern.

### Pass 2 — Sustainability

- The cap is per-prop, defaulting to 50 — any caller needing the legacy "render everything" behaviour can pass `:max-visible-results="Infinity"`.
- All existing comboboxes (currency, country, account-type, airline, cruise-line, etc.) automatically benefit from the cap + exact-badge promotion. No call-site churn.
- Adding more options to `AIRPORTS` later (or any other big list) doesn't degrade UX — the cap absorbs it.
- The search index is memoised by Vue's `computed`, so static lists build once and stay built.

### Pass 3 — Fresh-eyes correctness

- **Cap-after-filter ordering**: substring filter preserves the original `props.options` order (Array.filter is stable). Exact-badge promotion uses splice+unshift on only the one matched item; the rest of the order is unchanged. Predictable.
- **Empty-query semantics**: query is empty → substring match is `''` which matches every option → all options pass the filter → cap takes first 50. Behaviour: dropdown opens, first 50 visible alphabetically by IATA code, hint footer says "Showing 50 of 4046 — keep typing to narrow". User clearly sees the cue.
- **Cap vs short list**: if `props.options.length === 30` and `maxVisibleResults = 50`, no hint — all 30 already shown. Guard: `filtered.length > maxVisibleResults`.
- **Performance**: rendered DOM nodes drop from 4046 → 50, a ~98% reduction. Per-keystroke work also drops because we filter from a pre-lowercased index.
- **Case-insensitivity of promotion**: both `searchQuery.toUpperCase()` and `badgeUpper` (pre-uppercased at index time) are upper, so `SIN === SIN`, `sin === SIN`, `Sin === SIN`. All three queries promote.
- **Promotion doesn't fire on partial match**: `SI` uppercased = `SI`, no option has `badgeUpper === 'SI'`, no promotion.
- **Backward compat**: callers that don't set `rich.badge` see zero behaviour change beyond the cap. Callers that do (airports, future currency/country pickers) gain the promotion.
- **i18n / beanie mode**: new key has both en + beanie variants.
- **No callsite churn**: every existing `<BaseCombobox>` usage gets the new behaviour for free; no API break.

## Verification

1. **Type-check + lint + tests + build:**

   ```bash
   npm run validate
   ```

   New unit tests pass; existing 2216 stay green; build OK.

2. **Run translate:**

   ```bash
   npm run translate
   ```

   Generates zh for the new `combobox.showingHint` key.

3. **Manual smoke on localhost:5173:**
   - Open a vacation segment edit modal → airport picker.
   - With no query: dropdown shows ~50 airports + the "Showing 50 of 4046 — keep typing" hint. Should open fast on regular hardware.
   - Type `SIN` → Singapore Changi at position 0.
   - Type `sin` (lowercase) → Singapore Changi still at position 0.
   - Type `SI` → various SI\* matches, no promotion; SIN is somewhere in alphabetical order.
   - Type `London` → multiple London airports surface; cap-hint appears if there are >50 matches.
   - Sanity: open the currency picker / account-type picker (other BaseCombobox users) — verify no regression.

4. **Older-Android smoke (greg-driven, on actual hardware):**
   - Open the airport picker on the slow phone that was hanging.
   - Confirm it opens responsively now (not instant, but not hung).
   - Type a few characters; confirm filter is responsive.
   - If still slow, virtual scrolling is the next lever (out of scope for this PR).

## What this plan deliberately does NOT do

- Doesn't trim `AIRPORTS` — perf is solved at the rendering layer, full data preserved.
- Doesn't add a virtual-scrolling library — the cap should be sufficient.
- Doesn't extract `buildAirportOptions()` result to a module-level constant — orthogonal optimisation.
- Doesn't add a `searchOnly` mode — the cap + hint conveys the same UX cue.
- Doesn't change any consumer of `<BaseCombobox>` — pure component-level fix.
- Doesn't change the airport regeneration script (`scripts/updateAirports.mjs`).
