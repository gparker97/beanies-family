---
name: beanies-plan
description: Create standardized plans (and optionally GitHub issues) using a mandatory 4-pass review discipline — initial draft, DRY/error-handling, sustainability/maintainability, and fresh-eyes final sweep — with full context preservation.
---

# beanies-plan — Standardized Plan & Issue Creator

This skill creates comprehensive, implementation-ready plans and optionally GitHub issues. It ensures **zero context loss** — every prompt, decision, assumption, and detail is captured so that implementation can happen at any time, by any team member, without losing information.

---

## When to Invoke

- **Automatically**: When the user asks to "create a plan", "create an issue", "plan this feature", "write up a ticket", or similar
- **Via slash command**: `/beanies-plan`
- The skill handles both plan-only and plan+issue workflows

---

## Workflow

### Phase 1: Gather & Clarify

1. **Capture the initial prompt verbatim.** Store the user's exact words — this is the primary source of truth for intent.
2. **Ask clarifying questions** if requirements are ambiguous. Do not assume — ask.
3. **Default to direct implementation — no GitHub issue.** This is a one-dev project; tickets are overhead unless the user explicitly says "create an issue" / "file a ticket" / "open a ticket for this". If the user does ask for an issue, create one per Phase 5; otherwise the plan stands alone in `docs/plans/` with the full prompt history embedded.
4. Record all follow-up prompts, redirections, and refinements. Every user message that shapes the plan is part of the record.
5. **Mockup-aware intake.** If the prompt carries an approved mockup — a `Mockup:` line (the channel `beanies-pre-plan` uses) or a `docs/mockups/…` file the user points at — **read that file in full before drafting**; it is primary design input for Pass 1 (see Phase 2.1 → _Mockup-driven drafting_). If the prompt makes clear a mockup is expected but none is provided (e.g. `beanies-plan` was invoked standalone, bypassing `beanies-pre-plan`), generate one first: invoke `/frontend-design:frontend-design` clamped to `.claude/skills/beanies-theme/SKILL.md` + the CIG (the CIG always wins over the generator's defaults), producing a self-contained `docs/mockups/<concept>-YYYY-MM-DD.html`; iterate to the user's explicit approval; commit only the approved file; then draft from it. Writing `mockup file url` back to the Notion tracker is `beanies-pre-plan`'s responsibility, never this skill's — `beanies-plan` stays Notion-agnostic.

### Phase 2: Build the Plan Through Four Review Passes

Every plan — bug fix, feature, refactor, polish, anything — passes through **all four** of the passes below before it is shown to the user. The discipline is unconditional. Each downstream pass (2-4) runs in a **separate Plan subagent with a fresh context window** so it literally hasn't seen the prior pass's reasoning and reviews the artifact with fresh eyes. The verbatim prompts for each pass are in [Review Pass Prompts](#review-pass-prompts) below — the subagent receives the prompt unchanged.

After Pass 4 the plan is ready for Phase 3 (present to user). When all four passes have completed, the skill ends its turn by calling `ExitPlanMode` so the user reviews the final, four-pass-polished plan in plan mode.

#### Phase 2.1 — Pass 1: Initial Draft

Prepare a comprehensive plan following the structure in [Plan Document Format](#plan-document-format) below. The plan must include **all** context, details, and information required to implement the request in full. Do not summarize, truncate, or omit anything. Runs in the main conversation (no subagent).

Key principles:
- **No context loss**: If the user said it, it's in the plan
- **Self-contained**: A developer reading only this plan should be able to implement the feature without asking any questions
- **Assumptions explicit**: Every assumption is documented so it can be validated before implementation (especially if time has passed)

**Help Center coverage assessment.** While drafting, decide whether this work deserves Help Center documentation:

- **Yes if**: the plan introduces a distinct new user-facing feature, a meaningfully new way to accomplish an existing task, a security/privacy-relevant flow the user should understand, or a behavior change that contradicts what an existing help article currently says.
- **No if**: the work is a bug fix, refactor, internal cleanup, performance pass, dependency bump, brand/typography tweak, or a UI polish that doesn't change *what* the user can do.

If yes, the plan **must** include a `## Help Center Coverage` section (see format below) that specifies which article(s) are affected and follows the `/beanies-help-docs` skill's article-type conventions. The corresponding article work is part of the implementation acceptance criteria — not a follow-up.

**Observability coverage assessment (ALWAYS — every plan).** While drafting, work out the diagnostic logging the change must emit so its failure modes are triageable from CloudWatch without a local repro, and capture it in the mandatory `## Observability Coverage` section (see format below). This is per the "Observability & Diagnostic Logging" convention in `CLAUDE.md` and applies to **every** plan — feature, fix, or refactor. Unlike Help Center Coverage it is never omitted (a refactor states what signal it preserves, or why none is needed). Route events through `logEvent`/`reportError`/`perfTiming`; reserve `severity: 'critical'` (Slack page) for "user action failed / data at risk"; put queryable data in structured `context`; and if a new context key ships, flag the `ALLOWED_CONTEXT_KEYS` + store-declaration update.

**Mockup-driven drafting (only when an approved mockup informs this work).** When Phase 1 surfaced a mockup (a `Mockup:` line or a `docs/mockups/…` file), Pass 1 must translate that design faithfully into a CIG-compliant plan rather than re-inventing the UI. Read the mockup file, then draft under this instruction (the canonical mockup→plan directive — edit it here if it needs to change):

> This plan implements an approved mockup. Read the mockup file in full before drafting. Strive for simplicity and elegance in both the plan and the implementation, and follow all DRY conventions. Reproduce the mockup's design intent faithfully — its layout, visual hierarchy, spacing rhythm, component structure, tone, and the specific interactions it demonstrates — so the shipped UI is recognizably the same design. At the same time, every concrete style token (colors, typography and font sizes, radii, shadows, spacing, modal/component patterns) MUST come from the beanies theme + CIG (`.claude/skills/beanies-theme/SKILL.md`), not from whatever aesthetic the mockup's generator happened to choose. Where the mockup and the beanies UI theme / CIG disagree, the CIG ALWAYS wins — translate the mockup's intent into CIG-compliant equivalents rather than copying its raw values. Map each region of the mockup to existing components, composables, and utilities first (DRY) before proposing anything new. Call out any place where faithfully reproducing the mockup would violate the CIG, accessibility, i18n, or the rem-based text rule, and resolve it in favour of the rule. Ask any clarifying questions before drafting; once everything is clear, prepare the plan.

The plan's `## Approach` should reference the mockup path, and `## Files Affected` should list the approved `docs/mockups/<file>.html` as part of the change. The mockup is design input — the four review passes still run normally on the resulting plan.

#### Phase 2.2 — Pass 2: DRY + Error Handling (fresh subagent)

Invoke a `Plan` subagent. The subagent receives:
1. The full Pass-1 plan body as input.
2. The Pass 2 prompt **verbatim** from [Review Pass Prompts](#review-pass-prompts) — do not paraphrase.
3. Explicit authorization (and the relevant paths) to read the codebase so it can actually verify reuse claims rather than guess. At minimum: `src/composables/`, `src/utils/`, `src/components/ui/`, `src/components/` (for similar modals/forms/cards), `src/services/`, `src/stores/`.

Apply the subagent's revisions to the plan in-place. Record a one-line summary of what changed (or "No changes — already covered") in the `## Review Passes` section of the plan.

#### Phase 2.3 — Pass 3: Sustainability / Maintainability (fresh subagent)

Invoke a **new** `Plan` subagent — fresh context, no awareness of Pass 2. It receives:
1. The Pass-2-revised plan body.
2. The Pass 3 prompt **verbatim** from [Review Pass Prompts](#review-pass-prompts).

Apply revisions. Record a one-line summary in `## Review Passes`.

#### Phase 2.4 — Pass 4: Fresh-Eyes Final Sweep (fresh subagent)

Invoke a **new** `Plan` subagent — fresh context, no awareness of Passes 2 or 3. It receives:
1. The Pass-3-revised plan body.
2. The Pass 4 prompt **verbatim** from [Review Pass Prompts](#review-pass-prompts).

Apply revisions. Record a one-line summary in `## Review Passes`. The plan is now ready to present.

### Phase 3: Iterate Until Approved

1. Present the plan to the user for review (via `ExitPlanMode`).
2. Incorporate all feedback, redirections, and changes — but **judge the size of the change before deciding whether to re-run Passes 2-4**:
   - **Light edits** (wording tweaks, clarifications, renaming a helper, small detail fixes): apply directly. Do **not** re-run Passes 2-4. Note the iteration in the Prompt Log only.
   - **Substantial edits** (new requirement added, different approach, new files affected, scope removed, materially different design): apply the change, then re-run **Passes 2, 3, and 4** with fresh Plan subagents on the revised plan. Update the `## Review Passes` section to reflect the new round.
   - When in doubt: re-run. The cost of an extra pass is far lower than the cost of a missed regression in the discipline.
3. **Record every iteration prompt** — these are saved later.
4. Repeat until the user explicitly approves the plan.

### Phase 4: Save the Plan

Once the plan is fully approved:

1. **Save the FULL plan** (not summarized, not truncated — exactly what the user approved) to `docs/plans/YYYY-MM-DD-<short-slug>.md`
2. The plan must follow the complete [Plan Document Format](#plan-document-format) below.
3. If no GitHub issue is being created, the plan must note this explicitly and include all information that would otherwise go in the issue (see format below).

### Phase 5: Create GitHub Issue (only if the user explicitly asked for one)

**Default path — no issue.** The plan file alone is the record. Note in the plan: `> **No GitHub issue created.** This plan was approved for direct implementation.` and include ALL prompt history directly in the plan under a `## Prompt Log` section.

**Only if the user explicitly asked for an issue** (e.g. "create a ticket", "file an issue", "open a GitHub ticket"):

1. Create the issue using `gh issue create` with the format in [GitHub Issue Format](#github-issue-format) below.
2. Apply labels per the project's [Issue Labeling](#issue-labeling) conventions.
3. Add a **comment** on the issue containing ALL prompts from the conversation (initial + follow-ups + redirections). Use the format in [Prompt Log Comment](#prompt-log-comment-format) below.
4. Update the plan file to include the issue number and link.

---

## Review Pass Prompts

These prompts are the source of truth for what Passes 2, 3, and 4 actually do. Pass them to each pass's subagent **verbatim** — do not paraphrase, condense, or "improve" them. If a prompt needs refinement, edit it here. The trailing `--` is part of the prompt as Greg authored it; keep it.

### Pass 2 — DRY + Error Handling

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code.
>
> Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later.
>
> Ensure that there are never any silent failures. Everything with the potential to fail should be handled gracefully (i.e. a try/catch block or something similar as appropriate). Users should be shown informative error message, with direction for developers as well either in the error modal itself or on the console. Nothing should ever fail silently, and guidance on how to fix the error should always be available.
>
> Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.
>
> --

### Pass 3 — Sustainability / Maintainability

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.
>
> --

### Pass 4 — Fresh-Eyes Final Sweep

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.
>
> --

---

## Plan Document Format

```markdown
# Plan: <Title>

> Date: YYYY-MM-DD
> Related issues: #<number> (or "None — direct implementation")
> Plan file: `docs/plans/YYYY-MM-DD-<slug>.md`
> Mockup: `docs/mockups/<file>.html` (include this line only when an approved mockup drove the plan; omit otherwise)

## User Story

As a [role], I want [goal] so that [benefit].

## Context

<Why this work is needed. Background, motivation, current state.>

## Requirements

<Numbered list of all functional requirements. Be specific and complete.>

1. ...
2. ...

## Important Notes & Caveats

<Anything that could trip up implementation — edge cases, constraints, gotchas, things NOT to do.>

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. ...
2. ...

## Approach

<The accepted implementation plan. Technical details, files affected, key design decisions.>

## Files Affected

<List of files to be created or modified — include any `src/content/help/*.ts` files that need new or updated articles per the Help Center Coverage section below.>

## Help Center Coverage

> Include this section only if the work deserves Help Center documentation per Phase 2's assessment. Omit entirely (do not write "N/A") when it doesn't apply — bug fixes, refactors, polish, and similar work usually won't have this section.

For each affected article:

- **Action**: `new article` | `update existing` | `deprecate / replace`
- **Category**: `getting-started` | `features` | `security` | `how-it-works`
- **Article type** (for new articles): `how-to` | `explainer` | `reference` | `troubleshooting`
- **Slug**: `<kebab-case-slug>` (for new) or pointer to the existing article being updated
- **Title**: <user-facing title>
- **Scope**: 1–3 sentence summary of what the article will cover, framed from the user's point of view (the *why* and *what they'll get*, not the implementation)
- **Notes**: any gotchas the article must call out (irreversible actions, security implications, defaults that aren't obvious)

The article work is written following `.claude/skills/beanies-help-docs/SKILL.md` and lands **in the same change** as the feature — not as a follow-up. Treat it as a first-class acceptance criterion.

## Observability Coverage

> **MANDATORY for every plan** (per the "Observability & Diagnostic Logging" convention in `CLAUDE.md`). Observability is a first-class deliverable — never a follow-up. Unlike Help Center Coverage, this section is never omitted: even a pure refactor states what diagnostic signal it preserves or why none is needed.

State, concretely, the diagnostic logging this work emits so any failure can be **triaged from CloudWatch alone, without a local repro**:

- **Events**: each `logEvent`/`reportError`/`perfTiming` call the work adds or changes — the `surface` (kebab-case, greppable), `level`/`severity`, and the key `context` fields (queryable, structured — not string-interpolated).
- **Failure modes covered**: for each way this feature can fail or degrade, the event that would let you diagnose it blind (which branch, which input class, what state). Confirm no bare `catch {}` / silent fallback.
- **Success-path signal**: the counter/outcome emitted on success too (so _rates_ are measurable for future alerting), noting the `TELEMETRY_FLOOR_MS = 250` floor where relevant.
- **Critical vs. telemetry**: which events (if any) warrant `severity: 'critical'` (Slack page — reserve for "user action failed / data at risk") vs. firehose-only `warning`/`error`.
- **Privacy/store gate**: if any **new** `context` key ships, it MUST be added to `ALLOWED_CONTEXT_KEYS` (`logEvent.ts`) and the store data-collection declarations updated (`docs/runbooks/native-store-submission.md` + consumers) — call this out here.

## Acceptance Criteria

- [ ] ...
- [ ] ...
- [ ] Help Center article(s) listed in **Help Center Coverage** added/updated and verified to match the shipped behavior (omit this row if the section was omitted)
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified (events fire with the stated `surface`/`context`; failure modes are triageable from CloudWatch without a local repro; any new context key is allowlisted + declared)

## Testing Plan

<How to verify the implementation is correct and complete.>

1. ...
2. ...

## Review Passes

Lightweight record that all four review passes ran. One bullet per pass — a 1-line summary of what changed, or "No changes — already covered" if a pass found nothing to revise.

- **Pass 1 (Initial draft)**: <1-line summary of what was drafted>
- **Pass 2 (DRY + error handling)**: <1-line summary of revisions, or "No changes — already covered">
- **Pass 3 (Sustainability)**: <1-line summary of revisions, or "No changes — already covered">
- **Pass 4 (Fresh-eyes sweep)**: <1-line summary of revisions, or "No changes — already covered">

## Prompt Log

> Only included when no GitHub issue was created. Otherwise, prompts are saved as a comment on the issue.

<details>
<summary>Full prompt history</summary>

### Initial Prompt
<exact user prompt>

### Follow-up 1
<exact user prompt>

...
</details>
```

---

## GitHub Issue Format

```markdown
## User Story

As a [role], I want [goal] so that [benefit].

## Plan Reference

Full plan: [`docs/plans/YYYY-MM-DD-<slug>.md`](../docs/plans/YYYY-MM-DD-<slug>.md)

> The plan contains the complete technical approach, files affected, and design decisions. Always refer to it during implementation.

## Requirements

1. ...
2. ...

## Important Notes & Caveats

...

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. ...
2. ...

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Testing Plan

1. ...
2. ...
```

---

## Prompt Log Comment Format

After creating the issue, add a comment with this format:

```markdown
## Prompt Log

All prompts captured during plan creation. This is the complete record of user intent and iterations.

### Initial Prompt
> <exact user message>

### Follow-up 1
> <exact user message>

### Follow-up 2
> <exact user message>

...
```

---

## Issue Labeling

Follow the project's labeling conventions from `CLAUDE.md`:

1. **Type** (required — pick one): `enhancement`, `bug`, `refactor`, `performance`, `accessibility`, `documentation`, `testing`
2. **Priority** (required — pick one): `priority: critical`, `priority: high`, `priority: medium`, `priority: low`
3. **Page** (if applicable): `page: dashboard`, `page: accounts`, `page: transactions`, `page: assets`, `page: goals`, `page: reports`, `page: forecast`, `page: family`, `page: settings`, `page: login`
4. **Area** (if applicable): `area: ui`, `area: data`, `area: sync`, `area: brand`, `area: i18n`, `area: pwa`
5. **Special** (as needed): `security`, `auth`, `privacy`

---

## Rules

- **ALWAYS run all four review passes for every plan.** No exceptions, no "trivial enough to skip" carve-out. Bug fix, feature, refactor, polish — all four passes run.
- **Passes 2-4 use Plan subagents with fresh context windows.** That is what "fresh eyes" means in this skill — literal independent context, not just a fresh instruction in the same conversation. Do not run passes 2-4 inline in the main thread.
- **Pass the prompts verbatim.** Each pass's prompt in [Review Pass Prompts](#review-pass-prompts) is the spec — copy it word-for-word into the subagent invocation. Do not paraphrase, summarize, or "improve" them.
- **Record the passes in the saved plan.** The `## Review Passes` section is mandatory and proves the discipline ran. Each bullet is one line — what changed, or "No changes — already covered".
- **Re-run passes 2-4 only on substantial user edits.** Light edits (wording, clarifications, small detail fixes) skip the re-run. Substantial edits (new scope, different approach, new files affected) re-run all three downstream passes against fresh subagents.
- **End with `ExitPlanMode`.** Once all four passes have completed and the plan file is written, the skill ends its turn by calling `ExitPlanMode` so the user reviews the final plan in plan mode.
- **NEVER summarize or truncate the plan.** Save exactly what was approved.
- **DEFAULT to direct implementation.** Do not ask "issue or direct?" — only create a GitHub issue when the user explicitly requests one.
- **NEVER lose prompts.** Every user message that shaped the plan is recorded.
- **ALWAYS include assumptions.** These are critical for deferred implementation.
- **ALWAYS include acceptance criteria and testing plan.** These define "done".
- **Mockups inform Pass 1; the CIG always wins; stay Notion-agnostic.** When an approved mockup is present (via a `Mockup:` line or a `docs/mockups/…` path in the prompt), read it and draft to it using the _Mockup-driven drafting_ directive in Phase 2.1 — faithfully reproducing its design intent but sourcing every concrete style token from `.claude/skills/beanies-theme/SKILL.md` + the CIG (the CIG wins on any conflict). The mockup reaches this skill ONLY through the prompt + the repo file — never read the Notion tracker for it (writing `mockup file url` back is `beanies-pre-plan`'s job). If invoked standalone where a mockup is expected but absent, generate one first via `/frontend-design:frontend-design` (CIG-clamped), get approval, commit only the approved file, then draft.
- **ALWAYS assess Help Center coverage.** If the work introduces a distinct user-facing feature (or meaningfully changes behavior an existing article documents), include the `## Help Center Coverage` section in the plan AND treat the article as part of the same change — not a follow-up. Skip the section entirely for bug fixes, refactors, polish, and similar work.
- **ALWAYS include Observability Coverage.** Every plan carries the `## Observability Coverage` section (per the `CLAUDE.md` convention) — feature, fix, or refactor, never omitted. State the diagnostic events emitted (`logEvent`/`reportError`/`perfTiming`, kebab-case `surface`, structured `context`), how they make each failure mode triageable from CloudWatch without a local repro, the success-path signal for future alerting, and any `ALLOWED_CONTEXT_KEYS` + store-declaration update a new context key requires. The logging lands in the same change — an acceptance criterion, not a follow-up.
- **ALWAYS create 2-way links** between the plan file and the GitHub issue (if one was created).
- **ALWAYS add labels** to GitHub issues per the project conventions (when one is created).
- Plans are saved to `docs/plans/YYYY-MM-DD-<short-slug>.md` — this is a permanent historical record.
