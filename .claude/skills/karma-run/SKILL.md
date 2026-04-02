---
name: karma-run
description: Daily Reddit karma run — find 3-5 best rising post opportunities, present with comment angles, and log to Notion
---

# karma-run — Daily Reddit Karma Run

Find the 3-5 best Reddit comment opportunities right now and log them to the Notion Karma Building DB. The goal is speed: Greg should be commenting within 10-20 minutes of running this skill.

---

## When to Invoke

- **Via slash command**: `/karma-run`
- When the user asks for a "karma run", "find reddit posts to comment on", or similar

---

## Workflow

### Step 1: Fetch Rising Posts

Use `curl` with the Reddit JSON API to fetch rising/new posts from these subreddit groups:

```bash
# HIGH KARMA potential (large audiences, viral potential)
curl -s -H "User-Agent: beanies-karma-run/1.0" \
  "https://old.reddit.com/r/AskReddit/rising/.json?limit=25"

# TARGET COMMUNITY (builds local reputation in subs we'll eventually post in)
curl -s -H "User-Agent: beanies-karma-run/1.0" \
  "https://old.reddit.com/r/daddit+Parenting+personalfinance/rising/.json?limit=15"

# TECH / MAKER (authentic expertise)
curl -s -H "User-Agent: beanies-karma-run/1.0" \
  "https://old.reddit.com/r/LifeProTips+NoStupidQuestions+todayilearned+ExperiencedDevs+webdev/rising/.json?limit=20"
```

Parse each response with Python to extract: title, subreddit, score, num_comments, age in minutes, permalink.

### Step 2: Filter for Best Opportunities

Apply these filters to find the top 3-5 posts:

**Ideal post characteristics:**
- Posted 15 min - 4 hours ago (fresh enough to be early)
- Rising momentum: score > 5 for smaller subs, score > 50 for large subs (r/AskReddit)
- Low comment count relative to score (not yet saturated)
- Topic matches Greg's expertise areas (see below)
- NOT political, controversial, or NSFW

**Greg's expertise areas (filter for these):**
- Parenting 3 boys (ages 5, 7, 9), family logistics, kids' activities
- Solo parenting during wife's business trips (2-3 week stretches)
- Software engineering, IT consulting, vibe coding with AI
- Personal finance, family budgeting, multi-currency (lives in Hong Kong)
- Entrepreneurship, building side projects, startup experience
- General dad life, work-life balance, working parents
- Tech industry opinions, career advice
- Universal human experiences (food, memories, humor)

**Scoring heuristic:**
- Posts in target community subs (r/daddit, r/Parenting) get priority even with lower scores
- r/AskReddit posts with < 100 comments and > 100 score are ideal (riding the wave early)
- LPT/TIL posts with < 10 comments and rising score are high-value
- Any post where Greg has a unique angle (dad of 3, HK expat, IT consultant) scores higher

### Step 3: Present Opportunities

For each of the top 3-5 posts, present:

```
### 1. r/SubredditName — "Post Title"
**[Score pts, N comments, Xm old]**
https://reddit.com/r/subreddit/comments/id/slug/

**Why this is a good opportunity:** [1 sentence — why it's rising, why the comment count is good]
**Comment angle:** [2-3 sentences — the angle Greg should take, NOT a full draft. Greg writes in his own voice.]
```

End with a recommendation of which 2-3 to prioritize.

### Step 4: Log to Notion Karma Building DB

After presenting the opportunities, add each one to the Notion Karma Building DB.

**Database details:**
- Database ID: `32f247d9-a99f-8000-9be4-c939bb1ef690`
- Parent page: `32f247d9-a99f-81cf-8b2d-f336b80f422a` (Reddit Karma Building)

**Use `mcp__notion__API-post-page`** to create each entry with:

```json
{
  "parent": { "database_id": "32f247d9-a99f-8000-9be4-c939bb1ef690" },
  "properties": {
    "Name": { "title": [{ "text": { "content": "<post title truncated to 80 chars>" } }] },
    "Subreddit": { "select": { "name": "r/<subreddit>" } },
    "Link": { "url": "<full reddit URL>" },
    "Draft Comment": { "rich_text": [{ "text": { "content": "<the comment angle suggestion>" } }] },
    "Posted": { "checkbox": false },
    "Tier": { "select": { "name": "<tier>" } }
  }
}
```

**Tier mapping:**
- r/AskReddit, r/todayilearned, r/LifeProTips with high momentum → "1 - High ROI"
- r/daddit, r/Parenting, r/personalfinance, r/ExperiencedDevs → "2 - Strong"
- Everything else → "3 - Quick Win"

**Subreddit select options** (existing in the DB — add new ones as needed):
r/ExperiencedDevs, r/technology, r/personalfinance, r/programming, r/LifeProTips, r/NoStupidQuestions, r/todayilearned, r/mildlyinfuriating, r/webdev, r/Showerthoughts, r/mildlyinteresting, r/AskReddit, r/pics, r/AskParents, r/SideProject, r/daddit, r/Parenting

### Step 5: Summary

End with:
- Total opportunities logged: N
- Reminder: "Mark 'Posted' checkbox in Notion after commenting"
- Current karma status if the user mentions it

---

## Rules

- **SPEED IS EVERYTHING.** The whole point is to get Greg commenting on fresh posts. Don't over-analyze — present good-enough opportunities fast.
- **No full draft comments.** Only provide an angle/hook. Greg writes in his own voice.
- **No links, no app mentions, no self-promotion** in any suggested comment angles. This is pure karma building.
- **Mix subreddits:** Always include at least 1 high-karma sub AND 1 target community sub.
- **Skip posts that are:** political/partisan, NSFW, already saturated (100+ comments on small subs), too old (6+ hours), or topics Greg has no authentic angle on.
- **If Reddit API fails:** Fall back to WebSearch or suggest Greg check `reddit.com/r/daddit+AskReddit+Parenting/rising/` manually.
- **Log to Notion every time.** This creates a trackable history of karma building efforts.
