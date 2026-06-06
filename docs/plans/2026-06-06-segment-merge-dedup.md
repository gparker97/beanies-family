# Plan: Merge AI-extracted segments into matching existing segments (no duplicates)

> Date: 2026-06-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-06-segment-merge-dedup.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section.

## User Story

As a family trip planner using the AI travel-extract wedge, when I upload a document for a flight/stay/etc. that's already on the trip (a second passenger's ticket, a seat-assignment PDF), I want the app to **enhance the existing segment** — add the new person, refresh/extend the details — instead of creating a duplicate, so my trip stays clean and complete.

## Context

The #30 travel wedge currently **appends** every extracted segment to the chosen trip (`vacationStore.addExtractedSegments` concatenates the buckets). So uploading a second ticket for the same flight, or a seat-assignment doc, creates a duplicate segment. greg wants: on the **attach-to-existing-trip** path, if an extracted segment matches an existing one, **merge into it** (add travellers, overwrite/extend details, attach the new document there) rather than duplicating.

**Decisions locked (clarifying questions):**

1. **Strict per-kind identity** — two segments are "the same" only when their kind + key identifiers match (flight: flight number + departure date; cruise: ship + embark date; hotel: name + check-in; rental: agency + pickup; etc.). Any difference = a separate segment.
2. **Newer document wins** — on a conflicting structured field, overwrite the existing value with the new doc's (non-empty) value. Genuinely-new facts with no dedicated field (seats, baggage) — already folded into the extracted segment's `notes` by the mapper — are appended to the existing notes (deduped).

This is **pure client-side merge logic after the confirm-and-learn step**. The LLM prompt does **not** change → `PROMPT_VERSION` stays `2026-06-06.4`, drift test unaffected, **no Lambda redeploy**. Flag-gated (`aiTravelExtract`, prod-off) → no user-facing CHANGELOG.

## Requirements

1. **Identity key.** A pure `segmentIdentityKey(seg)` returns a stable normalized string for mergeable kinds, or `null` for kinds/segments with no reliable identity (car, activity, taxi/shuttle, or any segment missing its required key fields) → those always append, never merge.
2. **Merge-or-append on attach.** For each extracted segment, find an existing segment in the **chosen trip** with the same kind + identity key. Match → merge; no match (or `null` key) → append (current behaviour). Matching runs only on the attach path; a NEW trip has no existing segments.
3. **Field merge = newer wins.** Overwrite the existing segment's structured fields with the extracted segment's **non-empty** values; keep existing values where the extracted is empty. Re-derive the title from the merged fields.
4. **Notes = deduped append.** Append the extracted segment's notes lines to the existing notes, de-duplicated case-insensitively (so re-uploading the same doc doesn't keep growing notes).
5. **Travellers = undefined-aware union.** `undefined` existing travellers means "the whole trip"; adding a specific person keeps it `undefined` (already included). Explicit existing + explicit new → deduped union. New `undefined`/empty → leave existing unchanged (the doc named no one). Never silently shrink an "everyone" segment to a subset.
6. **Document attaches to the FINAL segment.** A merged extracted segment folds into the existing one (its extracted id disappears), so the source-document attach must target the **existing** segment's id. The merge returns an id-remap (extracted id → final id); `onReviewSubmit` attaches to the de-duplicated final ids.
7. **Idempotent re-upload.** Re-uploading the same document → overwrite same values + deduped notes + union of same travellers = no new segment and no growing data (other than a second copy of the attached file — see Caveats).
8. **Flag/ops posture.** Client-only; no prompt/Lambda change; flag-off → no CHANGELOG, no Help Center article.

## Important Notes & Caveats

- **Flight number already encodes the carrier** (e.g. `HO1602`, `SQ318`), and the free-text `airline` field is noisy (`"SQ"` vs `"Singapore Airlines (SQ)"`). **Refinement to surface:** the flight identity key is **`flightNumber` (normalized) + `departureDate`**, NOT airline — including the free-text airline would cause false **non**-merges (the very duplication we're fixing). A flight with an empty `flightNumber` → `null` key → append (never a false merge).
- **Per-kind keys** (all normalized: lowercase, trimmed, spaces/punctuation stripped from codes):
  - flight (`flight_outbound`/`flight_return`/`flight_other`): `flightNumber` + `departureDate` (both required, else `null`).
  - cruise: `shipName` + `embarkationDate` (both required).
  - train/ferry: `operator` + `departureDate` (+ `departureStation`/`arrivalStation` if present) (operator + departureDate required).
  - car, activity: **`null`** (no reliable key — always append).
  - accommodation: `name` + `checkInDate` (both required).
  - transportation `rental_car`: `agencyName` + `pickupDate`; `bus`: `operator` + `departureDate`; `airport_shuttle`/`taxi_rideshare`: **`null`** (weak identity — always append).
- **Identity-key collisions** (two existing segments share a key — already a data anomaly): merge into the **first** match; don't try to be clever. Deterministic + idempotent.
- **Document re-attach is additive.** The merge de-dups segment _data_, but attaching the source file to a merged segment still adds a photo. Re-uploading the identical file attaches a second copy. Acceptable (the common case is a _different_ doc — second ticket / seat PDF — which is worth keeping). Note it; don't build file-hash dedup now.
- **Only structured non-empty scalars overwrite.** The generic field-merge must NOT blindly spread the extracted object over the existing one — `id`, `photoIds`, `travellerIds`, `notes`, `title` are handled specially (keep id/photoIds, union travellers, append notes, re-derive title). Everything else: overwrite when the extracted value is a non-empty string / `true` boolean.
- **Merge is pure (no IO).** All failure handling stays where it already is: the store write in `updateVacation`'s existing path; the document re-attach stays warn-not-block in `onReviewSubmit`.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-06).

1. `vacationStore.addExtractedSegments(vacationId, buckets)` is called only from `TravelPlansPage.onReviewSubmit` (attach path). Changing its return to include an id-remap affects only that caller. (Verify during implementation.)
2. Extracted buckets already carry resolved `travellerIds` (set by `resolveSegmentTravellersFromMap` before `addExtractedSegments`), so the merge unions real ids.
3. `updateVacation`/`createVacation` spread segment objects, so merged segments persist intact; `vacationSegmentEntityId(vacationId, segmentId)` keys photo attachment by segment id.
4. The mapper's `buildNotes` joins facts with `\n` (one per line), so a line-split + `dedupedAppend` merge of notes is correct.

## Approach

### 1. New pure util `src/utils/segmentMerge.ts`

- `segmentIdentityKey(seg: VacationTravelSegment | VacationAccommodation | VacationTransportation, kind): string | null` — per the keys above; `null` when unmergeable or missing required fields. Normalizes codes (lowercase, strip spaces/punct) and dates.
- `segmentIdentityKey(seg, kind: 'travel' | 'accommodation' | 'transportation'): string | null` — takes the concrete segment + the kind discriminator (not a free string) and branches on `seg.type` within. Per the keys above; `null` when unmergeable or missing required fields.
- `mergeNotes(existing, incoming): string | undefined` — a thin wrapper, **no new dedup logic**: `dedupedAppend(existing?.split('\n') ?? [], incoming?.split('\n') ?? [])` then `.filter((l) => l.trim()).join('\n')`; `undefined` when empty. `dedupedAppend` already trims + lowercases for case-insensitive, order-stable dedup (`segmentTravellers.ts`), so the only new code is the split/join.
- `mergeSegmentTravellers(existing, incoming): string[] | undefined` — undefined-aware union (Req 5). **Lives in `segmentTravellers.ts`** beside `unionTravellerIds`/`resolveSegmentTravellers` (that file is the single source of truth for the "undefined = everyone" rule); `segmentMerge.ts` imports it. Rules: existing `undefined` → `undefined` (stays everyone); incoming `undefined`/empty → existing unchanged; both explicit → `[...new Set([...existing, ...incoming])]`.
- `mergeOneSegment(existing, incoming, buildTitle)` — kind-agnostic; iterate the **incoming** segment's keys (not a per-field allowlist that rots as `models.ts` grows). One `SPECIAL_KEYS = {id, title, notes, travellerIds, photoIds, arrivesNextDay, breakfastIncluded, type, status, sortDate}` names every out-of-band field. Every other key → overwrite only when the incoming value is a **non-empty string**. Special handling: `id`/`photoIds`/`type`/`status` keep existing (a `flight_return` doc can match a `flight_outbound` by the shared flight key — `type` MUST NOT flip); `arrivesNextDay`/`breakfastIncluded` → OR-merge (`existing || incoming`, so a newer doc omitting the flag can't flip true→false); `notes` → `mergeNotes`; `travellerIds` → `mergeSegmentTravellers`; `sortDate` → re-derive from merged dates (`departureDate || embarkationDate || arrivalDate`, matching `toTravelSegment`); `title` → re-derive **last** via `buildTitle(mergedSegment)` (depends on merged fields, so cannot be pre-computed; raw incoming title never overwrites).
- `mergeExtractedIntoVacation(existing: SegmentBuckets, incoming: SegmentBuckets): { merged: SegmentBuckets; idRemap: Record<string, string> }` — per kind, for each incoming segment: compute key; if non-null and an existing same-kind segment shares it, replace that existing entry with `mergeOneSegment(...)` and set `idRemap[incoming.id] = existing.id`; else append and set `idRemap[incoming.id] = incoming.id`. Pure, total, unit-tested. Re-derives titles using `buildTravelSegmentTitle`/`buildAccommodationTitle`/`buildTransportationTitle` (`@/utils/vacation`).
- **Types:** the merge functions type their buckets param as `SegmentBuckets` (from `travelExtractionToSegments`); the store's `ExtractedSegmentBuckets` is structurally identical and assignable, so no cast and **no third bucket type** — reuse one of these two.

### 2. Store: `addExtractedSegments` → merge-or-append

Refactor `vacationStore.addExtractedSegments(vacationId, buckets)`. Keep the existing `if (!vacation) { console.warn(...); return null; }` guard, then:

```
let merged, idRemap;
try {
  ({ merged, idRemap } = mergeExtractedIntoVacation(existing3Arrays, buckets));
} catch (err) {
  console.error('[vacation] addExtractedSegments merge failed:', err);
  return null; // → onReviewSubmit shows the existing saveFailed toast
}
const vacation = await updateVacation(vacationId, merged);
return vacation ? { vacation, idRemap } : null;
```

`existing3Arrays` = the vacation's current `{ travelSegments, accommodations, transportation }`. **New return type:** `{ vacation: FamilyVacation; idRemap: Record<string, string> } | null`. The local try/catch keeps the no-silent-failure guarantee named — a malformed merge surfaces as the user's saveFailed toast + a `[vacation]` console error, never a silent throw. (The store's input type is `ExtractedSegmentBuckets`; it's assignable to `SegmentBuckets` for the merge call.)

### 3. Page: `onReviewSubmit` uses the id-remap for attachment

- **Attach:** the current `const updated = await vacationStore.addExtractedSegments(...); vacationId = updated?.id` becomes `const res = await vacationStore.addExtractedSegments(payload.target.vacationId, ready.buckets); vacationId = res?.vacation.id ?? null;`, with `idRemap = res?.idRemap ?? {}`.
- **Create:** unchanged (no merge); `idRemap = {}` (identity).
- **Document attach (applies the remap to the WHOLE id list + de-dupes).** The existing attach block stores the file once against the FIRST id and `linkPhotoToEntity`s every remaining id (it attaches to **all** extracted segments, not a single "primary"). Change `const segIds = allSegmentIds(ready)` to `const segIds = [...new Set(allSegmentIds(ready).map((id) => idRemap[id] ?? id))]`. The first/rest split, `addPhoto`, and `linkPhotoToEntity` calls are otherwise unchanged. The de-dupe matters: two extracted segments can merge into the same existing id, and `linkPhotoToEntity` must not double-link it.
- Keep the existing warn-not-block try/catch around the document attach and alias learning. The merge's own failure is handled in §2 (the store try/catch → saveFailed).

### 4. Tests

- `segmentIdentityKey`: a match + a non-match per mergeable kind; `null` for car/activity/taxi and for missing required fields (e.g. flight with no flightNumber).
- `mergeOneSegment`/`mergeExtractedIntoVacation`: newer-wins field overwrite; keep-existing where incoming empty; **`type`/`status`/`sortDate` preserved when a `flight_return` doc merges into a `flight_outbound`**; **boolean preservation** (existing true, incoming omits → stays true); deduped notes append; traveller union (existing undefined → stays everyone; explicit+explicit dedup; incoming undefined → unchanged); title re-derived from merged fields; **mixed** doc (one merges, one appends); **idempotent** re-upload (same buckets twice → one segment, stable notes/travellers); id-remap correctness (merged → existing id, appended → own id); collision (two existing same key → merge into first).
- `addExtractedSegments`: returns `{ vacation, idRemap }`; merged trip has no duplicate; `onReviewSubmit` (or a focused test) attaches to final ids.

## Files Affected

- `src/utils/segmentMerge.ts` _(new)_ — identity key + merge helpers.
- `src/utils/__tests__/segmentMerge.test.ts` _(new)_.
- `src/utils/segmentTravellers.ts` — add `mergeSegmentTravellers` (undefined-aware union) if co-located there; reuse `dedupedAppend` for notes.
- `src/stores/vacationStore.ts` — `addExtractedSegments` merge-or-append + new return shape.
- `src/pages/TravelPlansPage.vue` — `onReviewSubmit` consumes the id-remap for the document attach (attach path).
- _(No prompt/Lambda/i18n/model changes.)_

## Acceptance Criteria

- [ ] Uploading a second passenger's ticket for an existing flight adds the person to that segment — no duplicate segment.
- [ ] Uploading a seat-assignment doc for an existing flight enhances it (fields refreshed newer-wins; seats appended to notes) — no duplicate.
- [ ] Strict identity: a different flight number or date (or a different kind) creates a separate segment.
- [ ] car / activity / taxi / shuttle and any segment missing required key fields always append (never false-merge).
- [ ] Traveller union is undefined-aware (everyone-segments stay everyone; explicit unions dedup; incoming-undefined leaves existing unchanged).
- [ ] The source document attaches to the merged (existing) segment, not a dropped extracted id.
- [ ] Re-uploading the same document is idempotent (no new segment, no growing notes/travellers).
- [ ] `npm run validate` green; no prompt/Lambda change (drift test unchanged); flag-off → no CHANGELOG.

## Testing Plan

1. **Unit** — `segmentMerge.test.ts` per the Tests list above; reuse existing `travelExtractionToSegments`/`segmentTravellers` test patterns. `npm run validate`.
2. **Manual (dev, flag on)** — create a trip with a flight (SQ318, 12 Aug, traveller Dad). Upload a second ticket for SQ318/12 Aug naming Mum → confirm-and-learn → save → the flight now lists Dad + Mum, no duplicate. Upload a seat-assignment doc for SQ318/12 Aug → seats appear in notes, no duplicate. Upload a _different_ flight → appends as new. Re-upload the same ticket → no change.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the merge feature — pure `segmentMerge.ts` (per-kind identity key with null-never-merge, newer-wins field overwrite, deduped notes append reusing `dedupedAppend`, undefined-aware traveller union, id-remap), `addExtractedSegments` merge-or-append returning the remap, and `onReviewSubmit` attaching the document to the final ids. Surfaced the flight-key refinement (flightNumber+date, not airline).
- **Pass 2 (DRY + error handling)**: `mergeNotes` wraps `dedupedAppend` (no new dedup); `mergeSegmentTravellers` lives in `segmentTravellers.ts`; named the real bucket types (no third type); `addExtractedSegments` wraps the merge in a local try/catch (→ saveFailed, no silent throw) and returns `{ vacation, idRemap }`; doc-attach applies the remap to the WHOLE id list + de-dupes (attaches to all segments, not a "primary").
- **Pass 3 (Sustainability)**: `mergeOneSegment` iterates incoming keys against one `SPECIAL_KEYS` set (no rot-prone per-field allowlist); booleans OR-merge (newer-omitted can't flip true→false); `segmentIdentityKey` is a flat switch with a `joinKey` that enforces required-ness once; added a boolean-preservation test.
- **Pass 4 (Fresh-eyes sweep)**: caught corruption risks — added `type`/`status`/`sortDate` to `SPECIAL_KEYS` (a `flight_return` doc shares the flight key with `flight_outbound`, so `type` must not flip; `sortDate` is derived, re-derive not overwrite); corrected the title to re-derive AFTER the field merge (depends on merged fields); noted `bookingReference` newer-wins is intentional; confirmed attach-only is correct + merge reads current arrays.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> One enhancement - if a travel plan is added for an existing flight segment (i.e. matches all the details of an existing segment) - then do not create a new segment. Only add to the existing segment. For example, if a flight segment exists and a travel plan is added that returns the same segment but a new person, ONLY add the new person to that segment (after the confirm and learn modal), do not create a new duplicate segment. For example, a new document is uploaded to the LLM with seat assignments for an existing flight - add those as appropriate (for example to the notes field). Avoid duplication, enhance the information on the existing segment where possible.

### Clarifying answers (AskUserQuestion)

> 1. Match key: **Strict identity** (same kind + key identifiers; any difference = a separate segment).
> 2. Field conflict: **Overwrite with newer value** (latest document authoritative for structured fields; still appending genuinely new info like seats to notes).

</details>
