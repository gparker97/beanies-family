# Changelog

All notable changes to beanies.family are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are grouped by date, with the most recent at the top. Each entry is a brief, human-readable summary — not a commit message.

> **Note:** This changelog was introduced on 2026-03-25. Entries before this date were backfilled from git history.

---

## 2026-04-14

### Added

- Astro scaffold for the new marketing site at `web/` — part of the SEO + AIO/GEO optimization initiative (#167). The public marketing pages, beanstalk blog, and help center will move to server-rendered static HTML at the apex domain, while the Vue PWA will live at `app.beanies.family`. This unlocks visibility to AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) that do not execute JavaScript
- Shared `@beanies/brand` package — single source of truth for brand theme, nav, and JSON-LD schema. Consumed by both the existing Vue app and the new Astro site; eliminates duplication of colors, fonts, and author/organization data
- Full Astro route tree: homepage, /about/greg, /blog (index + posts), /help (index + 5 categories + 24 articles), /privacy, /terms — 36 pages total, each with unique title, canonical URL, OpenGraph + Twitter Card meta, and JSON-LD (Organization, WebSite, SoftwareApplication, BlogPosting, Article, BreadcrumbList, Person). All metadata is in the raw HTML — no JS required for crawlers to read it
- Help center client-side search (MiniSearch island) — lazy-loaded ~10 KB JS on the `/help` page only. Index derived from the same help content modules as the articles; no content duplication
- SEO plumbing: `robots.txt` with explicit allowlist for 24 AI crawlers and traditional search engines; hand-curated `llms.txt`; auto-generated `llms-full.txt` (56 KB of concatenated blog + help content); RSS feed at `/blog/rss.xml`; IndexNow key file; dynamic sitemap covering all 36 URLs with `lastmod`
- Dynamic 1200×630 OG images per blog post — generated at build time via `astro-og-canvas` (CanvasKit/WASM Skia, no headless browser). Heritage Orange → Terracotta gradient with beanies logo
- Web Vitals RUM on every marketing page — `web-vitals` sends LCP, INP, CLS, FCP, TTFB to Plausible as custom events; Plausible script itself ported from the Vue app
- Phase A Terraform for the apex cutover (#167): new `app-subdomain` module (ACM cert, CloudFront distribution, Route53 alias for `app.beanies.family` sharing the existing Vue S3 bucket via OAC) and new `web` module (S3 bucket for Astro, `staging.beanies.family` CloudFront distribution with `X-Robots-Tag: noindex` response header). Manual-trigger `deploy-web.yml` GitHub workflow and apex-redirects CloudFront Function (authored, unattached pending Phase C). Cutover runbook at `docs/runbooks/cutover-apex-to-astro.md`. No existing infrastructure is modified — Phase A is purely additive

### Changed

- Repo is now an npm workspace monorepo (root, `web/`, `packages/*`). The Vue app stays at the repo root for now; it will move to `apps/app/` in a later focused refactor

---

## 2026-04-13

### Fixed

- Onboarding wizard overlay no longer sticks on Safari/iOS — replaced the outer Vue `<Transition>` with a deterministic class toggle + timed unmount so the overlay always clears after you finish onboarding (#153)
- App init loading spinner no longer blocks clicks on Safari after the app is ready — the overlay now has `pointer-events-none` since it only contains a spinner (#153)

### Changed

- E2E tests run with `prefers-reduced-motion: reduce` and decorative infinite CSS animations are disabled under that preference — improves test reliability on WebKit and respects the accessibility preference for real users (#153)
- E2E CI workflows consolidated — `main-ci.yml` no longer duplicates the Playwright pipeline; `e2e.yml` handles all E2E runs with an event-aware matrix (main push: Chromium; `run-e2e` PR label: Chromium + WebKit; weekly: all three)
- WebKit E2E stability — reduced-motion rule now also zeroes out CSS `transition-duration` (not just `animation-*`), page-object `goto()` calls use `waitUntil: 'domcontentloaded'` so a slow/missing `load` event no longer hangs navigation, and the webkit Playwright project has a per-test timeout and extra retry to absorb its ~2–3× slower Linux CI runtime (#155, #156, #165)
- WebKit E2E now runs on every main-branch merge alongside Chromium (not just on opt-in) so Safari/iOS regressions are caught before they reach users (#166)
- CI no longer fires duplicate E2E runs when multiple labels are added to a PR with `run-e2e` already applied — the trigger now checks which label was just added (#166)
- `google-drive.spec.ts` "Create Pod step 2" hardened against a WelcomeGate → CreatePodView transition race (#165)

---

## 2026-04-12

### Added

- Family registry now captures owner email, newsletter opt-in, and join date (write-once `createdAt`) — enables early-adopter identification and future contact (e.g. manual Substack onboarding)

### Changed

- Consolidated the three `registerFamily()` payloads in `syncStore` into a single shared helper (DRY)

## 2026-04-10

### Added

- Daily calendar view — see your whole family's day at a glance with per-member columns, color-coded headers, and click-to-create with pre-filled member
- Blog post: "does family trip planning stress you out? me too" — travel plans feature intro with screenshot
- Image lightbox on blog posts — click any image to view enlarged in an overlay
- UTM tracking on all blog post links for analytics
- Hover "+" on weekly and daily calendar time slots now shows the time range (e.g., "3pm – 4pm")
- "all day" label shown beneath all-day activities in list views
- `/pilot-scout` skill for finding potential pilot users across Reddit, HN, Quora, Product Hunt, and more

### Changed

- Activity drawer field order: title → schedule → who → category (more natural creation flow)
- Blog URL changed from `/beanstalk` to `/blog` (old URLs redirect automatically)
- Blog title renamed from "beanstalk blog" to "beanie beanstalk"
- Nav links renamed from "blog" to "beanstalk" across all pages
- Family members now sorted adults-first (oldest→youngest), then children, across all member pickers
- One-time activities no longer show recurring fee schedule chips or monthly charge — linked payment is one-time only

### Fixed

- Calendar view switch (month → week → day) no longer auto-scrolls to bottom of page
- Coming soon blog cards updated (travel plans removed, 2 cards remain)

---

## 2026-04-09

### Added

- Privacy Policy page at `/privacy` — covers local-first data model, Plausible analytics, Google Drive encryption, cookies (none), children's privacy, data portability
- Terms of Service page at `/terms` — "as is" warranty, not financial advice, liability limitations, open source license, acceptable use
- Twitter Card meta tags, canonical URL, and OG image metadata for better social sharing previews
- `robots.txt` and `sitemap.xml` for SEO
- Plausible custom event tracking for signups, logins, feature usage, and family deletions — all aggregate, no PII
- New families auto-subscribed to the Beanstalk newsletter (Substack) during signup with opt-out checkbox
- `/end-of-day` skill for session wrap-up and status updates

### Fixed

- Substack newsletter auto-subscribe during signup now works — replaced broken `fetch` + JSON (silently stripped by CORS) with hidden form POST that Substack actually receives
- Privacy and terms links added to blog/help page footer (PublicFooter)
- "Back to home" link on legal pages now goes to `/home` instead of `/nook`
- npm audit vulnerabilities resolved (0 remaining)
- Removed emoji from beanstalk welcome post greeting

## 2026-03-27

### Added

- "Your Daily Briefing" explainer article in Help Center — explains the critical activities orange box on the Family Nook, including what triggers each item type, sorting logic, and the five-item limit
- "Family To-Do Lists" how-to article in Help Center — creating, editing, completing, sorting, filtering, and deleting tasks
- "Travel Plans & Vacations" how-to article in Help Center — the five-step trip wizard, timeline, booking progress, accommodation gaps, ideas voting, and countdown
- "The Family Nook — Your Home Base" explainer article in Help Center — every widget on the Nook homepage explained: greeting, daily briefing, schedule cards, vacation card, to-do widget, milestones, Piggy Bank, recent activity, and onboarding wizard
- `beanies-help-docs` project-level skill for creating and auditing help center articles

### Fixed

- "View all articles" link on Help Center landing page no longer navigates to getting-started category — now smooth-scrolls to the full article index

### Changed

- Help Center landing page: article index section redesigned — category cards show article preview (up to 4 per category with overflow hint), centered header with subtitle, clickable cards navigate to category page
- Help Center category page: redesigned with hero banner, article count badge, subtle background glow, and "Explore other topics" section linking to sibling categories

---

## 2026-03-26

### Added

- "All" fee schedule option for activities — pay one upfront amount covering every session from start to end date, with exact per-session cost breakdown and one-time linked transaction
- Fee schedule hint badge with bulleted explanations of each payment option
- Clickable summary cards on Transactions page — tap Income or Expense card to filter the list by direction, with a colored ring highlight on the active card and a dismissible filter chip
- Dashboard Income and Expense summary cards now navigate to the Transactions page pre-filtered to the corresponding direction

### Changed

- Fee schedule chips reordered (Each, All, Weekly, Monthly, Yearly, Custom) and removed Quarterly option
- Activity modal field order reorganised: cost/fee fields now appear after drop-off/pick-up duties instead of mid-form, grouping logistics together and financials together for a more natural flow
- Travel wizard steps 2–4 now show large, engaging card-style buttons for initial segment selection (matching the Step 1 trip type grid), then switch to compact pills for adding more segments
- Travel wizard step 5 (Ideas) now shows a collaboration hint encouraging family members to add and vote on ideas together anytime

### Fixed

- Time picker dropdown now auto-scrolls to the currently selected time when opened, instead of always starting at the top of the list
- All activity time displays now use 12-hour format (e.g. "2:30pm") instead of raw 24-hour values — affects Nook schedule, activity list cards, weekly calendar grid, and activity detail modal
- Activity view modal now shows start/end time inside the grey schedule summary box for both recurring and one-time activities

## 2026-03-25

### Added

- Schedule summary box in transaction view modal — shows recurrence pattern, start/end dates for recurring transactions, or date for one-time transactions (matching the activity view convention)
- Link field on all travel segment types — flights, cruise, train/ferry, car, accommodations, and transportation now support an optional URL (previously only activities and ideas had this)

### Changed

- Travel segment link field moved from activity-only to a common field at the bottom of all travel edit forms
- Accommodation edit modal pairs link with contact phone on a shared row
- Transportation edit modal pairs link with booking reference on a shared row
- Removed standalone recurrence pill from transaction view modal (replaced by the summary box)
- E2E test suite overhauled: 87 → 21 tests (76% reduction), 15 → 7 spec files, CI runs Chromium only (~44s vs ~10 min)
- Introduced Three-Gate Filter, 25-test budget cap, and E2E health tracking (`docs/E2E_HEALTH.md`)
- Project changelog (`CHANGELOG.md`) introduced with 2-week backfill from git history

## 2026-03-24

### Added

- Success toasts when reconnecting after going offline or recovering from a network error

### Performance

- Cache-first loading with skeleton screens — app shell renders instantly from cache, data loads in background
- Manual refresh replaces automatic background sync for better user control

## 2026-03-23

### Added

- Share invite modal with social sharing channels (WhatsApp, email, copy link, QR code)
- Cross-device passkey support with PRF key re-wrapping for seamless login across devices
- Delete Family & All Data option in settings with password gate for safety
- Quick-link prompt with attention pulse on transaction form — suggests linking to activities or loans
- Late-night/early-morning flight warnings on travel timeline
- Link previews for travel plan ideas (fetches title, description, image from URL)
- Undo button on todo completion celebration modal
- Unified reschedule UX across all activity types (one-time, recurring, materialized)

### Changed

- All dates standardised to dd MMM yyyy format globally (e.g. "25 Mar 2026")
- Night flight detection consolidated into single-source hint system

### Fixed

- Dashboard net worth breakdown cards now expand independently
- Hint bubble flips above button when near viewport bottom
- Family member creation flow during pod setup — explicit add-another step
- Drive invite reads now cache-bust to pick up latest tokens
- Beanie mode text "counted a bean" replaced with "task completed"

## 2026-03-22

### Added

- Global search overlay with beanies-themed design — search across transactions, activities, accounts, goals, and travel
- Beanstalk Blog — public-facing blog with markdown rendering
- Hint badges on link payment and link goal fields in transaction form
- Field Trip category added under School activities
- Travel: standardised segment titles, one-way/return flight support, booked-status validation

### Changed

- All form modals migrated from center modals to right-side drawers
- Add buttons standardised — consistent gradient pills, top-right placement
- Travel idea editing now opens drawer from wizard instead of inline expand

## 2026-03-21

### Added

- Dedicated Travel Plans page with chronological timeline, edit modals, and idea editing
- Travel activity segments (shows, theme parks, sporting events, concerts, excursions)
- Auto-generated segment titles from field data (e.g. "SYD → LAX" for flights)
- Helpful hints for overlapping bookings on travel timeline
- Trip-type-specific countdown language ("cruise in X days" vs "trip in X days")
- Wizard add-by-type flow and pending items shown in timeline with gold tint
- Link field on travel ideas with auto-prepend https

### Changed

- Nook section cards unified with shared NookSectionCard component

### Fixed

- Accommodation gap warnings now open wizard to correct step
- Existing accommodations preserved when adding new stay
- Delete enabled on undated travel items
- Todo quick-add bar no longer auto-focuses on mobile/tablet
- Family creation onboarding flow — 4 UX fixes

## 2026-03-20

### Added

- Family vacation planner — complete feature with data model, store, 5-step wizard, segment cards, idea voting, calendar bars, and sidebar integration
- Vacation view modal with chronological timeline and inline editing
- Airline and airport autocomplete dropdowns (136 airlines)
- Cruise line, ship, and port autocomplete dropdowns
- Collapsible segment cards showing key details at a glance
- Expanded view modal cards showing all populated fields
- Recurring/one-time toggle moved to top of transaction modal
- Custom header prop for edge-to-edge modal headers

### Fixed

- Vacation data persistence across page refresh (Automerge collection migration)
- Return flight auto-populate copying only first letter
- Required flight fields with automatic return flight population from outbound data
- Separate outbound/return flights with editable title hints
- View modal polish — hero gradient, corners, countdown, BeanieFormModal integration

## 2026-03-19

### Added

- Prompt archive system for tracking all AI prompts (`docs/prompts/`)
- Branded QR code with logo overlay on invite modal
- Redesigned invite modal as stepped flow

### Fixed

- Nook "This Week" card items now grouped by day/date

## 2026-03-18

### Changed

- README rewritten with concise setup instructions (replaced story format)

### Fixed

- Assignee chip cutoff in weekly calendar activity blocks

## 2026-03-17

### Added

- Weekly calendar view with shared component extraction
- All-day activities, multi-day spanning, and form validation UX
- Creation confirmation modal for transactions and activities
- Category icons, name fixes, date-grouped upcoming section, new sports categories
- Info popover on Create Monthly Payment toggle
- Activity/transaction categories with enforced alphabetical ordering

### Changed

- Default to week view on desktop, month view on mobile
- Activity modal fields reordered with compact assignee pickers and schedule summary
- Preferred currency now uses search picker with alphabetical settings tiles
- Shared TodoItemRow component extracted (DRY refactor)

### Fixed

- Scope picker now shows when editing materialized recurring transactions
- Currency display and preferred currencies stay in sync when changing base currency
- Assignee picker popover wrapping and mutual exclusion
- Consistent transaction click behavior and view modal conventions

## 2026-03-16

### Added

- Loan repayment linking with amortization schedule and recurring payment system
- Info hints on locked fields explaining why they can't be edited
- Asset card payment summaries and amortization explainer
- Compact mobile todo layout with shared assignee picker
- Skip scope modal for linked payments, show success confirmation instead

### Changed

- All activity fee schedules normalised to monthly for linked transactions
- Compact schedule section, biweekly frequency removed

### Fixed

- Linked transaction fields properly locked with cross-navigation between entities
- Ghost projections and default category for linked payments

## 2026-03-15

### Added

- Comprehensive category overhaul — new categories for transactions and activities
- Education/Lessons split into separate category groups
- Net worth breakdown cards expand inline to show account details

## 2026-03-14

### Added

- Net worth breakdown card on dashboard with category tiles
- Reschedule UI for planner activities — drag or pick new date
- Week start day setting (Monday or Sunday) for calendar
- ShowFiguresPrompt component for hidden financial figures (dashboard and budget)
- Edit budget button on spending by category card

### Fixed

- Dashboard breakdown card ordering, pill wrapping, and period overflow
- Deleted accounts filtered from transaction modal dropdown
- Motivational quote and subtitle wrapping on mobile

## 2026-03-13

### Added

- Goals and Assets pages revamped with motivational design and DRY consolidation
- Assets visual polish — equity bars, stat subtexts, card animations, hint popover
- Shared UI string resolver for E2E tests to prevent text-change breakage

### Changed

- All E2E tests migrated to use `ui()` string resolver

### Fixed

- Progressive translation loading and pre-deploy translation sync

## 2026-03-12

### Added

- Comedy movie quotes added to daily mottos on the Nook

### Fixed

- Passkey registration uses progressive fallback for platform authenticator
- Landing page floating nav font sizes and mobile layout fixes

## 2026-03-11

### Added

- Slack webhook notifications for new family creation events
