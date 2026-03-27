# Plan: Daily Hints & Release Notes System

> Date: 2026-03-27

## Context

beanies.family needs a way to engage users with tips/tricks ("Bean Tips") and inform them about new features ("What's New" release notes). The goal is user education and feature discovery — framed as benefits, not feature lists — in Greg's authentic voice. This increases engagement, reduces "I didn't know it could do that" moments, and makes the app feel alive and personal.

## Design Philosophy

**Voice:** These messages come from Greg — the head beanie developer. The tone matches the blog: conversational, mildly self-deprecating, direct, benefit-first, short. Never corporate. Never AI-slop. Playful but respectful of the user's time.

**Core principle:** Every message answers "why should I care?" before "what is it?"

---

## Two Distinct Systems

### 1. Beanie Tip of the Day (Daily Hints / Tips & Tricks)

**What:** Short, actionable tips that help users get more out of beanies. One sentence of benefit, one sentence of how. Visually distinct from other Nook cards — warm, playful, and welcoming.

**Where they appear:**

```
┌─────────────────────────────────────────────────┐
│  NookGreeting ("good morning, greg")             │
│  FamilyStatusToast (orange gradient bar)         │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐ │
│  │ [beanie      ] 💡 beanie tip of the day  ✕  │ │
│  │ [character   ]                               │ │
│  │ [image       ] you can link transactions     │ │
│  │              │ directly to activities...      │ │
│  │              │                                │ │
│  │              │  [don't show tips] [got it]    │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  NookYourBeans (avatar row)                       │
│  ScheduleCards                                    │
│  ...                                              │
└───────────────────────────────────────────────────┘
```

**Design details:**

- **Position:** Inline card on the Nook page, below FamilyStatusToast, above NookYourBeans
- **Visual distinctiveness:** Warm gradient background (cream to soft peach), NOT plain white like other cards. Top accent stripe with gradient (Sky Silk → Heritage Orange → Terracotta). Subtle dot pattern texture in the background. This makes it visually pop compared to the standard white nook cards.
- **Beanie character:** Left side shows a beanie character image (64px, gently floating animation). Character changes by tip category — father+son for finance, family hugging for family, covering-eyes beanie for security, celebrating beanie for planner.
- **Label:** "beanie tip of the day" in Outfit `text-xs` font-weight 700, Heritage Orange color.
- **Lightbulb:** Animated gentle pulse on the 💡 emoji.
- **Typography:** Body text in Inter `text-sm`, message text at 75% opacity.
- **Dark mode:** Dark gradient background (slate tones), same accent stripe, adjusted text opacity.
- **Dismiss animation:** Fades up and collapses (350ms ease-out).
- **"Got it" button:** Orange gradient (Heritage Orange → Terracotta) with subtle shadow — matches the brand CTA style. Not a plain grey button.
- **Two actions:**
  - "Got it" — dismisses this tip, marks it seen, next tip shows tomorrow
  - "Don't show tips" — suppresses all tips permanently (reversible in Settings)

**Behavior:**

- Shows ONE tip per day (checked against `lastTipShownDate`)
- Each tip shown only once (tracked by tip ID in settings)
- Tips rotate through the full library; once all are seen, tips stop (no cycling)
- There should be a LOT of tips — comprehensive coverage of beanies features — so most users never reach the end
- New tips added with every release to keep the library growing
- Tips are contextual where possible (e.g., show the "link transactions to activities" tip only if user has both activities and transactions)
- Never shows during onboarding wizard
- Never shows alongside a release note (release notes take priority on the day of update)

**Content format (in code):**

```typescript
interface BeanTip {
  id: string; // e.g., 'tip-link-transactions'
  message: {
    en: string;
    beanie: string;
  };
  /** Optional: only show if user has this data */
  condition?: (stores: StoreContext) => boolean;
  /** Which feature area this relates to (for help center grouping) */
  category: 'finance' | 'planner' | 'family' | 'security' | 'general';
  /** Route for the "try it →" button — navigates user directly to the relevant page/view.
   *  When present, a compact "try it →" pill appears in the actions row.
   *  When absent (general tips with no specific destination), the button is omitted. */
  tryItRoute?: string;
}
```

**Example tips (in greg's voice):**

| ID                   | Message                                                                                                                                                      | tryItRoute      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `tip-link-txn`       | "you can link transactions directly to activities. that way, when you open piano lessons, you'll see exactly what you've paid — no detective work required." | `/transactions` |
| `tip-recurring`      | "set up recurring transactions once and forget about them. beanies will project them forward so you can see what's coming before it hits."                   | `/transactions` |
| `tip-vacation`       | "planning a trip? the vacation planner breaks it into flights, hotels, and activities — and totals the cost so there are no surprises."                      | `/planner`      |
| `tip-passkey`        | "skip the password next time. set up a passkey in settings and sign in with your fingerprint or face. it's faster and more secure."                          | `/settings`     |
| `tip-member-roles`   | "not all beans need to see the money stuff. set your kids as little beans and they'll only see their activities and to-dos."                                 | `/family`       |
| `tip-offline`        | "beanies works offline. if you lose internet, keep going — your data syncs when you're back."                                                                | —               |
| `tip-dark-mode`      | "night owl? dark mode is in settings. your eyes (and your phone battery) will thank you."                                                                    | `/settings`     |
| `tip-fee-schedule`   | "activities with fees? choose 'each' to pay per session, or 'all' to pay once upfront. beanies tracks either way."                                           | `/planner`      |
| `tip-export`         | "your data is always yours. export your .beanpod file anytime from settings — it's your encrypted backup."                                                   | `/settings`     |
| `tip-budget`         | "set a monthly budget on the dashboard and beanies will show you how you're tracking. green means good. orange means... well."                               | `/dashboard`    |
| `tip-filter-txn`     | "tap the income or expense cards on your dashboard to jump straight to a filtered transaction list. less scrolling."                                         | `/dashboard`    |
| `tip-milestones`     | "track your family's milestones — first day of school, lost teeth, birthdays. the small stuff matters. that's what beanies is for."                          | `/goals`        |
| `tip-multi-currency` | "dealing with multiple currencies? beanies converts everything to your base currency automatically. set your rates in settings."                             | `/settings`     |
| `tip-goal-tracking`  | "set savings goals and watch the progress bar fill up. it's weirdly motivating. trust me."                                                                   | `/goals`        |
| `tip-trust-device`   | "trust this device in settings to skip the password on your everyday devices. still encrypted, just faster."                                                 | `/settings`     |
| `tip-schedule-cards` | "the nook shows today's schedule and the week ahead. one glance to know who needs to be where."                                                              | —               |
| `tip-todo`           | "family to-dos keep everyone on the same page. assign tasks to specific beans and check them off together."                                                  | `/todo`         |
| `tip-net-worth`      | "the dashboard tracks your net worth over time. it adds up everything — accounts, assets, loans — so you don't have to."                                     | `/dashboard`    |
| `tip-beanie-mode`    | "toggle beanie mode in settings for a more casual vibe. all the labels get a little sillier. because why not."                                               | `/settings`     |
| `tip-chinese`        | "beanies speaks Chinese too. switch languages in settings — all labels, tips, and help content translate."                                                   | `/settings`     |

**Storage:**

- `dismissedTips: string[]` — array of tip IDs the user has seen (in Automerge doc per-member, syncs across devices)
- `tipsEnabled: boolean` — global toggle per-member (default `true`)
- `lastTipShownDate: string` — ISO date string, to throttle to once per day

---

### 2. What's New (Release Notes)

**What:** A modal that appears after a PWA update downloads a new version. Shows what changed (3-5 most important items), framed as benefits. Also permanently archived in the Help Center.

**When it appears:**

- Hooks into the existing PWA update mechanism (`usePWA.ts`)
- After the service worker activates a new version AND the page reloads
- Checks `lastSeenVersion` in localStorage against current app version
- If different → show the What's New modal
- User can dismiss; it won't show again for that version

**Modal design:**

```
┌─────────────────────────────────────────────────────┐
│                                                       │
│   🌱 What's New                                  ✕   │
│   ─────────────────────────────────────────────────   │
│                                                       │
│   march 2026                                          │
│                                                       │
│   ┌─────────────────────────────────────────────┐     │
│   │ pay for activities upfront      [try it →]  │     │
│   │ set a single fee that covers all sessions.  │     │
│   │ no more tracking individual payments for    │     │
│   │ piano lessons — one transaction, done.      │     │
│   └─────────────────────────────────────────────┘     │
│   ┌─────────────────────────────────────────────┐     │
│   │ tap to filter transactions      [try it →]  │     │
│   │ tap the income or expense card on your      │     │
│   │ dashboard and jump straight to a filtered   │     │
│   │ list. less scrolling, more finding.         │     │
│   └─────────────────────────────────────────────┘     │
│   ┌─────────────────────────────────────────────┐     │
│   │ links on travel segments        [try it →]  │     │
│   │ add booking confirmation URLs to flights,   │     │
│   │ hotels, and car rentals. everything in      │     │
│   │ one place when you need it.                 │     │
│   └─────────────────────────────────────────────┘     │
│                                                       │
│   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│   also fixed                                          │
│   • time picker scrolls to your selection             │
│   • all dates now show as "25 Mar 2026"               │
│   • 12-hour time format everywhere                    │
│                                                       │
│   ─────────────────────────────────────────────────   │
│                                                       │
│         [  See all release notes  ]                   │
│         [      Got it, thanks     ]  ← primary btn    │
│                                                       │
│   — greg, head beanie developer 🫘                     │
│                                                       │
└─────────────────────────────────────────────────────┘
```

**Design details:**

- **Modal:** Uses `BaseModal` (Tier 1 — not a form), size `lg`, `fullscreenMobile`
- **Background:** Cloud White body, subtle gradient top strip (Heritage Orange → Terracotta, 3px)
- **Header:** Sprout emoji + "What's New" in Outfit `text-lg` semibold
- **Version label:** Month/year in Outfit `text-xs` lowercase tracking-wide, 40% opacity
- **Feature entries:** Each is a rounded card (`rounded-2xl`, Cloud White bg) with:
  - Title: Outfit `text-sm` font-semibold, lowercase, tracking-wide
  - Description: Inter `text-sm`, regular weight, lowercase (capital "I" only), muted color (55% opacity)
  - **"try it →" button:** Top-right of each feature card. Orange text on tinted orange bg (`tint-orange-8`), `rounded-xl`. Clicking dismisses the modal and navigates to the relevant page/view. Arrow shifts right on hover.
  - 2-3 short sentences max per entry. 3-5 entries max per release.
- **Bug fixes:** Collapsed into a lighter "also fixed" section with bullet points, smaller text, lowercase
- **Signature:** "— greg, head beanie developer 🫘" right-aligned, Outfit italic `text-xs`
- **Actions:**
  - "See all release notes" — text link, navigates to Help Center > What's New
  - "Got it, thanks" — primary button (orange gradient), dismisses modal
- **Scrollable:** Body scrolls if content exceeds viewport (important for mobile)

**Content format (in code):**

```typescript
interface ReleaseNote {
  version: string; // date-based, e.g., '2026.03'
  date: string; // ISO date
  month: string; // Display label, e.g., 'March 2026'
  features: {
    title: { en: string; beanie: string };
    description: { en: string; beanie: string };
    icon?: string; // Optional emoji
    /** Route for "try it →" button — navigates user directly to the feature */
    tryItRoute?: string; // e.g., '/planner', '/dashboard', '/settings'
  }[];
  fixes?: {
    text: { en: string; beanie: string };
  }[];
  /** New tips introduced in this release (added to the tip library) */
  newTipIds?: string[];
  signature?: string; // Default: '— greg, head beanie developer 🫘'
}
```

**Storage:**

- `lastSeenVersion: string` — in localStorage (not Automerge — device-specific, since updates happen per-device)
- Release notes content lives in `src/content/release-notes/` as TypeScript files

---

### 3. Help Center Integration: "What's New" Category

**New help center category:**

```typescript
{
  id: 'whats-new',
  labelKey: 'help.category.whatsNew',
  descriptionKey: 'help.category.whatsNewDesc',
  icon: '🌱',
  color: 'primary',  // Heritage Orange
}
```

- Added as the FIRST category in `HELP_CATEGORIES` (most relevant to returning users)
- Each release note auto-generates a help article with the same content as the modal
- Articles titled by month: "What's New — March 2026", "What's New — February 2026"
- Sorted reverse-chronologically
- Same article structure as existing help content (headings, paragraphs, callouts, lists)
- Searchable via the existing help center search
- Users who missed a release note or want to go back can find them here
- New users can browse the full history to see when features were added

**Help Center layout with new category:**

```
Help Center
├── 🌱 What's New          ← NEW (release notes archive)
├── 🚀 Getting Started
├── ✨ Features
├── 🔒 Security
└── ⚙️ How It Works
```

---

## Architecture Summary

```
src/
├── content/
│   ├── help/
│   │   ├── whats-new.ts           ← Auto-generated from release notes
│   │   └── ...existing...
│   ├── release-notes/
│   │   ├── types.ts               ← ReleaseNote, BeanTip interfaces
│   │   ├── index.ts               ← Export functions (getLatest, getAll, etc.)
│   │   ├── 2026.03.ts             ← Release note content (date-based)
│   │   └── ...
│   └── tips/
│       ├── index.ts               ← Tip selection, shuffle/filter logic
│       └── tips.ts                ← Tip definitions (comprehensive library)
├── components/
│   ├── nook/
│   │   └── BeanTipCard.vue        ← Inline tip card for Nook page
│   └── common/
│       └── WhatsNewModal.vue      ← Release notes modal
├── composables/
│   ├── useBeanTips.ts             ← Tip selection, dismiss, daily tracking
│   └── useWhatsNew.ts            ← Version check, modal trigger
└── pages/
    └── FamilyNookPage.vue         ← Add BeanTipCard slot
```

**Data flow:**

```
PWA update detected
  → Page reloads with new SW
  → useWhatsNew() checks localStorage.lastSeenVersion vs APP_VERSION
  → If different → show WhatsNewModal
  → On dismiss → update lastSeenVersion

User opens Nook
  → useBeanTips() checks: tipsEnabled? onboarding done? no release note showing? different day from last tip?
  → Picks next unseen tip (filtered by conditions)
  → Shows BeanTipCard
  → On "Got it" → add to dismissedTips, collapse card
  → On "Don't show tips" → set tipsEnabled = false (reversible in Settings)
```

---

## Version Tracking

**Date-based versioning:** `YYYY.MM` (e.g., `2026.03`)

1. Set version in `package.json` (e.g., `"version": "2026.03"`)
2. Expose at build time via Vite's `define` config: `__APP_VERSION__`
3. Bump with each release
4. Compare against `localStorage.lastSeenVersion` on app load

---

## Files Affected

### New files:

- `src/content/release-notes/types.ts`
- `src/content/release-notes/index.ts`
- `src/content/release-notes/2026.03.ts` (first release note)
- `src/content/tips/index.ts`
- `src/content/tips/tips.ts`
- `src/components/nook/BeanTipCard.vue`
- `src/components/common/WhatsNewModal.vue`
- `src/composables/useBeanTips.ts`
- `src/composables/useWhatsNew.ts`
- `src/content/help/whats-new.ts`

### Modified files:

- `src/pages/FamilyNookPage.vue` — add BeanTipCard between greeting and status toast
- `src/content/help/categories.ts` — add "What's New" category (first position)
- `src/content/help/types.ts` — add `'whats-new'` to HelpCategory union
- `src/content/help/index.ts` — import whats-new articles
- `src/services/translation/uiStrings.ts` — add i18n strings for tips, release notes, help category
- `src/App.vue` — mount WhatsNewModal (global, shows on version change)
- `vite.config.ts` — define `__APP_VERSION__`
- `package.json` — set date-based version

---

## Content Strategy

### Writing guidelines for tips & release notes:

1. **Lowercase style** — all text is lowercase except "I" (standard convention) and proper nouns where omitting capitalization would hurt clarity (e.g., "Chinese", "Google Drive"). When in doubt, lowercase.
2. **Lead with the benefit**, not the feature name
3. **One thought per sentence.** Two sentences per tip. Three max per release note entry.
4. **Use "you" and "your"** — it's about them, not us
5. **Concrete examples** over abstract descriptions ("piano lessons" not "activities")
6. **Humor is welcome** but never at the expense of clarity
7. **No jargon** — "encrypted backup" not "AES-256-GCM encrypted beanpod envelope"
8. **End release notes with signature** — "— greg, head beanie developer 🫘"
9. **Every tip has a quiet exit** — never nag, always let users turn it off
10. **Add new tips with every release** — keep the library growing so users rarely run out

### Tone spectrum:

```
Corporate ←──────────────────────────→ Meme
                        ↑
                   Greg's voice
                   (conversational,
                    direct, slightly
                    irreverent, warm)
```

---

## Decisions Made

| Question           | Decision                                                                        |
| ------------------ | ------------------------------------------------------------------------------- |
| Tip frequency      | Once per day (unless permanently dismissed)                                     |
| Version scheme     | Date-based: `YYYY.MM` (e.g., `2026.03`)                                         |
| Tip cycling        | Stop when all seen; but library should be large enough users rarely hit the end |
| Release note size  | 3-5 most important features + 3-5 critical fixes                                |
| "Learn more" links | Deep link to relevant page; help article as fallback                            |
