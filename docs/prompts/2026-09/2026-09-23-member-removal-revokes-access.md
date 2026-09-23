---
date: 2026-09-23
category: security
issue: Notion tracker #77
plan: docs/plans/2026-09-23-member-removal-revokes-access.md
tags: [security, auth, member-removal, envelope, tombstones, google-drive, device-eviction]
---

# Removing a family member actually revokes their access (tracker #77)

Pre-plan → plan → build-auto, run autonomously on greg's instruction.

## Prompts

### Initial prompt (2026-09-23)

> Ok now let's address one of the final high priority issues - please run /beanies-pre-plan
> on issue #77 then move directly to /beanies-plan and /beanies-build-auto - work directly
> and only stop if there is a major showstopper or blocker issue requiring my decision

### Follow-up 1

> yes, tracker #77 - go ahead

## Outcome

Built, verified and reviewed (two `/code-review high` rounds); NOT committed or deployed.
Plan: `docs/plans/2026-09-23-member-removal-revokes-access.md` (Implementation Notes and
Review rounds sections record every deviation and finding). Pre-plan resolved the row's five
open questions autonomously; family-key rotation stays #117. Removal now: tombstones every
envelope wrap attributed to the member plus every invite (propagating, grow-only
`revokedKeys`), records an authenticated `removedMembers` doc entry, removes their Drive
permission on the folder and file, drops their Drive token copy, and evicts or locks the
family on a removed member's device that sees the removal. `npm run validate` green (8518
tests); browser-verified the remove flow and the manual-check alert, light/dark at 400px.
