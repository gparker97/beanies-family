---
name: beanies-pre-plan
description: Standardized requirements-intake step that runs BEFORE beanies-plan. Collects complete, well-structured intent (via a copy/paste template or a Notion issue row), validates it, and hands a fully-populated initial prompt to beanies-plan so its 4-pass discipline starts from complete requirements. Use when the user says "pre-plan this", "intake this issue", "prep a plan for X", or invokes /beanies-pre-plan.
---

# beanies-pre-plan — Requirements Intake for beanies-plan

`beanies-plan` refines _how_ work gets built through four review passes, but none of those passes can invent a missing requirement, an overlooked platform, or an unstated constraint. The quality ceiling of a plan is set _before_ Pass 1 runs — by the completeness of its initial prompt.

This skill front-loads that completeness. It gathers intent into a standard structure, validates it, and hands a fully-populated prompt to `beanies-plan`. The result: `beanies-plan`'s clarifying-question round shrinks to genuine gaps only.

**This skill is problem-side only.** It captures _what_ and _why_ — never _how_. The technical approach is `beanies-plan`'s job; pre-specifying it would short-circuit the 4-pass design reasoning.

---

## When to Invoke

- **Via slash command:** `/beanies-pre-plan`
- **Natural language:** "pre-plan this", "intake this issue", "prep a plan for X", "let's spec this before planning"
- The skill chains INTO `beanies-plan` — it never replaces or modifies it.

---

## The Canonical Field Table — single source of truth

This table is the ONE authoritative definition of the intake fields. The copy/paste template (below), the Notion schema (below), and the field→`beanies-plan` mapping are all **projections of this table** — read off its columns. To add, rename, or remove a field, edit one row here; everything else re-derives. **Never type the field list out a second time.**

| Field                | Tier            | Applies to | Notion property (type)                                | → beanies-plan section                  |
| -------------------- | --------------- | ---------- | ---------------------------------------------------- | --------------------------------------- |
| Title                | Required        | all        | Title (title)                                        | plan Title                              |
| Type                 | Required        | all        | Type (select: feature/bug/refactor/chore/other)      | labeling                                |
| Priority             | Required        | all        | Priority (select: critical/high/medium/low)          | labeling                                |
| Surfaces — platforms | Required        | all        | Platforms (multi-select: web/PWA/iOS/Android/tooling) | Approach + DRY-pass targeting + labeling |
| Surfaces — area      | Required        | all        | Area (rich text)                                     | Approach + labeling                     |
| Objective            | Required        | all        | Objective (rich text)                                | Context                                 |
| Scope-do             | Required        | all        | Scope (rich text)                                    | Requirements                            |
| User story           | Conditional     | feature    | User Story (rich text)                               | User Story                              |
| UX/mockup flag       | Conditional     | feature    | Mockup needed (checkbox)                             | Important Notes                         |
| Current              | Conditional     | bug        | Current (rich text)                                  | Context                                 |
| Expected             | Conditional     | bug        | Expected (rich text)                                 | Requirements                            |
| Repro                | Conditional     | bug        | Repro (rich text)                                    | Context / Testing seed                  |
| Out-of-scope         | Optional (`—`)  | all        | Out of Scope (rich text)                             | Important Notes                         |
| Done-when            | Optional (`—`)  | all        | Done When (rich text)                                | seeds Acceptance Criteria               |
| References           | Optional (`—`)  | all        | References (rich text)                               | Context / Related issues                |
| Open questions       | Optional (`—`)  | all        | Open Questions (rich text)                           | Assumptions + clarify loop              |
| Notes                | Optional (`—`)  | all        | Notes (rich text)                                    | Important Notes                         |

**Tiers** (read off the _Tier_ + _Applies to_ columns):

- **Required** — always present. ~6 fields. Keep it this small; if intake becomes a 20-field form it gets abandoned.
- **Conditional** — required only for their _Type_: `feature` → User story (+ mockup flag); `bug` → Current + Expected + Repro. `refactor`/`chore`/`other` → required tier only.
- **Optional** — fill when known, else leave the `—` placeholder. Never interrogate the user about these.

Two **Notion-only** properties (workflow state, NOT intake intent, NOT in the template) live in the binding block below: **Status** and **Plan File**.

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
Done when:    <how you'll know it's right — seeds acceptance criteria, or "—">
References:   <ADRs, docs/plans/*, issues, error reports — or "—">
Open Qs:      <decisions you want surfaced / things you're unsure about — or "—">
Notes:        <non-default constraints, gotchas — or "—">

=== END PRE-PLAN ===
```

To emit a blank template for the user, output exactly this block.

---

## Workflow

A flat, linear sequence of guarded steps. Each step has one job and one explicit failure outcome — nothing fails silently.

1. **Determine mode.**
   - Message contains a filled `=== BEANIES PRE-PLAN ===` block → **PASTE mode** (step 3).
   - Message references a Notion issue ("pre-plan the X issue", a title or id) → **NOTION mode** (step 2 then 4).
   - Neither, and no content to work with → emit the blank template (above) and stop. Let the user fill it.

2. **NOTION pre-check (fail loud, then fall back).** Confirm the `mcp__notion-beanies__*` tools are available (same availability pattern as `.claude/skills/start-session/SKILL.md` step 5). If not: tell the user _"Notion issue tracker not connected — run `/mcp` to authenticate, or paste a filled template instead,"_ then emit the blank template. Never run a query that would silently no-op.

3. **PASTE — parse.** Read the canonical fields out of the block. If the sentinels are present but the body is unparseable (no `Field:` lines), say so explicitly — _"couldn't parse a pre-plan block between the sentinels — here's a clean blank template"_ — and emit a fresh blank template. Never guess at field contents.

4. **NOTION — resolve, query, capture.** Resolution is single and canonical: use the recorded **`data_source_id`** (binding block below) with `API-query-data-source`. Only if that id is absent/rejected, fall back to `API-retrieve-a-database` on the recorded `database_id` to re-resolve — and report that the recorded id is stale so the binding block can be fixed. Filter by title match or the Status _query-for_ value. Handle explicitly:
   - **DB/data-source not found** → _"beanies Issue Tracker DB not found — has it been created? See schema in this skill."_
   - **No row matches** → list the closest titles / current Backlog and ask which.
   - **Ambiguous (multiple matches)** → present candidates and ask which.
   - On success: map row properties onto the canonical fields via the _Notion property_ column, and **capture the matched row id** for the deferred write-back (step 7).

5. **Validate (shared — both modes).** Enforce the Required tier + the type-driven Conditional rows. For each genuinely blocking gap, ask ONE targeted question naming the missing field. Do not interrogate on Optionals. State which fields were auto-filled vs. left `—`, so nothing is silently dropped.

6. **Assemble + hand off.** Fill the template with resolved values and hand off to `beanies-plan` in-thread (invoke `/beanies-plan` with the assembled block as its initial prompt — `beanies-plan` captures it verbatim as its Phase 1 prompt). Confirm to the user that `beanies-plan` is taking over. In NOTION mode, also state plainly: _"NOTION write-back pending for row `<id>` once the plan is saved."_ The row id is the only state carried across the boundary.

7. **NOTION write-back — deferred post-save action (NOT synchronous).** `beanies-plan` exits to plan mode, iterates with the user, and saves the file only on approval — so the plan path does not exist at handoff, and the plan may be abandoned entirely. When — and only when — `beanies-plan` reports a saved `docs/plans/…` path in the same thread, `API-patch-page` the captured row: set **Plan File** = that url and advance **Status** to the _advance-to_ value. Handle:
   - **Patch failed** → surface the error plus the exact Plan File url + target Status so the user can set them manually.
   - **Row id lost** → tell the user write-back can't proceed; ask for the issue reference to re-resolve.
   - **No save ever reported** (plan abandoned / thread ended) → do nothing. The row correctly keeps its pre-plan Status. Never guess or construct a path; never advance Status for an unsaved plan.

---

## Notion binding + DB schema ("beanies Issue Tracker")

The single place holding (a) the runtime ids and (b) the Status vocabulary. Nothing elsewhere in this skill re-states these — they refer back here.

> **Status: not yet created.** The "beanies Issue Tracker" Notion DB has not been provisioned. Until it is, **NOTION mode is unavailable** — the skill operates in PASTE mode only. To enable NOTION mode, create the DB per the schema below and fill in both ids in the binding block.

**Binding (filled in after the DB is created):**

```
beanies Issue Tracker
  database_id:    <filled in at creation>
  data_source_id: <filled in at creation>   ← what API-query-data-source / API-post-page actually use
Status vocabulary: Backlog · Ready to plan · Planned · In progress · Done
  query-for value (NOTION mode default filter): "Ready to plan"
  advance-to value (write-back after planning):  "Planned"
```

**Schema.** Intake properties = the _Notion property (type)_ column of the Canonical Field Table (one property per row — not re-listed here, to avoid a second copy that can drift). Plus two workflow-only properties:

| Property  | Notion type                              | Purpose                       |
| --------- | ---------------------------------------- | ----------------------------- |
| Status    | select (values = Status vocabulary above) | triage / loop state           |
| Plan File | url                                      | written back after planning   |

**Access:** read via `API-query-data-source` on the recorded `data_source_id` (default filter Status = _query-for_); write-back via `API-patch-page` (Plan File url + Status = _advance-to_). Use `API-retrieve-a-page` only if a property value is truncated in a query result.

---

## Rules

- **Problem-side only.** Capture what/why; never the how. No technical approach in intake.
- **Never modify `beanies-plan`.** The only coupling is the assembled prompt crossing the boundary in-thread (+ the row id carried for write-back, + the saved path read back).
- **Single source of truth.** The Canonical Field Table is authoritative; template + schema + mapping are projections. Changing a field is a one-row edit. The Status vocabulary + its two transitions + both Notion ids live only in the binding block.
- **Never fail silently.** Every Notion call, the paste parse, and the write-back have an explicit user-facing outcome.
- **Keep it low-friction.** Required tier ~6 fields; Optionals are blankable; never interrogate on Optionals.
- **Don't restate baked-in constraints.** DRY, no-silent-failures, MVO, rem-based text, i18n are already enforced by `beanies-plan` Pass 2/3 and `CLAUDE.md`. Only NON-default constraints belong in the Notes field.
- **Write-back is deferred + conditional.** Never block on the plan path, never guess it, never advance Status for an unsaved/abandoned plan.
- **Keep the issue DB separate from launch content.** This is product/issue tracking — distinct from "Post Tracker" and all launch/marketing material (Notion only, per `CLAUDE.md`).
- **Cite real files, not symlinks.** Reference `start-session` (not the `good-morning` symlink) for the MCP-availability pattern.
