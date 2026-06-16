---
name: beanies-pre-plan
description: Standardized requirements-intake step that runs BEFORE beanies-plan. Collects complete, well-structured intent (via a copy/paste template or a Notion issue row), reviews EVERY field, asks the user to resolve anything missing/unclear/TBC (writing resolved values back to the tracker) before building, and — when a mockup is requested — generates a CIG-clamped UI mockup via the frontend-design skill, gets it approved, and stores it on the tracker. Only after explicit user approval does it hand a fully-populated initial prompt (plus any approved mockup) to beanies-plan. Use when the user says "pre-plan this", "intake this issue", "prep a plan for X", or invokes /beanies-pre-plan.
---

# beanies-pre-plan — Requirements Intake for beanies-plan

`beanies-plan` refines _how_ work gets built through four review passes, but none of those passes can invent a missing requirement, an overlooked platform, or an unstated constraint. The quality ceiling of a plan is set _before_ Pass 1 runs — by the completeness of its initial prompt.

This skill front-loads that completeness. It gathers intent into a standard structure, reviews and validates **every** field, resolves anything missing, unclear, or marked `TBC` with the user **before** building anything, and — only with the user's explicit go-ahead — hands a fully-populated prompt to `beanies-plan`. The result: `beanies-plan`'s clarifying-question round shrinks to genuine gaps only.

**This skill is problem-side only.** It captures _what_ and _why_ — never _how_. The technical approach is `beanies-plan`'s job; pre-specifying it would short-circuit the 4-pass design reasoning. (The one near-the-line field, _Reuse hints / affected files_, is an optional pointer for the DRY pass — a place to look, not a solution to adopt.)

---

## When to Invoke

- **Via slash command:** `/beanies-pre-plan`
- **Natural language:** "pre-plan this", "intake this issue", "prep a plan for X", "let's spec this before planning"
- The skill chains INTO `beanies-plan` — but **only after the user explicitly approves** the assembled prompt. It never auto-launches `beanies-plan`, and it never replaces or modifies it.

> **Issue numbers always mean the Notion tracker, never GitHub.** Any bare issue reference — `#29`, `issue #29`, `id 29`, "the 29 issue" — resolves to the **`ID` (unique_id) of a row in the "Beanies Main Issue Tracker" Notion DB** (binding block below), and the skill runs in **NOTION mode**. These are NOT GitHub issue numbers and the skill must never `gh issue view` them. (GitHub issues are an _output_ of `beanies-plan`, gated by the Notion `github issue` passthrough — never an input here.) If the intended source is genuinely a GitHub issue or a pasted block, the user will say so explicitly.

---

## The Canonical Field Table — single source of truth

This table is the ONE authoritative definition of the intake fields. The copy/paste template (below), the Notion property mapping, and the field→`beanies-plan` section mapping are all **projections of this table** — read off its columns. To add, rename, or remove a field, edit one row here; everything else re-derives. **Never type the field list out a second time.**

| Field                          | Tier            | Applies to | Notion property (type)                                                   | → beanies-plan section          |
| ------------------------------ | --------------- | ---------- | ------------------------------------------------------------------------ | ------------------------------- |
| Title                          | Required        | all        | Name (title)                                                             | plan Title                      |
| Type                           | Required        | all        | Issue Type (select: Bug / Feature)                                       | labeling                        |
| Priority                       | Required        | all        | Priority (select — vocab-mapped, see binding block)                      | labeling                        |
| Surfaces — platforms           | Required        | all        | Device Type (multi-select)                                               | Approach + DRY targeting + labeling |
| Surfaces — area                | Required        | all        | View (multi-select)                                                      | Approach + labeling             |
| Objective                      | Required        | all        | Objective / Goal (rich text)                                             | Context                         |
| Scope-do                       | Required        | all        | Main Requirements / Scope (rich text)                                    | Requirements                    |
| User story                     | Conditional     | feature    | User Story (if feature) (rich text)                                      | User Story                      |
| UX / mockup                    | Conditional     | feature    | UI / UX Expectations (rich text)                                         | Important Notes                 |
| Current                        | Conditional     | bug        | Current Behavior (if bug) (rich text)                                    | Context                         |
| Expected                       | Conditional     | bug        | Expected Behavior (if bug) (rich text)                                   | Requirements                    |
| Repro                          | Conditional     | bug        | _(no direct Notion property — fold into References)_                     | Context / Testing seed          |
| Out-of-scope                   | Optional (`—`)  | all        | Out of Scope (rich text)                                                 | Important Notes                 |
| Acceptance criteria            | Optional (`—`)  | all        | Acceptance Criteria (rich text)                                          | seeds Acceptance Criteria       |
| Edge cases / constraints       | Optional (`—`)  | all        | Edge Cases / Constraints (rich text)                                     | edge-case analysis seed         |
| Reuse hints / affected files   | Optional (`—`)  | all        | Reuse Hints / Affected Files (rich text)                                 | Approach + DRY-pass seed        |
| References                     | Optional (`—`)  | all        | References / Supporting Materials + Dependencies / Related Issues (rich text) | Context / Related issues   |
| Open questions                 | Optional (`—`)  | all        | Open Questions (rich text)                                               | Assumptions + clarify loop      |
| Notes                          | Optional (`—`)  | all        | Notes / Comments (rich text)                                             | Important Notes                 |

**Tiers** (read off the _Tier_ + _Applies to_ columns):

- **Required** — always present. ~6 fields. Keep it this small; if intake becomes a 20-field form it gets abandoned.
- **Conditional** — required only for their _Type_: `feature` → User story (+ UX/mockup); `bug` → Current + Expected (+ Repro if available). `refactor`/`chore`/`other` (PASTE only — Notion's `Issue Type` offers just Bug/Feature) → Required tier only.
- **Optional** — fill when known, else leave the `—` placeholder. Never interrogate the user about these.

**Notion conventions** (the DB is the authority for NOTION mode):

- **Review every field on the row — not just the mapped ones.** Read all intake columns before assembling, and flag for the clarify loop (step 5) anything that is blank-but-needed, marked `TBC`, internally contradictory, or that you do not fully understand.
- A property value of `"n/a"` (case-insensitive) or blank means **deliberately not provided** — treat it as empty (carried as `—`), never as literal content. This is the ONLY acceptable "empty" state, and only for Optional fields.
- A value of `"TBC"` / `"TBD"` / `"to be confirmed"` (case-insensitive) is a **placeholder that MUST be resolved before the prompt is built** — never carried through and never silently treated as empty. Resolve it from your own research and/or targeted user questions (step 5), then **write the resolved value back into that Notion property** (the pre-assembly write-back, see binding block) so the row itself is complete and matches the prompt.
- `Device Type` / `View` are carried into the Surfaces lines **verbatim** (lossless); `Priority` is vocab-mapped to the canonical scale (binding block) so `beanies-plan` labeling is direct.
- Several Notion fields concatenate into one canonical field (e.g. References = `References / Supporting Materials` + `Dependencies / Related Issues`). Drop any sub-part that is empty/`n/a`.

Notion-only properties (workflow/meta state — NOT intake intent, NOT in the template) live in the binding block below: **Status**, **beanies-plan prompt** (immediate write-back target), **plan file url** (deferred write-back target), **generate mockup?** (control — triggers the step-6 mockup loop), **mockup file url** (step-6 write-back target), **github issue** (passthrough), **Feature gated?** (passthrough — the build-behind-a-feature-gate preference). The `ID`, `Assignee`, `Raised By`, and `Date` properties are read-only metadata the skill ignores (except `ID`, usable to reference the issue back to the user).

---

## The copy/paste template

This block is the Canonical Field Table rendered as fillable lines (Field column, in table order; conditional rows grouped; Optional rows pre-filled with `—`). The sentinels make the hand-off unambiguous even when pasted into a noisy message.

```
=== BEANIES PRE-PLAN ===

Title:        <short imperative title>
Type:         feature | bug | refactor | chore | other
Priority:     critical | high | medium | low
Surfaces:     platforms: [web / PWA / iOS / Android / tooling]  •  area: <page / feature / component>
Objective:    <1–2 sentences: the problem and the win — the "why">

# Feature only
User story:   As a <role>, I want <goal> so that <benefit>.
UX / mockup:  <mockup expected? yes/no>  •  <any UX expectations>
Mockup:       <repo path + htmlpreview url — filled by step 6 once a mockup is approved; else "—">

# Bug only
Current:      <what happens today>
Expected:     <what should happen>
Repro:        <exact steps + error text / screenshot / #beanies-errors link>

# Always
Scope (do):
  - <concrete, testable item>
  - <…>
Out of scope (don't):
  - <… or "—">
Acceptance criteria:           <how you'll know it's right — seeds acceptance criteria, or "—">
Edge cases / constraints:      <… or "—">
Reuse hints / affected files:  <pointers for the DRY pass — NOT the approach — or "—">
References:                    <ADRs, docs/plans/*, issues, error reports — or "—">
Open Qs:                       <decisions to surface / things you're unsure about — or "—">
Notes:                         <non-default constraints, gotchas — or "—">

=== END PRE-PLAN ===
```

To emit a blank template for the user, output exactly this block.

---

## Workflow

A flat, linear sequence of guarded steps. Each step has one job and one explicit failure outcome — nothing fails silently.

1. **Determine mode.**
   - Message contains a filled `=== BEANIES PRE-PLAN ===` block → **PASTE mode** (step 3).
   - Message references a tracker issue — **any issue-number form (`#29`, `issue #29`, `id 29`, "the 29 issue")**, a title, or an `ID` → **NOTION mode** (step 2 then 4). The number is the Notion **`ID` (unique_id)**, never a GitHub issue — do not `gh issue view` it (see "When to Invoke"). Resolve it against the Beanies Main Issue Tracker only.
   - "pre-plan the next issue" / no specific reference but NOTION is wanted → **NOTION mode** with the default filter (step 4).
   - Neither, and no content to work with → emit the blank template (above) and stop. Let the user fill it.

2. **NOTION pre-check (fail loud, then fall back).** Confirm the `mcp__notion__*` tools are available (same availability pattern as `.claude/skills/start-session/SKILL.md` step 5 — if the tool isn't present, the MCP isn't connected). If not: tell the user _"Notion issue tracker not connected — run `/mcp` to authenticate, or paste a filled template instead,"_ then emit the blank template. Never run a query that would silently no-op.

3. **PASTE — parse.** Read the canonical fields out of the block. If the sentinels are present but the body is unparseable (no `Field:` lines), say so explicitly — _"couldn't parse a pre-plan block between the sentinels — here's a clean blank template"_ — and emit a fresh blank template. Never guess at field contents. Then go to step 5.

4. **NOTION — resolve, query, capture.** Resolution is single and canonical: use the recorded **`data_source_id`** (binding block) with `API-query-data-source`. Only if that id is absent/rejected, fall back to `API-retrieve-a-database` on the recorded `database_id` to re-resolve — and report that the recorded id is stale so the binding block can be fixed.
   - **Selecting the row:** if the user named a title/`ID`, filter to it. Otherwise apply the default filter `Status = "Not started"` (the _query-for_ value) and, if more than one matches, present the candidates and ask which.
   - Handle explicitly:
     - **DB / data-source not found** → _"Beanies Main Issue Tracker DB not found — has it moved or been deleted? See the binding block ids."_
     - **No row matches** → list the closest titles / current `Not started` rows and ask which.
     - **Ambiguous (multiple matches)** → present candidates and ask which.
   - On success: map row properties onto the canonical fields via the _Notion property_ column (apply the `n/a`→empty, verbatim-Surfaces, Priority-vocab, and concatenation conventions above), and **capture the matched row id** for the write-backs (steps 6–8). If a needed value is truncated in the query result, re-read it with `API-retrieve-a-page`.
   - **Then review EVERY intake column on the row** (not only the required/conditional ones). Capture, for step 5, any field that is `TBC`/`TBD`, blank-but-needed, internally contradictory, or otherwise unclear — these must be resolved (and `TBC`/incomplete ones written back) before anything is assembled.

5. **Validate & clarify — ALWAYS resolve before building (shared — both modes).** Review **all** fields. Block and ask the user targeted questions for EVERY one of: a missing Required field; a missing type-driven Conditional field; any field marked `TBC`/`TBD`; any value that is ambiguous, contradictory, or that you do not fully understand. Ask as many questions as it takes (batch them with `AskUserQuestion` where possible). **Do not assemble or write anything back until every requirement is clear and every question has been completely and fully answered.** Where you can resolve a gap yourself from the codebase/docs, do the research and confirm the resolution with the user rather than guessing silently. The ONLY fields you may leave unresolved are Optional fields the user has deliberately left blank/`n/a` (a clear, intentional omission) — but if even an Optional reads as unclear or is marked `TBC`, ask. State which fields were provided, which you resolved (and how — research vs. user answer), and which were intentionally left `—`, so nothing is silently dropped or invented. (NOTION mode: a bug with no Repro is acceptable if the rest is clear — note it and continue; Repro has no dedicated property.)

6. **Mockup — generate, approve, store (conditional; runs only when a mockup is wanted).** Reachable once step 5 is fully resolved. This step owns the WHOLE mockup lifecycle so `beanies-plan` receives a finished, approved design and stays Notion-agnostic.
   - **Decide whether to run.** Run when the design needs a visual: NOTION mode → the `generate mockup?` select is `Yes`; PASTE mode → the `UX / mockup` line says a mockup is expected. Skip entirely (straight to step 7) when it is `No` / empty / `—`. If `generate mockup?` is blank on what is clearly a new UI surface (a `feature` touching a visual `View`), don't silently skip — raise it in the step-5 clarify loop (_"this looks like a new UI surface — generate a mockup?"_) and set the field per the user's answer before deciding here. Bugs, refactors, and non-visual work never generate a mockup.
   - **Generate via `/frontend-design:frontend-design` — always, and always CIG-clamped.** Never hand-roll a mockup. Invoke the `frontend-design` skill with a prompt built from the captured requirements (Objective, Scope, User story, UX expectations, Surfaces). Because `frontend-design` is built to chase a bold, generator-chosen aesthetic, the invocation MUST clamp it to the beanies brand: instruct it to produce a single self-contained **`docs/mockups/<concept>-YYYY-MM-DD.html`** (the repo's one-file-per-concept convention) that strictly follows `.claude/skills/beanies-theme/SKILL.md` + the CIG (Heritage Orange for alerts — never Alert Red; Outfit/Inter; the six-level type scale; squircle radii; the three-tier modal patterns; rem-based text). **The CIG always wins over the generator's defaults.** Ask for **one or more distinct approaches** when the design space is open (e.g. 2–3 layout directions), or a single proposal when the surface is constrained.
   - **Review + iterate with the user.** Open the generated HTML locally so the user can actually see it (e.g. `open docs/mockups/<file>.html`), present the approaches, and iterate on the `frontend-design` output until the user **explicitly approves ONE**. Never assume approval.
   - **Commit only the approved mockup.** Keep the single approved `docs/mockups/<concept>-YYYY-MM-DD.html`; discard the rejected explorations (do not commit them).
   - **Store the url (NOTION write-back).** `API-patch-page` the captured row to set **`mockup file url`** = the rendered-preview link `https://htmlpreview.github.io/?https://raw.githubusercontent.com/gparker97/beanies-family/main/docs/mockups/<file>.html` (this renders the committed file rather than its source; it resolves once the file is committed + pushed). Handle a failed patch by surfacing the field + exact url so the user can set it manually — never silently skip.
   - **Carry the mockup into the prompt.** Retain the approved mockup's repo path + url so step 7 adds the `Mockup:` line to the assembled block. **This is the ONLY channel by which `beanies-plan` learns about the mockup** — `beanies-plan` never reads Notion for it.

7. **Assemble, write back (NOTION), and request approval.** Only reachable once step 5 (and step 6, if it ran) is fully resolved. Fill the template with resolved values to produce the **assembled block**.
   - **NOTION — backfill resolved intake columns FIRST.** For every field that was `TBC`/`TBD`/incomplete on the row and that you resolved in step 5, `API-patch-page` the resolved value into its Notion property (per the _Notion property_ column of the Canonical Field Table) **before** assembling the block — so the tracker row itself is complete and matches the prompt. Handle a failed patch by surfacing the field + value so the user can set it manually; never silently skip a backfill.
   - **Add the `Mockup:` line (only if step 6 approved a mockup).** In the `# Feature` section of the assembled block, set `Mockup:` = `<repo path>  •  <htmlpreview url>` so `beanies-plan` can read the design from the prompt (Notion-agnostic hand-off). Omit the line entirely when no mockup was generated.
   - Append one directive line derived from the Notion `github issue` select (PASTE mode: omit unless the user stated a preference):
     - `create github issue` → `GitHub issue: CREATE — beanies-plan should open a GitHub issue per CLAUDE.md labeling.`
     - `do not create github issue` → `GitHub issue: SKIP — do not create a GitHub issue.`
   - Append one directive line derived from the Notion `Feature gated?` select (gating is **by request only** — an empty value is the No-gate default; PASTE mode: omit unless the user stated a preference):
     - `Yes - behind feature gate in settings` → `Feature gate: YES — build the feature behind a dev feature flag registered in src/config/flagRegistry.ts (+ committed prod state in src/config/featureFlags.committed.ts) so it appears and is toggleable in Settings → Feature Flags.`
     - `No feature gate` (or empty) → `Feature gate: NO — ship ungated (the default; never add a gate that wasn't requested).`
   - **NOTION write-back (at handoff — the immediate writes, per the binding block):** on the captured row, `API-patch-page` to set **`beanies-plan prompt`** = the assembled block (rich_text) and **`Status`** = the _advance-to_ value (`In Progress`). Handle: **patch failed** → surface the error plus the exact text + target Status so the user can set them manually; **row id lost** → tell the user the prompt wasn't written back and give them the assembled block to paste. Never block the hand-off on the write-back. (The `plan file url` is NOT written here — it doesn't exist yet; see step 8.)
   - **Retain the captured row id** for the deferred step 8 write-back.
   - **STOP and request explicit approval — never auto-launch `beanies-plan`.** After the write-back, show the user the assembled block and confirm (NOTION mode) that the row was advanced to `In Progress` with the prompt + any backfilled columns written back. Then ask plainly, e.g.: _"Requirements are captured and written back to Notion #<ID>. Do you want to proceed to create the plan via `/beanies-plan`?"_ **Wait for the user's explicit go-ahead.** Only on an explicit yes do you invoke `/beanies-plan` in-thread with the assembled block as its Phase 1 prompt (`beanies-plan` captures it verbatim). If the user says no, defers, or wants changes, iterate on the intake (re-running step 5 as needed) — never proceed to planning without approval. When you do hand off, mention that the `plan file url` will be written back once `beanies-plan` saves the plan (step 8).

8. **Deferred `plan file url` write-back (NOTION mode only — the one non-immediate write).** The hand-off created a standing obligation keyed to the captured row id. `beanies-plan` exits to plan mode, iterates with the user, and saves the file **only on approval** — so the plan path does not exist at hand-off, and the plan may be abandoned entirely. When — and only when — `beanies-plan` reports a saved `docs/plans/…` path **in the same thread**, `API-patch-page` the captured row to set **`plan file url`** = the file's GitHub blob URL on the default branch (`https://github.com/gparker97/beanies-family/blob/main/<saved path>` — it resolves once the plan is committed + pushed). Handle:
   - **Patch failed** → surface the error plus the exact url + row id so the user can set it manually.
   - **Row id lost** → tell the user the url can't be written back; ask for the issue reference to re-resolve.
   - **No save ever reported** (plan abandoned / thread ended) → do nothing. `plan file url` correctly stays empty; never guess or construct a path for an unsaved plan.

   _This step lives in `beanies-pre-plan`, never in `beanies-plan`: the row id is pre-plan's state, and `beanies-plan` must stay Notion-agnostic so it behaves identically when invoked standalone._

---

## Notion binding + DB schema ("Beanies Main Issue Tracker")

The single place holding (a) the runtime ids, (b) the Status vocabulary + transitions, (c) the vocab maps, and (d) the write-back contract. Nothing elsewhere in this skill re-states these — they refer back here.

> **Status: LIVE.** The "Beanies Main Issue Tracker" Notion DB exists and is wired up. NOTION mode is available whenever the `mcp__notion__*` tools are connected.

**Binding:**

```
Beanies Main Issue Tracker
  database_id:    373247d9-a99f-8162-afe9-d322209eb688
  data_source_id: 373247d9-a99f-8151-9776-000b913cb06f   ← what API-query-data-source / API-patch-page use
Status vocabulary: Not started · In Progress · Done
  query-for value (NOTION mode default read filter): "Not started"
  advance-to value (write at handoff):               "In Progress"
Write-back — four phases:
  Pre-assembly (NOTION, only when step 5 resolved a TBC/incomplete intake column):
    • <each resolved intake property> (matching type) ← value resolved via research / user answers
         (write each backfilled column BEFORE assembling, so the row is complete + matches the prompt)
  Mockup (NOTION, workflow step 6 — only when generate mockup? = Yes and the user approved one):
    • mockup file url (url)         ← htmlpreview render link of the approved docs/mockups/… file
                                       (https://htmlpreview.github.io/?https://raw.githubusercontent.com/
                                        gparker97/beanies-family/main/docs/mockups/<file>.html;
                                        resolves once the mockup is committed + pushed)
  At handoff (immediate — write these back, THEN ask the user for approval to proceed to planning):
    • beanies-plan prompt (rich_text) ← the assembled === BEANIES PRE-PLAN === block
                                       (includes the Mockup: line when step 6 produced one)
         (Notion caps a rich_text segment at 2000 chars — split a longer block across
          multiple text objects in the same property so the patch doesn't 400.)
    • Status (select)               ← advance-to value
  Deferred (only after beanies-plan saves the plan file — workflow step 8):
    • plan file url (url)           ← GitHub blob URL of the saved docs/plans/… file
                                       (https://github.com/gparker97/beanies-family/blob/main/<path>;
                                        resolves once the plan is committed + pushed)
generate mockup? (select Yes / No) → control that triggers the step-6 mockup loop:
  "Yes"          → generate via /frontend-design:frontend-design (CIG-clamped), approve, commit the
                   approved docs/mockups/… file, write mockup file url, add the Mockup: line to the prompt
  "No" / empty   → skip the mockup loop (but if blank on a clearly-new UI surface, raise it in step 5)
github issue (select) → passthrough directive to beanies-plan:
  "create github issue"        → CREATE (beanies-plan opens the issue, CLAUDE.md labeling)
  "do not create github issue" → SKIP
Feature gated? (select) → passthrough directive to beanies-plan (gating is BY REQUEST ONLY):
  "Yes - behind feature gate in settings" → GATE (build behind a DevFlag registered in
                                            src/config/flagRegistry.ts + featureFlags.committed.ts;
                                            it then appears + is toggleable in Settings → Feature Flags)
  "No feature gate" / empty               → NO GATE (ship ungated — the default)
```

**Vocab maps** (Notion value → canonical, one-way — the skill never writes these back):

```
Priority:  Critical → critical · High Priority → high · Normal → medium · Low / Future → low
Issue Type: Bug → bug · Feature → feature
Device Type / View: carried verbatim into the Surfaces line (no remap)
```

**Schema.** Intake properties = the _Notion property_ column of the Canonical Field Table (one property per row — not re-listed here, to avoid a second copy that can drift). Plus the workflow/meta properties:

| Property            | Notion type                               | Role in this skill                                   |
| ------------------- | ----------------------------------------- | ---------------------------------------------------- |
| Status              | select (Not started / In Progress / Done) | read filter (`Not started`) + write-back (`In Progress`) |
| beanies-plan prompt | rich_text                                 | immediate write-back target — the assembled block    |
| plan file url       | url                                       | deferred write-back target — GitHub URL of the saved plan (step 8) |
| generate mockup?    | select (Yes / No)                         | control — `Yes` triggers the step-6 mockup loop      |
| mockup file url     | url                                       | step-6 write-back target — htmlpreview render link of the approved mockup |
| github issue        | select (create / do not create)           | read → passthrough directive to beanies-plan         |
| Feature gated?      | select (Yes - behind feature gate in settings / No feature gate) | read → passthrough directive to beanies-plan (empty = no gate, the default) |
| ID                  | unique_id                                 | read-only — use to reference the issue to the user   |
| Assignee / Raised By / Date | select / multi-select / date      | read-only metadata — ignored                         |

**Access:** read via `API-query-data-source` on the recorded `data_source_id` (default filter Status = _query-for_); write-back via `API-patch-page` (pre-assembly: any resolved `TBC`/incomplete intake column; mockup (step 6): mockup file url, after the user approves a generated mockup; at handoff: beanies-plan prompt + Status = _advance-to_, then ask the user for approval to proceed; deferred: plan file url, after the plan saves). Use `API-retrieve-a-page` only if a property value is truncated in a query result.

---

## Rules

- **Issue numbers are Notion tracker IDs, never GitHub.** A bare `#N` / `issue #N` / `id N` always resolves to the Beanies Main Issue Tracker `ID` (unique_id) → NOTION mode. Never `gh issue view` an issue number here; GitHub issues are a `beanies-plan` _output_, not a pre-plan _input_. (See "When to Invoke".)
- **Problem-side only.** Capture what/why; never the how. The one exception — _Reuse hints / affected files_ — is an optional DRY-pass pointer, not an approach; it never constrains the design.
- **Never modify `beanies-plan`.** The only coupling is the assembled prompt crossing the boundary in-thread (+ the captured row id, used for the at-handoff and the deferred write-backs). The `plan file url` write-back lives here, not in `beanies-plan`, so `beanies-plan` stays Notion-agnostic when invoked standalone.
- **Single source of truth.** The Canonical Field Table is authoritative; template + Notion mapping + section mapping are projections. Changing a field is a one-row edit. The Status vocabulary, its transition, both Notion ids, the vocab maps, and the write-back contract live only in the binding block.
- **Never fail silently.** Every Notion call, the paste parse, and the write-back have an explicit user-facing outcome.
- **Review every field; clarify before building.** Read ALL intake columns, not just the required ones. Ask the user about every missing Required/Conditional field, every `TBC`/incomplete column, and anything ambiguous, contradictory, or unclear — as many questions as needed — and **do not assemble or write back the prompt until all are completely and fully answered.** Keep the template itself small, but never skip a needed clarification for the sake of speed.
- **Respect the `n/a` vs `TBC` distinction.** `n/a`/blank = deliberately not provided → leave as `—` (Optionals only). `TBC`/`TBD`/"to be confirmed" = MUST be resolved (research and/or ask), written back into the Notion column (pre-assembly write-back), and reflected in the prompt — never carried through as a placeholder and never treated as empty.
- **Never auto-chain into `beanies-plan`.** After the prompt is written back to Notion, STOP and get the user's explicit approval before invoking `/beanies-plan`. No silent or automatic hand-off; if the user hasn't said yes, the skill ends after the write-back.
- **Don't restate baked-in constraints.** DRY, no-silent-failures, MVO, rem-based text, i18n are already enforced by `beanies-plan` Pass 2/3 and `CLAUDE.md`. Only NON-default constraints belong in the Notes / Edge-cases fields.
- **Feature gating is by request only — the `Feature gated?` select IS the request.** `Yes - behind feature gate in settings` → the assembled prompt directs `beanies-plan` to build the feature behind a DevFlag registered in `src/config/flagRegistry.ts` (+ committed state in `featureFlags.committed.ts`), so it surfaces and is toggleable in Settings → Feature Flags. `No feature gate` or empty → ship ungated (the default). Never infer or add a gate that wasn't selected, and never gate via the env-capability `features.ts` checks (that is not the Settings feature-flags system). This passthrough is a delivery preference, not problem-side intent, so it lives in the binding block — not the Canonical Field Table.
- **Mockups: generate only when requested, always via `frontend-design`, always CIG-clamped, never auto-approved.** When `generate mockup?` = `Yes` (or PASTE's `UX / mockup` says a mockup is expected), step 6 runs the loop: invoke `/frontend-design:frontend-design` (never hand-roll the mockup) with a prompt that clamps it to `.claude/skills/beanies-theme/SKILL.md` + the CIG — the CIG always wins over the generator's bold defaults — producing a self-contained `docs/mockups/<concept>-YYYY-MM-DD.html`; iterate with the user; commit ONLY the approved file (discard rejected explorations); write `mockup file url` (htmlpreview render link) back to Notion; and add the `Mockup:` line to the assembled prompt. `No`/empty → skip (but a blank on a clearly-new UI surface is raised in the step-5 clarify loop). `beanies-plan` learns about the mockup ONLY via that `Mockup:` line — pre-plan never expects `beanies-plan` to read Notion.
- **Write-back has four phases.** (1) Pre-assembly: any `TBC`/incomplete intake column resolved in step 5 is written back into its own Notion property before the prompt is assembled. (2) Mockup (step 6): `mockup file url`, only after the user approves a generated mockup. (3) At hand-off: the assembled prompt + `Status = In Progress` are written back, THEN the user is asked for approval to proceed to planning. (4) Deferred to step 8: `plan file url`, only after `beanies-plan` actually saves a plan file, never for an abandoned plan. Surface any patch failure with the exact values so the user can apply them manually.
- **Keep the issue DB separate from launch content.** This is product/issue tracking — distinct from "Post Tracker" and all launch/marketing material (Notion only, per `CLAUDE.md`).
- **Cite real files, not symlinks.** Reference `start-session` (not the `good-morning` symlink) for the MCP-availability pattern.
