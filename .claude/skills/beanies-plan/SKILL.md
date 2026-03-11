---
name: beanies-plan
description: Create standardized plans and optionally GitHub issues with full context preservation
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
3. **Ask the user**: _"Should I create a GitHub issue for this, or will this be implemented directly without an issue?"_
   - This must ALWAYS be asked. Never skip it.
4. Record all follow-up prompts, redirections, and refinements. Every user message that shapes the plan is part of the record.

### Phase 2: Draft the Plan

Prepare a comprehensive plan following the structure in [Plan Document Format](#plan-document-format) below. The plan must include **all** context, details, and information required to implement the request in full. Do not summarize, truncate, or omit anything.

Key principles:
- **No context loss**: If the user said it, it's in the plan
- **Self-contained**: A developer reading only this plan should be able to implement the feature without asking any questions
- **Assumptions explicit**: Every assumption is documented so it can be validated before implementation (especially if time has passed)

### Phase 3: Iterate Until Approved

1. Present the plan to the user for review.
2. Incorporate all feedback, redirections, and changes.
3. **Record every iteration prompt** — these are saved later.
4. Repeat until the user explicitly approves the plan.

### Phase 4: Save the Plan

Once the plan is fully approved:

1. **Save the FULL plan** (not summarized, not truncated — exactly what the user approved) to `docs/plans/YYYY-MM-DD-<short-slug>.md`
2. The plan must follow the complete [Plan Document Format](#plan-document-format) below.
3. If no GitHub issue is being created, the plan must note this explicitly and include all information that would otherwise go in the issue (see format below).

### Phase 5: Create GitHub Issue (if requested)

If the user requested a GitHub issue:

1. Create the issue using `gh issue create` with the format in [GitHub Issue Format](#github-issue-format) below.
2. Apply labels per the project's [Issue Labeling](#issue-labeling) conventions.
3. Add a **comment** on the issue containing ALL prompts from the conversation (initial + follow-ups + redirections). Use the format in [Prompt Log Comment](#prompt-log-comment-format) below.
4. Update the plan file to include the issue number and link.

If the user requested NO GitHub issue:

1. Note in the plan: `> **No GitHub issue created.** This plan was approved for direct implementation.`
2. Include ALL prompt history directly in the plan under a `## Prompt Log` section.

---

## Plan Document Format

```markdown
# Plan: <Title>

> Date: YYYY-MM-DD
> Related issues: #<number> (or "None — direct implementation")
> Plan file: `docs/plans/YYYY-MM-DD-<slug>.md`

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

<List of files to be created or modified.>

## Acceptance Criteria

- [ ] ...
- [ ] ...

## Testing Plan

<How to verify the implementation is correct and complete.>

1. ...
2. ...

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

- **NEVER summarize or truncate the plan.** Save exactly what was approved.
- **NEVER skip the "issue or direct?" question.** Always ask.
- **NEVER lose prompts.** Every user message that shaped the plan is recorded.
- **ALWAYS include assumptions.** These are critical for deferred implementation.
- **ALWAYS include acceptance criteria and testing plan.** These define "done".
- **ALWAYS create 2-way links** between the plan file and the GitHub issue (if created).
- **ALWAYS add labels** to GitHub issues per the project conventions.
- Plans are saved to `docs/plans/YYYY-MM-DD-<short-slug>.md` — this is a permanent historical record.
