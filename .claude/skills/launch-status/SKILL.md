---
name: launch-status
description: Update and review beanies.family launch plan status in Notion — progress, dates, karma level, and next actions
---

# launch-status — Launch Plan Status Update

Review and update the beanies.family launch plan in Notion. Provides a concise status report and clear next steps.

---

## When to Invoke

- **Via slash command**: `/launch-status`
- When the user asks for "launch status", "where are we with launch", "update the launch plan", or similar

---

## Workflow

### Step 1: Gather Current State

Collect the following information:

1. **Ask the user** for their current Reddit karma level (or check if they mention it)
2. **Read the Launch Roadmap** from Notion to get current phase and dates
3. **Read the Karma Building DB** to check recent activity
4. **Check current date** to assess timeline progress

**Notion page IDs:**
- Launch HQ: `32c247d9-a99f-8188-b169-eacfdc48c057`
- Launch Roadmap: `32c247d9-a99f-810b-8d5d-ded0c2579b43`
- Content Tracker: `32c247d9-a99f-81f8-8100-da43f1e4c216`
- Channel Posts: `32c247d9-a99f-8118-8f92-d254e7522536`
- Beta Users: `32c247d9-a99f-8133-979c-c7b9ce6ebf0a`
- Metrics Dashboard: `32c247d9-a99f-8170-bfce-de8334246617`
- Post Drafts: `32c247d9-a99f-81a6-bb13-dd999197e9f8`
- Feedback Log: `32c247d9-a99f-8127-9335-fa73c32b93f7`
- Reddit Karma Building: `32f247d9-a99f-81cf-8b2d-f336b80f422a`
- Karma Building DB: `32f247d9-a99f-8000-9be4-c939bb1ef690` (data source: `32f247d9-a99f-805b-928a-000b52e0de73`)

### Step 2: Assess Phase & Progress

**Current phase structure (as of Apr 2, 2026):**

| Phase | Description | Gate |
|-------|-------------|------|
| Phase 0 | Karma Building via Daily Karma Runs | Until 100+ karma |
| Phase 1 | First Feedback Posts (r/daddit, r/Parenting, r/SideProject) | Until engagement reviewed |
| Phase 2 | Launch Week (Blog, HN, Reddit) | After Phase 1 checkpoint |
| Phase 3 | Product Hunt + Amplify | After Phase 2 |
| Phase 4 | Engage & Iterate | Ongoing |

Determine:
- Which phase we're currently in (based on karma level and date)
- Whether any phase gate has been met (e.g., karma reached 100+)
- Days remaining in current phase estimate
- Whether dates need adjusting

### Step 3: Update Notion — Launch HQ Page (MANDATORY)

**ALWAYS update the Launch HQ page on every /launch-status run.** This is the user's at-a-glance dashboard — it must reflect the latest status, metrics, and next actions. Never skip this step, even for minor updates.

First, read the current Launch HQ page to get all block IDs:
```
mcp__notion__API-get-block-children(block_id: "32c247d9-a99f-8188-b169-eacfdc48c057")
```

Then update ALL of the following sections. Use the block IDs from the page read — do not hardcode IDs (they may change if the page is reorganized).

#### A. Intro line (first paragraph, italic)
Update `Last updated: [today's date]`.

#### B. Target launch date paragraph
Block `32c247d9-a99f-8195-b127-e0d0901b6f97` — update with current target dates and phase status.

#### C. CURRENT STATUS section (all blocks between "━━━ CURRENT STATUS ━━━" and the next section)
Update every block in this section:
- **Phase:** Current phase number, name, and whether previous phase gate was cleared
- **Reddit karma:** Current karma level, target, cleared status, account age
- **Quora:** Current status (update if changed)
- **Content ready:** Update with latest content prep status
- **Blockers:** Current blockers or "None" with context

#### D. PHASE TIMELINE section
Update each phase line with:
- Current dates and gate status
- Status emoji: ✅ COMPLETE / 🟢 Active / 🟡 Prep starting / ⚪ Pending

#### E. KEY METRICS section
Update the Reddit karma bullet with current karma level and gate status.

#### F. NEXT STEPS section (all bulleted items)
Replace with current, actionable next steps organized by timeframe:
- **TODAY:** Single most important action
- **DAILY:** Recurring daily actions for this phase
- **THIS WEEK:** Key deliverables for the current week
- **NEXT MILESTONE:** What triggers the next phase transition

#### G. Karma Building summary (bottom of page, before child pages)
Update the summary paragraph with current karma status and strategy.

#### H. Launch Roadmap strategy update
Block `32e247d9-a99f-8181-95e0-e5534a53d7a2` — update with `[DATE] latest strategy note`.

#### I. Karma Building child page
Block `336247d9-a99f-81ea-9ec3-c6e75ed250ed` — update current karma level and gate status.

**API format:** Use `mcp__notion__API-update-a-block` with the block type at the top level (NOT nested in `type`):
```
# For paragraphs:
paragraph: {"rich_text": [{"type": "text", "text": {"content": "..."}}]}

# For bold labels:
paragraph: {"rich_text": [
  {"type": "text", "text": {"content": "Label: "}, "annotations": {"bold": true}},
  {"type": "text", "text": {"content": "value"}}
]}

# For bulleted lists:
bulleted_list_item: {"rich_text": [...]}
```

### Step 4: Present Status Report

Output a concise status report in this format:

```
## Launch Status — [DATE]

**Current phase:** Phase N — [Name]
**Reddit karma:** X / 100 target
**Account age:** ~N weeks
**Days in current phase:** N

### Progress
- [x] Completed item
- [x] Completed item
- [ ] Pending item

### Blockers
- [Any blockers or risks]

### Next Steps (this week)
1. [Specific, actionable next step]
2. [Specific, actionable next step]
3. [Specific, actionable next step]

### Key Dates
| Phase | Est. Date | Status |
|-------|-----------|--------|
| Phase 0 complete | Apr 27 | [On track / At risk / Blocked] |
| Phase 1 start | Apr 28 | [Pending Phase 0] |
| Phase 2 (Launch) | May 12 | [Pending] |
| Phase 3 (PH) | May 19 | [Pending] |
```

### Step 5: Update Memory (if significant changes)

If the launch timeline has shifted significantly or a phase gate has been reached, update the project memory at `/home/greg/.claude/projects/-home-greg-projects-beanies-family/memory/project_launch_plan.md` with the new status.

---

## Prep Tasks Checklist

Track these across phases — report on uncompleted items:

**Content (Phase 1 prep):**
- [ ] Blog post: "Why I built beanies.family" (founder story)
- [ ] Blog post: "How our family manages money together" (use case)
- [ ] 4-6 polished app screenshots (dashboard, family page, mobile, dark mode)
- [ ] 60-second Loom walkthrough video
- [ ] Open Graph / social share image (1200x630)

**Technical (Phase 2 prep — Claude tasks):**
- [ ] Landing page with beta signup CTA
- [ ] Referral source tracking (?ref= URL params)
- [ ] SEO meta tags and Open Graph images

**Accounts (Phase 2 prep):**
- [ ] Hacker News account
- [ ] Product Hunt account
- [ ] Buffer account
- [ ] Join 3-5 Facebook groups (family/parenting focused)

**Post Drafts (Phase 1 prep):**
- [x] r/daddit feedback post (v2, saved in Post Drafts)
- [ ] r/Parenting variant
- [ ] r/SideProject / Indie Hackers variant
- [ ] Show HN draft
- [ ] Product Hunt listing draft

---

## Rules

- **ALWAYS update Launch HQ.** Every single /launch-status run must update the Launch HQ page in Notion with the latest status, metrics, and next steps. This is the user's at-a-glance dashboard — if it's stale, the skill has failed.
- **Read before writing.** Always `get-block-children` on Launch HQ first to get current block IDs and see what needs changing.
- **Be concise.** The status report should be scannable in 30 seconds.
- **Be honest about timeline.** If karma building is slower than expected, say so and adjust dates.
- **Next steps must be specific and actionable.** Not "continue building karma" but "run /karma-run daily, focus on r/AskReddit rising posts, target 2-3 comments per day."
- **Update memory only for significant changes** (phase transitions, major date shifts). Don't update for minor progress.
- **Track prep tasks.** Each status check should flag uncompleted prep items that are becoming time-sensitive for the next phase.
- **Reddit account age is 8 months** (as of Apr 2026). Do not refer to it as "5 weeks" — that was an earlier error.
