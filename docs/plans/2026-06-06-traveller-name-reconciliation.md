# Plan: Reconcile itinerary legal names with beanies family-member names

> Date: 2026-06-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-06-traveller-name-reconciliation.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section.

## User Story

As a family trip planner using the AI travel-extract wedge, I want the passenger names on a booking (full legal names, surname-first, ALL CAPS, with titles, or romanized) to be matched to the right beanies family members — and to confirm/correct any the app can't place, once — so that "who's travelling" on each segment is accurate without me re-entering people every trip.

## Context

The #30 "who's travelling" feature (shipped earlier today) matches the AI-extracted `travellers` names to family members via `matchTravellerIds` (`src/utils/segmentTravellers.ts`). That matcher only catches the case where the document's **first token** equals the member's name. Itineraries diverge from beanies names in several ways at once:

- **Format:** `SMITH/JONATHAN MR`, surname-first, ALL CAPS, honorifics (`MR`/`MRS`/`MSTR`/`MISS`/`DR`), middle names/initials, PNR/slash artefacts.
- **Nicknames & roles:** legal `Jonathan` → beanies `Johnny`; members named `Dad`/`Mum`/`greg` — no formatting can bridge these.
- **Transliteration:** Chinese members appear romanized/pinyin and surname-first on tickets.

Today an unmatched name silently falls back to "everyone on the trip" — safe but inaccurate, and it never improves.

**Chosen direction (greg):** "Code + confirm-and-learn", PLUS asking the LLM to **normalize the name format** it returns ("first_name last_name, strip titles, slashes, etc.") so code matching and the learned aliases stay clean and stable. The LLM does **format** normalization (no roster sent — document-only, ADR-030 intact); **identity** matching + confirmation + learning stay local in code. The two halves are complementary: normalization fixes caps/order/titles; alias-learning fixes nicknames/roles that formatting can't.

## Requirements

1. **Prompt normalization (document-only, no roster sent).** Instruct the model to return each `travellers` entry canonically: given-name then family-name order, Title Case, honorifics/titles stripped, slashes/PNR artefacts removed, middle names/initials dropped. Applied to all three drift-pinned prompt copies; `PROMPT_VERSION` bumps `2026-06-06.3` → `2026-06-06.4`. **We never send family member names to the model.**
2. **Defensive code normalizer.** A single pure `normalizePersonName(raw): string` (the model may not always comply, and BYOK/older proxies won't). Used by BOTH the matcher and the alias writer (one canonical form everywhere — DRY).
3. **Upgraded matcher.** `matchTravellerIds` normalizes both sides and matches a document name against each member's `name` AND a new per-member `aliases` list (all-token, not just first token). Keeps the deliberate **no-false-positive** stance: a bare token that matches 2+ members is ambiguous → no auto-match (left for confirmation), never a silent wrong assignment.
4. **Per-member aliases.** Add optional `aliases?: string[]` to `FamilyMember` (stored in the Automerge doc / `.beanpod` — local-first, encrypted, never sent anywhere). `Create/UpdateFamilyMemberInput` are `Omit`/`Partial<Omit<...>>` derivations of `FamilyMember`, so they inherit `aliases` automatically — no separate edit. Backfilled lazily (absent = none). The match list is `name + aliases`.
5. **Confirm-and-learn in the review modal.** In `TravelExtractReviewModal`, surface the **distinct** normalized traveller names found across the whole document, each with a family-member picker pre-filled with the matcher's best guess (matched → that member; unmatched → empty/"who's this?"). The user can correct any. On save, every name the user **explicitly assigns that the matcher did not already auto-resolve** is persisted as an alias on that member, so it auto-matches on every future trip.
6. **Resolution from the confirmed map.** Each segment's `travellerIds` is resolved from the user-confirmed name→member map (deduped). A segment that ends up with no mapped members resolves to the trip default (existing "everyone" fallback for new-trip union / dynamic for attach — unchanged).
7. **Backward-compat & flag posture.** Members without `aliases` behave exactly as today. The review modal only opens behind `aiTravelExtract` (prod-off), so the entire flow — including alias writes — is flag-gated; **no user-facing CHANGELOG entry** and no Help Center article ship now (consistent with the rest of #30). The managed-tier prompt change requires an `ai-extract` Lambda redeploy (greg, manual).

## Important Notes & Caveats

- **Do NOT send the roster to the LLM.** Prompt normalization is pure document formatting. Identity matching is local. This preserves ADR-030's "single document only" minimization.
- **No silent mis-assignment.** Ambiguous auto-matches (a token matching multiple members) must resolve to "unmatched → confirm", never a guess. This is the whole point of confirm-and-learn.
- **One canonical normalized form.** The matcher and the alias writer MUST share `normalizePersonName`, and aliases are STORED normalized — otherwise a learned alias won't match next time (different caps/order). Store + compare both via the same function.
- **Aliases are the user's own legal names, stored only in their encrypted local doc.** Never transmitted. Dedupe case-insensitively on write; never write an alias equal (normalized) to the member's own `name` (redundant) or already present.
- **Raw names must reach the modal.** The current mapper converts names→ids and discards the names. The new flow keeps the normalized names available to the modal (see Approach §4 data flow) so it can show the mapping UI; identity resolution moves to the confirm step.
- **The drift test** (`extractionPromptDrift.test.ts`) compares `PROMPT_VERSION` + `TRAVEL_JSON_SHAPE` + built messages across the three copies — the normalization instruction must be byte-identical in all three.
- **Don't over-nag.** When every extracted name auto-matches confidently, the mapping section should read as a quiet confirmation (pre-filled), not a chore; only unmatched names get visual emphasis.
- **Empty extraction.** If a document yields zero traveller names (none printed), show no mapping section; segments fall back to the trip default exactly as today.
- **Normalized-name collisions are by design.** `travellerMap` / `distinctTravellerNames` are keyed by normalized name, so two distinct travellers who normalize identically (e.g. two members both legally "Chris Lee") collapse to one mapping row → one member. Acceptable for this wedge; call it out so it reads as intended, not a silent bug.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-06).

1. `FamilyMember.name` is a single string; `CreateFamilyMemberInput = Omit<FamilyMember,'id'|'createdAt'|'updatedAt'>` and `UpdateFamilyMemberInput = Partial<Omit<...>>` (confirmed `models.ts:1251-1252`), so `aliases` propagates from the one `FamilyMember` edit. Writes flow `familyStore.updateMember(id, input)` → `familyRepo.updateFamilyMember` → Automerge (confirmed `familyStore.ts:250`).
2. `FamilyMemberModal.vue` is the member editor; a (flag-gated, optional) aliases viewer/editor would live there. Default: **defer** the standalone editor — auto-learn covers the need, and a wrong learned alias is correctable by greg during flag-on testing. (Revisit if Pass review finds it cheap + valuable.)
3. The review modal currently receives `TravelReady` and does NOT see raw names; we extend that payload (Approach §4).
4. `matchTravellerIds` is currently called inside the mapper via an injected resolver (added earlier today). This plan **moves resolution out of the mapper** to the confirm step; the mapper reverts to logistics + a names side-channel.
5. AI parts remain flag-off; greg redeploys the Lambda manually for managed-tier testing.

## Approach

### 1. Prompt normalization (3 drift-pinned copies + version bump)

In `scripts/spikes/extractionPrompt.mjs`, `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` (byte-identical):

- Bump `PROMPT_VERSION` → `2026-06-06.4`.
- Extend the `travellers` shape string + add one system line instructing canonical output: _"For each name in `travellers`, output it as 'Given Surname' in Title Case: drop honorifics/titles (Mr, Mrs, Ms, Mstr, Master, Miss, Dr, etc.), remove slashes and booking-code artefacts, reorder surname-first names to given-name-first, and omit middle names/initials. Example: 'SMITH/JONATHAN MR' → 'Jonathan Smith'."_ Keep it identical across copies.

### 2. Shared name helpers (`src/utils/segmentTravellers.ts`)

- `normalizePersonName(raw: string): string` — trim + collapse whitespace; if a single `/` splits into two parts, reorder to `given family`; strip honorific tokens; strip punctuation (`.`/`,`); Title Case; return. Pure, total, unit-tested. The same function is the canonical form for aliases. **Scope is deliberately closed to avoid creeping special-casing:** a fixed honorific set (mr, mrs, ms, mstr, master, miss, dr, prof, sir, madam — no open-ended growth), single-`/` reorder only (0 or 2+ slashes → whitespace-normalized, not parsed), no recursive/heuristic name parsing. Anything not covered falls through to confirm-and-learn — we do NOT add per-format branches.
- Upgrade `matchTravellerIds(names, roster): UUID[]` (keep the public signature — the existing call sites/tests use `(names, roster)`; the modal calls `matchTravellerIds([name], roster)` for a single best guess). Resolve **per input name** internally (the current implementation flattens all names into one id Set, which can't express per-name ambiguity — refactor to iterate names):
  - Build, per member, a normalized set: `{ normalize(name), ...aliases.map(normalize) }`.
  - For each input name `n` (normalized): collect the members whose normalized set contains `n`, OR (single-token `n`) whose normalized `name`/alias token equals `n`.
  - **Ambiguity guard (per name):** if that one name resolves to >1 distinct member, drop it (unmatched) — never guess. Union the surviving single-member hits across names; dedupe. (Keeps the existing one-way intent: a bare first token must not match a fuller member name spuriously.)
- Keep `resolveSegmentTravellers` / `isTravellerSubset` / `unionTravellerIds` as-is.
- New pure **exported** helper `learnableAliases(confirmedMap, autoMatches, roster)` in `segmentTravellers.ts` (one home — NOT inline in the modal, so it's unit-testable and the modal stays a thin consumer) → the list of `{ memberId, alias }` the user set that the matcher didn't already produce, excluding aliases equal (normalized) to the member's own name or already present. Used by the alias-learning write.
- New pure **exported** helper `dedupedAppend(existing: string[] | undefined, additions: string[]): string[]` in `segmentTravellers.ts` — appends `additions` to `existing ?? []`, case-insensitively de-duplicated against existing entries and each other, order-stable. Takes a list (not one) so the alias write can append all of a member's new aliases in one call (see §4).

### 3. Data model

- `src/types/models.ts`: add `FamilyMember.aliases?: string[]` ONLY. `Create/UpdateFamilyMemberInput` inherit it automatically via their existing `Omit`/`Partial<Omit<...>>` derivations (`models.ts:1251-1252`) — do NOT edit the input types (a manual edit would drift). No migration (optional field, absent = none).

### 4. Data flow: carry normalized names to the modal, resolve on confirm

**Mapper (`travelExtractionToSegments.ts`) — revert the resolver injection; produce names instead.** Change the return to `{ buckets, travellerNamesBySegmentId }` where `travellerNamesBySegmentId: Record<UUID, string[]>` holds each produced segment's normalized `travellers` (apply `normalizePersonName` defensively here so downstream is uniform). The three `to*` factories stay logistics-only; the loop records names keyed by the generated segment id. Segments are produced WITHOUT `travellerIds`. **Keying invariant:** the segment `id` minted in the `to*` factory (`generateUUID()`) is the SAME id used as the `travellerNamesBySegmentId` key AND the id that survives unchanged through `unionTravellerIds`/`materializeUnmatchedTravellers`/`createVacation`/`addExtractedSegments`, so `onReviewSubmit` resolves `travellerNamesBySegmentId[seg.id]` directly on `ready.buckets` segments before persistence — no id remapping.

**`useDocumentToTravel.ts`:** stop building a `matchTravellerIds` resolver for the mapper. Pass the names through on `TravelReady`:

- Add to `TravelReady`: `travellerNamesBySegmentId: Record<UUID, string[]>` and a derived `distinctTravellerNames: string[]` (deduped, normalized union).

**`TravelExtractReviewModal.vue`:** when `distinctTravellerNames` is non-empty, render a "Who are these travellers?" section: one row per distinct name → the existing **`FamilyChipPicker` (`@/components/ui/FamilyChipPicker.vue`) with `mode="single"`** (reuse — do NOT build a new dropdown; single mode emits `''` on deselect / the member id on select). It already defaults to `familyStore.sortedHumans` when `members` is omitted (`FamilyChipPicker.vue:48-50`), so no `:members` prop is needed. Pre-fill via `matchTravellerIds([name], familyStore.sortedHumans)` (best guess; unmatched → empty). Local reactive `nameToMemberId: Record<string, string>`. Unmatched rows visually flagged ("who's this?"). The existing trip-target chooser + segment summary stay.

**Emit:** extend the `submit` payload with `travellerMap: Record<normName, memberId>` and `aliasesToLearn: Array<{ memberId: string; alias: string }>`. **Update BOTH** the modal's `defineEmits` `submit` type AND `onReviewSubmit`'s parameter type to `{ target; tripName; travellerMap; aliasesToLearn }`, and include the two new fields at **both** `emit('submit', …)` call sites (new-trip + attach branches). Compute `aliasesToLearn` via the exported `learnableAliases(nameToMemberId, autoMatches, roster)`, where `autoMatches` is the per-name pre-fill result from `matchTravellerIds([name], roster)` **captured at modal-open** (not recomputed at save) — so a learned alias is exactly "what the user changed", stable even if the roster mutates mid-session. `saveDisabled` does NOT require every name mapped (unmapped is allowed → contributes nobody).

**`TravelPlansPage.onReviewSubmit`:** the payload is exactly `{ target, tripName, travellerMap, aliasesToLearn }`.

- **Resolve FIRST:** for each segment, `travellerIds = unique(travellerNamesBySegmentId[seg.id]?.map((n) => travellerMap[n]).filter(Boolean))`; empty → leave `travellerIds` undefined. (`travellerNamesBySegmentId` lives on `ready`; `travellerMap` is the consumed emit artifact.) Do this **before** the existing `unionTravellerIds(ready.buckets)` + `materializeUnmatchedTravellers` create-path logic (lines ~118-126/148-149), so that logic works unchanged on resolved buckets; the attach path still leaves unmapped ids undefined.
- **Persist learning AFTER the trip save succeeds:** **group `aliasesToLearn` by `memberId`** and issue ONE `familyStore.updateMember(memberId, { aliases: dedupedAppend(member.aliases, additions) })` per member (read each member's current `aliases` once, append the whole group). **Never issue two sequential `updateMember` calls for the same member in this loop** — the second would read stale pre-first `aliases` and clobber the first. Wrap the whole learning loop in ONE `try/catch` placed after the trip save (mirrors the existing document-attach block exactly): on failure → single `console.error('[travel-extract] alias learning failed:', err)` + one warning toast (`travelExtract.aliasLearnFailed.*` keys), and **never block or roll back the saved trip**. Nothing silent.

### 5. (Optional, deferred) Member alias editor

Defer a standalone aliases editor in `FamilyMemberModal.vue` unless a review pass finds it cheap. If included, gate it behind `aiTravelExtract` (its only purpose is the flag-off feature) and keep it a simple chip add/remove bound to `aliases`. Not required for the core loop.

### 6. Tests

- `normalizePersonName`: ALL CAPS, `SURNAME/GIVEN`, titles (Mr/Mstr/Miss), middle names, punctuation, pinyin/romanized, already-clean passthrough, empty.
- `matchTravellerIds`: alias hit, normalized-format hit, surname-first hit via normalization, nickname miss (no alias) → unmatched, ambiguity guard (token matching 2 members → unmatched), dedupe, empty roster.
- Mapper: returns names side-channel keyed by segment id; segments have no `travellerIds`; still 1:1 (no split); names normalized.
- Confirm reducer / `learnableAliases`: only manual (non-auto) assignments learned; never learns the member's own name or a dupe.
- `dedupedAppend`: appends, case-insensitive dedupe vs existing + within additions, order-stable, `undefined` existing → additions.
- `onReviewSubmit` resolution: segment ids resolved from confirmed map; unmapped → trip default; **two aliases for the SAME member in one save → a single `updateMember` with both appended (no clobber)**; alias-write failure doesn't block save.
- Drift test green with `2026-06-06.4`.

## Files Affected

**Model & shared logic**

- `src/types/models.ts` — `FamilyMember.aliases?: string[]` only (Create/UpdateFamilyMemberInput inherit via `Omit`/`Partial` — no separate edit).
- `src/utils/segmentTravellers.ts` — `normalizePersonName`, upgraded per-name `matchTravellerIds`, alias-learning helper.
- `src/utils/__tests__/segmentTravellers.test.ts` — extend.

**AI pipeline (flag-gated)**

- `scripts/spikes/extractionPrompt.mjs`, `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — normalization instruction + `PROMPT_VERSION` `.4`.
- `src/utils/travelExtractionToSegments.ts` — drop the `resolveTravellerIds` param (added earlier today); return `{ buckets, travellerNamesBySegmentId }`; normalize names. The `withTravellers` resolver helper is removed.
- `src/utils/__tests__/travelExtractionToSegments.test.ts` — **replace** the resolver-based cases (the "resolves multiple names onto ONE segment", "applies the resolver across all three kinds", "leaves travellerIds absent…" tests) with names-side-channel assertions; keep the logistics/no-split/no-leak cases.
- `src/composables/useDocumentToTravel.ts` — thread names onto `TravelReady`; stop building the mapper resolver.

**Review modal + orchestration**

- `src/components/travel/TravelExtractReviewModal.vue` — name→member mapping section; extend emit.
- `src/pages/TravelPlansPage.vue` — `onReviewSubmit` resolves segments from the confirmed map + persists learned aliases (warn-not-block).

**i18n**

- `src/services/translation/uiStrings.ts` — mapping-section labels + `travelExtract.aliasLearnFailed.*` (en + lowercase beanie); `npm run translate`.

**(Optional, deferred)**

- `src/components/family/FamilyMemberModal.vue` — flag-gated aliases editor.

## Acceptance Criteria

- [ ] Model returns canonical `travellers` ("Jonathan Smith"); a defensive `normalizePersonName` produces the same form for non-compliant input.
- [ ] `matchTravellerIds` matches via name + aliases with normalization; surname-first/caps/titled names hit; ambiguous tokens never auto-match.
- [ ] `FamilyMember.aliases?` added; existing members load unchanged.
- [ ] The review modal shows distinct traveller names with member pickers, pre-filled with best guesses, unmatched flagged; mapping is optional.
- [ ] Confirmed map resolves each segment's `travellerIds`; unmapped names → trip default; the new-trip union still works.
- [ ] Manually-assigned (non-auto) names are persisted as normalized aliases on the member; a repeat itinerary auto-matches them; alias-write failure warns but never blocks the save.
- [ ] No roster is ever sent to the LLM; drift test green with `PROMPT_VERSION 2026-06-06.4`.
- [ ] i18n en+beanie present; `npm run translate` clean; `npm run validate` green.
- [ ] Flag-off → no user-facing CHANGELOG entry; Lambda-redeploy note recorded.

## Testing Plan

1. **Unit** — normalizer, matcher (incl. ambiguity guard + alias hits), mapper names side-channel, learn-aliases reducer, onReviewSubmit resolution + alias write + failure-doesn't-block, drift test. Run `npm run validate`.
2. **Manual (dev, flag on)** — upload an itinerary with `SMITH/JONATHAN MR`: modal shows "Jonathan Smith" pre-mapped (if alias exists) or unmatched. Map it to "Johnny" → save → re-upload a different airline's ticket for the same person → now auto-mapped. A doc with no names → no mapping section, segments default to everyone.
3. **Manual (managed tier)** — after the Lambda redeploy, confirm the model returns normalized names end-to-end.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the four-part design — document-only prompt normalization (+version bump), shared `normalizePersonName`, upgraded alias-aware matcher with an ambiguity guard, `FamilyMember.aliases`, and a confirm-and-learn mapping step in the review modal (names threaded via `TravelReady`, resolution moved out of the mapper to the confirm step, learned aliases persisted warn-not-block). All flag-gated.
- **Pass 2 (DRY + error handling)**: Verified against the code and tightened — `aliases` on `FamilyMember` auto-propagates to the input types (dropped the redundant edit); reuse `FamilyChipPicker mode="single"` + `:members` for the per-name picker (no new dropdown); refactor `matchTravellerIds` to resolve per-name so the ambiguity guard works (public signature unchanged); resolve segment ids from the confirmed map BEFORE the existing union/materialize create-path logic; alias-learning in its own post-save try/catch (warn-not-block, `aliasLearnFailed` toast); replace (not update) the resolver-based mapper tests.
- **Pass 3 (Sustainability)**: Closed `normalizePersonName`'s scope (fixed honorific set, single-slash only, no per-format branches — unhandled formats fall through to confirm-and-learn); gave `learnableAliases` one tested home in `segmentTravellers.ts`; removed the §3 self-contradiction (don't manually edit the input types); corrected the `FamilyChipPicker` import path + dropped the redundant `:members` prop; documented normalized-name collisions as intended behaviour.
- **Pass 4 (Fresh-eyes sweep)**: Caught a real correctness bug — learning two aliases for the same member in one save would clobber via a stale read; fixed by grouping `aliasesToLearn` by member and writing once per member. Defined/located `dedupedAppend` (list-taking); pinned the segment-id keying invariant end-to-end; made the `defineEmits`/`onReviewSubmit`/both-call-site signature change explicit; fixed `aliasesToLearn` to diff against auto-matches captured at modal-open; made `travellerMap` consumption explicit in the resolve expression. Privacy invariant (no roster to the LLM) re-confirmed.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> There is a potential issue with the who is travelling feature - the names on the itinerary would typically be full legal names, while names in beanies often will not match. How should we reconcile a legal name with a family member name in beanies? A couple options would be to send the list of family member names in the prompt and ask the model to do it's best to map an itinerary name to a fmaily member name, or try to do this at the code level with the result of the LLM. What do you think - and are there other options you can think of to address this issue?

### Clarifying answer (direction)

> I am leaning towards (1) [code + confirm-and-learn] but also to ask the LLM to normalize the name format it returns, to help the code-level confirmation be more effective. for example, the LLM should always return in a standard format (i.e. first_name last_name, strip titles, slashes, etc) which makes the code level matching easier. This in conjunction with code + confirm I think could be an effective solution.

</details>
