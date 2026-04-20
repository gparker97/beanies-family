---
name: end-session
description: Session wrap-up — commit, push, update STATUS.md, CHANGELOG.md, launch status in Notion, and clean up unfinished work. Run whenever wrapping up a session (end of day, switching machines, about to clear context), not just at end of day.
---

# end-session — Session Wrap-Up

Close out the current session so the next session (on any machine, with any context) can pick up exactly where you left off. Ensures clean working tree, updated project status, and no orphaned work.

**This skill should be invoked proactively** when the session is winding down — whether that's end of day, switching to a new machine, or about to clear context. The user might say things like "wrapping up", "done for the day", "signing off", "switching machines", "about to clear context", "let's close this session".

---

## When to Invoke

- **Via slash command**: `/end-session`
- When the user says "wrapping up", "done for today", "let's close out", "end of session", "switching machines", "clearing context", "moving to a new machine"
- **Proactively** if the conversation is ending and there are uncommitted changes or status files haven't been updated

---

## Workflow

### Step 1: Clean the Working Tree

1. Run `git status` to check for uncommitted or untracked changes.
2. If there are changes:
   - Review the diff to understand what's pending.
   - Stage and commit with an appropriate message (follow repo commit conventions).
   - Push to `main`. If pre-push tests fail, fix and retry.
3. If the tree is already clean, proceed to Step 2.
4. **Goal:** `git status` shows "nothing to commit, working tree clean" and branch is up to date with `origin/main`.

### Step 2: Update STATUS.md

Read and update `docs/STATUS.md` with:

1. **Update the header**: Set `Last updated` to today's date and `Updated by` to the current author with a brief summary of changes.
2. **Add to Completed Work**: Add bullet points for all significant work completed this session, grouped by area (e.g., "Legal & Compliance", "Analytics", "Onboarding"). Include:
   - What was built/fixed/changed
   - Key technical details (new files, patterns used)
   - Any decisions made and why
3. **Update any "In Progress" or "Pending" sections** if they exist.
4. **Remove stale items** that are no longer accurate.

### Step 3: Update CHANGELOG.md

1. Check if today's date section (`## YYYY-MM-DD`) already exists.
   - If yes, append new entries to the existing section.
   - If no, create a new date section at the top (below the header).
2. Add entries for all user-visible changes made this session, grouped by type:
   - `### Added` — new features
   - `### Fixed` — bug fixes
   - `### Changed` — modifications
3. Keep entries brief and human-readable — focus on what the user would notice.

### Step 4: Update Launch Status in Notion

If any launch-relevant work was done (new features, user-facing changes, metrics updates), update the Launch HQ in Notion:

1. Read Launch HQ blocks: `mcp__notion__API-get-block-children(block_id: "32c247d9-a99f-8188-b169-eacfdc48c057")`
2. Update the intro line with today's date.
3. Update CURRENT STATUS with any new deployments, features shipped, or metrics.
4. Update KEY METRICS if user provided numbers (new families, karma, etc.).
5. Update NEXT STEPS based on what's left to do.

**Skip this step** if no launch-relevant changes were made (e.g., pure refactoring or internal tooling).

### Step 5: Check for Unfinished Work

1. Check for any TODO comments added during the session: `grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.ts" --include="*.vue" | grep "$(date +%Y)"`
2. Check the task list for any in-progress or pending tasks.
3. Check for any saved plans in `docs/plans/` that haven't been implemented yet — note them.
4. Check for any open GitHub issues that were being worked on but not completed.

**If unfinished work exists:**
- List each item clearly with file paths and context.
- Ask the user if they want to complete any of them now before closing out.
- For items that can't be completed, add a note to `docs/STATUS.md` under a "Pending / Next Session" section so the next developer knows.

### Step 6: Final Push & Verify

1. Stage and commit all status file updates (STATUS.md, CHANGELOG.md).
2. Push to `main`.
3. Run `git status` one final time to confirm the tree is clean.
4. Report a summary:
   - What was committed and pushed
   - Any unfinished items noted for next session
   - Current state of the project

---

## Status Report Format

Present the final summary in this format (use the session date — or date + time if multiple sessions happen on the same day):

```
## Session Wrap-Up — [DATE]

### Shipped Today
- [Bullet points of what was deployed]

### Key Metrics
- Families: [X]
- Users: [X]  
- Reddit karma: [X]
- [Other relevant metrics]

### Pending / Next Session
- [Items that need attention next time]

### Files Updated
- docs/STATUS.md ✓
- CHANGELOG.md ✓
- Notion Launch HQ ✓ (or skipped)

### Working Tree
- Clean ✓
- Pushed to origin/main ✓
```

---

## Rules

- **Never leave uncommitted changes.** The working tree must be clean before the session ends.
- **Never leave unpushed commits.** Everything on local must be on `origin/main`.
- **Always update STATUS.md and CHANGELOG.md.** These are mandatory every session.
- **Notion updates are conditional** — only if launch-relevant work was done.
- **Be specific about unfinished work.** Include file paths, line numbers, and enough context that someone without this conversation can understand what's left.
- **Don't create new work.** This skill is for closing out, not starting new tasks.
- **Ask before discarding.** If there are uncommitted changes that look intentional, ask the user before reverting.
