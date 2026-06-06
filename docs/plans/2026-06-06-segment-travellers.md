# Plan: "Who is travelling" on each travel / accommodation / transportation segment

> Date: 2026-06-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-06-segment-travellers.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section.

## User Story

As a family trip planner, I want to record **who** is on each individual segment of a trip — because not everyone travels on every leg (one parent flies in early, the kids share a different hotel room, only Dad takes the rental car) — so that the timeline reflects reality and the AI can complete the picture from a booking document without ever splitting one journey into one-row-per-person.

## Context

Travel segments (`VacationTravelSegment`, `VacationAccommodation`, `VacationTransportation`) currently capture the logistics of a leg (flight number, hotel, rental car) but **not who is on it**. The trip as a whole has `FamilyVacation.assigneeIds` (chosen in `VacationStep1`, confirmed `models.ts:798`), but there is no per-segment notion of travellers.

This is the second enhancement on the #30 AI travel wedge. Two halves:

1. **Manual (user-facing now):** a per-segment multi-select of family members, defaulting to the trip's travellers, editable per segment. Reuses the existing `FamilyChipPicker`. Ships to users on the next deploy.
2. **AI (flag-gated `aiTravelExtract`, prod-off):** the extraction prompt asks the model to return the passenger/traveller names it sees per segment; the mapper matches those names to family members and fills each segment's traveller list — **never** creating duplicate segments when several people share one booking.

The existing `terminal` field (added 2026-06-06) is the reference pattern for "add a field across the model, the three edit modals, the timeline display, the AI prompt, and the mapper." Verified: `terminal` was threaded through `TravelSegmentEditModal` (ref + `onEdit`/`onNew` init + `handleSave`), `buildTravelKeyValue`/`travelDetailRows` in `useVacationTimeline.ts`, `TRAVEL_FIELDS` + `TRAVEL_JSON_SHAPE`, and `uiStrings.ts` (`vacation.field.terminal`).

## Requirements

1. Add an optional `travellerIds?: UUID[]` field to all three segment types: `VacationTravelSegment`, `VacationAccommodation`, `VacationTransportation`.
2. **Default inheritance (resolution, not materialization for manual):** a segment with `travellerIds === undefined` resolves to the trip's current `assigneeIds` ("everyone on the trip"). When the user opens a segment's edit modal, the picker is pre-checked with the resolved travellers; the first save materializes the selection. Wizard-created and inline-created segments are left `travellerIds === undefined` (they read as "everyone" via resolution) — no add-site seeding needed (see Approach §4 for why this is simpler and correct).
3. **Manual editing:** each of the three segment edit modals (`TravelSegmentEditModal`, `AccommodationEditModal`, `TransportationEditModal`) gets a "Who's travelling" multi-select using `FamilyChipPicker` (`mode="multi"`, humans only), pre-populated with the segment's resolved travellers.
4. **Display (timeline):** on a collapsed segment card, show a compact avatar row **only when the segment's travellers are a strict subset of the full trip** (at least one trip member is NOT on this segment). When everyone on the trip is on the segment (or the field is unset → treated as "everyone"), show nothing. The **expanded** segment details **always** list the resolved travellers.
5. **AI extraction:** the three drift-pinned travel prompts gain a per-segment `travellers` array (names exactly as written in the document) plus an explicit instruction: a booking shared by multiple people is **ONE** segment with multiple travellers — never one segment per person. (The existing "a round-trip flight is two segments" rule is about distinct journeys and is unchanged.)
6. **AI name → member matching:** a pure helper matches the model's traveller names to family members (case-insensitive, trimmed). Per segment: matched names → those member ids; **no names, or none match → leave `travellerIds` unset** for that segment, which the orchestration layer then materializes to the trip default (see Requirement 7).
7. **AI new-trip travellers:** when the extraction creates a _new_ trip (no existing `assigneeIds` to inherit), the new trip's `assigneeIds` is set to the **union** of all segments' resolved travellers (replacing the current `assigneeIds: []` at `TravelPlansPage.onReviewSubmit:129`), and any segment that matched no names is materialized to that union. When _attaching_ to an existing trip, no `travellerIds` materialization is applied to unmatched segments — they stay undefined and resolve dynamically to the existing trip's `assigneeIds` (simpler, and correct: a document that named no one shouldn't pin a snapshot).
8. i18n: all new labels via `uiStrings.ts` as `{ en, beanie }` pairs (the file stores only `en` + lowercase `beanie`; `zh` and the other locales are generated by `npm run translate`, which must be run).
9. No regression to existing trips/segments: a segment with `travellerIds` undefined behaves as "everyone on the trip" everywhere (display, expanded details, edit-modal prefill).

## Important Notes & Caveats

- **Never split a segment per person.** This is the single most important AI rule. It lives in the prompt (instruction + schema wording). The mapper is already 1:1 (one draft → one segment); it does not split. No defensive de-dup is added.
- **Travellers names must not leak into `notes`.** Confirmed: `collectScalarFields` (extractionPrompt.ts:261) only copies `string`/`number` entries, so an array-valued `travellers` is naturally skipped from the flat-field sweep. We still add `'travellers'` to `SEGMENT_STRUCTURAL_KEYS` (extractionPrompt.ts:247) for explicitness, and parse it separately in `parseTravelSegment`. A unit test asserts it never appears in `fields`/`notes`.
- **Matching happens with the roster; the materialization happens with the trip context.** The pure mapper does not know the family roster or the target trip. It accepts ONE optional, pure resolver param — `resolveTravellerIds(names) => UUID[]` — applied **once** in its dispatch loop (the three `to*` factories stay logistics-only; see Approach §8). The **empty → trip-default** materialization and the **new-trip union** are applied in `onReviewSubmit`, where the trip target is known.
- **Member names are a single `name` field.** `FamilyMember.name` is one string (models.ts:86 — verified there is no separate first/last field, and `familyStore.sortedHumans` is `sortedMembers` filtered to `!isPet`). So `matchTravellerIds` matches a document name against `member.name` case-insensitively and trimmed, AND against the first whitespace-delimited token of the **document** name (so a ticket "John Smith" matches a member named "John"). **The asymmetry is deliberate:** we match the document-name's first token against the _full_ member name, but do NOT match the _member-name's_ first token against the document name. Symmetric first-token matching would let two members "John Smith" and "John Doe" both match a ticket "John …" — a silent false positive. Do NOT "improve" this into a symmetric match. Keep the match list deduped.
- **Pets:** travellers are humans-only. `FamilyChipPicker` defaults `includePets: false` (verified at `src/components/ui/FamilyChipPicker.vue:32`; it then sources `familyStore.sortedHumans`), and its own comment names "vacation travelers" as a humans-only context. So `<FamilyChipPicker v-model mode="multi" />` with no `include-pets` is exactly right; `matchTravellerIds` is built from `familyStore.sortedHumans`.
- **Activity-type travel segments.** `VacationTravelSegment` also covers `type === 'activity'` (a show, a museum visit), flowing through the same `TravelSegmentEditModal` and timeline loop. The "Who's travelling" field applies to them too — "who is on this item" is equally meaningful for an activity ("just the kids went to the aquarium"). The shared `vacation.field.travellers` label reads slightly generically for an activity but is acceptable; do NOT special-case a separate label — that forks the field for no real gain and breaks the single-field DRY pattern.
- **Backward compatibility / "everyone" semantics:** `travellerIds === undefined` means "the whole trip." No migration. The empty array `[]` ("nobody") is a _strict subset_; the edit modal prevents persisting `[]` by falling back to the trip default on save, so `[]` is never reachable from the UI.
- **AI prompt copies must stay byte-identical across all three files and `PROMPT_VERSION` must bump** (`2026-06-06.2` → `2026-06-06.3`). The drift test (`extractionPromptDrift.test.ts`) compares `PROMPT_VERSION`, `TRAVEL_JSON_SHAPE` (deep-equal), and `buildTravelExtractionMessages(...)` output across client/spike/server — so the new shape key AND the new system-message line must be identical in all three copies.
- **Manual segment travellers are user-facing** → CHANGELOG entry. **AI extraction is flag-off** → no user-facing CHANGELOG line for the AI half (consistent with the #30 posture).

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-06).

1. `FamilyVacation.assigneeIds` is the canonical trip-level traveller list (confirmed: `models.ts:798`, set in `VacationStep1`/`VacationWizard`, synced to the linked activity in `vacationStore.updateVacation`).
2. The timeline renders segments via `useVacationTimeline`'s `TimelineItem` (consumed in `TravelPlansPage.vue`). The composable already receives the full `vacation` (a `ComputedRef<FamilyVacation>`), so `vacation.value.assigneeIds` IS in scope inside `useVacationTimeline` — precompute the resolved travellers + the `showTravellers` (subset) boolean ON the `TimelineItem` inside the composable, keeping `TravelPlansPage`'s template dumb.
3. `MemberChip` (`size="dot"`) is the right primitive for the compact avatar row; confirmed it renders nothing for orphaned ids (safe in loops) and already carries `title`/`aria-label`. `size="sm"` is the name-pill variant for the expanded list.
4. The AI-created **new trip** path currently calls `createVacation` with `assigneeIds: []` (confirmed `TravelPlansPage.onReviewSubmit:129`); Requirement 7 changes that to the union of segment travellers. The **attach** path calls `vacationStore.addExtractedSegments` (confirmed line 138), which does NOT touch `assigneeIds` — correct, since attach inherits the existing trip's travellers by resolution.
5. The model can read passenger names off most tickets/itineraries; when it can't, the trip-default materialization (new trip) / dynamic resolution (attach) covers it.
6. `vacationStore.updateVacation`, `createVacation`, and `addExtractedSegments` all **spread** the objects they persist (confirmed `addExtractedSegments` spreads the segment arrays), so an unknown-to-them `travellerIds` key passes through untouched. No store change needed.

## Approach

### 1. Data model (`src/types/models.ts`)

Add to each of the three segment interfaces (`VacationTravelSegment` ~`models.ts:709`, `VacationAccommodation` ~`:729`, `VacationTransportation` ~`:755`, next to the existing `photoIds?` field):

```ts
/** Family members on THIS segment. Undefined = the whole trip (assigneeIds). */
travellerIds?: UUID[];
```

(Naming: `travellerIds` — matches the existing `assigneeIds`/`memberId` id-suffix convention and the UK spelling greg used.)

### 2. Shared traveller util (DRY — needed in 3 modals + display + AI)

Create `src/utils/segmentTravellers.ts` — pure, total, unit-tested (mirrors the `src/utils/*.ts` pure-helper convention used by `travelExtractionToSegments.ts` and `vacation.ts`). No store access. Exports:

- `resolveSegmentTravellers(travellerIds: UUID[] | undefined, tripAssigneeIds: UUID[]): UUID[]`
  → returns `travellerIds` when defined, else `tripAssigneeIds`. Single source of truth for the "undefined = whole trip" rule. Used by the edit-modal prefill, the expanded-details list, and the subset check.
- `isTravellerSubset(travellerIds: UUID[] | undefined, tripAssigneeIds: UUID[]): boolean`
  → `true` when the field is defined AND at least one trip member is absent from this segment. `undefined` → `false` (everyone → no row). Empty array → `true` (but unreachable from the UI). Drives the collapsed-card avatar row (Requirement 4).
- `matchTravellerIds(names: string[], roster: FamilyMember[]): UUID[]`
  → for each document name (trimmed, lowercased), match against each roster member's `name` (trimmed, lowercased), comparing both the full document name and its first whitespace token; collect matched member ids; dedupe; drop unmatched. Pure. Used by the AI resolver. (See Caveat: members have a single `name` field.)
- `unionTravellerIds(buckets: SegmentBuckets): UUID[]`
  → deduped union of every segment's `travellerIds` across the three arrays (skip undefined). Used for the AI new-trip `assigneeIds` (Requirement 7). `import type { SegmentBuckets }` from `travelExtractionToSegments.ts` (type-only — see cohesion note).

**Cohesion note (Pass 3):** these four helpers all operate on the same `travellerIds | undefined` / `tripAssigneeIds` / roster domain and are deliberately kept as small, independent, single-responsibility functions in one file — no shared mutable state, no class, no nesting. `isTravellerSubset` MUST be implemented as a single comparison pass (`const set = new Set(travellerIds); return travellerIds !== undefined && tripAssigneeIds.some((id) => !set.has(id))`), NOT by calling `resolveSegmentTravellers` then re-diffing — keep each helper's logic flat and self-contained so a change to one cannot silently alter another. The `SegmentBuckets` import is **type-only** (erased at compile), so there is no runtime cycle even though `travelExtractionToSegments.ts` also references this module's `matchTravellerIds` _indirectly_ (it receives the resolver as a param — it does not import it; see §8).

Components pass in `familyStore.sortedHumans` / `vacation.assigneeIds`; the helpers stay store-free and trivially testable.

### 3. Manual editing — the three edit modals

For each of `TravelSegmentEditModal.vue`, `AccommodationEditModal.vue`, `TransportationEditModal.vue` (identical pattern, mirrors how `terminal` was threaded). All three already receive `vacationId` and already call `vacationStore.getVacationById(props.vacationId)` for photoIds (confirmed: travel `:318`, accommodation `:136`, transportation `:173`), so the trip is one call away:

- Add a `travellerIds` ref: `const travellerIds = ref<string[]>([])`.
- A small computed for the trip default: `const tripAssigneeIds = computed(() => vacationStore.getVacationById(props.vacationId)?.assigneeIds ?? [])`.
- In `onEdit`: `travellerIds.value = resolveSegmentTravellers(seg.travellerIds, tripAssigneeIds.value)` — pre-checks the picker with the segment's explicit travellers or the trip default.
- In `onNew` (kept consistent even though the travel/accommodation/transportation add paths currently materialize the segment _before_ opening the modal — see §4): `travellerIds.value = [...tripAssigneeIds.value]`.
- **Placement (design decision):** the "Who's travelling" `FormFieldGroup` is placed **directly under the Status pill group** (the first group in all three modals — confirmed `TravelSegmentEditModal:474`) and **above** the kind-specific booking details. "Who is on this leg" is primary context set before the logistics, and mirrors `VacationStep1`'s trip-level "who's going" question one level down.
- The control is `<FamilyChipPicker v-model="travellerIds" mode="multi" />` (humans only — no `include-pets`), inside `<FormFieldGroup :label="t('vacation.field.travellers')">`.
- In `handleSave`, include `travellerIds` on the rebuilt segment object: `travellerIds: travellerIds.value.length ? travellerIds.value : tripAssigneeIds.value` — so clearing all falls back to the trip default and `[]` is never persisted (see Caveat). The existing `handleSave` already rebuilds the whole segment via spread + explicit fields and calls `updateVacation`; add the one key there.

**Triplication — deliberate, not a refactor target (Pass 3):** the three modals already duplicate this exact ref-init-save shape for `status`, `photoIds`, and `terminal`. Extracting a shared `useSegmentTravellers(vacationId, getSeg)` composable to remove the ~5 added lines per modal would _increase_ coupling (the composable would need to know each modal's differing index prop and segment-array name) for a marginal LOC saving, and would diverge from the established per-field convention these modals already follow. **Do NOT introduce a shared modal composable here** — keep the three additions parallel and obvious, matching the `terminal` precedent. The genuinely shared logic (the resolve/subset/match rules) already lives in `segmentTravellers.ts` (§2), which is the correct seam.

**Error handling:** these modals already wrap save in `validation.attemptSave(async () => { … })` with a `try/finally` resetting `isSubmitting`, and early-return on missing vacation. No new failure surface is introduced (the picker is pure local state; `getVacationById` returning undefined is already handled by the `?? []` default and the existing `if (!vacation) return` guard). No silent failure path is added.

### 4. Manual add (wizard + inline) — why no add-site seeding

New segments are created in three places, none of which need to seed `travellerIds`:

- Wizard steps `VacationStep2/3/4` build new segments via `generateUUID()` + emit `update:segments` (e.g. `VacationStep2.addSegment`, `:159`). These steps do **not** receive `assigneeIds` as a prop (`VacationStep2` props are `tripType`, `tripStartDate`, `tripEndDate`, `segments` only — the wizard holds `assigneeIds` as a local ref). Threading a new `assigneeIds` prop through three steps purely to stamp a redundant snapshot is bloat.
- `TravelPlansPage.addActivitySegment` (`:511`) creates a bare segment inline, then opens the edit modal.

Because `travellerIds === undefined` already **resolves** to the trip's current `assigneeIds` everywhere (display, expand, modal prefill via §2/§3), a freshly-added segment correctly reads as "everyone on the trip" with zero extra code. The user's first save through the edit modal materializes their choice. This satisfies Requirement 2 for the manual flow without touching the wizard steps at all.

**One nuance vs. Requirement 2's "later trip-travellers change does not rewrite existing segments":** for an _unedited_ segment (still `undefined`), a later change to trip travellers WILL change its resolved set — which is the desired "this segment follows the trip" behavior until the user explicitly pins it. The "don't rewrite" guarantee applies to segments the user (or AI) has explicitly set, and those carry a concrete `travellerIds` array that resolution returns verbatim. This is the simplest correct model and matches user intent ("I only pinned the ones that differ"). Document this in the helper's doc comment.

### 5. Display — collapsed avatar row + expanded list (in the composable)

- **`useVacationTimeline.ts`:** the composable already has `vacation.value` (hence `assigneeIds`) in scope. Add two fields to `TimelineItem` (`interface TimelineItem` at `:36`):
  - `travellers: string[]` — the resolved traveller ids (`resolveSegmentTravellers(seg.travellerIds, v.assigneeIds)`), used for the always-on expanded list.
  - `showTravellers: boolean` — `isTravellerSubset(seg.travellerIds, v.assigneeIds)`, used to gate the collapsed avatar row.
    Populate both in all three per-kind loops (travel ~`:321`, accommodation ~`:374`, transportation ~`:473`) via a single shared local expression so the three call sites stay byte-identical and a future field rename touches one place each. This keeps the subset/resolve logic in one tested place and the template dumb.
- **`TravelPlansPage.vue` — collapsed card (subset only):** where the collapsed segment title row renders (the `openEditModal(item)` card region around `:1259`/`:1450`), add `v-if="item.showTravellers"` → a **right-aligned overlapping stack of `<MemberChip :member-id size="dot" />`** (16px initial circles, `-ml-1.5` overlap). `MemberChip` renders nothing for orphaned ids, so the loop is safe. The whole stack gets a `:title`/`aria-label` listing the resolved names for accessibility.
- **`TravelPlansPage.vue` — expanded details (always):** at the TOP of the expanded section, a dedicated "Travelling" row rendered as wrapping `<MemberChip :member-id size="sm" />` name pills over `item.travellers`. Distinct from the text `detailRows` so names are legible once the segment is open.
- The avatar row / traveller pills are a **separate template element**, not folded into the `keyValue` summary string (travellers are members, not text, and the collapsed rule is conditional).
- **Capped-stack `+N` — keep the math in the composable, not the template (Pass 3):** a family is realistically <8 members, so the dot stack is uncapped by default — render `item.travellers` directly. **If** real data shows it needs a cap, compute `visibleTravellers: string[]` and `overflowCount: number` on the `TimelineItem` (not `travellers.slice(0,4)`/arithmetic inline in the template). Do not add these two fields speculatively — only if the cap actually ships.
- **Design rationale (re: greg's `/frontend-design` ask):** dots-when-subset keeps the collapsed timeline calm (no redundant "everyone" badges) while making exceptions ("just Dad", "kids only") pop; name pills on expand give full legibility. Both reuse `MemberChip`, so sizing/colour/dark-mode are inherited — zero new visual primitives.

### 6. AI prompt (all three drift-pinned copies + `PROMPT_VERSION` bump)

In `scripts/spikes/extractionPrompt.mjs`, `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` (keep byte-identical — the drift test deep-equals `TRAVEL_JSON_SHAPE` and the built messages):

- Bump `PROMPT_VERSION` `2026-06-06.2` → `2026-06-06.3` in all three.
- In `TRAVEL_JSON_SHAPE`, add a `travellers` key (identical string in all three):
  `travellers: 'array of strings — the names of the people on THIS segment exactly as written on the booking/ticket (e.g. ["John Smith","Mary Smith"]), or [] if no names are shown. A booking shared by several people is ONE segment with multiple names here — NEVER output a separate segment per person.'`
  Also mention `travellers` in the relevant `*Fields` guidance string if it reads naturally — but the standalone key is the load-bearing change.
- Add one system-message line to `buildTravelExtractionMessages` (identical in all three copies, since the test compares the built message array): _"If one booking covers multiple passengers, return a single segment and list every passenger in that segment's `travellers`. Never duplicate a segment to represent different passengers."_
- `travellers` is **NOT** added to `TRAVEL_REQUIRED_KEYS` (keeps an older deployed proxy parsing — same posture as `categoryHint`, confirmed at extractionPrompt.ts:140).

### 7. AI parsing (`parseTravelSegment` → `TravelSegmentDraft`)

- Add `travellers: string[]` to `TravelSegmentDraft` (`src/services/ai/types.ts:100`).
- Add `'travellers'` to `SEGMENT_STRUCTURAL_KEYS` (extractionPrompt.ts:247) so the flat-field sweep never copies it into `fields`.
- In `parseTravelSegment` (extractionPrompt.ts:274), read it defensively from BOTH the top level and the nested `*Fields` objects (it could land in `travelFields`). **Extract the list-of-strings coercion into a tiny named local helper** `toStringList(raw): string[]` rather than inlining a 4-method chain at the read site — a named helper reads clearly and is independently testable:
  `const rawTravellers = obj.travellers ?? nested.travellers; travellers: toStringList(rawTravellers)` where `toStringList(raw) = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : []`.
  Because `collectScalarFields` only copies scalars, the array never leaks into `fields`/`notes`; the explicit structural-key + dedicated parse make this unambiguous and testable. Note: if `travellers` is nested under `travelFields`, `Object.assign(nested, sub)` (extractionPrompt.ts:292) already captures it, so reading from `nested` covers that path.

### 8. AI mapping (`travelExtractionToSegments`) — inject a resolver, apply once

- Change the signature to `travelExtractionToSegments(result, resolveTravellerIds?: (names: string[]) => UUID[]): SegmentBuckets`. Backward compatible (optional → existing tests unaffected).
- **Single application point (Pass 3 — reduce coupling):** rather than spreading the resolver call into each of `toTravelSegment` / `toAccommodation` / `toTransportation`, apply it **once** in the top-level dispatch loop after the per-kind factory returns its base segment:
  ```ts
  const seg = toTravelSegment(draft); // (or toAccommodation / toTransportation)
  const ids = resolveTravellerIds?.(draft.travellers) ?? [];
  if (ids.length) seg.travellerIds = ids;
  buckets.<kind>.push(seg);
  ```
  This keeps the three pure `to*` factories focused solely on logistics-field mapping (their existing single responsibility) and confines the new traveller concern to one place. The `to*` factories do not gain a parameter. A no-match yields an **absent** `travellerIds` key, which the orchestration layer materializes for the create path / leaves dynamic for the attach path. Resolver stays pure.

### 9. AI orchestration — resolver injection + new-trip union

- In `useDocumentToTravel.ts` (`:101`), build the resolver from the roster and pass it to the mapper:
  `const resolve = (names: string[]) => matchTravellerIds(names, familyStore.sortedHumans)` then `travelExtractionToSegments(result.data, resolve)`. (Add `useFamilyStore` + the `matchTravellerIds` import; the composable currently imports `useVacationStore` only.)
- In `TravelPlansPage.onReviewSubmit` (`:109`), apply the new-trip union now that the target is known. **Extract the materialization into one small named local** `materializeUnmatched(buckets, defaultIds)` so the create branch reads as two clear steps rather than a triple-nested loop sitting inside `onReviewSubmit`:
  - **Create:** `const defaultIds = unionTravellerIds(ready.buckets)`; then `materializeUnmatched(ready.buckets, defaultIds)` sets `travellerIds = defaultIds` on every segment across the three arrays that has none. Pass `assigneeIds: defaultIds` to `createVacation` (replacing the current `assigneeIds: []` at `:129`).
  - **Attach:** no change — `addExtractedSegments` appends the buckets as-is; unmatched segments stay `travellerIds`-undefined and resolve to the existing trip's `assigneeIds`. (Materializing them would pin a snapshot the document never asserted; dynamic resolution is both simpler and more correct.)
  - Use the shared pure helpers; keep the mutation localized and obvious. Wrap nothing new — the existing `try/catch` around the save (`:124`–`:146`) already reports failures via toast + `console.error`, so no silent failure is introduced.

### 10. Store

No new store method or change needed — confirmed `updateVacation`/`createVacation`/`addExtractedSegments` spread the objects they persist, so `travellerIds` and the new `assigneeIds` flow through unchanged.

## Files Affected

**Model & shared logic**

- `src/types/models.ts` — `travellerIds?: UUID[]` on the 3 segment interfaces.
- `src/services/ai/types.ts` — `travellers: string[]` on `TravelSegmentDraft`.
- `src/utils/segmentTravellers.ts` _(new)_ — `resolveSegmentTravellers`, `isTravellerSubset`, `matchTravellerIds`, `unionTravellerIds` (pure, single-responsibility, no cross-calls).
- `src/utils/__tests__/segmentTravellers.test.ts` _(new)_.

**Manual UI**

- `src/components/travel/TravelSegmentEditModal.vue`
- `src/components/travel/AccommodationEditModal.vue`
- `src/components/travel/TransportationEditModal.vue`
- `src/composables/useVacationTimeline.ts` — `travellers` + `showTravellers` (+ optional `visibleTravellers`/`overflowCount` only if the +N cap ships) on `TimelineItem`, populated in all three loops.
- `src/pages/TravelPlansPage.vue` — collapsed avatar row (`v-if="item.showTravellers"`) + always-on expanded list + new-trip union (`materializeUnmatched` local) in `onReviewSubmit`.
- _(No change to `VacationStep2/3/4.vue` — see Approach §4. New segments inherit "everyone" by resolution.)_

**AI (flag-gated)**

- `scripts/spikes/extractionPrompt.mjs`
- `src/services/ai/extractionPrompt.ts` (+ `parseTravelSegment` with a `toStringList` local, `PROMPT_VERSION`, `SEGMENT_STRUCTURAL_KEYS`)
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs`
- `src/utils/travelExtractionToSegments.ts` — optional resolver param applied once in the dispatch loop (factories unchanged).
- `src/composables/useDocumentToTravel.ts` — build + inject resolver (add `useFamilyStore`).
- `src/utils/__tests__/travelExtractionToSegments.test.ts` — extend.
- `src/services/ai/__tests__/extractionPromptDrift.test.ts` — no change needed (the bumped version + new shape key + new message line flow through the existing assertions automatically).

**i18n**

- `src/services/translation/uiStrings.ts` — `vacation.field.travellers` (`{ en: "Who's travelling", beanie: "who's travelling" }`) + a `vacation.field.travelling` label for the expanded "Travelling" row if needed; `npm run translate`. (Entries are `{ en, beanie }` only; other locales are generated.)

**Docs**

- `CHANGELOG.md` — Added (manual per-segment travellers; user-facing half only).

## Acceptance Criteria

- [ ] All three segment types carry optional `travellerIds`; existing trips load unchanged.
- [ ] Each edit modal shows a "Who's travelling" multi-select pre-filled with the segment's resolved travellers (segment value or trip default); saving persists the selection; clearing all falls back to the trip default (no empty persisted).
- [ ] A newly-added (unedited) segment reads as "everyone on the trip" via resolution; the user's first save materializes their choice; a materialized choice is not rewritten when trip travellers later change.
- [ ] Collapsed card shows the avatar row **only** when `item.showTravellers` (strict subset); expanded details always list `item.travellers`.
- [ ] AI: a multi-passenger booking yields ONE segment with multiple travellers — verified on a real shared-booking document; no per-person duplicate segments.
- [ ] AI: passenger names match to members; segments with no/unmatched names default to the trip travellers (new-trip union for create; dynamic resolution for attach); a new AI-created trip's `assigneeIds` = union of segment travellers.
- [ ] AI: traveller names never appear in a segment's `notes` or `fields` (unit test).
- [ ] All three prompt copies are byte-identical and `PROMPT_VERSION` is bumped; the drift test passes.
- [ ] The four `segmentTravellers` helpers are independent (no helper calls another); `isTravellerSubset` and `resolveSegmentTravellers` each pass their own unit tests in isolation.
- [ ] i18n keys present as `{ en, beanie }`; `npm run translate` clean.
- [ ] `npm run validate` green (type-check, lint, format, unit tests, build).
- [ ] CHANGELOG updated (manual half).

## Testing Plan

1. **Unit — `segmentTravellers.test.ts`:** `resolveSegmentTravellers` (undefined→trip, defined→itself, defined-empty→empty); `isTravellerSubset` (undefined→false, full set→false, strict subset→true, empty→true); `matchTravellerIds` (exact name, first-token match, case/space-insensitive, no-match→[], dupes deduped, empty roster→[]); `unionTravellerIds` (dedup across the 3 arrays, skips undefined).
2. **Unit — `travelExtractionToSegments.test.ts` (extend):** with a resolver, a draft naming two members → ONE segment with both ids in `travellerIds`; a draft with no names / no resolver → no `travellerIds` key; resolver applied once in the loop (each kind gets `travellerIds`); names never leak to `fields`/notes; still 1:1 (no split).
3. **Unit — `parseTravelSegment` / `toStringList`:** `travellers` parsed from a top-level array AND from a nested `travelFields.travellers` array; garbage/missing → `[]`; non-string entries filtered; `travellers` absent from `fields`.
4. **Unit — drift test:** passes with the bumped `PROMPT_VERSION`, the new `TRAVEL_JSON_SHAPE.travellers` key, and the new system-message line identical across all three copies.
5. **Manual (dev):** add a flight, edit travellers to "just Dad" → collapsed card shows a one-dot row; set it back to everyone → row disappears; expand → list always present. New segment reads as everyone. Legacy trip (no field) shows no rows.
6. **Manual (flag-on, greg):** upload a real multi-passenger itinerary → one segment per journey, travellers populated; upload a doc with no names → new trip's `assigneeIds` = union, segments materialized to it; attach-to-existing case leaves unmatched segments resolving to the existing trip travellers.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — model field on 3 segment types, shared pure helpers, 3 edit modals, wizard default-inherit, timeline subset avatar row, all-three-copies prompt change + PROMPT_VERSION bump, draft parsing, mapper resolver injection, and orchestration-layer fallback + new-trip union.
- **Pass 2 (DRY + error handling)**: Verified reuse claims against the codebase and tightened: dropped wizard add-site seeding (undefined already resolves to "everyone"); moved resolve/subset computation into `useVacationTimeline` (it already has `assigneeIds` in scope); corrected `matchTravellerIds` to a single-`name` member model; fixed i18n to `{ en, beanie }`-only; simplified the AI attach path to dynamic resolution (union only on create).
- **Pass 3 (Sustainability)**: Confined the AI traveller resolver to a single application point in the mapper's dispatch loop (the three `to*` factories stay logistics-only); mandated the four `segmentTravellers` helpers be independent/flat (no helper-calls-helper); pushed any `+N` cap arithmetic out of the Vue template into composable-computed fields (added only if the cap actually ships); extracted `toStringList` and `materializeUnmatched` named locals to avoid inline chains and a triple-nested loop in `onReviewSubmit`; explicitly ruled OUT a shared modal composable; confirmed the `SegmentBuckets` import is type-only (no runtime cycle).
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every load-bearing codebase claim (terminal precedent, scalars-only sweep, humans-only picker default, both store paths spread, drift test is pairwise not snapshot, MemberChip sizes/orphan-safety, `ready.buckets` is `SegmentBuckets`) — all confirmed. Corrected Assumption 2 wording (`ComputedRef<FamilyVacation | undefined>`); added an `activity`-type caveat (field/picker apply, don't fork the label); made the `matchTravellerIds` document-first-token **asymmetry** explicit with a guard + test against a symmetric "improvement" (silent false positives). No blocking issues.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /frontend-design)

> One thing I realized is missing from the travel segment is WHO IS TRAVELLING on each segment. Not every family member will always be travelling on each segment, so I think it would be useful to be able to explicitly select who would be travelling on each segment.
>
> My thought is that this field should be a multi-select field, re-using the family member multi-select that's been used in several places in the code. By default, whoever is selected as travelling on the trip when the trip is created is assumed to be travelling on each segment, however this can be edited by the user.
>
> In addition, when AI/LLM reads in travel plans, it should return who is travelling on each segment. When receiving this info from the LLM, _never_ create separate travel segments if multiple members are travelling on the same segment. Rather, use this information to accurately complete the list of family members travelling on a segment.
>
> Please let me know if any questions

### Clarifying answers (AskUserQuestion)

> 1. Scope: All three kinds — travel, accommodations, and transportation get the travellers field.
> 2. AI fallback: Names if found, else trip default — match passenger names to members; missing/unmatched → default that segment to everyone on the trip.
> 3. Display: Only when it's a subset — avatar row on the collapsed card only when the segment's travellers differ from the whole trip; expanded details always list them.

### Follow-up

> that's fine, no need to create a mockup. i only invoked frontend-design for thoughts on where and how exactly to display the family member names in the form and display in a natural way and to use space efficiently

</details>
