# Prompt Archive

This directory stores all prompts provided to AI assistants (Claude Code) during development of beanies.family. The goal is to maintain a searchable, timestamped record of every instruction — so future contributors can understand why and how a feature was built or a bug was fixed.

## Structure

```
docs/prompts/
├── README.md                              # This file
├── YYYY-MM/                               # Year-month subdirectories
│   ├── YYYY-MM-DD-<short-slug>.md         # One file per task/feature/bug
│   └── ...
```

## File naming

```
YYYY-MM-DD-<short-slug>.md
```

The slug should match the feature, bug, or task name. Use the GitHub issue title or plan slug when available.

## File format

```markdown
---
date: YYYY-MM-DD
category: feature | bugfix | refactor | design | infrastructure | exploration
issue: "#101"
plan: "docs/plans/YYYY-MM-DD-slug.md"
tags: [relevant, keywords]
---

# Title

## Prompt 1 — YYYY-MM-DD HH:MM UTC
> User's prompt (verbatim or close paraphrase)

## Prompt 2 — YYYY-MM-DD HH:MM UTC
> Follow-up prompt

## Outcome
Brief summary of what was implemented or decided.
```

## Fields

| Field | Required | Description |
|---|---|---|
| `date` | Yes | Date work started (YYYY-MM-DD) |
| `category` | Yes | One of: `feature`, `bugfix`, `refactor`, `design`, `infrastructure`, `exploration` |
| `issue` | No | GitHub issue number(s), e.g. `"#101"` or `"#97, #98"` |
| `plan` | No | Path to linked plan in `docs/plans/`, if any |
| `tags` | No | Keywords for searching |

## Guidelines

- **One file per task/feature/bug** — keep related prompts together even across multiple sessions
- **Record the user's prompts**, not Claude's responses (those are reconstructible from code + git history)
- **Add an Outcome section** once work is complete to close the loop
- **Year-month subdirectories** keep the archive manageable over time

## Searching

```bash
# Find all bugfix prompts
grep -r "category: bugfix" docs/prompts/

# Find prompts related to a specific issue
grep -r "#101" docs/prompts/

# Find by tag
grep -r "navigation" docs/prompts/
```
