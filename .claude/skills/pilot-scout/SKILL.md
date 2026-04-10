---
name: pilot-scout
description: Scour the internet for people asking about family/financial planning apps — find potential pilot users for beanies.family and log opportunities to Notion
---

# pilot-scout — Find Potential Pilot Users

Scour the internet across multiple platforms for people actively looking for family finance, budgeting, or family planning apps. Find 5-8 of the best opportunities where greg can introduce beanies.family, get feedback, and recruit early users. Log everything to the Notion Pilot Scouting DB.

---

## When to Invoke

- **Via slash command**: `/pilot-scout`
- When the user asks to "find pilot users", "scout for users", "find people looking for our app", or similar

---

## Workflow

### Step 1: Search Across Platforms

Use **WebSearch** to run targeted queries across multiple platforms. Run ALL search groups in parallel for speed.

**Search query templates** (adapt and combine — run at least 8-10 searches):

```
# Reddit — direct app requests
"looking for" family budget app site:reddit.com
"recommend" family finance app site:reddit.com
"alternative to" YNAB OR Mint OR Monarch site:reddit.com
"need an app" family budget OR household budget site:reddit.com
"best app for" couples budget OR family finances site:reddit.com 2026
"self-hosted" budget OR finance app site:reddit.com
"privacy" budget app OR finance app site:reddit.com

# Hacker News — builders and early adopters
"Ask HN" budget app OR family finance site:news.ycombinator.com
"Show HN" budget OR family finance site:news.ycombinator.com
family finance app site:news.ycombinator.com 2026

# Product Hunt — app discovery
family budget OR family finance site:producthunt.com 2026
budgeting app launch site:producthunt.com

# Twitter/X — real-time requests
"looking for" family budget app site:twitter.com OR site:x.com
"anyone know" budget app family site:twitter.com OR site:x.com
"need a" budgeting app site:twitter.com OR site:x.com 2026

# Indie Hackers — founder community
family finance OR budget app site:indiehackers.com
personal finance app feedback site:indiehackers.com

# Quora — question-based
best family budgeting app site:quora.com
family finance planning app recommendation site:quora.com

# Ask MetaFilter — high-quality Q&A
budget app OR finance app site:ask.metafilter.com

# Facebook — groups (limited external search but try)
"family budget" app recommendation site:facebook.com

# BetaList / AlternativeTo — app seekers
family budget site:betalist.com OR site:alternativeto.net
alternative to YNAB OR Mint site:alternativeto.net

# Niche forums & blogs
"looking for" family budget app forum OR community
"switched from" YNAB OR Mint "looking for" alternative 2026
"local first" OR "offline" budget app OR finance app
"privacy focused" family finance app
```

**Target subreddits** (if using Reddit JSON API as fallback):
- r/personalfinance, r/FinancialPlanning, r/povertyfinance, r/Budget
- r/YNAB, r/Mintuit (displaced Mint users)
- r/Parenting, r/daddit, r/Mommit, r/workingmoms
- r/selfhosted, r/degoogle, r/privacy, r/PrivacyGuides
- r/SideProject, r/startups, r/EntrepreneurRideAlong
- r/androidapps, r/iOSapps (app recommendation requests)
- r/AusFinance, r/UKPersonalFinance, r/EUPersonalFinance (international)

### Step 2: Filter for Best Opportunities

From all search results, identify the 5-8 best opportunities.

**Ideal opportunity characteristics:**
- Person is **actively asking** for an app recommendation or expressing frustration with existing apps
- **Fresh enough to reply to** — platform-specific freshness rules:
  - Reddit: < 7 days old (strongly prefer < 48h)
  - Hacker News: < 10 days old (HN locks comments after ~14 days, sometimes sooner — don't cut it close)
  - Twitter/X: < 3 days old (fast-moving, older tweets get no engagement)
  - Quora: any age OK (evergreen, answers always accepted)
  - Forums: must have recent activity (replies within last 2 weeks)
- The post has **engagement** (upvotes, comments, likes) — signals others have the same need
- The platform allows **replies or comments** (skip read-only articles/listicles)
- The person's needs **align with what beanies.family offers**: family-focused, privacy-first, local-first, multi-currency, offline-capable, free, no ads
- NOT an old archived thread, locked post, or a competitor promoting their own app
- **NOT already in the Notion database** — check before suggesting

**beanies.family strengths to match against (filter for these pain points):**
- "I want something private / no cloud required / self-hosted"
- "I need multi-currency support" (expats, international families)
- "Mint shut down and I need an alternative"
- "YNAB is too expensive / too complex"
- "I want something for the whole family, not just me"
- "I want offline support / PWA"
- "I don't want my financial data on someone else's server"
- "I need something simple for family budgeting"
- "Looking for something open / transparent / indie"

**Scoring heuristic:**
- **Direct app request** ("looking for an app that...") → highest priority
- **Frustration with competitor** ("YNAB pricing is insane", "Mint replacement?") → high priority
- **Privacy/self-hosted ask** → high priority (our strongest differentiator)
- **General finance discussion** where app rec would be natural → medium priority
- **Old post (>7 days) but highly upvoted** → include if still accepting comments
- **Twitter/X posts** → high priority if recent (real-time engagement)
- **Hacker News** → high priority (technical early adopters love local-first)

**Platform priority order:**
1. Reddit (highest volume of app requests)
2. Hacker News (technical early adopters, love privacy-first/local-first)
3. Twitter/X (real-time, direct engagement)
4. Indie Hackers (founders who give great feedback)
5. Product Hunt (app discovery mindset)
6. Quora / Ask MetaFilter (long-tail, evergreen questions)
7. Facebook / AlternativeTo / BetaList (supplemental)

### Step 3: Present Opportunities

For each of the top 5-8 opportunities, present:

```
### 1. [Platform] — "Post/Question Title"
**[Engagement stats, Age, Platform-specific metrics]**
Link: <clickable URL>

**What they're asking for:** [1-2 sentences — what this person needs]
**Why beanies fits:** [1 sentence — which beanies.family feature directly addresses their need]
**Reply angle:** [2-3 sentences — how greg should frame the introduction. Should feel genuine, helpful, not spammy. Lead with empathy or humor, mention beanies naturally.]
```

**Reply angle guidelines:**
- **Lead with value**, not a pitch. Answer their question first, then mention beanies as "something I've been building"
- **Be genuine** — greg is a dad of 3 who built this for his own family. That's the authentic angle.
- **Humor welcome** — if the post tone is casual, match it. "I literally built an app for this because I was tired of spreadsheets" works great.
- **Platform-appropriate tone:**
  - Reddit: casual, helpful, self-deprecating humor ok. Mention being an indie dev.
  - HN: technical, focus on local-first/CRDT/privacy architecture. HN loves technical depth.
  - Twitter: punchy, direct. Link to the app.
  - Indie Hackers: founder-to-founder. Share the journey, ask for feedback.
  - Quora: thorough answer first, then mention beanies as one option among many.
  - Product Hunt: product-focused, feature highlights.
- **NEVER sound like a bot or marketer.** No "Check out our amazing app!" energy.
- **Always invite feedback** — "would love your thoughts" or "still in early days, looking for feedback"

End with a prioritization recommendation: which 2-3 to reply to first (freshest + highest engagement + best fit).

### Step 4: Log to Notion Pilot Scouting DB

After presenting the opportunities, add each one to the Notion Pilot Scouting database.

**Database details:**
- Database name: "Pilot User Targeted Search"
- Database ID: `339247d9-a99f-80d7-a617-e449fb26bf62`
- Parent page: Pilot User Targeted Search page under Launch HQ

**Use `mcp__notion__API-post-page`** to create each entry with:

```json
{
  "parent": { "database_id": "339247d9-a99f-80d7-a617-e449fb26bf62" },
  "properties": {
    "Post Title": { "title": [{ "text": { "content": "<platform: post title truncated to 80 chars>" } }] },
    "Sub": { "select": { "name": "<platform name>" } },
    "Post Link": { "url": "<full URL>" },
    "Post Detail": { "rich_text": [{ "text": { "content": "<what they need + reply angle suggestion>" } }] },
    "Notes": { "rich_text": [{ "text": { "content": "<fit score + notes>" } }] },
    "Status": { "select": { "name": "Found" } },
    "Posted?": { "checkbox": false },
    "Date": { "date": { "start": "<YYYY-MM-DD>" } },
    "Type": { "select": { "name": "Opportunity" } }
  }
}
```

**Platform (Sub) select options:**
Reddit, Hacker News, Twitter/X, Product Hunt, Indie Hackers, Quora, Ask MetaFilter, Facebook, AlternativeTo, BetaList, MoneySavingExpert, Other

**Fit Score (in Notes field):**
- **"A - Perfect Fit"**: Person's needs directly match beanies.family features (privacy, family, multi-currency, offline)
- **"B - Strong Fit"**: Person is looking for a budgeting/family app, beanies covers most needs
- **"C - Worth a Shot"**: General finance discussion where beanies could be mentioned naturally

### Step 5: Summary

End with:
- Total opportunities found: N (breakdown by platform)
- Top 3 to reply to NOW (freshest, highest fit)
- Any emerging patterns ("lots of people asking about Mint alternatives this week", "privacy-focused requests are trending")
- Reminder: "Mark 'Replied' checkbox in Notion after responding"

---

## Rules

- **BREADTH MATTERS.** Search across as many platforms as practical. Don't just do Reddit — the whole point is multi-platform scouting.
- **FRESHNESS IS CRITICAL.** Prioritize posts from the last 48 hours. Include posts up to 7 days old only if they're still active and accepting comments. **Hard cutoffs by platform:**
  - **Hacker News:** NEVER suggest posts older than 10 days. HN locks comments after ~14 days (sometimes sooner). If a post is close to the limit, skip it — greg can't reply to a locked thread.
  - **Reddit:** Posts older than 6 months are archived. Prefer posts < 7 days old.
  - **Quora:** Evergreen — answers accepted indefinitely. Older posts are OK here.
  - **Ask MetaFilter:** Check if thread is still open. Older threads may be closed.
  - **Forums (MoneySavingExpert, etc.):** Check if thread is still active (recent replies). Skip dead threads.
- **NEVER SUGGEST DUPLICATE LINKS.** Before presenting any opportunity, check the Notion Pilot Scouting DB (`339247d9-a99f-80d7-a617-e449fb26bf62`) for existing entries. Query with `mcp__notion__API-query-data-source` or `mcp__notion__API-post-search` to see what's already been logged. Skip any URL that already appears in the database. This is a hard rule — greg has likely already seen and acted on (or dismissed) previous entries.
- **NO SPAM ENERGY.** Reply angles must feel like a genuine person sharing something they built, not a marketer. greg's authentic story (dad of 3, built it for his own family, privacy-focused) is the pitch.
- **LEAD WITH EMPATHY.** Every reply angle should start by addressing the person's actual problem before mentioning beanies.
- **INVITE FEEDBACK.** Always suggest greg ask for feedback — this is about finding pilot users who will help shape the product, not just acquiring users.
- **SKIP:** Locked/archived threads, competitor marketing posts, posts where self-promotion would be inappropriate or against sub rules, and any posts that are just competitors promoting their own apps (not real users asking for help).
- **Reddit via API, not WebSearch.** WebSearch cannot access reddit.com (blocked by Anthropic crawler). Always use `curl` with the Reddit JSON API (`old.reddit.com/.../.json`) for Reddit searches.
- **If WebSearch returns thin results:** Try alternative query phrasings, check Reddit JSON API directly via curl, or suggest greg check specific communities manually.
- **Log to Notion every time.** This creates a trackable pipeline of pilot user outreach.
- **Track patterns.** Note what people are consistently asking for — this feeds back into product development.
