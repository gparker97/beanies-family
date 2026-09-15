# Plan: Canonical airport and airline codes from AI extraction

> Date: 2026-09-15
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-15-airport-airline-code-normalization.md`
>
> **No GitHub issue created.** This plan was approved for direct implementation; the full prompt history is embedded in the `## Prompt Log` section below.

## User Story

As a family that hands beanies a flight confirmation, I want the trip it creates to name my flights the way the app names every other flight ("SIN → PVG"), so that a flight beanies read for me is indistinguishable from one I entered by hand.

## Context

The AI extraction path returns whatever string the model found in the document for `departureAirport`, `arrivalAirport` and `airline`. Nothing normalizes it, and nothing ever asked the model for a code:

- **The prompt never asks for a code.** All three copies (`src/services/ai/extractionPrompt.ts:398`, `scripts/spikes/extractionPrompt.mjs:172`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs:175`) describe the fields as `departureAirport, arrivalAirport` inside one long `travelFields` string with no format instruction. `git log -S "IATA"` over the prompt files returns nothing — such a rule has never existed.
- **No resolver exists.** Nothing in `src/` or `infrastructure/lambda/` maps a name to a code. The only consumers of the `AIRPORTS` list are `buildAirportOptions()` (`src/utils/vacation.ts:1342`) and `buildAirlineOptions()` (`:1335`), which build dropdown options and never run in reverse.
- **The value is stored verbatim.** `travelExtractionToSegments.ts` sweeps the fields through `TRAVEL_FIELDS` → `pickFields()` untouched (`:183`), while the canonical shape the pickers write is `"City (CODE)"` for airports (`vacation.ts:1343`) and `"Name (CODE)"` for airlines (`vacation.ts:1336`).

The visible symptom is the auto-generated flight title. `airportCode()` (`vacation.ts:862`) tries `/\(([A-Z]{3})\)/` and, failing that, falls back to `airport.split(' ')[0]` — the **first word**:

| Stored value                            | Title shows |
| --------------------------------------- | ----------- |
| `Singapore (SIN)`                       | `SIN` ✓     |
| `Singapore Changi Airport`              | `Singapore` |
| `London Heathrow Airport`               | `London`    |
| `John F. Kennedy International Airport` | **`John`**  |

`useVacationTimeline.ts:200` (inside the exported, pure `buildTravelKeyValue`) has the identical first-word fallback for the airline code.

Three further defects were found while verifying this plan, all in the same code paths, all fixed here because fixing them separately would mean editing the same four lines twice:

1. **Two telemetry keys on this exact surface are silently stripped today.** `useDocumentToTravel.ts:130-134` sends `segment_count` and `target_kind`, and **neither is in `ALLOWED_CONTEXT_KEYS`** (`src/utils/diagnosticContext.ts:61`) nor in the Lambda mirror. `redactContext` drops them with a console-only warn (`diagnosticContext.ts:338-340`), so every travel extraction since #30 has shipped an event with no payload. This is the same incident class the file itself records for `recovery_method`/`attempt`/`lostSiblings`.
2. **The airline token duplicates the flight number.** `buildTravelKeyValue` renders `` `${code} ${flightNumber}` ``, so a picker-entered `Singapore Airlines (SQ)` + `SQ25` reads `SQ SQ25`.
3. **A flight number with no airline is dropped from the summary.** The whole token is inside `if (seg.airline)`, so `flightNumber` never renders without an airline.

A prior fix on the same field is easy to mistake for this one: `34729e6e` ("flatten nested travelFields", #30) fixed the airports arriving **blank** because nested `travelFields` were dropped whole. Different defect, same field — and the regression test it added (`src/utils/__tests__/travelExtractionToSegments.test.ts:305-311`) currently **pins the un-normalized behaviour** by asserting `expect(seg.departureAirport).toBe('Singapore Changi Airport')`.

## Requirements

1. A shared resolver canonicalizes an airport string to `"City (CODE)"` and an airline string to `"Name (CODE)"`, using the existing `AIRPORTS` / `AIRLINES` constants as the only source of truth.
2. Resolution is applied at the extraction boundary, so a segment created from a document carries the same field shape as one created from the picker **whenever the value is in our lists** (outcomes `code` and `rescued`) — and that shape has **exactly one definition in code**, shared by the resolver and the combobox option builders, so the two cannot drift. Values we cannot place in a list (requirements 4–6) are, by definition, not of that shape; see requirement 4.
3. Resolution is **idempotent** — an already-canonical value, or a value the pickers wrote, passes through byte-identical; and every other outcome re-resolves to itself.
4. A bare code (`SIN`, `sin`) resolves to the canonical form. A bare code that is correctly shaped but **absent from our list** (`HO` — Juneyao is not among the 135 airlines) is a distinct outcome, `code-unlisted`: the code is kept, used for display, and counted as a **success**, because the model did exactly what the prompt asked and only our list is short. It never warns and never escalates the telemetry level. Its stored value is the upper-cased bare code, **deliberately not the canonical `"Name (CODE)"` shape** — we cannot construct that shape without a list entry, and inventing one would put a fabricated name in the user's data.
5. An **ambiguous** input never guesses. Where the normalized input cannot identify exactly one entry, the original string is preserved unchanged. Ambiguity is judged across airport **names and cities together**, not per rung.
6. An **unresolvable** input is preserved verbatim — never blanked. No data loss under any input.
7. The same resolver backs the display fallbacks in `airportCode()` (`vacation.ts`) and the airline code in `buildTravelKeyValue` (`useVacationTimeline.ts`), so **already-saved** segments holding a name render correctly too, with no CRDT migration.
8. All three prompt copies instruct the model to return the **3-letter IATA airport code and the 2-character IATA airline code**, converting from whatever name the document spells out. A travel itinerary always names the airport and carrier in full, and the model knows the IATA mapping, so this is the primary mechanism — the resolver is the safety net for when it still returns a name, not the main event. The same instruction **forbids invented placeholders** (`TBA`/`TBD`/`UNK`) and **forbids guessing a code from a multi-airport city name**, so the firm instruction cannot manufacture a confidently-wrong-but-well-shaped answer. `PROMPT_VERSION` bumped, drift guard green.
9. Neither the resolver nor the mapper emits telemetry. Both are **pure and total**: the resolver returns a `CodeResolution` for every input and cannot throw, the mapper returns an outcome tally the caller logs. There are no exceptions to this and therefore no error-reporting path inside `travelCodes.ts` — which also keeps `vacation.ts`'s "no side effects" contract intact on the render path.
10. Diagnostic telemetry reports how often each resolution outcome occurs, by classification only — never the raw string — **using only already-allowlisted context keys**, and fixes the two keys currently being stripped on this surface. The event's `level` escalates on **airport** resolution failure only, never on the expected "airline not in the hand-maintained list" outcome.
11. The flight summary renders the carrier once: a flight number that already carries its carrier designator renders alone — **including when it is written with a space (`SQ 25`)** — and a flight number with no airline is no longer dropped.

## Important Notes & Caveats

- **Three prompt copies, one drift guard.** `src/services/ai/__tests__/extractionPromptDrift.test.ts` asserts `PROMPT_VERSION`, per-task `requiredKeys`, `jsonShape`, `sources` and the built messages match across client, spike and Lambda for every task and every source kind. Change one, change all three, bump `PROMPT_VERSION`, or CI fails. The guard compares the three copies **to each other** (not to a snapshot), so editing the text of an existing `jsonShape` value is fine as long as all three are byte-identical. The instruction goes inside the existing `travelFields` string in `TRAVEL_JSON_SHAPE` — a new key would change `jsonShape` in a way the mapper doesn't read.
- **Instruction placement matters.** The `travelFields` string describes flights, then cruise, then train/ferry in one run-on value. The code requirement is annotated **inline on the three flight field names**, with the fallback sentence closing the flights clause _before_ `cruise:` — not appended to the end of the whole string, where it would sit two clauses away from the fields it governs. The drift guard is indifferent; model adherence is not.
- **The Lambda needs a redeploy for the prompt change to take effect**, but there is **no ordering constraint**: the client resolver rescues a name whether or not the Lambda has been redeployed — unlike the `CORRECTION_GRANTS` change of 2026-09-14.
- **A prompt instruction is not a guarantee.** The model will still sometimes return a name, so the resolver still has to exist — but after §5 it is the safety net rather than the primary mechanism, and a rising `rescued` count is now a _signal that the prompt has regressed_ rather than the expected steady state.
- **A correctly-shaped code can still be garbage, and some garbage is a real airport.** `/^[a-z]{3}$/i` matches `TBD`, `TBA`, `NIL` — none of which are in the list, so they land as `code-unlisted` and title the flight `TBA`, exactly as the first-word fallback does today. But **`UNK` is Unalakleet, `NAN` is Nadi, `VAR` is Varna and `RET` is Røst** (verified in `airports.ts`). A firm "MUST be a code" instruction is precisely what pushes a model that cannot find the airport toward a code-shaped placeholder, and `UNK` would then resolve to `Unalakleet (UNK)` with outcome `code`, no warning and no level escalation — a _confidently wrong, canonically shaped_ airport, which is worse than today's visibly-wrong `UNK`. This is why the prompt (§5) explicitly forbids placeholders rather than relying on a denylist: a denylist in the resolver would be a guess at the model's failure vocabulary and could never cover the listed ones without deleting real airports. The prompt clause is the single-point fix; a test pins it.
- **The prompt must not be allowed to guess where the resolver refuses to.** Requirement 5 says "never guess" — but if the instruction says only "always return a code", a document naming just `London` invites the model to pick one of LHR/LGW/LCY/STN and we store it as outcome `code` with no signal at all, silently relocating the ambiguity decision from our deterministic rule into an invisible one. The instruction therefore carries the counterpart clause: _a city with several airports comes back as the city name_, which routes it into the `ambiguous` path we designed for it.
- **`code-unlisted` is the bare-code rung ONLY, never the parenthesized rung.** This is load-bearing, not an implementation detail: the paren rung's list-membership check is the only thing separating "a trailing code" from "a trailing parenthetical". `London Heathrow (T5)` is a plausible model output and `Circle City (New)` is a real row in `airports.ts`; if an unlisted trailing paren group were accepted as a code, the first would title a flight `T5` and the field would be rewritten to `T5`. Under bare-only, both fall through to the fold rung and are preserved verbatim. A regression test pins `Heathrow (T5)` → `unresolved`.
- **`code-unlisted` costs the human-readable name, and that is the accepted price.** `travelDetailRows` (`useVacationTimeline.ts:267-269`) and `TravelExtractReviewModal.vue:152` show the **stored** value. With the firm prompt, an unlisted carrier now arrives as `HO`, so those two surfaces read `HO` where today they read `Juneyao Airlines`. `flightCodeLabel` is unaffected (`HO1602` prints alone) and the title is _better_, but the family loses the carrier's full name in the detail row. The remedy is the documented one-line addition to `src/constants/airlines.ts`, which upgrades it to `Juneyao Airlines (HO)` everywhere; the signal that it is worth doing is `air_unl` in the event `detail`. The same applies to an airport outside the `scheduled_service=yes` filter — rare, since the list holds 4,159 entries.
- **The canonical form prefers the city over the airport name.** `John F. Kennedy International Airport` stores `New York (JFK)`, because that is what the picker writes. The detail row therefore names the city and the code rather than the terminal-building name. That is requirement 2 working as designed, not a loss.
- **The review modal is NOT an editor.** Its own header says so: "_Review + confirm surface for AI-extracted travel segments (#30). NOT an editor — it shows … AFTER save via the segment edit drawers._" A wrong airport is **visible** there and **editable after save** in `TravelSegmentEditModal`. Any copy (including the dev `console.warn`) that tells a maintainer the family "picks the right value in the review modal" is wrong and must name the edit drawer instead.
- **The airport/airline comboboxes are list-only — there is no free-text mode.** Neither `TravelSegmentEditModal.vue` nor `VacationStep2.vue` passes `otherValue`, and `BaseCombobox`'s `checkBackwardCompat()` only enters "other" mode when `otherValue` is set. So (a) there is no second write site that could produce a non-canonical value, which strengthens the case for canonicalizing upstream only; and (b) an unmatched stored value is never cleared — `displayText` falls back to `selectedOption?.label || props.modelValue`, so it renders as plain trigger text. No data loss, but `code-unlisted`/`ambiguous`/`unresolved` values show as fallback text rather than a selected option, and cannot be "corrected" to an unlisted carrier at all.
- **Never assert list cardinalities in tests.** `AIRPORTS` is regenerated by `scripts/updateAirports.mjs` and lands as a **monthly `automation`-labelled `airport-sync` bot PR**. The list holds **4,159** entries today (`grep -c "{ code:"` reports 4,160 because the `AirportInfo` interface comment matches too, and a naive single-line regex under-counts because prettier wraps the long entries), with roughly **150 ambiguous folded keys** out of ~6,100 — numbers that move on every sync. Tests must assert behaviour on a **fixture list** or **per-entry properties** (every entry round-trips), never counts.
- **Named real-list examples are themselves churn-sensitive.** `London` is structurally ambiguous forever (four airports, one city), but `Aberdeen` and `Albany` are ambiguous only because of _today's_ rows — a sync could change either, and a test pinning them would then fail for a correct reason with a confusing message. The **rung behaviours are therefore tested against a 3-entry fixture list** through the exported factory, with exactly one real-list ambiguity example (`London`) kept as an end-to-end sanity check.
- **A malformed constants file is a BUILD failure, not a runtime one.** `src/constants/airports.ts` is a typed TypeScript module (`export const AIRPORTS: AirportInfo[]`), so a corrupt entry is caught by `tsc` / `npm run validate` / CI on the bot PR — it cannot reach a running app. This is why the resolver has **no runtime index-build guard** (see Approach §1): the guard would be unreachable code, and the check it was standing in for belongs in a unit test that runs on the bot PR instead.
- **A duplicate IATA code is not ambiguity.** A code is an identity; if the regenerated list ever carries two rows for one code, the code→entry map keeps the first and resolution still succeeds. There are **zero duplicate codes today** (verified). Only **names and cities** can collide into `ambiguous`. Consequence for testing: the per-entry property test must assert the **code**, not byte-identity of the canonical value — a future duplicate code would make the second row's canonical value resolve to the first row's, which is correct behaviour and must not fail the bot PR.
- **A bare 3-letter place name loses to a code, by design.** Rung 1 wins before the fold rung, so a literal input of `Bod`, `Agr`, `Nan`, `Lar`, `Moi`, `Obo`, `Rst`, `Ili` or `Ilo` resolves to the _other_ airport that owns that code (nine such collisions today). This is the right default — a bare 3-letter token in an airport field is overwhelmingly a code — and the fold rung is unaffected (`Nan Airport` → `nan` → NNT, not NAN). Recorded so it is a known property rather than a surprise; no code is added for it.
- **`AIRLINES` is hand-maintained, and `Juneyao Airlines` (HO) is NOT in it.** Verified: 135 entries, no `HO`. So "`Juneyao Airlines` renders `HO` **via the list**" is impossible, and two other rungs cover it instead: after §5 the model returns `HO` directly, which lands as `code-unlisted` and is used as-is; and if it returns the name anyway, requirement 11's designator test reads `HO1602` and prints that alone. Either way the repo's own Juneyao fixture reads correctly without touching the list. **Because both an unlisted airline and an unlisted code are expected steady state, neither may raise the telemetry level or print a console warning** — otherwise the loudest signal on this surface becomes the one nobody should act on.
- **Airline codes are alphanumeric, not alphabetic.** 15 of them contain a digit (`A3 D7 G9 G4 5J U2 F9 G3 6E J9 7C B6 9C Y4 W6`). `useVacationTimeline.ts:200` already uses `[A-Z0-9]{2}`; `vacation.ts:862` uses `[A-Z]{3}` for airports (all 4,159 airport codes are alphabetic — verified). The resolver must be **case-insensitive** on both, which the current uppercase-only regexes are not.
- **Two airline names contain parentheses** — `ANA (All Nippon Airways)` and `SAS (Scandinavian Airlines)` — so their canonical form has _two_ paren groups (`ANA (All Nippon Airways) (NH)`). The paren rung must be **end-anchored** so it reads the code group, not the name group. 40 _airport_ names also contain parentheses (`Cocos (Keeling) Islands`, `Antwerp International Airport (Deurne)`); only one ends in a 2–3-character group (`Circle City (New)`), which is the concrete reason the paren rung must also require list membership.
- **Merge heals stored data for free.** `segmentIdentityKey` (`src/utils/segmentMerge.ts:52`) keys flights on `flightNumber + departureDate` and never on airports, so canonicalization cannot change which segments fold together. And `mergeOneSegment` lets the newer non-empty string win and re-derives `title` last, so re-uploading a document over a legacy segment upgrades its stored airport to canonical form as a side effect. No migration, and no merge risk.
- **Do not migrate existing saved data.** Requirement 7 makes it unnecessary: legacy names render as codes at display time with the stored value left alone.
- **Never log the raw airport/airline string.** `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`) is a conservative allowlist mirrored in `infrastructure/lambda/telemetry/index.mjs:65` and pinned by a hardcoded sorted array in `infrastructure/lambda/telemetry/__tests__/handler.test.mjs:433`. The raw string goes to `console.warn` (on-device only) and nowhere else.
- **Zero new context keys, by design.** `docs/runbooks/native-store-submission.md:589-591` records the house rule for exactly this situation: "**No new diagnostic keys.** The events use `action`, `error_code`, `detail` and `os`, all already allowlisted, so §1's data-collection table is unchanged by this feature and must not be edited for it." Following it means no allowlist edit, no Lambda edit, no Lambda-test array edit, and no `PrivacyInfo.xcprivacy` / Play Data Safety / `privacy.astro` / runbook churn.
- **No i18n work.** `flightCodeLabel` and the canonical formatters emit proper nouns and codes only — no English prose — and CLAUDE.md explicitly exempts proper-noun reference data (airports/airlines/countries) from translation. The `beanies-i18n/no-bare-render-strings` `.ts` rule scopes to `src/constants/**` and `src/composables/**`; the new module lives in `src/utils/`, and the only new string in `src/composables/` is a dev `console.warn`, which is not a render string.
- **`arrivesNextDay` precedent.** `c7ebe48f` found that a travel bug can pass US-timezone testing and fail everywhere else. Airport-name shapes are similarly locale-flavoured — include non-English and multi-airport-city cases in tests.
- **The resolver runs on the render path**, inside `buildTravelSegmentTitle` and `buildTravelKeyValue`, for every flight row. It must never log, never report, and must build its index once. `vacation.ts`'s module header promises "no reactivity, no store access, no side effects" — a resolver that could fire a diagnostic from inside a title builder would break that promise, which is the second reason §1 has no reporting path.
- **`vacation.ts` is 1,556 lines.** This change adds one ~8-line function to its existing "Auto-generated segment titles" section and removes a regex from another. That section is a plausible future extraction into `travelLabels.ts`, but extracting it now would touch every importer for no behavioural gain — noted as a follow-up, deliberately not done here.
- **The demo fixture is unaffected in title, changed in summary.** `src/services/demo/demoFixture.ts:599-628` uses fictional `Home City` / `Seaside` / `Beanstalk Air`; none exist in either list, so all three stay unresolved. Both demo flights carry an explicit `title` (`'Flight to the coast'`, `'Flight home'`), so `buildTravelSegmentTitle` never runs for them — an earlier draft's claim that the demo title changes was wrong. The one visible change is the collapsed summary: `Beanstalk BN220` → `BN220` (the designator rule). Nothing in `src`, `e2e`, `web` or `docs` references those fixture strings, so no test or screenshot pins it.
- **`TravelExtractReviewModal.vue:152` and `travelDetailRows` need no change** — both display the _stored_ value, which is canonical from the moment the mapper writes it (for listed values; see the `code-unlisted` caveat above). Canonicalizing upstream is what keeps these two read-only.

## Assumptions

> **Review these before implementation.** Valid at the time of planning.

1. `AIRPORTS` (4,159 entries, `code`/`name`/`city`/`country`) and `AIRLINES` (135 entries, hand-maintained) remain the canonical lists, and `AIRPORTS` continues to be auto-regenerated by `scripts/updateAirports.mjs` (last regenerated 2026-08-01).
2. The canonical stored shapes stay `"City (CODE)"` (airport) and `"Name (CODE)"` (airline) — and after this change there is exactly one definition of each, so a future reshape is a one-line edit rather than a hunt.
3. `PROMPT_VERSION` is `2026-09-14.3` in all three copies (verified); the bump target is `2026-09-15.1`.
4. The 135-airline list is not exhaustive, so an unresolvable or unlisted-code airline is an expected steady-state outcome, not a defect — and the design treats it as such (no warn level, no console noise).
5. No other in-flight work is editing `travelExtractionToSegments.ts`, `vacation.ts`'s title builders, or `useVacationTimeline.ts`.
6. `travelExtractionToSegments` has exactly one production call site (`useDocumentToTravel.ts:117`, verified), so adding a field to `MappedExtraction` is non-breaking.
7. `resolveTripTarget` (`vacation.ts:835`) is pure (verified — three branches over `matches.length`), so hoisting its two calls into one is behaviour-preserving.

## Approach

### 1. New resolver util — `src/utils/travelCodes.ts`

One module, ~150 lines, two clearly separated sections: **Resolution** and **Outcome accounting**. Airports and airlines share one resolver built by a **monomorphic** factory — no type parameters, no `CodeIndex<T>` gymnastics. Each list is flattened into a uniform entry shape _before_ the factory sees it, so the factory itself knows nothing about airports or airlines:

```ts
/** The uniform shape the resolver indexes. Built once per list, from the constants. */
interface CodeEntry {
  code: string;
  canonical: string; // the stored shape — see canonicalAirportValue / canonicalAirlineValue
  keys: readonly string[]; // the strings a human might type: airport name + city, or airline name
}

export type CodeOutcome =
  | 'code' // the input carried a code we know (bare, or trailing "(CODE)") → canonicalized
  | 'code-unlisted' // a BARE, correctly-shaped code absent from our list → kept as the code; a SUCCESS
  | 'rescued' // matched by folded name/city → canonicalized
  | 'ambiguous' // matched >1 distinct code → original preserved
  | 'unresolved'; // no match → original preserved

export interface CodeResolution {
  outcome: CodeOutcome;
  /** Always safe to store: canonical on code|rescued, the upper-cased code on code-unlisted,
   *  the trimmed original otherwise. NEVER empty unless the input was. */
  value: string;
  /** The IATA code — present on code|code-unlisted|rescued, absent on ambiguous|unresolved. */
  code?: string;
}
```

**The single definition of the stored shape** lives here, and the combobox option builders import it rather than re-templating it. This is what makes requirement 2 structurally true instead of true-by-coincidence:

```ts
export const canonicalAirportValue = (a: AirportInfo): string => `${a.city} (${a.code})`;
export const canonicalAirlineValue = (a: AirlineInfo): string => `${a.name} (${a.code})`;
```

`vacation.ts:1336`/`:1343` change to `value: canonicalAirlineValue(a)` / `value: canonicalAirportValue(a)`. `buildAirportOptions`' richer `label` and `rich` fields are untouched — only the _value_ (the thing that gets stored) is shared. No import cycle: `travelCodes.ts` imports only the two constants modules; `vacation.ts` imports `travelCodes.ts` (and keeps its existing `AIRPORTS`/`AIRLINES` imports for the option lists).

These two formatters are the **only** producers of the canonical shape. `code-unlisted` does not use them — it cannot, having no entry — which is exactly why its stored value is a bare code and why requirement 2 is scoped to `code`/`rescued`.

**The factory:**

```ts
/**
 * Build a resolver over one coded list. Exported so the ladder can be unit-tested against a
 * small FIXTURE list — the real AIRPORTS list is regenerated monthly, and pinning rung
 * behaviour to today's rows would make the airport-sync bot PR fail for correct reasons.
 */
export function makeCodeResolver(spec: {
  codePattern: RegExp; // /^[a-z]{3}$/i | /^[a-z0-9]{2}$/i
  buildEntries: () => readonly CodeEntry[]; // called at most once, lazily
}): (raw?: string) => CodeResolution;
```

The memoized index lives **inside the returned closure** — one index per resolver. (This is worth stating explicitly: a module-scoped `let index` shared by both resolvers would have the airline resolver serving the airport index, or vice versa, depending on call order.)

Two exported instances, five lines each:

```ts
export const resolveAirport = makeCodeResolver({
  codePattern: /^[a-z]{3}$/i,
  buildEntries: () =>
    AIRPORTS.map((a) => ({
      code: a.code,
      canonical: canonicalAirportValue(a),
      keys: [a.name, a.city],
    })),
});
export const resolveAirline = makeCodeResolver({
  codePattern: /^[a-z0-9]{2}$/i,
  buildEntries: () =>
    AIRLINES.map((a) => ({ code: a.code, canonical: canonicalAirlineValue(a), keys: [a.name] })),
});
```

**The ladder, first win** (three flat early returns, no nesting):

1. **Bare code** — the whole trimmed string matches `codePattern`. In our list → `code` (canonicalized). Not in our list → `code-unlisted`: `value` is the upper-cased code, `code` is set so display uses it, and the outcome counts as a success. This rung is what makes the strengthened prompt (§5) safe: once the model is told to always return a code, an unlisted carrier or a small airport outside the scheduled-service filter arrives as a perfectly good code, and classing that as a failure would make the warn rate measure our list's length rather than the model's behaviour. **`code-unlisted` is produced by this rung and no other** — see the caveat; the type comment says so too.
2. **Trailing paren code** — `/\(([a-z0-9]{2,3})\)$/i` naming a **listed** code → `code`. **End-anchored** on purpose: it reads `(NH)` out of `ANA (All Nippon Airways) (NH)`, and it refuses to rewrite `Sydney (SYD) Terminal 1` into `Sydney (SYD)` (which would discard text from the field, against requirement 6 — that input falls through and is preserved). **Membership-checked** on purpose: without it, `London Heathrow (T5)` would become `T5`.
3. **Folded key** — one `Map<string, CodeEntry | null>` over every `keys` entry, where `null` marks "more than one distinct code". A hit → `rescued`; a `null` → `ambiguous`; a miss → `unresolved`.

The index is therefore two maps: `byCode: Map<string, CodeEntry>` (first wins — see the duplicate-code note) and `byKey: Map<string, CodeEntry | null>`.

Folding name and city into **one** map is what makes requirement 5 true. A separate name rung followed by a separate city rung would resolve `Aberdeen` to `ABZ` (exact name match) while the city `Aberdeen` is ambiguous between `ABR` and `ABZ` — a guess dressed as a resolution. One map, "exactly one distinct code or nothing", removes the rung-ordering question entirely and is less code.

**The fold — one expression, no loop:**

```ts
const TRAILING_GENERIC = /(?:airport|international|intl)+$/;
function fold(raw: string): string {
  const base = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return base.replace(TRAILING_GENERIC, '') || base;
}
```

The draft's "iteratively strip while non-empty" while-loop is replaced by a single `+`-quantified regex and one `||` fallback: same behaviour, no loop, no termination condition to get wrong. **Verified by running it against the real list**: `Singapore Changi Airport` → `SIN`, `Shanghai Pudong International Airport` → `PVG`, `John F. Kennedy International Airport` → `JFK`, `Felix Houphouet Boigny Airport` → `ABJ`, `London Heathrow Airport` → `LHR`, `London`/`Aberdeen`/`Albany` → ambiguous, `internationalairport` → strips to empty → falls back to itself. Applied to **both** sides, which is what makes `"Singapore Changi Airport"` meet the stored `Singapore Changi`. Dropping separators also makes `Félix-Houphouët-Boigny` / `Felix Houphouet Boigny` agree. Where suffix-stripping collides two different airports, the distinct-code check turns it into `ambiguous` — safe by construction.

`fold` is **module-private and untested directly** — every behaviour it has is observable through a resolver, and exporting it now would create a public API with no second caller. If a non-travel caller appears, promote it to a shared text util then.

> **Deliberately not refactoring `segmentMerge.keyPart`** (`src/utils/segmentMerge.ts:36`), which is the closest existing normalizer (`toLowerCase().replace(/[^a-z0-9]/g,'')`, no diacritic folding). It is a **merge identity key**: widening it changes which saved segments fold together — a data-affecting change with no bearing on this display fix.

**No try/catch, no reporting path, nothing to degrade.** The resolver is **total by construction**: trim, two regexes, two `Map.get`s. Index construction is `Array.prototype.map` plus `Map.set` over a typed, compile-time-validated array — there is no throw to catch. The draft's `reportError` index-build guard is removed for three reasons: (a) the failure it guards against is a TypeScript compile error, unreachable at runtime; (b) it made `buildTravelSegmentTitle` — a function whose file header promises no side effects — capable of firing a diagnostic from inside a render; (c) it required a cached-failure sentinel, a "reports once" subtlety, an acceptance criterion and a module-mocking test, all for dead code. The integrity it was worried about is checked instead by a **unit test that runs on the monthly bot PR** (Testing Plan §1), which catches a bad regeneration _before_ merge rather than reporting it from production. CLAUDE.md rule 2 is satisfied trivially: there is no `catch`.

Per-entry defensiveness is kept and costs nothing: `buildEntries` skips any entry whose `code` is falsy, and a wrong-length code simply never matches `codePattern` (it stays reachable by name), so a hypothetical bad row degrades to "that one airport is unresolvable" rather than a poisoned map.

**Outcome accounting** (second section of the file):

```ts
export type CodeTally = Record<CodeOutcome, number>; // exhaustive — adding an outcome is a compile error
export interface CodeOutcomes {
  airport: CodeTally;
  airline: CodeTally;
}

export function emptyCodeOutcomes(): CodeOutcomes; // fresh object, never a shared constant
export function mergeCodeOutcomes(a: CodeOutcomes, b: CodeOutcomes): CodeOutcomes; // pure, returns new
export function summarizeCodeOutcomes(o: CodeOutcomes): { detail: string; degraded: boolean };
```

`summarizeCodeOutcomes` is **one** export, not the draft's `formatCodeOutcomes` + `codeResolutionDegraded` pair: the `detail` string and the `level` decision are two halves of one telemetry statement, and deriving them together removes the failure mode where a caller formats the breakdown but forgets to escalate the level. `degraded` is `airport.ambiguous + airport.unresolved > 0` — **airport only, and `code-unlisted` is excluded from both kinds**, because an unlisted airline and an unlisted-but-valid code are both documented steady state (assumption 4, requirement 4) and letting either set `warn` would make the warn rate measure our lists' coverage rather than the thing this change exists to watch.

Because `CodeTally` is `Record<CodeOutcome, number>`, adding `code-unlisted` to the union is a **compile error** at every site that enumerates outcomes — which is the point: the tally, the `detail` formatter and the `degraded` predicate cannot silently forget the new case.

The per-kind split in `CodeOutcomes` is load-bearing for exactly that reason; it is two levels deep and fully typed, and no third level is added.

### 2. Apply at the extraction boundary — `src/utils/travelExtractionToSegments.ts`

`toTravelSegment` already computes the title from the picked fields _before_ spreading them (`:190-191`). The change is a **pure** transform, not an in-place mutation:

```ts
const { fields, outcomes } = canonicalizeTravelCodes(pickFields(draft.fields, TRAVEL_FIELDS));
```

`fields` then replaces `mapped` at its three existing uses (title, spread, `primaryDate`). `buildNotes(draft, TRAVEL_FIELDS)` reads `draft.fields`, not `mapped`, so the raw value cannot leak into `notes` either way (the key is excluded by name) — verified.

The draft's `canonicalizeAirportFields(mapped)` mutated its argument _and_ returned a value; that hides half of what it does inside a parameter and makes the ordering of "build the title" vs "canonicalize" an invisible dependency — precisely the kind of thing that breaks silently when someone reorders two lines a year from now. A pure return makes the ordering explicit and unbreakable.

`canonicalizeTravelCodes` is module-private, ~12 lines, one loop over a fixed table, no per-field copy-paste:

```ts
const CODE_FIELDS = [
  ['departureAirport', 'airport'],
  ['arrivalAirport', 'airport'],
  ['airline', 'airline'],
] as const;
```

For each present field it resolves, writes `r.value`, and counts `r.outcome` into the tally. `toTravelSegment` returns `{ segment, outcomes }`; `travelExtractionToSegments` accumulates with `mergeCodeOutcomes` in the loop it already uses to accumulate `buckets` — the same "factory returns, caller accumulates" shape the file already has. `toAccommodation` / `toTransportation` keep their existing signatures (no airports to resolve); the asymmetry is one line of comment.

**The on-device warning is narrowed to the actionable cases.** It fires when an **airport** is `unresolved` or when **either kind** is `ambiguous`. An unresolved _airline_ and a `code-unlisted` value of either kind are silent — both are expected (assumption 4, requirement 4), `flightCodeLabel` now renders them acceptably, and warning on them would train developers to ignore this surface's warnings:

```ts
console.warn(
  `[travel-extract] ${key} "${raw}" is ${r.outcome} — stored as-is. ` +
    `The family can correct it in the segment edit drawer after saving (the review modal is read-only). ` +
    `An unlisted airline goes in src/constants/airlines.ts; airports are auto-generated — re-run \`npm run update-airports\`.`
);
```

Two corrections are baked into that text: `src/constants/airports.ts` is stamped "AUTO-GENERATED — do not edit by hand", so an earlier draft's "add the airport to `src/constants/airports.ts`" would have sent the next maintainer to edit a file the bot overwrites monthly; and `TravelExtractReviewModal.vue` declares itself "NOT an editor", so telling a maintainer the fix happens there is wrong.

It lives here rather than in `travelCodes.ts` precisely because a _picker-entered_ value must not warn — and the file header already documents `[travel-extract] console.warn` as its non-silence mechanism for skipped drafts.

`MappedExtraction` gains one field:

```ts
export interface MappedExtraction {
  buckets: SegmentBuckets;
  travellerNamesBySegmentId: Record<string, string[]>;
  /** Airport/airline canonicalization outcomes, for the caller's one telemetry event. */
  codeOutcomes: CodeOutcomes;
}
```

The mapper stays pure and total: the resolver is pure, and no `logEvent`/`reportError` is called here (requirement 9).

`departurePort` (cruise) and `departureStation` / `arrivalStation` (train/ferry) are deliberately **not** normalized — cruise ports have no universal short code (already noted at `vacation.ts:1374`) and stations have none either.

**Not extended to the edit modals.** `VacationStep2.vue` and `TravelSegmentEditModal.vue` write through `BaseCombobox`, whose options are already canonical _and now share the resolver's definition of canonical_ (§1), and which — verified — pass **no `otherValue`**, so they cannot produce a free-text value at all. One write-site, no second call site to keep in step.

### 3. One telemetry event, zero new context keys — `src/composables/useDocumentToTravel.ts:124`

The composable already emits exactly one event per extraction. **Extend it; do not add a second.**

```ts
const { buckets, travellerNamesBySegmentId, codeOutcomes } = travelExtractionToSegments(data);
...
const totalSegments =
  buckets.travelSegments.length + buckets.accommodations.length + buckets.transportation.length;
const target = resolveTripTarget(matches);                 // hoisted — was called twice (:134, :142)
const { detail, degraded } = summarizeCodeOutcomes(codeOutcomes);
logEvent({
  level: degraded ? 'warn' : 'info',
  surface: SURFACE,
  message: 'travel document ready for review',
  context: {
    action: 'ready',
    kind: target.kind,                    // was `target_kind` — STRIPPED until now
    count: totalSegments,                 // was `segment_count` — STRIPPED until now
    detail,
  },
});
```

Three things happen here:

- **The two stripped keys are fixed** by remapping to the generic `kind` and `count`, which are already allowlisted (`diagnosticContext.ts:75`, `:321`) and whose allowlist comments state the convention explicitly ("`action`, `kind` and `error_code` above are REUSED rather than duplicated per feature"; `count` was added as "a GENERIC `count`" for exactly this reason). No new keys, and an event that has been empty since #30 starts carrying its payload.
- **`detail` carries the breakdown** as a fixed-shape, closed-vocabulary trace: `apt_code=2,apt_unl=0,apt_resc=0,apt_amb=0,apt_raw=0,air_code=1,air_unl=0,air_resc=0,air_amb=0,air_raw=0` (103 chars; ~113 worst-case with two-digit counts, well under `MAX_STRING_LEN = 200`). Fixed shape including zeros — easier to eyeball and to parse than a sparse one. Built in one place (`summarizeCodeOutcomes`) with one unit test pinning the exact string. This is the same use of `detail` the codebase already establishes (`useAppUpdate.ts:94` `floor=…,behind=…`; `usePodCompaction.ts:399` `wrote=…,read=…`) and the runbook already declares for the iOS share trace. `CLAUDE.md` rule 4 ("structured context, never string-interpolated data") is honoured where it matters: the **alarm signal is the `level`**, not a parsed string.
- **The level escalates to `warn`** when an **airport** was ambiguous or unresolved. That, not an integer key, is the queryable rate: `count(level="warn") / count(*)` filtered on the surface with the message pinned. Both levels fire on every extraction, so the _rate_ is computable — `CLAUDE.md` rule 6 ("emit the counter on the success path too"). Airline outcomes ride in `detail` for inspection but never move the level, so the warn rate stays a clean airport-resolution signal.

No `try/catch` is added around the emit: `logEvent` is contractually "fire-and-forget, NEVER throws" (`logEvent.ts` header) and the whole body already sits inside `deliverTravel`'s catch (`:88-99`). A third layer would be decoration.

### 4. Route the display fallbacks through the resolver

- `vacation.ts:862` — the existing module-private `airportCode()` keeps its name and both call sites (`:885`, `:886`), and its body becomes one line: `return resolveAirport(airport).code ?? airport?.trim() ?? ''`. The `split(' ')[0]` first-word fallback is gone; an unidentifiable airport now renders its **full trimmed string** instead of "John". No new export and no second name for one behaviour — the draft's "becomes `airportCodeOf()`, or the local function is deleted" left two futures open and would have put `airportCode` and `airportCodeOf` in the same file.
- `useVacationTimeline.ts:196-202` — replace the inline regex + first-word fallback with a new exported `flightCodeLabel()` in `vacation.ts` (beside the other title builders; `useVacationTimeline` already imports from `@/utils/vacation` and `vacation.ts` imports nothing from it, so there is no cycle), and drop the `if (seg.airline)` gate:

```ts
const label = flightCodeLabel(seg.airline, seg.flightNumber);
if (label) p.push(label);
```

`flightCodeLabel` is five statements, zero nesting, and **four** rules rather than the draft's five:

```ts
/** Two alphanumerics (at least one a letter) then 1–4 digits: "SQ25", "HO1602", "6E123". */
const FLIGHT_DESIGNATOR = /^(?=[a-z0-9]{2}\d)(?=[a-z0-9]*[a-z])[a-z0-9]{2}\d{1,4}$/i;

export function flightCodeLabel(airline?: string, flightNumber?: string): string {
  const carrier = resolveAirline(airline).code ?? airline?.trim() ?? '';
  const fn = flightNumber?.trim() ?? '';
  if (!fn) return carrier;
  // Itineraries print the designator both ways ("SQ25" and "SQ 25"); test the compact form
  // so the spaced one doesn't reintroduce the "SQ SQ 25" duplication, but display as written.
  if (FLIGHT_DESIGNATOR.test(fn.replace(/\s+/g, ''))) return fn;
  return `${carrier} ${fn}`.trim();
}
```

The draft's rules 3 ("flight number starts with the resolved code") and 4 ("flight number carries any designator") collapse into the single designator test: `SQ25` and `HO1602` both take it, so the special case for "matches _our_ code" disappears along with the need for a separate `airlineCodeOf` export. `segmentMerge.ts:49` already records the repo's position that "the flight number already encodes the carrier", so this is consistency, not invention. The existing `China Eastern (MU)` + `5678` fixture is unaffected — `5678` carries no letter, so it is not a designator and still renders `MU 5678`.

**The one trade-off, recorded deliberately:** on a codeshare (`Singapore Airlines (SQ)` + `NZ4567`) the summary shows `NZ4567` and drops the marketing carrier. That is the same stance `segmentIdentityKey` already takes, it avoids printing two contradictory carriers in a space-constrained row, and the full airline is still shown in `travelDetailRows`. Likewise an operational-suffix number (`LH400D`) or a 5-digit one falls through to `carrier + number`, which is merely verbose, never wrong. A future maintainer reading this should know both were chosen, not overlooked.

`travelDetailRows` (`useVacationTimeline.ts:266-270`) and `TravelExtractReviewModal.vue:152` deliberately keep showing the **stored** value: `Singapore (SIN)` reads well, and so does a legacy `Singapore Changi Airport`. Nothing to change in either.

Step 4 is the rung that fixes already-saved segments with no migration (requirement 7).

### 5. Prompt change, all three copies

Annotate the three field names **inside the flights clause** of the existing `travelFields` string in `TRAVEL_JSON_SHAPE`, byte-identically in all three copies, and close that clause (before `cruise:`) with the fallback rule:

> `kind=travel flights: airline (the 2-character IATA carrier code — e.g. "SQ", "HO", "A3" — converted from the carrier name printed on the itinerary; never the name), flightNumber, departureAirport, arrivalAirport (both the 3-letter IATA airport code — e.g. "SIN", "JFK" — converted from the airport name printed on the itinerary; never the name), departureDate (YYYY-MM-DD), … arrivesNextDay (boolean). For those three fields: if the document names only a city that has several airports, return the city name; if you cannot determine the code, return the name exactly as printed; never invent a placeholder such as "TBA", "TBD" or "UNK". cruise: …`

Bump `PROMPT_VERSION` to `'2026-09-15.1'` in all three.

**Both instructions are equally firm, and this is a deliberate change from an earlier draft** that asked for the airline code only "when confident". An itinerary always names the carrier and the airports in full, and the model knows the IATA mapping — so asking for the code is asking for something it can reliably do, and the softer wording was inviting a name we would then have to rescue. The `code-unlisted` rung (§1) is what makes the firm version safe: a code the model returns for a carrier outside our 135-entry list is kept, used, and counted as a success rather than as a resolution failure. "2-character", not "2-letter" — 15 codes contain a digit.

**The two guard clauses are not decoration — they close the holes a firm instruction opens:**

- _No invented placeholders._ `UNK` is Unalakleet, `NAN` is Nadi, `VAR` is Varna, `RET` is Røst. Without this clause, a model told it MUST return a code has an easy, plausible-looking out that resolves to a real airport in the wrong hemisphere, with outcome `code`, no warning and no escalation. A resolver-side denylist cannot fix this without deleting real airports, so the fix belongs in the instruction.
- _No guessing among a multi-airport city._ Without this clause the model quietly picks one of LHR/LGW/LCY/STN for a document that says only "London", and requirement 5's "never guess" becomes a rule we enforce on ourselves while delegating the guess. With it, `London` comes back as a name and lands in the `ambiguous` path, preserved and warned.
- _Name-as-last-resort_ keeps requirement 6 true: the resolver rescues a name; it can do nothing with `""`.

**The resolver is now the safety net, not the mechanism.** That is the intended division of labour, and it changes what the telemetry is watching: `apt_resc` / `air_resc` rising is no longer business-as-usual, it is the signal that the prompt has stopped working (a model change, a prompt regression, or a document class that defeats it).

### 6. Update the pinning test

`src/utils/__tests__/travelExtractionToSegments.test.ts:305-311` asserts the un-normalized passthrough. Change the two airport assertions to `'Singapore (SIN)'` / `'Shanghai (PVG)'`, leave `airline: 'Juneyao Airlines'` asserted **unchanged** (HO is not in the list — this is the documented steady-state passthrough, and pinning it proves requirement 6), and add a comment noting that this test's original subject was the nested-`travelFields` flattening of #30, which it still covers. The other airport-bearing tests in the file (`:103`, `:132`, `:194`) assert only notes/ids/travellers and pass unchanged — verified.

## Files Affected

**New**

- `src/utils/travelCodes.ts` — resolution (exported factory, ladder, fold, the two canonical formatters) + outcome accounting. No `errorReporter` import, no telemetry, no side effects.
- `src/utils/__tests__/travelCodes.test.ts` — fixture-list ladder tests (incl. the memo assertion via a counting `buildEntries`), the real-list per-entry round-trip/shape property test, and the `summarizeCodeOutcomes` cases

**Modified**

- `src/utils/travelExtractionToSegments.ts` — pure `canonicalizeTravelCodes` in `toTravelSegment`; `codeOutcomes` on `MappedExtraction`; narrowed dev `console.warn`
- `src/composables/useDocumentToTravel.ts` — extend the existing event (level escalation, `kind`/`count`/`detail`), hoist `resolveTripTarget`, name `totalSegments`
- `src/utils/vacation.ts` — `airportCode()` body delegates to `resolveAirport`; new exported `flightCodeLabel()`; `buildAirportOptions`/`buildAirlineOptions` use the shared canonical formatters
- `src/composables/useVacationTimeline.ts` — `buildTravelKeyValue` uses `flightCodeLabel`, flight number no longer gated on airline
- `src/services/ai/extractionPrompt.ts` — IATA instruction + guard clauses + `PROMPT_VERSION`
- `scripts/spikes/extractionPrompt.mjs` — same
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — same
- `src/utils/__tests__/travelExtractionToSegments.test.ts` — un-pin the airport passthrough, keep the airline one
- `src/utils/__tests__/vacation.test.ts` — new `buildTravelSegmentTitle` / `flightCodeLabel` cases (neither function has any test today)
- `src/composables/__tests__/useVacationTimeline.terminal.test.ts` — airline/flight-number label cases
- `src/composables/__tests__/useDocumentToTravel.test.ts` — assertions for the repaired telemetry context

**Deliberately NOT modified** (each was in an earlier draft; each is now unnecessary):

- `src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs`, `infrastructure/lambda/telemetry/__tests__/handler.test.mjs` — zero new context keys, so no allowlist edit, no mirror edit, no pinned-array edit.
- `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, the store Data-Safety / App-Privacy answers, `web/src/pages/privacy.astro` — no new key and no new data category, so §1's table must **not** be edited (the runbook's own rule at `:589-591`).
- `src/utils/errorReporter.ts` and any new `travel-codes` surface — the runtime index-build guard is gone (Approach §1), so no new error surface exists.
- `src/utils/__tests__/travelCodes.memo.test.ts` — **dropped in Pass 4.** Exporting `makeCodeResolver` lets the memo assertion be a counting `buildEntries` spy in the main test file, which removes the second file _and_ the `vi.mock('@/constants/airports')` it existed to isolate.
- `src/constants/__tests__/airports.test.ts` — not added; the per-entry round-trip property test in `travelCodes.test.ts` _is_ the constants-integrity check, so there is one test, not two.
- `src/components/travel/TravelExtractReviewModal.vue`, `travelDetailRows`, `src/components/ui/BaseCombobox.vue` — all display the stored value; the combobox already falls back to `modelValue` for an unmatched value and never clears it.
- `src/services/demo/demoFixture.ts` — its flights carry explicit titles; only the collapsed summary changes (`Beanstalk BN220` → `BN220`), and nothing pins it.
- `src/utils/vacation.test.ts` (the duplicate, non-`__tests__` file) — holds date/progress helpers only, no title expectations.

## Observability Coverage

**Events**

| Surface          | Level  | When                                                                                                                    | Context                                                                                                                                                                                      |
| ---------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `travel-extract` | `info` | once per travel extraction, after mapping, when every **airport** yielded a code (`code`, `code-unlisted` or `rescued`) | `action: 'ready'`, `kind` (create\|attach\|choose), `count` (segments), `detail` (`apt_code=…,apt_unl=…,apt_resc=…,apt_amb=…,apt_raw=…,air_code=…,air_unl=…,air_resc=…,air_amb=…,air_raw=…`) |
| `travel-extract` | `warn` | same call, same event, when any **airport** was ambiguous or unresolved                                                 | identical shape                                                                                                                                                                              |

One event per extraction, one surface, no second event and no second surface. The `level` is the classification; `detail` is the breakdown. Airline outcomes are recorded in `detail` but never move the level — an unlisted carrier is expected, not a defect.

**Failure modes covered**

- _The model stops returning codes after a prompt or model change_ — **this is the primary signal now that §5 makes the prompt the mechanism.** `apt_resc` / `air_resc` rising against a falling `apt_code` / `air_code` means the model has started returning names again and the resolver is carrying the load it was only meant to backstop. Visible as a **rate** because the event fires on every extraction, not only on failure, and legible without a local repro: a prompt regression, a model swap, or a document class that defeats the instruction all show here first.
- _A city-ambiguous input starts dominating_ — `apt_amb` rises specifically, distinguishing "we could not identify it" (`apt_raw`, → fix the prompt / re-run `update-airports`) from "we identified several" (`apt_amb`, → the family disambiguates in the segment edit drawer).
- _The resolver regresses to passthrough_ — `apt_code` and `apt_resc` collapse to zero while extractions continue, and the warn rate jumps to ~100%. No separate error event is needed to see it.
- _A bad `airport-sync` regeneration_ — caught **before merge** by the per-entry round-trip/shape test on the bot PR, which is strictly better than a production report: the corrupt list never ships. A malformed entry is additionally a `tsc` failure, since `airports.ts` is typed.
- _An airline or airport outside our lists_ — `air_unl` / `apt_unl` rise with `air_amb` / `apt_amb` flat, and the level stays `info`. Expected steady state (requirement 4): the model returned a valid code we simply cannot expand to a full name. Deliberately not an alarm, and distinguishable from `air_raw` / `apt_raw` (a name we could not place), which is the actionable one. A sustained `air_unl` is the cue to add the carrier to `airlines.ts` — the code itself is never logged, so identifying _which_ carrier means looking at the trip in the app, which is the correct privacy trade-off.
- _The prompt starts inventing placeholders_ — not directly visible (a listed placeholder like `UNK` counts as `code`), which is precisely why the instruction forbids it and a prompt test pins the clause. Recorded here so nobody expects telemetry to catch it.
- _The event itself is empty_ — the defect this plan fixes. After it, `count > 0` on every `ready` event; `count` absent fleet-wide means the allowlist regressed again.

**No silent failures**

- The resolver is **total by construction**: every input returns a `CodeResolution`. There is no `try`, no `catch`, no throw path, and therefore nothing that could be swallowed — CLAUDE.md rule 2 is satisfied by having no exception handling rather than by having correct exception handling.
- Index construction cannot fail at runtime (typed, compile-validated constants), skips any falsy-code entry, and leaves a wrong-length code reachable by name only, so the worst case is "one airport is unresolvable" — which is the preserved-verbatim path.
- Every ambiguous value, and every unresolved **airport**, produces an on-device `console.warn` naming the value **and the next step**, and is simultaneously visible to the family in the review modal and editable — after save — in the segment edit drawer. That is the user-facing graceful degradation.
- `logEvent` cannot throw by contract, and the caller already sits inside `deliverTravel`'s catch, which toasts `ai.error.generic` and reports.

**Success-path signal** — the event fires on every extraction, including the all-resolved case, so the failure rate is computable. It carries no duration, so `TELEMETRY_FLOOR_MS = 250` does not apply.

**Critical vs. telemetry** — nothing here is `severity: 'critical'`, and nothing calls `reportError` at all. No user action fails and no data is at risk: the worst outcome is a cosmetically wrong title over a preserved, editable value. Firehose only, no Slack page.

**Privacy / store gate** — **no new context keys.** `action`, `kind`, `count` and `detail` are all already allowlisted in `src/utils/diagnosticContext.ts` (verified at `:68`, `:75`, `:188`, `:321`), already mirrored in `infrastructure/lambda/telemetry/index.mjs`, and already declared to Apple and Google inside the existing Diagnostics → Other Diagnostic Data category. Per `docs/runbooks/native-store-submission.md:589-591`, §1's data-collection table is therefore unchanged and must not be edited. No value in `detail` is derived from the model's string — it is ten integers under fixed labels. The raw airport/airline string never leaves the device.

> ⚠️ **The `## Observability Coverage`, `## Acceptance Criteria` and `## Testing Plan` sections
> below describe the DELETED resolver design.** They are kept verbatim as the record of what was
> approved. Read the "SUPERSEDED IN IMPLEMENTATION" section at the end of this file for what
> actually shipped — in particular, the `detail` format named above is not emitted (an
> `inferred_count` integer replaced it), and the criteria referring to `code-unlisted`,
> `travelCodes.ts`, `makeCodeResolver` and the per-entry property test describe code that no
> longer exists.

## Acceptance Criteria

- [ ] `resolveAirport` / `resolveAirline` return the canonical form for a listed bare code (`sin`), a trailing parenthesized code, an exact folded name and an unambiguous city
- [ ] A correctly-shaped but **unlisted bare** code (`HO` for airlines) returns `code-unlisted`, keeps the upper-cased code as both `value` and `code`, is used for display, prints **no** console warning, and does **not** set `degraded`
- [ ] `code-unlisted` is produced by the **bare-code rung only**: `London Heathrow (T5)` returns `unresolved` with the string preserved, **not** `T5`
- [ ] An already-canonical value round-trips **byte-identical**, including `ANA (All Nippon Airways) (NH)`; and every non-canonical outcome re-resolves to itself (idempotent for all five outcomes, including `code-unlisted`)
- [ ] **Every** `AIRPORTS` / `AIRLINES` entry resolves from its own canonical value back to **its own `code`** with outcome `code`, and every airport code matches `/^[A-Z]{3}$/`, every airline code `/^[A-Z0-9]{2}$/` — a per-entry property, with **no count asserted and no canonical-value byte-identity asserted** (a future duplicate IATA code is correct behaviour, not a failure), so a bad `airport-sync` regeneration fails the bot PR instead of production
- [ ] The canonical stored shape has **one definition**: `buildAirportOptions().value` and `resolveAirport(name).value` are produced by the same function
- [ ] A multi-airport city (`London`) returns `ambiguous` with the original string preserved; the same holds for a fixture-list name that is another fixture entry's city
- [ ] An unresolvable string is preserved verbatim — no blanking, no partial rewrite; `Sydney (SYD) Terminal 1` is left alone rather than truncated
- [ ] A segment created from an extraction whose values resolved to `code` or `rescued` carries the same field shape as one created from the picker, and the value appears as a **selected option** (not fallback text) in `TravelSegmentEditModal`'s combobox. A `code-unlisted` / `ambiguous` / `unresolved` value renders as fallback trigger text and is **not** cleared — asserted, because that is the documented consequence of requirement 4
- [ ] `John F. Kennedy International Airport` titles a flight `JFK`, not `John`; an unknown airport titles with its full string, not its first word
- [ ] An already-saved segment holding an airport name renders its code, with the stored value unchanged
- [ ] `Juneyao Airlines` + `HO1602` renders `HO1602` (not `Juneyao HO1602`); `Singapore Airlines (SQ)` + `SQ25` renders `SQ25`; `Singapore Airlines (SQ)` + `SQ 25` renders `SQ 25` (not `SQ SQ 25`); `China Eastern (MU)` + `5678` still renders `MU 5678`; a flight number with no airline renders instead of vanishing
- [ ] All three prompt copies carry the **firm** IATA instruction for airports **and** airlines (not the "when confident" wording), **plus both guard clauses** (no placeholder such as `TBA`/`TBD`/`UNK`; a multi-airport city comes back as the city name); the annotations sit inline on the flight field names, not appended after the cruise/train clauses; `PROMPT_VERSION` is `2026-09-15.1`; `extractionPromptDrift.test.ts` green
- [ ] A live extraction against the redeployed Lambda returns codes rather than names for a real itinerary — the prompt rung is verified end to end, not assumed (this is the mechanism now, so it is tested as one)
- [ ] Each resolver builds its index **once** per session, from its **own** list — asserted through the exported factory with a counting `buildEntries`, with no module mocking
- [ ] `travelCodes.ts` imports no telemetry or error-reporting module, and `vacation.ts` remains free of side effects on the render path
- [ ] `canonicalizeTravelCodes` does not mutate its argument (asserted: the object passed in is unchanged)
- [ ] The `travel-extract` `ready` event now ships `kind`, `count` and `detail` through the allowlist (previously `segment_count`/`target_kind` were dropped), escalates to `warn` on an **airport** failure only, **stays `info`** when only an airline was unresolved or unlisted, and **adds no key to `ALLOWED_CONTEXT_KEYS`** — `diagnosticContext.ts`, the Lambda mirror, its pinned test and the store runbook are untouched
- [ ] No test asserts an `AIRPORTS` / `AIRLINES` cardinality, and no rung behaviour is pinned to a churn-sensitive real-list row (the monthly `airport-sync` bot PR stays green)
- [ ] `npm run validate` green

## Testing Plan

1. **Resolver unit tests** (`travelCodes.test.ts`) — **rung behaviour against a 3-entry fixture list** through the exported `makeCodeResolver`, so nothing here depends on a monthly-regenerated row: one case per rung, idempotency for all five outcomes, case-insensitivity, diacritic folding, trailing-`Airport`/`International` stripping, name-vs-city ambiguity, the `code-unlisted` bare rung (`value`/`code`/no-warn/not-degraded), the `code-unlisted`-is-bare-only guard (`Heathrow (T5)` → `unresolved`), a trailing parenthetical that is not a code, `Sydney (SYD) Terminal 1` preserved, empty/`undefined` input, a digit-bearing airline code (`A3`), a 2-letter ordinary word that must not match by substring, the memo assertion (counting `buildEntries`, resolve twice, one build), and `summarizeCodeOutcomes`' exact `detail` string plus `degraded` true for an airport failure / **false** for an airline-only failure and for `code-unlisted`. Then, against the **real** lists: the **per-entry round-trip + code-shape property test** (which doubles as the constants-integrity guard on the monthly bot PR), `London` → `ambiguous`, and the four headline rescues (`Singapore Changi Airport`, `Shanghai Pudong International Airport`, `John F. Kennedy International Airport`, `Felix Houphouet Boigny Airport`). **No count assertions.**
2. **Mapper tests** — the #30 nested-shape fixture now yields canonical airports and still yields the verbatim airline; `codeOutcomes` tallies are correct; the input object passed to `canonicalizeTravelCodes` is not mutated; an unresolvable airport logs one `[travel-extract]` warn while an unresolvable _airline_ and a `code-unlisted` value log none; cruise ports and train stations are untouched.
3. **Title tests** (`vacation.test.ts`, first coverage for `buildTravelSegmentTitle`) — `SIN → PVG` from names, from codes and from mixed input; an unknown airport renders its full string, not its first word; plus the `flightCodeLabel` rules including the spaced designator (`SQ 25`), the no-airline case, and the codeshare case (`SQ` + `NZ4567` → `NZ4567`).
4. **Timeline test** — `buildTravelKeyValue` renders the label per requirement 11, and the existing `China Eastern (MU)` + `5678` → `MU 5678` fixture (`useVacationTimeline.terminal.test.ts:14-15`) is unchanged.
5. **Caller test** — `useDocumentToTravel.test.ts` gains assertions that the `ready` event's context contains `kind`, `count` and a `detail` matching the `apt_code=` shape (the regression guard for the stripped-keys defect), and that an airline-only failure keeps `level: 'info'`.
6. **Drift guard** — `extractionPromptDrift.test.ts` green after the three-copy edit, plus one assertion in the client prompt test that the `travelFields` value contains the IATA requirement **and** the no-placeholder clause (so a future prompt edit cannot quietly delete the guard that stops `UNK` becoming Unalakleet).
7. **Live prompt check** — after the Lambda redeploy, run one real itinerary through the deployed extractor and confirm it returns `SIN`/`PVG`-shaped codes and a 2-character airline code, not names; and run one itinerary that names only a multi-airport city and confirm it comes back as the city name rather than a guessed code. The prompt is the primary mechanism after §5, so it gets a live test rather than an assumption; the 2026-09-14 lesson was that only a production call found the system-vs-user prompt conflict.
8. **Browser walk** (per the standing "verify in a browser" rule): hand the app a real flight confirmation, confirm the review modal shows `"Singapore (SIN)"` in the route line and the saved trip titles the flight `SIN → PVG`; open the segment edit modal and confirm the combobox shows the value as a _selected option_ rather than raw fallback text; confirm the collapsed timeline row reads `HO1602`, not `Juneyao HO1602`.
9. **CloudWatch** — after deploy, confirm one `travel-extract` `ready` event per extraction whose `count`/`kind`/`detail` are actually present (they are absent today), and that a name-bearing document produces `level: warn` with a non-zero `apt_amb`/`apt_raw`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the resolver-at-the-boundary design, the display-fallback rung that fixes saved data without a migration, the three-copy prompt change, and pure-mapper + caller-emits telemetry.
- **Pass 2 (DRY + error handling)**: Verified every claim against the code and corrected the wrong ones (list size 4,159 not 4,031; `Juneyao`/`HO` is **not** in `AIRLINES`, so that acceptance criterion was unachievable; airline codes are alphanumeric; no test covers the title builders at all today). Found and folded in three live defects in the same code paths: `segment_count`/`target_kind` have never been allowlisted and are stripped from every travel-extraction event; the airline token duplicates the flight number (`SQ SQ25`); a flight number with no airline is dropped. **DRY:** collapsed the two ladders into one generic `makeCodeResolver`; collapsed three maps + an ambiguity set into two maps (`null` = ambiguous) and merged the name and city rungs into one, which also removed a real mis-resolution (`Aberdeen` → `ABZ`); dropped the unused `via` union, the unconsumed `canonical` status and the `canonicalAirport`/`canonicalAirline` wrappers; extended the **existing** telemetry event instead of adding a second; reused the already-allowlisted `action`/`kind`/`count`/`detail` for **zero new context keys**, which deleted six files from the change set per the runbook's own precedent; recorded why `segmentMerge.keyPart` is deliberately not refactored. **Error handling:** added the index-build guard (report once, cache an empty index, degrade to verbatim passthrough, name the file to fix); put a fix-guidance `console.warn` at the boundary and kept the render path silent; removed the redundant try/catch around `logEvent`; end-anchored the paren rung so no input is ever partially rewritten; banned list-cardinality assertions so the monthly `airport-sync` bot PR cannot go red.
- **Pass 3 (Sustainability)**: Cut the unreachable runtime index-build guard (a malformed typed constants file is a `tsc`/CI failure, and the guard made a "no side effects" title builder able to fire telemetry mid-render) and replaced it with a per-entry round-trip property test that fails the bot PR instead; made the canonical stored shape a **single shared definition** used by both the resolver and the combobox option builders; made the boundary transform **pure** instead of mutate-and-return; de-genericized `makeCodeResolver` to a monomorphic factory over a flattened `CodeEntry` with the memo **inside** the closure (the draft's module-scoped `let index` would have been shared by both resolvers); replaced the suffix-stripping while-loop with one regex; collapsed `flightCodeLabel` from five rules to four (no nesting) and `formatCodeOutcomes`+`codeResolutionDegraded` into one `summarizeCodeOutcomes`; kept `fold`/`airlineCodeOf` unexported rather than shipping speculative API; **fixed a reliability bug — the draft escalated the event to `warn` on the expected "airline not in the 135-entry list" outcome, which would have made the warn rate useless**, so level and console warnings are now airport-driven only; corrected the warn's remediation text, which told maintainers to hand-edit an auto-generated file; documented the duplicate-IATA-code and codeshare trade-offs.
- **greg's edit (post-Pass-3)**: Keep the three folded-in defects together ("they're the same lines"). And: _"any travel itinerary should have the full airport name, so AI should be able to read that and return a proper 3 letter airport code as well as airline code."_ Applied by making both prompt instructions equally firm (the airline one was softer), promoting the prompt to the primary mechanism with the resolver as safety net, and adding the `code-unlisted` outcome that the firm instruction requires — a valid code outside our lists is a success, not a resolution failure, so the warn rate keeps measuring the model rather than our lists' coverage. Recorded the `TBA`/`UNK` garbage-code trade-off and added a live post-deploy prompt check.
- **Pass 4 (Fresh-eyes sweep)**: Both late additions are right in substance but were under-specified. **Firm prompt:** added two guard clauses it was missing — no invented placeholders (**`UNK` is Unalakleet, `NAN` is Nadi, `VAR` is Varna, `RET` is Røst**, so a placeholder would have resolved to a real airport as outcome `code` with no warning — strictly worse than today's visible `UNK`) and no guessing a code from a multi-airport city (which had silently moved requirement 5's "never guess" decision into the model); moved the annotations inline onto the flight field names instead of appending after the cruise/train clauses. **`code-unlisted`:** pinned it to the **bare-code rung only** (extending it to the paren rung would turn `London Heathrow (T5)` into `T5`, and `Circle City (New)` is a real row), scoped requirement 2 and the combobox acceptance criterion to `code`/`rescued` (as written they contradicted requirement 4), and recorded the name-for-code trade-off it imposes on `travelDetailRows`. **Corrections:** the review modal is **not an editor** (its own header says so), so the `console.warn` copy and three caveats now name the segment edit drawer; the airport/airline comboboxes pass **no `otherValue`**, so the "'other' free-text mode" justification was wrong (the real, stronger argument is that free text is impossible, and an unmatched value falls back to `modelValue` rather than being cleared); `flightCodeLabel` now tests the designator on the whitespace-stripped number, so the common `SQ 25` form no longer reprints as `SQ SQ 25`; the demo-fixture claim was wrong (both demo flights carry explicit titles — only the summary changes). **Sustainability:** exported `makeCodeResolver` so every rung is tested against a 3-entry fixture list, which deletes `travelCodes.memo.test.ts` and its `vi.mock` of the 4,159-entry constants module and stops `Aberdeen`/`Albany` ambiguity (a churn-sensitive row) from being load-bearing in tests; forbade asserting canonical-value byte-identity in the per-entry test (a future duplicate code is correct behaviour); recorded the nine bare-3-letter place-name/code collisions as an accepted property; noted the i18n rule does not apply.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Previously I recall we had a bug where sometimes the AI would return an airport name instead of an airport code. Can you confirm that this bug is fixed now?

### Follow-up 1

> Yes please go ahead and fix with /beanies-plan then proceed to /beanies-build-auto

### Follow-up 2

> no keep them together, they're the same lines. also, any travel itinerary should have the full airport name, so AI should be able to read that and return a proper 3 letter airport code as well as airline code.

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Pass 4 review prompt

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.
>
> Two parts of this plan were added late, after the earlier review passes, at the user's direction. Give them particular scrutiny, and say plainly if either is wrong: (1) the strengthened prompt instruction (Approach §5); (2) the `code-unlisted` outcome. Check specifically whether `code-unlisted` interacts badly with anything (the combobox option matching, the canonical-shape single-definition requirement, the per-entry property test, `flightCodeLabel`, idempotency), and whether the firmer prompt creates any risk the plan has not recorded.

</details>

### Critical Files for Implementation

- `/home/greg/projects/beanies-family/src/utils/travelCodes.ts` (new)
- `/home/greg/projects/beanies-family/src/utils/travelExtractionToSegments.ts`
- `/home/greg/projects/beanies-family/src/utils/vacation.ts`
- `/home/greg/projects/beanies-family/src/composables/useDocumentToTravel.ts`
- `/home/greg/projects/beanies-family/src/services/ai/extractionPrompt.ts` (plus the two mirrored copies)

---

## ⚠️ SUPERSEDED IN IMPLEMENTATION — the altitude was wrong

> Added 2026-09-15, after implementation and a `/code-review max`. Everything above is the plan as
> approved through four passes. **It was built, reviewed, and then largely deleted.** This section
> is the record of why, because the plan's central claim turned out to be the defect.

### What the plan got wrong

The plan's answer to "the AI returns an airport name" was a **local resolver**: a 4,159-row
index over `AIRPORTS`/`AIRLINES` that mapped names and cities back to codes, applied at the
extraction boundary and behind the display fallbacks. It was built exactly as specified, and the
review found the design unsafe. Reproduced against the real lists:

| Input                           | Stored                                                  | Outcome     | Signal            |
| ------------------------------- | ------------------------------------------------------- | ----------- | ----------------- |
| `Goa`                           | `Genova (GOA)` — India to Italy                         | `code`      | none              |
| `Tokyo`                         | `Tokyo (HND)` — a Narita itinerary becomes Haneda       | `rescued`   | none              |
| `Washington`                    | `Washington (DCA)` — Dulles unreachable by its own city | `rescued`   | none              |
| `UNK`                           | `Unalakleet (UNK)` — Alaska                             | `code`      | none              |
| `Dubai International Airport`   | unchanged                                               | `ambiguous` | warns + escalates |
| `London` / `Paris` / `New York` | unchanged                                               | `ambiguous` | warns + escalates |

The wrong answers landed at the **highest-confidence** outcomes, silently, in the family's CRDT;
the alarm fired on exactly what the prompt instructed the model to return. Three root causes:

1. **The OurAirports `city` column is inconsistent across co-located airports** — NRT's city is
   `Narita`, IAD's is `Dulles`. So "this city matches exactly one row" is not evidence of
   unambiguity, and the ambiguity guard protected ~1% of city inputs rather than the ~139 the
   plan assumed.
2. **29 airports have a 3-letter city or name**, so the bare-code rung ate them (`Goa` → GOA).
3. **A guard clause added in §5 fed the weak engine its hardest inputs.** "If the document names
   only a city that has several airports, return the city name" deliberately routed bare city
   names into the one rung that guesses. Self-inflicted, and the worst single decision in the plan.

Four review passes missed all of it because **none of them executed the resolver against the real
list**. The ladder reasons beautifully; only measurement shows the data does not support it.

### The measurement that settled it

| Path                                                  | Result                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Model returns a **code** (what the prompt asks)       | **4,159/4,159 airports, 135/135 airlines correct**               |
| Model returns a **name** (the resolver's rescue rung) | 4,065 rescued, 87 ambiguous, **4 landed on a different airport** |

greg's call, and it is the right one: _"we should be asking the model to translate city or airport
names to codes … not be writing logic to do it ourselves in our code — this is what we should be
using AI for and it should be much more accurate and simpler. In the case the AI returns an answer
with low confidence, we can fallback to the information in the original document."_

A model that knows the world's airports is a far better name→code resolver than a string matcher
over an open-data CSV. The local engine was a liability wrapped around a fix the prompt delivers.

### What actually shipped

**The prompt is the mechanism; there is no local translation.** `PROMPT_VERSION` `2026-09-15.2`,
byte-identical in all three copies: return the IATA airport and airline codes, translating from
the names the itinerary prints; if you cannot confidently identify one (including a multi-airport
city the document does not disambiguate), **return the name exactly as printed**; never invent a
placeholder. The not-confident fallback is the document's own words, not a guess of ours.

Three code changes, all table-free:

1. **`vacation.ts::airportCode`** — the original defect. Kept the unanchored paren match (so
   `Sydney (SYD) Terminal 1` still reads `SYD`) and replaced the `split(' ')[0]` fallback, which
   titled a JFK flight **"John"**, with the whole trimmed string. Longer, never wrong.
2. **`vacation.ts::flightCodeLabel`** (new, ~8 lines) — prints the carrier once. A **prefix test**,
   not a shape test: the plan's `FLIGHT_DESIGNATOR` regex still produced `EK EK` and `SQ SQ-25`,
   and silently erased the airline when the flight-number field held an equipment code (`E190`).
   Also drops the `if (seg.airline)` gate, so a flight number with no airline stops vanishing.
3. **`useDocumentToTravel.ts`** — the separate live defect: `segment_count` and `target_kind` were
   never in `ALLOWED_CONTEXT_KEYS`, so every travel-extraction event since #30 shipped an empty
   payload. Remapped to the allowlisted `kind`/`count`, plus `detail: coded=N,named=N` from a
   shape regex (not a lookup) and `warn` when `named > 0` — the model declining to translate is
   the prompt-health signal, and it is supposed to be rare.

**Deleted, never shipped:** `src/utils/travelCodes.ts` and its tests — the resolver, the fold, the
factory, the canonical formatters, the outcome tally, the write-time field rewriting. **No
extracted value is rewritten at all now**, so the stored field stays what the document said and
the #30 regression test keeps its original assertion.

### Findings from the review that the smaller design makes moot

The resolver carried a measured 42-88ms synchronous index build on the first flight-title render
(below `TELEMETRY_FLOOR_MS`, so unmeasurable in production); `fold()` deleted non-decomposable
letters, so `Bodo` failed while `Bodø` resolved; `TRAILING_GENERIC` collapsed 55 uniquely-resolvable
hub names into `ambiguous`; the per-entry "constants integrity" test short-circuited at the paren
rung and never touched the name index it claimed to guard; and write-time rewriting would have
silently reverted a family's manual correction on the next upload of the same PDF. None of it
exists any more.

### Still open, deliberately

- **`extractSegmentOccurrences` emits the stored `seg.title`**, so a pre-change segment keeps its
  legacy title on every calendar chip, month cell and scheduled reminder while `/travel` shows the
  derived one. Pre-existing (titles have always been stored), not made worse here, out of scope.
- **A long name in a title row truncates.** `VacationSegmentCard`'s title is a single `truncate`
  line, so `John F. Kennedy International Airport → SIN` ellipsizes. Correct-and-clipped beats
  short-and-wrong, the full value is in the detail row, and it only occurs when the model declined.
- **`VacationStep2.vue` passes `other-value`** on the airport/airline comboboxes, so the wizard can
  still write a free-text name. Harmless now that nothing rewrites values and the title renders a
  name in full — but it refutes the plan's "one write site" claim, which is recorded here because
  the claim was load-bearing for the deleted design.
- **The live prompt check is the load-bearing test and is greg's to run.** The prompt is now the
  whole mechanism, and only a real document through the deployed Lambda proves it translates.

### Round-three addendum: two more review rounds, and the rule that ended them

A second `/code-review max` on the small design found real line-level defects, and **the fixes for
them introduced a worse one**: adding a leading bare-code rung _before_ the parenthesized rung
turned `LOS ANGELES (LAX)` into `LOS` — Lagos, Nigeria. Also `SAN FRANCISCO (SFO)` → `SAN` (San
Diego) and `ABU DHABI (AUH)` → `ABU` (Atambua). GDS and e-ticket text is overwhelmingly all-caps,
and the prompt's own not-confident fallback returns the printed name, so that is the mainline path
for the exact shape it broke. All 95 tests were green.

That was the third round of fixes-introducing-regressions in the same two functions, which is the
repo's own signal to stop patching and move the decision (`docs/lessons.md`). The structural answer:

- **One `carriedCode(value, width)` in `vacation.ts`**, exported, consumed by `airportCode`,
  `flightCodeLabel` and the extraction telemetry's shape probe. Three consumers deriving the code
  three ways was its own defect class — an anchored probe beside an unanchored extractor logged
  working input as a translation failure and escalated the event.
- **Two shapes, and deliberately no cleverer rung**: the whole trimmed value when it _is_ a code,
  or a parenthesized code. Parens are matched **first**, which is what stops an all-caps city word
  winning over the real code.
- **The governing rule, written into the docstring so the next rung has to argue with it:**
  _verbose but true beats short and possibly false._ When a field does not plainly carry a code the
  caller renders the whole string. `SIN Terminal 3` therefore titles long rather than earning back
  a rung whose failure mode is a different real airport. A test pins that as intended, not a bug.
- **Placeholders are refused in both shapes** (`TBA`, `Somewhere (TBA)`), since `UNK` is Unalakleet
  and `NAN` is Nadi.
- **`flightCodeLabel` derives the carrier once** for bare and parenthesized shapes. Branching on
  shape had left the bare path unguarded: `EK` + `EK` printed `EK EK`, and `SQ` + `E190` dropped
  the carrier — the two defects the function exists to prevent, on the shape the prompt now makes
  mainline.
- **`inferred_count` meters airports only**, the same number `level` keys on, so the metric can
  always reproduce the severity it shipped with.

`PROMPT_VERSION` `2026-09-15.3` also scopes the translate directive to the three flight fields and
attaches the code note to `departureAirport` as well as `arrivalAirport`. The unscoped wording sat
immediately above the cruise and train field lists; a model returning `operator: 'EST'` for
Eurostar would have missed `segmentIdentityKey` (type + operator + departureDate) and appended a
duplicate train segment on every re-upload.

### Carried forward, not fixed here

Each is real, verified, and out of scope for a title fix. Named so they are decisions rather than
oversights:

- **The Lambda ships only via `terraform apply`; no workflow runs terraform.** `managed` is the
  default tier, so a client-only deploy would ship the longer titles with none of the benefit.
  Applied by hand three times in this session and verified live, but nothing detects a
  prompt-version skew the way `managedProvider` already detects an unknown task.
- **A title is unbounded and persisted.** Travel fields are capped at `MODEL_TEXT_MAX = 4000`, not
  200, so two pathological OCR-bleed fields could persist an ~8KB derived title to every device.
  `.trim()` also does not collapse internal newlines.
- **`segmentMerge` downgrades picker values.** `departureAirport`/`arrivalAirport`/`airline` are not
  in `SPECIAL_KEYS`, so re-uploading a PDF over a hand-picked segment replaces `Singapore (SIN)`
  with `SIN`. Line 159 then re-derives `title`, overwriting a user-authored one despite `title`
  being excluded. Both pre-date this change; the prompt makes the first visible.
- ~~**The review modal hides the route when it equals the title**~~ — **FIXED.** The suppression
  assumed the title was a _shortened_ form of the route, which stopped being true once a title can
  be the full route verbatim. The route now always shows when there is one, and it is expanded to
  readable names.
- ~~**Combobox round-trip.**~~ **FIXED** — greg hit it on a real EVA Air itinerary: the codes came
  back correct (`LAX`, `TPE`, `BR`) but the FROM dropdown showed a custom "SIN" rather than the
  matching airport, because the option `value` is `"Singapore (SIN)"` and `VacationStep2` passes
  `other-value`, so `checkBackwardCompat()` flipped the field into "other" mode.

  The mapper now stores the value the PICKER writes, via the same `airportLabel`/`airlineLabel`
  pair the display sites use: `expandCodesToPickerValues` in `travelExtractionToSegments.ts`.

  **This is not a reversal of the "no write-time rewriting" decision.** What that decision
  forbade was persisting an _inference_ — name→code, which the measurements showed unreliable.
  Expanding a bare LISTED code to its own canonical label is an identity map over a 1:1 exact
  index, and everything that is not one (a name, an unlisted code, a placeholder, a value with
  trailing text) passes through untouched, so the document's own words are still never overwritten
  by a guess. The functions are idempotent, so a picker-entered value is a no-op.

  Verified end to end through the real mapper: `SIN`/`TPE`/`BR` store as `Singapore (SIN)` /
  `Taoyuan (TPE)` / `EVA Air (BR)`, each matching a dropdown option exactly (pinned by a test), so
  the drawer now shows the selected option — `Singapore - Singapore Changi (SIN)` — instead of raw
  text. The title still derives as the compact `SIN → TPE`.

- ~~**Detail rows now read `SIN` / `SQ` rather than a name**~~ — **FIXED**, on greg's call:
  _"a code to airport name lookup is fine and this should already exist in the airport
  drop-down."_ It did: `buildAirportOptions` already carried the data, so `airportLabel` /
  `airlineLabel` share one `Map` and one definition of the stored shape with it, and a test pins
  them byte-identical so the dropdown and the label cannot drift.

  **code→entry is the safe direction and the only lookup in the file** — 1:1, exact, zero
  duplicate codes in either list. That is the whole difference from the deleted resolver: asking
  a CSV to translate a _name_ is unreliable, expanding a _code the model already gave us_ is a
  dictionary lookup.

  **Bare codes only.** A value that already carries text (`Sydney (SYD) Terminal 1`, or a name)
  is returned exactly as stored — expanding it would discard what the document said. Titles keep
  the compact code (`SIN → JFK`); only the detail rows and the review modal's route expand.
  Placeholders are refused, with the denylist stopping deliberately short of `NAN`, which is Nadi,
  Fiji rather than a garbage token.

  Verified in a browser: `FROM Singapore (SIN) / TO New York (JFK) / AIRLINE Singapore Airlines
(SQ)` from a segment storing `SIN`/`JFK`/`SQ`.

- **`WallPeripheralCards.vue:60` documents an invariant this change breaks** for pre-existing pods:
  its comment says `item.title` "already renders a flight as SIN → HND", which is no longer true
  for a segment whose stored airports are names.
