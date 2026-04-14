---
name: start-of-day
description: First-thing-in-the-morning ritual — sync the repo, surface project status, deliver a warm/silly/motivational good morning, and lay out today's pending work so you start the day knowing exactly what's in front of you
---

# start-of-day — Morning Ritual

Get the workspace synced and the brain warmed up. Run this on the **first login of every day** before any other work.

This skill is the bookend to `/end-of-day`: end-of-day captures yesterday's state into the repo and Notion; start-of-day pulls that state forward and turns it into today's actionable picture.

---

## When to Invoke

- **Via slash command**: `/start-of-day`
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

### Step 4: Compose the morning report

Deliver a single message that combines:

#### a) Good morning greeting

A warm, fun, silly, or motivational one-liner. **Vary it every time** — never reuse yesterday's. Keep it short (one or two sentences). Match Greg's lowercase brand voice.

Examples (rotate these and invent new ones):

- "good morning, greg! ☕ the beanies are stretching, the apex is humming, and your terraform plan is purring like a contented capybara. let's count some beans."
- "morning! 🫘 today is brought to you by the letter 'A' for Astro and the number 13 (your real users — not a typo, a milestone)."
- "rise and shine, founder of focal points! the staging site is ready, the apex cutover is one terraform apply away, and somewhere in singapore an EC2 box is rooting for you."
- "good morning! 🌅 yesterday past-greg shipped 19 commits and didn't break prod. today-greg has a low bar to clear. take it easy."
- "morning, greg. small reminder from the universe: cutover days have a way of becoming Big Days. coffee first, then terraform."
- "🫘 every bean counts, including the bean of getting out of bed. you did it. ten points to gryffindor."
- "good morning! the registry table is clean, the cors headers are friendly, the OAuth lambda knows your name. the simulation is ready when you are."

Tone: warm, lowercase, occasionally absurd. Never preachy or motivational-poster cringe. The aim is to make the user smile, not to sell them anything.

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

Deliver as a single message. No headers, no sections — just three short paragraphs that flow naturally:

```
[greeting line]

**State:** [one-liner about repo + overnight changes + key context from STATUS]

**Today's pending work:**
- **[Verb]** [item 1]
- **[Verb]** [item 2]
- **[Verb]** [item 3]
[etc — max 7 items]
```

Aim for the whole message to fit comfortably on one screen. Greg is reading this with their first cup of coffee — don't overwhelm.

---

## Rules

- **Always sync first.** No skipping `git fetch + pull`. Stale repos cause stale advice.
- **Never auto-resolve unexpected git state.** Dirty working tree, diverged branches, conflicts — stop and ask.
- **Vary the greeting.** Rotate tone (silly, warm, motivational, absurd) and content. Read the room — if Greg said "exhausted yesterday" in `/end-of-day`, today's greeting leans gentle.
- **Keep pending work crisp.** No essays. The user should be able to pick the next action in under 10 seconds of reading.
- **Don't moralize.** No "remember to take breaks" lectures. Greg is an adult.
- **Skip the launch dashboard.** That's `/launch-status`'s job. Mention it as "run /launch-status if you want today's launch metrics" only if the most recent STATUS update is launch-relevant.
- **Be honest about empty days.** If nothing's pending, say so — don't invent busywork.
- **Match brand voice.** lowercase, friendly, never corporate. "every bean counts" energy.
