---
name: start-of-day
description: First-thing-in-the-morning ritual — sync the repo, surface project status, fetch top news + today's calendar, and lay out today's pending work so you start the day knowing exactly what's in front of you
---

# start-of-day — Morning Ritual

Get the workspace synced and the brain warmed up. Run this on the **first login of every day** before any other work.

This skill is the bookend to `/end-of-day`: end-of-day captures yesterday's state into the repo and Notion; start-of-day pulls that state forward and turns it into today's actionable picture.

---

## When to Invoke

- **Via slash command**: `/start-of-day` or `/good-morning` (both invoke this same skill — `good-morning` is a symlink wrapper)
- **Proactively**: When the user says "good morning", "morning", "ready to start", "let's go", "what's on for today" or similar at the start of a session
- Always recommend running it if it's a new calendar day since the last activity in the conversation

---

## Workflow

### Step 1: Sync the repo (mandatory, no shortcuts)

The repo MUST be fully synced before any work begins — overnight pushes from CI, dependabot, or another machine could otherwise cause merge headaches later.

1. `cd` to the repo root if not already there.
2. Capture the current branch and confirm it's clean:
   ```bash
   git branch --show-current && git status --short
   ```
3. If the working tree is dirty, **stop and ask the user** what to do (don't auto-stash, don't auto-commit — yesterday's `/end-of-day` should have left it clean; dirty state on a fresh morning is suspicious and worth a human eyeball).
4. Fetch + show what's new on origin:
   ```bash
   git fetch --all --prune
   git log HEAD..origin/$(git branch --show-current) --oneline 2>&1 | head -20
   ```
5. If there are remote commits, fast-forward pull:
   ```bash
   git pull --ff-only
   ```
   - If `--ff-only` fails (local commits ahead of remote), **stop and report** to the user — don't auto-rebase; they may want to push or investigate.
6. Show the final state: branch + last 3 commits + clean working tree.

### Step 2: Read project status

Pull the day's context into the conversation. In parallel, read:

1. `docs/STATUS.md` (top section + most recent dated session block) — what was shipped yesterday, current phase, pending items
2. `CHANGELOG.md` (today's date if it exists, otherwise yesterday's most recent entry) — user-facing changes
3. `tasks/lessons.md` (top entry only) — recent corrections to keep front-of-mind
4. **Skip Notion launch status** — `/launch-status` is its own skill the user can run if they want today's launch dashboard. Don't duplicate that work here.

### Step 3: Check for pending work

Surface anything that's actively waiting:

1. `git log --oneline -10` — what's been shipped recently (catch up on yesterday's late-day commits)
2. Open GitHub issues with `in-progress` label:
   ```bash
   gh issue list --label "in-progress" --state open --json number,title,updatedAt --jq '.[] | "#\(.number) \(.title) (updated \(.updatedAt | split("T")[0]))"'
   ```
3. Saved plans in `docs/plans/` whose dates are within the last 14 days and don't have an obvious "shipped" / "completed" marker — these are still in-flight
4. TODO/FIXME comments added in the last 7 days:
   ```bash
   git log --since="7 days ago" --pretty=format: --name-only | sort -u | xargs -I{} grep -l "TODO\|FIXME" {} 2>/dev/null | head -5
   ```
5. Any deferred runbooks (e.g. `docs/runbooks/cutover-*.md`) that mention "scheduled" or "tomorrow"

### Step 4: Fetch news headlines

Surface 1–2 major news stories from the last 24 hours. Use `WebSearch` with a query like `"top news today"` or `"major news headlines [today's date]"`. Pick stories that are genuinely top-of-the-news — world events, major tech/AI announcements, market moves. Skip clickbait, sports, celebrity gossip.

For each story: one short line — headline + a 5-10 word context phrase. No links unless the source is canonical (Reuters, AP, official press release).

If the search returns nothing useful, skip this section silently — don't pad with filler.

### Step 5: Fetch today's calendar

Pull today's Google Calendar events from **both** of Greg's accounts. Query them in parallel (single message, two `list_events` calls):

1. **Personal/family calendar** — `calendarId: gregsophia@gmail.com` (query this **first**; usually has the day's family logistics — kids' lessons, sports, appointments)
2. **Work calendar** — `calendarId: greg@grobrix.com`

For both: pass `startTime` and `endTime` as today's local-day window in `Asia/Singapore` (e.g. `2026-04-18T00:00:00+08:00` → `2026-04-18T23:59:59+08:00`), `orderBy: startTime`, `timeZone: Asia/Singapore`.

**Output format:** a single combined "Today's calendar" list, with `gregsophia` events first, then `grobrix` events. For each event: `HH:MM — title (location, if present and short)`. Skip declined events. Tag each line with `[family]` or `[work]` only if there's ambiguity; usually the context is obvious.

**MCP availability check:** if `mcp__claude_ai_Google_Calendar__list_events` isn't available, the MCP isn't connected — note "calendar not connected — run `/mcp` to authenticate" and skip the section.

**Empty days:** if both calendars return zero events, write "calendar clear — no events today."

### Step 6: Compose the morning report

Deliver a single message that combines:

#### a) Good morning greeting

One direct, low-key line. Greg is reading this with their first cup of coffee — keep it brief and easy to parse. No silly language, no metaphors, no emoji-heavy openings, no absurdist humor. A simple "Good morning, Greg." is fine. Optionally add one short factual context phrase tied to the day (date, weather if known, what shipped yesterday) — but only if it adds real signal.

Examples of the right tone:

- "Good morning, Greg. Saturday, April 18."
- "Good morning. Repo synced, nothing in flight."
- "Morning, Greg. Yesterday shipped the buy-fruit post and the staging teardown plan."

Avoid: stacked metaphors, emoji clusters, "the beanies are stretching", "rise and shine", motivational-poster phrasing.

#### b) Today's pending work — brief, actionable

A short bulleted list (3-7 items max) of what's actively in flight or scheduled for today/this week, drawn from STATUS.md, GitHub issues, and runbooks. Each item:

- Starts with a **bold action verb** (Apply, Deploy, Verify, Write, Review, Cleanup, etc.)
- One line, ≤80 characters
- References file paths, issue numbers, or runbook sections so the user can dive in immediately

Prioritize:
1. Anything explicitly scheduled for today (e.g. "Phase C cutover scheduled for Apr 15")
2. Open `in-progress` issues
3. Pending items called out in `STATUS.md` "Next Session" / "Pending" sections
4. Anything mentioned in a recent runbook as "next step"

If there's genuinely nothing pending, say so clearly: "no pending items — wide open day. what would you like to work on?"

#### c) Quick state snapshot

Two or three lines summarizing the world:

- Working tree status
- What changed overnight (if anything was pulled)
- Anything notable from yesterday's STATUS update

Format example:

```
**State:** Clean working tree on `main`. Pulled 2 commits from overnight (dependabot bumps). Yesterday's session shipped Phase B + authored Phase C cutover.
```

---

## Output Format

Deliver as a single scannable message. Use bold section labels so Greg can jump to whichever section matters first. Aim for the whole thing to fit on one screen.

```
[greeting line — one sentence]

**State:** [one-liner about repo + overnight changes + key context from STATUS]

**News:**
- [Headline 1 + 5-10 word context]
- [Headline 2 + 5-10 word context]

**Today's calendar:**
- [HH:MM] [event title]
- [HH:MM] [event title]
(or: "calendar clear" / "calendar not connected — run `/mcp` to authenticate")

**Today's pending work:**
- **[Verb]** [item 1]
- **[Verb]** [item 2]
- **[Verb]** [item 3]
[etc — max 7 items]
```

Order matters: greeting → state → news → calendar → pending work. State and pending work are repo-driven and always present. News and calendar are best-effort — skip silently if unavailable.

---

## Rules

- **Always sync first.** No skipping `git fetch + pull`. Stale repos cause stale advice.
- **Never auto-resolve unexpected git state.** Dirty working tree, diverged branches, conflicts — stop and ask.
- **Greeting stays direct.** No silly metaphors, no emoji clusters, no absurdist humor. One short factual line. Reading-this-with-coffee tone, not stand-up-routine tone.
- **Keep pending work crisp.** No essays. The user should be able to pick the next action in under 10 seconds of reading.
- **Don't moralize.** No "remember to take breaks" lectures. Greg is an adult.
- **Skip the launch dashboard.** That's `/launch-status`'s job. Mention it as "run /launch-status if you want today's launch metrics" only if the most recent STATUS update is launch-relevant.
- **Be honest about empty sections.** If nothing's pending, say so. If calendar isn't connected, say so. No filler.
- **News stays real.** 1-2 genuinely top stories from the last 24 hours. No clickbait, no padding. Skip the section if WebSearch returns nothing useful.
