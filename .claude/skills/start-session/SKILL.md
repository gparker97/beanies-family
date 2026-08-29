---
name: start-session
description: Fresh-session ritual — sync the repo, surface project status, fetch top news + a famtech (family-technology) competitor-news sweep + today's calendar, kick off the daily beanies-metrics refresh in the background, and lay out pending work so you start a new session knowing exactly what's in front of you. Run at the start of any new session (new day, new machine, after context clear), not just mornings.
---

# start-session — Session Start Ritual

Get the workspace synced and the brain warmed up whenever starting a fresh session — a new day, switching machines, or after clearing context. Run this before any other work on a new session.

This skill is the bookend to `/end-session`: end-session captures the previous session's state into the repo and Notion; start-session pulls that state forward and turns it into an actionable picture for the current session.

---

## When to Invoke

- **Via slash command**: `/start-session` or `/good-morning` (both invoke this same skill — `good-morning` is a symlink wrapper kept for the common morning case)
- **Proactively**: When the user says "good morning", "morning", "ready to start", "let's go", "what's on for today", "fresh session", "new context", "picking up where I left off" or similar at the start of a session
- Always recommend running it when starting a new session — whether that's a new calendar day, a new machine, or a cleared context — since the last activity in the conversation

---

## Workflow

### Step 1: Sync the repo (mandatory, no shortcuts)

The repo MUST be fully synced before any work begins — pushes from CI, dependabot, or another machine could otherwise cause merge headaches later.

1. `cd` to the repo root if not already there.
2. Capture the current branch and confirm it's clean:
   ```bash
   git branch --show-current && git status --short
   ```
3. If the working tree is dirty, **stop and ask the user** what to do (don't auto-stash, don't auto-commit — the previous `/end-session` should have left it clean; dirty state on a fresh session is suspicious and worth a human eyeball).
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

Pull the session's context into the conversation. In parallel, read:

1. `docs/STATUS.md` (top section + most recent dated session block) — what was shipped in the most recent session(s), current phase, pending items
2. `CHANGELOG.md` (today's date if it exists, otherwise the most recent entry) — user-facing changes
3. `tasks/lessons.md` (top entry only) — recent corrections to keep front-of-mind
4. **Skip Notion launch status** — `/launch-status` is its own skill the user can run if they want the launch dashboard. Don't duplicate that work here.

### Step 3: Check for pending work

Surface anything that's actively waiting:

1. `git log --oneline -10` — what's been shipped recently (catch up on late commits from the previous session)
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

### Step 3.5: Validate pending items against the codebase (mandatory)

STATUS.md's "Pending / Next Session" block can rot — items shipped in subsequent sessions get carried forward by mistake. Before displaying any item to greg, **verify it isn't already done**.

For each candidate item from STATUS.md, ask: would this leave a fingerprint in the repo if it were shipped? If yes, look for the fingerprint:

- **Item names a feature, helper, composable, or component** (e.g. "build `sendDiagnosticToSlack`", "extract `useEscapeClose`") → grep the codebase for the symbol. If it exists, the item is done.
  ```bash
  grep -rn "<symbol>" src/ web/src/ 2>/dev/null | head -5
  ```
- **Item names a file/path** (e.g. "implement v3 nav in `MobileBottomNav.vue`") → read the file. If the implementation is there, done.
- **Item describes a deploy, ship, or implementation** of something nameable → check commits since the item was added.
  ```bash
  git log --since="<item's date>" --oneline --grep="<keywords>" -i
  ```
- **Item references a draft flag flip** ("flip pillars `draft: false`", "remove `DRAFT = true`") → grep the file for the literal flag.
- **Item references content cleanup** ("remove arrow artifacts `←`", "drop `<!-- TODO -->` placeholders") → grep the relevant content directory for the literal pattern.
- **Item points at a GitHub issue** ("#185 hardening", "#190 mobile nav") → check issue state via `gh issue view <n> --json state,labels`.

**Verdict for each item:**
- **Done** — drop silently from the displayed pending list (do NOT pad the report). Mention in the closing summary that N stale items were dropped, so greg knows the validator ran.
- **Done but worth confirming** — surface as a question, not a pending item: "STATUS lists X as pending but I see Y in the codebase — is this done?"
- **Still pending** — keep in the list, optionally with a one-line "verified still pending: <evidence>" if the check turned up something interesting.
- **Ambiguous** — keep, but flag for greg: "couldn't fully verify; carrying forward."

Run the checks in parallel (one bash call per item, batched in a single message) — most checks are fast greps. Don't ask greg before each verification — only ask after, if the verdict is genuinely ambiguous.

### Step 4: Fetch news — general headlines + famtech watch — and kick off the daily metrics refresh

Three independent pieces here. They don't depend on each other, so kick them off together — 4b and 4c both go to background subagents in the same message.

#### 4a) General headlines

Surface 1–2 major news stories from the last 24 hours. Use `WebSearch` with a query like `"top news today"` or `"major news headlines [today's date]"`. Pick stories that are genuinely top-of-the-news — world events, major tech/AI announcements, market moves. Skip clickbait, sports, celebrity gossip.

For each story: one short line — headline + a 5-10 word context phrase. No links unless the source is canonical (Reuters, AP, official press release).

If the search returns nothing useful, skip this section silently — don't pad with filler.

#### 4b) Famtech watch — competitive-intelligence sweep

beanies.family competes in the family-technology ("famtech") space, and greg wants to stay on top of what's moving there. The trigger for this feature was Maple — a large family-organizer app that announced it's retiring at the end of 2026, which opened a real migration opportunity greg turned into blog + pillar content. That's the class of event worth catching early: a rival **shutting down or migrating users out**, a **funding round or acquisition**, a **major feature launch** that shifts the competitive picture, a **notable spike in users**, or **people joining/leaving/founding** these companies. This is market awareness that directly feeds positioning, blog angles, and pilot outreach — so cast a wide net.

**Delegate this to a subagent** (Explore or general-purpose) so the multi-query searching stays out of the main session context. Ask it to return a short digest — **3–6 bullets max**, most notable first, each with a one-line "why it matters for beanies" tag and a canonical source link where one exists. Fall back to running the `WebSearch` calls inline only if subagents aren't available.

Search several angles, not one query — comprehensiveness is the point:

- **Category events:** `"family organizer app" OR "family calendar app" funding OR acquired OR "shutting down" 2026`, `famtech OR "family tech" startup funding OR acquisition 2026`, `family finance app kids allowance news 2026`, `"shared family calendar" app launch OR update 2026`.
- **Named products** (seed list — not exhaustive; add any you know, drop any that have clearly died): Cozi, Maple, FamilyWall, Picniic, Hearth Display, Skylight (Calendar), TimeTree, Jam, OurHome, Google Family Link, Life360, Greenlight, GoHenry, BusyKid, FamZoo, Bark, Qustodio, Canopy, Milo. Search the notable ones by `<name> news OR funding OR "shutting down" OR update 2026`.
- **People moves:** founders/execs of the above joining, leaving, or starting something new.

**Freshness:** favor the last ~30 days, lead with anything from the last 7. Famtech news is lower-frequency than world news, so a wider window is correct — a competitor shutdown or raise from three weeks ago is still worth surfacing if it hasn't come up before. Dedupe within the sweep; don't list the same story twice, and don't re-run identical searches across angles.

**Relevance bar:** only surface things that would actually make greg lean in — a Maple-class shutdown/migration opening, a funding round, an acquisition, a competitive-picture-changing feature, or a notable hire/departure. Skip routine app updates, "best family apps 2026" listicles, SEO spam, and anything about beanies.family itself (greg already knows his own news). If nothing clears the bar, **skip the section silently** — an empty famtech watch is honest and far better than padding.

#### 4c) Daily metrics refresh — background, never blocks

Every session start also refreshes the beanies growth/usage metrics so they're up to date at least once a day — but the whole point of running it HERE is that greg never waits on it. The collectors (DynamoDB registry, CloudWatch, Plausible) take minutes; the session-start report must not.

**Launch a general-purpose subagent in the background** (same message as the famtech sweep) with a prompt like: "Run the beanies-metrics skill end to end (`.claude/skills/beanies-metrics/SKILL.md`): run all the read-only collectors, build the dashboard, and return a 3-5 line summary of the headline numbers (total families, new this week, engaged/churned movement, top traffic source) plus anything that moved sharply since the last run."

- **Do NOT wait for it.** Compose and deliver the Step 6 report without the metrics; note in one line that the refresh is running.
- **When its notification arrives later**, relay a SHORT update — the 3-5 headline lines, not the full report (greg's standing concision preference). If nothing moved meaningfully, one line ("metrics refreshed — no significant movement") is the right amount.
- If the subagent fails (expired AWS creds, Plausible token), report the one-line reason and move on — the session is not blocked, and greg can run `/beanies-metrics` directly after fixing it.

### Step 5: Fetch today's calendar

Pull today's Google Calendar events from **both** of Greg's accounts. Query them in parallel (single message, two `list_events` calls):

1. **Personal/family calendar** — `calendarId: gregsophia@gmail.com` (query this **first**; usually has the day's family logistics — kids' lessons, sports, appointments)
2. **Work calendar** — `calendarId: greg@grobrix.com`

For both: pass `startTime` and `endTime` as today's local-day window in `Asia/Singapore` (e.g. `2026-04-18T00:00:00+08:00` → `2026-04-18T23:59:59+08:00`), `orderBy: startTime`, `timeZone: Asia/Singapore`.

**Output format:** a single combined "Today's calendar" list, with `gregsophia` events first, then `grobrix` events. For each event: `HH:MM — title (location, if present and short)`. Skip declined events. Tag each line with `[family]` or `[work]` only if there's ambiguity; usually the context is obvious.

**MCP availability check:** if `mcp__claude_ai_Google_Calendar__list_events` isn't available, the MCP isn't connected — note "calendar not connected — run `/mcp` to authenticate" and skip the section.

**Empty days:** if both calendars return zero events, write "calendar clear — no events today."

### Step 6: Compose the session-start report

Deliver a single message that combines:

#### a) Greeting

One direct, low-key line. greg is reading this with their first cup of coffee (or mid-afternoon, or on a new machine — whatever the start of this session looks like). Keep it brief and easy to parse. No silly language, no metaphors, no emoji-heavy openings, no absurdist humor. Match the time of day: "Good morning, greg." on the morning start; "Hey greg" or "Picking up where you left off" on a fresh mid-day session. Optionally add one short factual context phrase tied to the session (date, what shipped last session) — but only if it adds real signal.

Examples of the right tone:

- "Good morning, greg. Saturday, April 18."
- "Good morning. Repo synced, nothing in flight."
- "Picking up on a fresh context. Yesterday's session shipped the buy-fruit post and the staging teardown plan."
- "Hey greg — fresh session. Last commit was 20 minutes ago."

Avoid: stacked metaphors, emoji clusters, "the beanies are stretching", "rise and shine", motivational-poster phrasing.

#### b) Pending work — brief, actionable

A short bulleted list (3-7 items max) of what's actively in flight or scheduled for today/this week, drawn from STATUS.md, GitHub issues, and runbooks. Each item:

- Starts with a **bold action verb** (Apply, Deploy, Verify, Write, Review, Cleanup, etc.)
- One line, ≤80 characters
- References file paths, issue numbers, or runbook sections so the user can dive in immediately

Prioritize:
1. Anything explicitly scheduled for today (e.g. "Phase C cutover scheduled for Apr 15")
2. Open `in-progress` issues
3. Pending items called out in `STATUS.md` "Next Session" / "Pending" sections
4. Anything mentioned in a recent runbook as "next step"

If there's genuinely nothing pending, say so clearly: "no pending items — wide open session. what would you like to work on?"

#### c) Quick state snapshot

Two or three lines summarizing the world:

- Working tree status
- What changed since the last local activity (if anything was pulled)
- Anything notable from the most recent STATUS update

Format example:

```
**State:** Clean working tree on `main`. Pulled 2 commits from overnight (dependabot bumps). Previous session shipped Phase B + authored Phase C cutover.
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

**Famtech watch:**
- [Competitor/product event + one-line why-it-matters + source link]
- [etc — 3-6 items max, or omit the whole section if nothing notable]

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

Order matters: greeting → state → news → famtech watch → calendar → pending work. State and pending work are repo-driven and always present. News, famtech watch, and calendar are best-effort — skip silently if unavailable or nothing clears the bar. End with one line noting the background metrics refresh is running (its short summary lands later — never hold the report for it).

---

## Rules

- **Always sync first.** No skipping `git fetch + pull`. Stale repos cause stale advice.
- **Never auto-resolve unexpected git state.** Dirty working tree, diverged branches, conflicts — stop and ask.
- **Greeting stays direct.** No silly metaphors, no emoji clusters, no absurdist humor. One short factual line. Match the time of day: morning gets "good morning"; a fresh mid-day session gets a neutral pickup line.
- **Keep pending work crisp.** No essays. The user should be able to pick the next action in under 10 seconds of reading.
- **Don't moralize.** No "remember to take breaks" lectures. greg is an adult.
- **Skip the launch dashboard.** That's `/launch-status`'s job. Mention it as "run /launch-status if you want the launch metrics" only if the most recent STATUS update is launch-relevant.
- **Be honest about empty sections.** If nothing's pending, say so. If calendar isn't connected, say so. No filler.
- **News stays real.** 1-2 genuinely top stories from the last 24 hours. No clickbait, no padding. Skip the section if WebSearch returns nothing useful.
- **Famtech watch is competitive intel, not filler.** Delegate the multi-query sweep to a subagent to keep main context clean. Only surface events that move the needle (shutdown/migration, funding, acquisition, picture-changing feature, notable people move); ~30-day window, freshest first. Dedupe, cite canonical sources, and skip the section silently when nothing clears the bar. Never include beanies.family's own news here.
