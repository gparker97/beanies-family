---
name: beanies-help-docs
description: Create, review, and maintain beanies.family Help Center articles — how-to guides, explainers, and reference docs
---

# beanies-help-docs — Help Center Article Creator & Reviewer

This skill creates and maintains articles for the beanies.family Help Center. It produces documentation that is welcoming, clear, precise, and genuinely helpful — written in the beanies voice.

---

## When to Invoke

- **Via slash command**: `/beanies-help-docs`
- When the user asks to write, review, update, or audit help center content
- When a new feature ships and needs documentation

---

## Core Philosophy

The beanies.family help center exists because **no one should feel lost managing their family's finances**. Every article is written for a real person — a parent, a partner, a family member — who wants to do something and wants to understand how. They are not developers. They are not accountants. They are people who care about their family.

### Guiding Principles

1. **User-first, always.** Every sentence answers "why does this matter to me?" before "how does it work?"
2. **Precise over brief.** Never skip a step to save space. A user stuck at step 3 because you skipped step 2 is worse than a slightly longer article.
3. **Warm, not patronising.** The beanies voice is friendly and encouraging — like a helpful friend, not a corporate FAQ.
4. **No jargon.** If a technical term is unavoidable, explain it inline. Assume the reader has never used a finance app before.
5. **Show the benefit.** Every article starts by explaining *why this feature exists* and *what the user gains* from using it.

---

## Article Types

Every help center article has a **type** that shapes its structure and tone. The type must be clearly identifiable to the reader.

### How-To

A **how-to** article answers: *"How do I do this specific thing?"*

- **Purpose:** Step-by-step instructions to complete a task
- **Tone:** Direct, encouraging, action-oriented
- **Structure:** Brief context → why this matters → numbered steps → tips/gotchas
- **Rules:**
  - Get to the steps quickly — context should be 1–2 short paragraphs max
  - Every step is a single, concrete action the user can perform
  - Never skip steps. If clicking a button opens a modal, say so. If a field has a default, mention it.
  - Use the exact labels, button names, and menu items from the UI (wrap in `<strong>`)
  - Include screenshots descriptions or callouts for anything non-obvious
  - End with a "What's next?" or related articles pointer

### Explainer

An **explainer** article answers: *"What is this and why should I care?"*

- **Purpose:** Help the user understand a concept, feature, or system behaviour
- **Tone:** Conversational, clear, engaging — like explaining to a curious friend
- **Structure:** What it is → why it exists → how it works (user-focused) → practical implications
- **Rules:**
  - Focus on *what the user experiences*, not implementation details
  - Use analogies and concrete examples wherever possible
  - Break complex topics into digestible sections with clear headings
  - If a concept affects the user's data or money, be extra clear about the implications
  - Always tie back to the user's benefit: "This means your data is safe even if..."

### Reference

A **reference** article answers: *"What are all the options/values/settings for this?"*

- **Purpose:** Comprehensive lookup for configuration, categories, statuses, or field definitions
- **Tone:** Clear, scannable, structured — the user is looking up something specific
- **Structure:** Brief intro → organised tables or lists → notes on edge cases
- **Rules:**
  - Optimise for scanning — use tables, definition lists, and consistent formatting
  - Every item should have a brief explanation of what it does and when to use it
  - Group related items logically
  - Include defaults and common configurations

### Troubleshooting

A **troubleshooting** article answers: *"Something isn't working — what do I do?"*

- **Purpose:** Help the user diagnose and resolve a specific problem
- **Tone:** Calm, reassuring, solution-focused — the user is probably frustrated
- **Structure:** Symptom description → likely causes → step-by-step fix → prevention tips
- **Rules:**
  - Lead with the symptom so the user can quickly confirm they're in the right article
  - Offer the most common fix first, then alternatives
  - Be honest about limitations (e.g., "There is no password recovery — by design")
  - Include "If this doesn't help" guidance

---

## Article Structure Requirements

Every article, regardless of type, must include:

### 1. Why This Exists (opening paragraph)
One or two sentences explaining why this feature/concept exists and what problem it solves for the user. This is not optional — it anchors the entire article.

### 2. What You'll Get / Why You'd Use This
A brief statement of the benefit: "By the end of this guide, you'll have..." or "Understanding this helps you..."

### 3. The Core Content
The steps (how-to), explanation (explainer), reference table (reference), or fix (troubleshooting).

### 4. Callouts for Gotchas
Use `callout` sections for:
- Things that can't be undone (e.g., password loss)
- Common mistakes or confusion points
- Security implications
- Important defaults the user should know about

### 5. Related Articles / What's Next
Point the user to logical next steps or related articles.

---

## Writing in the beanies Voice

### Do
- "Your pod is like a family vault — everything inside is encrypted and only your family can open it."
- "Head to the Piggy Bank section and tap Accounts."
- "That's it! Your new account is ready to track."
- "Don't worry — you can always change this later in Settings."

### Don't
- "The system persists your data in an encrypted Automerge CRDT document."
- "Navigate to the accounts management interface."
- "Configuration changes can be modified via the Settings module."
- "Please be advised that this action is irreversible."

### Voice Checklist
- [ ] Would a non-technical family member understand every sentence?
- [ ] Does the opening paragraph explain *why* before *how*?
- [ ] Are UI elements referenced by their exact visible labels?
- [ ] Is the tone warm without being condescending?
- [ ] Are there no unexplained acronyms or technical terms?

---

## Technical Format

Articles are TypeScript objects in `src/content/help/`. Follow the existing `HelpArticle` interface:

```typescript
interface HelpArticle {
  slug: string;           // URL-safe identifier (kebab-case)
  category: HelpCategory; // 'getting-started' | 'features' | 'security' | 'how-it-works'
  title: string;          // Clear, concise title
  excerpt: string;        // 1-2 sentence summary for cards and search
  icon: string;           // Single emoji representing the topic
  readTime: number;       // Estimated minutes to read
  sections: ArticleSection[];
  popular?: boolean;      // Show in "Popular Articles" on landing page
  updatedDate: string;    // ISO date of last meaningful update
}
```

### Section Types Available

| Type | Use For |
|------|---------|
| `heading` | Section headers (level 2 or 3). Always include `id` for TOC anchors |
| `paragraph` | Body text. Supports `<strong>`, `<em>`, `<code>` inline HTML |
| `steps` | Numbered step-by-step instructions. Items in `items[]` array |
| `list` | Bullet or numbered lists. Use `ordered: true` for numbered |
| `callout` | Important warnings, tips, or notes. Include `title` and `icon` |
| `infoBox` | Supplementary information boxes. Include `title` and `icon` |
| `codeBlock` | Code snippets (rarely needed in user docs) |

### File Organisation

- Articles live in category files: `getting-started.ts`, `features.ts`, `security.ts`, `how-it-works.ts`
- All articles are re-exported through `src/content/help/index.ts`
- New categories require updates to `types.ts`, `categories.ts`, `index.ts`, and i18n strings

### i18n

- Article content is currently in English directly in the TypeScript files
- Category labels and UI chrome use translation keys via `uiStrings.ts`
- When adding new categories, add corresponding translation keys

---

## Workflow

### When Writing a New Article

1. **Understand the feature.** Read the relevant Vue components, stores, and composables. Understand the user flow end-to-end. Use subagents to explore the codebase if needed.
2. **Identify the article type.** Is the user trying to *do something* (how-to), *understand something* (explainer), *look something up* (reference), or *fix something* (troubleshooting)?
3. **Draft the article** following the type-specific structure above.
4. **Self-review against the checklist:**
   - Does the opening explain why this exists?
   - Is every step precise and complete (for how-tos)?
   - Would a non-technical family member understand it?
   - Are UI labels exact matches to what's on screen?
   - Are gotchas and edge cases called out?
   - Is the tone warm and beanies-appropriate?
5. **Ask questions** if anything is unclear about how the feature works, what the user benefit is, or what edge cases exist. Never guess — ask.
6. **Present the article** to the user for review before committing.

### When Reviewing the Help Center (Audit Mode)

When invoked without a specific article request, perform a comprehensive review:

1. **Inventory existing articles.** Read all files in `src/content/help/` and list every article with its category, type, and coverage.
2. **Map the app's features.** Use subagents to explore the codebase — identify all pages, major features, user flows, and functionality.
3. **Gap analysis.** Compare the feature map against existing articles. Identify:
   - Features with no documentation
   - Complex features with only basic coverage
   - Common user journeys that aren't documented end-to-end
   - Potential confusion points or pitfalls without guidance
   - Missing troubleshooting articles for known edge cases
4. **Quality review.** For each existing article, check:
   - Accuracy: Does it match the current UI and behaviour?
   - Completeness: Are steps missing or outdated?
   - Voice: Does it follow the beanies tone?
   - Structure: Does it follow the type-specific format?
5. **Present findings** as a prioritised list of recommendations:
   - **Missing articles** (with proposed title, type, and brief scope)
   - **Articles needing updates** (with specific issues found)
   - **Quality improvements** (tone, structure, completeness)
6. **Ask for direction** before writing anything. Let the user prioritise.

---

## Categories and Their Scope

| Category | Slug | Covers |
|----------|------|--------|
| Getting Started | `getting-started` | First-time setup, onboarding, initial configuration |
| Features | `features` | How to use specific features (accounts, transactions, goals, planner, to-dos, etc.) |
| Security & Privacy | `security` | Encryption, .beanpod files, zero-knowledge architecture, password policy |
| How It Works | `how-it-works` | Under-the-hood explanations (calculations, logic, data flow — in user-friendly terms) |

If a new category is needed (e.g., "Troubleshooting", "FAQs"), propose it with:
- Category ID (kebab-case)
- Display name and description
- Icon emoji
- Color from the brand palette
- What it would contain and why it deserves its own category

---

## Quality Standards

### Accuracy
- **Always verify against the actual codebase.** Read the component, check the store, follow the data flow. Never write documentation from memory or assumption.
- **Use exact UI labels.** If a button says "Add Account", don't write "Create Account".
- **Test the flow.** Mentally walk through every step you document. If you're unsure about a step, explore the code or ask.

### Completeness
- **No skipped steps.** Every action between start and finish must be documented.
- **Include defaults.** If a field has a default value, mention it.
- **Cover edge cases.** What happens if the user has no accounts? No family members? An empty pod?
- **Note limitations.** If a feature doesn't do something users might expect, say so clearly.

### Freshness
- **Update `updatedDate`** whenever an article is meaningfully changed.
- **Flag stale content** during audits — if the UI has changed since the article was written, it needs updating.

---

## Existing Article Inventory

For reference, the current help center contains these articles:

**Getting Started (4):**
- Creating Your First Pod
- Adding Family Members
- Language & Currency
- Connecting Google Drive

**Features (5):**
- Managing Accounts
- Recording Transactions
- Setting & Tracking Goals
- Budgets & Category Limits
- Family Planner & Activities

**Security (4):**
- How Your Data Is Encrypted
- The .beanpod File Explained
- Zero-Knowledge Architecture
- Password Recovery (There Is None)

**How It Works (5):**
- Net Worth Calculation
- Cash Flow & Savings Rate
- Dashboard Summary Cards
- Your Daily Briefing
- Budget Pace Status Logic

*This inventory should be updated as articles are added or removed.*

---

## Reminders

- **Always ask questions** before writing if you're unsure about anything. It's better to ask than to publish incorrect help content.
- **Read the actual code** before documenting a feature. Help articles must match reality.
- **Follow the beanies brand voice** — consult `.claude/skills/beanies-theme/SKILL.md` for tone, colors, and terminology.
- **Use the translation system** for any new UI text added to support the help center (category labels, badges, etc.).
- **Keep the article inventory updated** in this skill file when articles are added or removed.
