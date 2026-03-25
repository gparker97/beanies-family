# Changelog

All notable changes to beanies.family are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are grouped by date, with the most recent at the top. Each entry is a brief, human-readable summary — not a commit message.

> **Note:** This changelog was introduced on 2026-03-25. Entries before this date were backfilled from git history.

---

## 2026-03-25

### Added

- Schedule summary box in transaction view modal — shows recurrence pattern, start/end dates for recurring transactions, or date for one-time transactions (matching the activity view convention)
- Link field on all travel segment types — flights, cruise, train/ferry, car, accommodations, and transportation now support an optional URL (previously only activities and ideas had this)

### Changed

- Travel segment link field moved from activity-only to a common field at the bottom of all travel edit forms
- Accommodation edit modal pairs link with contact phone on a shared row
- Transportation edit modal pairs link with booking reference on a shared row
- Removed standalone recurrence pill from transaction view modal (replaced by the summary box)

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
