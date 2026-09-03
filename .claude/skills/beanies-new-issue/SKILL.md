---
name: beanies-new-issue
description: Turn a scattered, half-formed idea, bug report, or feature request into a complete, well-researched row in the "Beanies Main Issue Tracker" Notion DB — researching the codebase, recent commits, docs, and the web to fill every field, asking only about genuine gaps, checking for duplicates, showing the full proposed issue for approval, and then creating it as a "Not started" row that /beanies-pre-plan can pick up. Use this WHENEVER the user wants to capture, log, file, raise, open, add, or jot down an issue / bug / feature / idea / ticket / tracker item / TODO for beanies — even when they just describe a problem or wish ("the calendar feels cramped on mobile", "we should let users export their data", "remember to fix the flaky sync toast") without saying the word "issue". It is the front door to the tracker and the step BEFORE /beanies-pre-plan.
---

# beanies-new-issue — Capture an idea into the Beanies issue tracker

A good plan starts with a good issue, and a good issue starts long before `/beanies-pre-plan` ever reads it. `beanies-pre-plan` _validates and refines_ an existing tracker row; this skill _creates_ that row in the first place — turning whatever the user hands over (a one-line wish, a frustrated bug description, a pasted Slack error, a rambling voice-note transcript) into a structured, researched, complete issue.

The goal is a row so well-formed that running `/beanies-pre-plan #<ID>` on it later finds almost nothing left to clarify. This skill does the legwork up front: it reads the codebase, recent commits, and docs (and searches the web where that helps), fills every field it confidently can, asks the user only about the genuine gaps and the decisions that are truly theirs to make, shows the whole thing for approval, and only then writes it to Notion.

**This skill is problem-side only.** Like `beanies-pre-plan`, it captures _what_ and _why_, never _how_. The technical approach is `beanies-plan`'s job — pre-specifying it here would short-circuit the 4-pass design reasoning downstream. The one near-the-line field, _Reuse Hints / Affected Files_, is an optional pointer for the later DRY pass — a place to look, never a solution to adopt.

---

## The pipeline this skill begins

```
  raw idea / bug / wish
        │
        ▼
  /beanies-new-issue   ← THIS SKILL: research → fill → dedupe → approve → create "Not started" row
        │
        ▼
  /beanies-pre-plan #<ID>   ← validates every field, resolves TBCs, optional mockup, → In Progress
        │
        ▼
  /beanies-plan   ← 4-pass design → saved docs/plans/… → optional GitHub issue → implementation
```

This skill only owns the first hop. It **never** auto-runs `beanies-pre-plan`; it offers it once the row exists (see step 9).

---

## DRY: the schema lives in beanies-pre-plan, not here

`beanies-pre-plan` already holds the **single source of truth** for the tracker: its **Canonical Field Table** (every intake field → Notion property + tier + which `beanies-plan` section it feeds) and its **Notion binding block** (the DB ids, the Status vocabulary, the vocab maps, the `n/a` vs `TBC` conventions). This skill is the _write_ counterpart of pre-plan's _read_, so it deliberately does **not** restate that schema — it reads it.

**Before doing anything, read `.claude/skills/beanies-pre-plan/SKILL.md`** — specifically its "Canonical Field Table" and "Notion binding + DB schema" sections. Use them as the authoritative list of fields, the field→property mapping, the tiers (Required / Conditional / Optional), and the conventions. If that table and this skill ever disagree, **the table wins** — and fix the drift rather than working around it.

The two ids you need (from pre-plan's binding block):

```
Beanies Main Issue Tracker
  database_id:    373247d9-a99f-8162-afe9-d322209eb688   ← parent when CREATING a page (API-post-page)
  data_source_id: 373247d9-a99f-8151-9776-000b913cb06f   ← retrieve schema + query for duplicates
```

**Connected MCP namespace.** The tracker is shared with the **`mcp__notion-beanies__*`** integration (the plain `mcp__notion__*` integration returns `object_not_found` for this DB). Use `notion-beanies`. If only `notion` is connected, try it as a fallback and tell the user which one worked; if neither is present, the MCP isn't connected (see step 1).

**Never hardcode select/multi-select options** (Priority, Issue Type, Device Type, View, Category, the control selects). They drift — `View` alone has ~30 options and grows. Always read the **live** options from `API-retrieve-a-data-source` on the `data_source_id` at runtime (step 2) and map onto those. (For reference only, verified live 2026-09-03: Issue Type = `Bug / Feature / Security`; Priority = `Critical / High / Normal / Low / Future` — note **`Low / Future` is ONE option**, and there is no `High Priority`; Device Type = `Desktop / Mobile (Browser) / Mobile (PWA) / iOS App / Android App / All / Mobile / PWA`; Category = `data / app / UI / auth / security / new feature / feature update / permissions / android / iOS / PWA / AI`. Verify live — do not trust this line.)

---

## Workflow

A linear sequence of guarded steps. Each has one job and one explicit, user-facing failure outcome — **nothing fails silently** (a core project principle).

### 1. Capture the raw input + pre-check Notion

Take whatever the user gave — a sentence, a paragraph, a pasted error, a screenshot description — as the raw seed. Don't judge its completeness yet; that's what the rest of the workflow is for. If they gave nothing concrete ("I want to log an issue"), ask what the issue is, in their own words, before proceeding.

Then confirm the Notion MCP is connected (same availability pattern as `start-session` step 5 — if the `mcp__notion-beanies__*` tools aren't present, the MCP isn't connected). If not: tell the user _"Beanies issue tracker not connected — run `/mcp` to authenticate"_ and stop. Never run a write that would silently no-op.

### 2. Read the live schema

`API-retrieve-a-data-source` on the `data_source_id`. Capture the current property set and — critically — the live option lists for every select/multi-select (`Issue Type`, `Priority`, `Device Type`, `View`, `Category`, `generate mockup?`, `github issue`, `Feature gated?`, `Status`, `Assignee`, `Raised By`). Everything you write in step 8 must use option names that exist in this response. If a property you expect from pre-plan's Canonical Field Table is missing here, the schema changed — stop and tell the user rather than guessing.

### 3. Classify the issue

Decide **Bug vs Feature vs Security** from the raw input. This determines the Conditional tier:

- **Feature** → needs _User Story_ (+ _UI / UX Expectations_).
- **Bug** → needs _Current Behavior_ + _Expected Behavior_ (+ repro detail, folded into _References_ — there is no dedicated Repro property).
- **Security** → bug-shaped, and treated as such: _Current Behavior_ is the exploit path, _Expected Behavior_ is the invariant that should hold. Prefer it over `Bug` whenever the work is closing an exposure rather than fixing something a user experiences as broken — and say so in _Notes_ when nothing is visibly broken today, so a later reader does not mistake the row for a live incident.

If it's genuinely a refactor/chore/tech-debt item, file it as the closest of the three (usually Feature for new capability, Bug for "X is broken/wrong") and say so in _Notes_. If the type is ambiguous, ask.

### 4. Research — proportional, subagent-backed

This is what makes the issue _good_. Scale the effort to the issue: a one-line copy tweak needs a quick grep; a new page needs real exploration. **Use subagents liberally** (a core project principle) so the main context stays clean — launch focused, parallel `Explore`/`general-purpose` agents, one concern each, in a single message. Typical concerns:

- **Codebase** — where does this live? Which components/stores/composables/pages are involved? This feeds _Surfaces (View)_, _Reuse Hints / Affected Files_, and grounds _Objective_ and _Scope_ in real structure. (MVO: pages/components = View, stores/composables = Orchestrator.)
- **Recent commits & docs** — `git log` around the area, `docs/STATUS.md`, `docs/plans/`, `docs/adr/`, `CHANGELOG.md`. Has this been touched, planned, or decided already? Surface related work into _References_ and _Dependencies / Related Issues_.
- **Surfaces** — which platforms (`Device Type`) and which app area(s) (`View`) does it affect? Map to the **live** options from step 2.
- **Category** — the issue's nature (`data / app / UI / auth / security / new feature / feature update / permissions / android / iOS / PWA / AI` — read live). A **Required** multi-select (per pre-plan's Canonical Field Table): pick **all** that genuinely apply (e.g. a cross-account save bug is `data` + `auth`; a native chrome bug is `app` + `UI` + `android`). Derive it from the issue's own nature — don't interrogate the user unless it's genuinely ambiguous.
- **Web search** — only when external facts genuinely help (a library's capability, a platform constraint, an accessibility/standard norm). Don't pad with web results that don't change the issue.

Fill every field you can **confidently** justify from this research. Leave a field unfilled only when research genuinely can't determine it and it's a real gap for step 7. Track, for the step-9 summary, what you filled from research vs. what the user told you vs. what was intentionally left blank — so nothing is silently invented or dropped.

### 5. Duplicate check — always

Before proposing a new row, query the tracker for anything similar: `API-query-data-source` on the `data_source_id`, scanning recent/`Not started`/`In Progress` rows by title and objective for overlap with the new issue. If you find plausible matches, **show them** (ID, title, status, one-line objective) and ask the user how to proceed:

- **Proceed** — it's genuinely distinct → continue to a new row.
- **Merge** — it's the same work → don't create a duplicate; offer to enrich the existing row instead (and hand them `/beanies-pre-plan #<that ID>` if they want to take it forward).
- **Cancel** — they'll handle it manually.

Never silently create a near-duplicate. If nothing matches, say so briefly and continue.

### 6. Decide the control fields (the user's calls)

Four fields are **decisions, not research** — they encode how the work should be delivered, and they're the user's to make. Propose a sensible default with your reasoning, then confirm (batch with `AskUserQuestion`):

- **Priority** (`Critical / High / Normal / Low / Future`, live — `Low / Future` is a single option) — propose from impact + urgency; default `Normal` unless the input signals otherwise. For a security row, weigh the MITIGATIONS as well as the severity: an escalation that needs several preconditions and is backstopped elsewhere is not automatically Critical, and saying why in _Notes_ is what stops the priority reading as an under-call later.
- **generate mockup?** (`Yes / No`) — propose `Yes` for any new/changed **visual** surface (a feature touching a visual `View`), `No` for bugs, logic, tooling, and copy-only changes. This is the flag pre-plan's step-6 mockup loop reads.
- **github issue** (`create github issue` / `do not create github issue`) — propose per how the user usually works; this is a passthrough pre-plan hands to `beanies-plan`.
- **Feature gated?** (`Yes - behind feature gate in settings` / `No feature gate`) — **gating is by request only**; default `No feature gate` unless the user wants it behind a Settings feature flag.

### 7. Clarify the gaps — ask before creating

Now resolve everything still open. Block and ask the user targeted questions (batch via `AskUserQuestion` where possible) for: any missing **Required** field; any missing type-driven **Conditional** field; and anything ambiguous or contradictory you couldn't settle from research. Where your research _proposes_ an answer, present it for confirmation rather than asking cold ("I think this affects the `nook` and `activities` views and the PWA — right?") — it's faster for the user and shows your work.

**Do not interrogate the user about Optional fields.** Fill them from research when you can; otherwise leave them empty (they'll carry as `—`). Keep this lightweight — the whole point is that the user answers a few sharp questions, not a 20-field form. Don't restate baked-in constraints (DRY, no-silent-failures, MVO, rem-based text, i18n) — those are enforced downstream; only **non-default** constraints belong in _Notes_ / _Edge Cases_.

### 8. Show the full proposed issue and get explicit approval

Render the complete issue in an easy-to-read format (template below) — every field, in tracker order, with provenance markers so the user can see at a glance what came from where. **Stop and wait for explicit approval.** Never create the row before the user signs off; let them correct any field first (loop back to 6/7 as needed).

```
📋  NEW ISSUE — preview (nothing written yet)

  Title:        <Name>
  Type:         <Bug | Feature>
  Priority:     <…>
  Surfaces:     platforms: <Device Type, …>  •  area: <View, …>
  Category:     <data / auth / UI / … — all that apply>

  Objective:    <Objective / Goal>
  Scope (do):
    - <Main Requirements / Scope item>
    - <…>

  # Feature
  User story:   As a <role>, I want <goal> so that <benefit>.
  UX:           <UI / UX Expectations>

  # Bug
  Current:      <Current Behavior>
  Expected:     <Expected Behavior>

  Out of scope:        <… or —>
  Acceptance criteria: <… or —>
  Edge cases:          <… or —>
  Reuse hints:         <Reuse Hints / Affected Files, or —>
  References:          <References / Supporting Materials + repro detail, or —>
  Related issues:      <Dependencies / Related Issues, or —>
  Open questions:      <… or —>
  Notes:               <… or —>

  Controls:     Priority <…> · mockup <Yes/No> · github <create/skip> · gate <yes/no>
  Will create as:  Status "Not started" · Raised By greg

  Provenance:   researched ⟨fields⟩ · you told me ⟨fields⟩ · left blank ⟨fields⟩

Create this issue in the Beanies Main Issue Tracker? (yes / edit a field / cancel)
```

### 9. Create the row, then offer pre-plan

On approval, `API-post-page` with `parent: { "database_id": "373247d9-a99f-8162-afe9-d322209eb688" }` and a `properties` object mapping each filled field to its Notion property (names + types from pre-plan's Canonical Field Table, confirmed live in step 2). Set:

- **Status** → `Not started` (so `/beanies-pre-plan`'s default filter picks it up).
- **Raised By** → `greg` (multi-select); **Assignee** → `greg` if that's the convention.
- Title → `Name`; selects/multi-selects → live option names; everything else → `rich_text`.
- **Watch the 2000-char rich_text cap** — if any field's text exceeds it, split that property's value across multiple text objects in the same `rich_text` array so the call doesn't 400. (`ID`, the `unique_id`, is assigned by Notion — don't set it.)

Handle failures loudly: on a `400`/validation error, show the offending property + value and what you'll adjust (most often an option name that doesn't match the live schema, or an over-length field); retry once corrected. On success, read back the new **`ID`** and page URL.

Then **stop and offer the handoff** — never auto-chain. For example:

> Created **#<ID> — <Title>** as `Not started` in the tracker. <url>
> Want me to run `/beanies-pre-plan #<ID>` on it now, or leave it for later?

Only run `/beanies-pre-plan` if the user says yes.

---

## Rules

- **Read pre-plan's schema first; never duplicate it.** The Canonical Field Table + binding block in `.claude/skills/beanies-pre-plan/SKILL.md` are authoritative for fields, mappings, ids, and conventions. This skill is the write counterpart of pre-plan's read. If they disagree, the table wins — fix the drift.
- **Problem-side only.** Capture _what_ and _why_, never _how_. The lone exception — _Reuse Hints / Affected Files_ — is an optional DRY-pass pointer, not an approach.
- **Research before asking.** Use subagents liberally, proportional to the issue, to fill fields from the codebase/commits/docs (+ web when it genuinely helps). Ask the user only about real gaps and the control-field decisions — present researched answers for confirmation rather than asking cold.
- **Never interrogate Optional fields.** Fill from research or leave blank (`—`). Keep intake light; a form people abandon captures nothing.
- **Always dedupe.** Check the tracker for similar rows before creating, and offer merge/proceed/cancel. Never silently create a near-duplicate.
- **Live options only.** Read select/multi-select options from the data source at runtime; never hardcode `Priority`/`View`/`Device Type`/`Category`/etc. — they drift.
- **Always set Category.** `Category` (multi-select — the issue's nature: `data / app / UI / auth / security / new feature / feature update / permissions / android / iOS / PWA / AI`) is a Required field; derive it from the issue and select all that apply. It maps to the `Category` Notion property (write it in step 9 like any other multi-select).
- **Show, then write.** Render the full proposed issue with provenance and get explicit approval before any write. Let the user edit any field first.
- **Create as `Not started`, Raised By greg.** This is exactly what makes the row consumable by `/beanies-pre-plan`'s default filter. Don't advance Status here — that's pre-plan's job at handoff.
- **Never fail silently.** Every Notion call (schema read, dedupe query, page create) has an explicit user-facing outcome. Surface the exact property + value on a write failure so it can be fixed.
- **Never auto-chain into pre-plan.** Create the row, report the new `#ID` + url, then _offer_ `/beanies-pre-plan #<ID>`. Wait for the user's go-ahead.
- **Don't restate baked-in constraints.** DRY, no-silent-failures, MVO, rem-based text, i18n are enforced downstream and in `CLAUDE.md`. Only non-default constraints belong in _Notes_ / _Edge Cases_.
- **Issue numbers are Notion tracker IDs, never GitHub.** GitHub issues are a downstream _output_ of `beanies-plan` (gated by the `github issue` passthrough this skill sets), never an input here.
- **Keep the issue DB separate from launch content.** This is product/issue tracking — distinct from the Post Tracker and all launch/marketing material (Notion only, per `CLAUDE.md`).
