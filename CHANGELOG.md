# Changelog

All notable changes to beanies.family are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries are grouped by date, with the most recent at the top. Each entry is a brief, human-readable summary — not a commit message.

> **Note:** This changelog was introduced on 2026-03-25. Entries before this date were backfilled from git history.

---

## 2026-04-25

### Added

- **Mobile nav redesign mockups (design-only, not yet shipped).** Two interactive HTML mockups exploring a calmer 4-category bottom nav (Nook / Planning / Money / Pod) that uses a "bean-jar stack" pattern — tap a category and a vertical column of beans rises from the tab. v1 (`docs/mockups/mobile-nav-bean-jar.html`) compares three layouts; v2 (`docs/mockups/mobile-nav-bean-jar-v2.html`) commits to the system rule "cluster bloom = ADD, pure bean stack = NAVIGATE", with a Heritage Orange `+` seal differentiating the FAB's bloom from the nav's stack, plus a scaling stress test (3 / 6 / 10 items) and a `＋N more` overflow strategy. Implementation deferred to a future session.

---

## 2026-04-24

### Fixed

- **Permission semantics across the pod.** The three member toggles now have clean, non-overlapping scopes: **Can view finances** (piggy bank), **Can edit family content** (recipes, cookbook, cook logs, medications, allergies, emergency contacts, scrapbook, sayings, favorites, notes, todos, travel plans — everything except the family roster), and **Can manage family members** (add/edit/delete members, family name, pod-level settings). Before this, the cookbook, recipes, and emergency contacts were incorrectly gated on "manage pod", so a member with edit-family-content but no manage-members permission could open the "add recipe" modal but not save it, and couldn't see the edit / log-cook buttons on a recipe. Scrapbook, medications, allergies, todos, and travel plans weren't gated at all. All add-affordances (buttons, add-tiles, empty-state CTAs, quick-add intents) now follow the same rules. The toggle labels in the family member modal have been renamed to match.
- **Quick-add sheet hides actions you can't do.** The + button sheet used to show every action to everyone — a member without finance permission would see "Transaction" / "Account" / "Budget" / "Asset" / "Goal", tap one, and get bounced to the no-access page. Those items now disappear from the sheet entirely when the member can't view finances; likewise content items (recipes, cook-log, medications, allergies, etc) disappear when the member can't edit family content. Empty sections don't render.

### Added

- **"Fresh off the press" divider on the beanstalk.** A small zine-style ornament now sits between the masthead and the latest-issue card on `/blog` — thin Heritage Orange rules fading in from each side, bracketing a Fraunces-italic label flanked by two accent dots. Replaces the previous "card butts up against the hero" layout.
- **New family-reading illustration on the family library.** `/guides` now leads with a warm family-reading scene (dad + three beanies gathered around a book) sitting on a soft multi-stop radial halo. Gentle bob animation, redesigned from an absolute-positioned corner sticker into a proper two-column flex so nothing clips on mobile.
- **Themed date + time pickers across the app.** New `BeanieDatePicker` and `BeanieTimeInput` components replace every native date/time field. Both use the same pill vocabulary as the existing preset-time picker: filled Heritage Orange when a value is chosen, slate when empty, Outfit font. Date picker has a calendar popover with Today/Tomorrow quick chips and respects your **Week Starts On** setting. Time picker opens a themed 3-column popover (Hour · Minute · AM/PM) with Now/Clear shortcuts — no more generic browser UI.
- **Smaller, cleaner reschedule + activity forms.** The reschedule modal and new-activity flow no longer squeeze date + start + end time into one row when it's tight — date gets its own line and the times sit below, so nothing clips.
- **Compact "+1 day" toggle on flight/train arrivals.** Replaces the wider checkbox + label with a small orange toggle pill, letting arrival time match departure width.

### Changed

- **Beanstalk mascot on mobile is now a watermark.** The tall mascot used to stack above the title on phones and push the pitch + featured card past the fold. It now sits behind the masthead text at low opacity, keeping the brand hello visible without consuming any vertical space.
- **Refreshed subtitles on the three existing beanstalk posts** so each card carries its own one-line hook under the title (Substack-style).
- **Cleaner beanstalk mascot asset.** Swapped the previous background-removed PNG for a fully transparent version — no halo around the character on the hero gradient.
- **Picker popovers teleport out of their parent** so segment cards and modals with clipped overflow no longer cut off the bottom of the calendar or time columns. They reposition on scroll/resize and flip up when they'd overflow the viewport.
- **Quick-edit date/time fields on travel segment cards** now use the themed pickers inline, with the night-flight hint (🌙 early morning / late night) kept alongside.
- **Family library hero copy.** `/guides` now reads "a guide to family organization · in order" (was "a reading curriculum · in order") and opens with "how do we go from feeling overwhelmed to feeling in control?" instead of the declarative version. The reading-time stat is cleaner ("X min reading time" rather than "~X min total · a lifetime to practice"), and the footer credits claude-bot for research help.

## 2026-04-23

### Added

- **The family library — guides landing page redesign.** `/guides` is now an e-zine-style landing with a Fraunces-italic hero, a four-station curriculum arc, and a 2×2 grid of chapter covers. Each pillar gets its own palette + background texture (swirl, grid, ledger rules, circuit traces), a "what's inside" bullet list pulled live from the guide's section titles, a reading-time badge, tag chips, and a slate "read chapter N" CTA. Pillar 1 carries a "start here" ribbon. `ItemList` + `CollectionPage` structured data added for AI crawlers.
- **"family library" in the top navigation** — added next to **beanstalk** so the curriculum has a persistent entry point everywhere on the site. Collapses into the hamburger menu on narrow screens.
- **Hamburger menu on narrow screens.** Below ~820px width, the pill nav swaps to a clean hamburger + full-width dropdown that slides down from the top. All destinations (my story, security, beanstalk, family library, help) + sign-in + primary CTA are available in generously-sized taps. Desktop keeps the full pill nav exactly as before. Escape, overlay click, or orientation change all close the panel.
- **FAQ + Glossary shipped to prod** with their new reference-book look. FAQ: sticky category sidebar with scroll-spy highlighting, filter-as-you-type input, tint-striped category sections, numbered Q cards, footer "get in touch" CTA. Glossary: sticky A–Z jump strip (inactive letters dimmed), alphabetical sections with oversized italic dropcap letters, "core" ribbons on the five foundational terms (beanies.family, pod, .beanpod, local-first, E2EE), and computed "see also" chip trails that surface cross-references already present in the definitions.
- **Four pillar guides shipped to prod.** The Overwhelmed / Family Organization / Family Finance Basics / Local-first Tools guides are now live at `/guides/<slug>` — four long-read pieces averaging ~3–4k words each with short-answer blocks, drop-caps, chapter eyebrows, sticky section rail on wide screens, reading progress bar, and "what to take away" recap cards.
- **Prev/next navigation at the bottom of every guide.** Two cream cards that walk the curriculum in canonical order (overwhelm → organization → finance → local-first), with a hairline top rule and serif titles. At the ends of the walk, the fallback points at the library.
- **Back-to-top button on guide pages.** Glass-disc control pinned to the bottom-right, matches the one on the homepage. Appears after 400px of scroll.
- **Quick reference section on the help index.** Two prominent feature cards (FAQ + Glossary) sit between the category grid and the popular articles block, each with its own emoji watermark, count badge, and gradient wash.
- **Close controls on the quick-add FAB sheet.** A subtle × in the top-right corner and a wider "close" pill at the bottom. The back gesture / device back button / browser back button all now dismiss the sheet (previously did nothing) — the sheet pushes a history entry on open and pops it on close.
- **Quick-add FAB (#37).** A floating "+" button pinned to the bottom-right of every page opens a grouped sheet with 19 add actions spread across four sections — Everyday (Activity, To-do, Transaction, Trip, Cook log, Saying), Family, Money, and Care. Tap anything to land directly in its add form, no matter which page you were on. The button itself is a hand-authored peek-a-boo beanie SVG that themes for dark mode via a single CSS variable. Hidden on Settings / Login / Welcome / 404.
- **Context-aware pre-fill.** When you're on a bean's detail page and tap Saying (or Favorite, Note, Medication, Allergy), the add form opens with that bean already selected. Same for Cook log when you're viewing a specific recipe. No picker step needed.
- **Inline bean picker.** If you tap a bean-specific action from anywhere else (like the Dashboard), the sheet expands directly below the section you tapped with a tile grid of family beanies. Pick one and the add form opens with them pre-selected. Pets are filtered out. Re-tapping a different action updates the picker in place.
- **Recipe + medication pickers.** Tapping Cook log without a recipe in context, or Dose log without a medication, swaps the sheet to a full picker view with a scrollable list — recipes show their polaroid thumbnail, medications show which beanie they belong to. Dose log picks + confirms a dose in one flow without any page navigation.
- **Empty-state guidance.** Tapping Trip idea when you have no trips yet shows a warm "add a trip first" prompt with a one-tap jump into the trip wizard. Same pattern for empty bean / recipe / medication pickers.
- **Stale-link guard.** If a deep-linked `?action=…` URL lands on a page that hides the FAB (e.g. Settings), the query is stripped and a friendly toast explains the menu isn't available there — no silent swallow.

### Changed

- **Top navigation polish.** Added "family library" to the main nav. The footer's main link row now carries **beanstalk · family library · help · faq · glossary · sign in**; privacy + terms moved into a smaller fine-print row alongside the copyright, matching the classic legal-strip convention. The GitHub link was dropped from the footer since the homepage already surfaces GitHub prominently.
- **Contact CTAs unified on the Slack-backed modal.** Every non-coding feedback surface — FAQ intro / empty-state / footer, glossary footer, homepage story, and the "Can I give feedback" FAQ answer — now points at the existing "get in touch" modal (the one opened by the footer's `💬 get in touch with me` button) instead of suggesting a GitHub issue. GitHub issues are reserved for actual coding problems from here on.
- **Em-dashes swept out of long-form content.** Every `—` and `–` in the four pillar guides + the welcome-to-the-beanstalk blog post was replaced with a plain ASCII hyphen — em-dashes read as an AI-writing tell, and the content should feel human.
- **Guide library chapter numbers dropped the leading zero.** "chapter 01 / 02 / 03 / 04" is now "chapter 1 / 2 / 3 / 4" — reads more naturally. The curriculum arc circles follow suit.
- **Quick-add FAB tightened.** Removed the **Recurring** tile from the Money group; it was redundant with **Transaction** (both landed in the same drawer, and the recurrence toggle inside is one click away). Money now shows 4 tiles.
- **Smooth scroll across the marketing site.** Anchor clicks and table-of-contents jumps now glide to their target instead of snapping, matching the homepage's existing feel. Respects `prefers-reduced-motion`.
- **Unified the "add from deep link" flow.** The bean-tab-specific `?add=1` query shortcut is replaced by the FAB's richer `?action=<name>` intent system. User-facing behavior is unchanged; under the hood, all Bean tabs + the Pod index pages now consume intents through one composable with proper error handling (unknown actions surface a toast; handler exceptions are caught and reported).

### Fixed

- **Guides library page was rendering blank cards on prod.** An invalid `:not(::after)` selector clause was silently killing the CSS rule that brought pillar-card content above a texture overlay, leaving every card empty.
- **FAQ + Glossary answer links now show the correct orange-underlined styling.** Scoped CSS wasn't reaching the inline HTML in answers/definitions; flipped the style blocks to `is:global` with every selector namespaced under the page root.
- **Mobile header no longer overflows the viewport** — replaced by the hamburger + dropdown design described above.
- **Recipe detail "back to the cookbook" double arrow.** A literal `←` was baked into the translation string while the button also rendered a chevron-left icon; removed the literal arrow so the icon owns the single visual cue.
- **Guide first-bullet alignment.** When a section started with a list rather than a paragraph, the drop-cap floated into the list's vertical space and pushed only the first bullet's marker to the right. Fixed by containing the drop-cap float to its paragraph box via `display: flow-root`.
- **Guide heading line-wrapping** — titles and subtitles were wrapping after a few words because `overflow-wrap: anywhere` was applied at the guide-prose root. Moved the aggressive wrapping to paragraphs only; headings break on word boundaries.
- **List markers (bullets and numbers) were missing** on guide pages because a Tailwind preflight reset was stripping `list-style`. Re-applied explicit `list-style: disc/decimal` inside guide prose with Heritage-Orange markers.
- **Spacing between counts and the following word** on FAQ + Glossary ("6questions" / "3terms") — Astro was collapsing the literal space between adjacent `{expr}` interpolations; fixed with a template-literal expression.

---

## 2026-04-22

### Changed

- **Pillar guides redesign — tier 1 (prototype on pillar 1, not yet live in prod).** The first of four pillar guides (`/guides/overwhelmed-family-planning`) now renders with a family-zine editorial treatment: "TL;DR" answer cards on each section (the existing short-answer blocks promoted from inline bold to distinctive kraft-paper cards with a Heritage Orange rail), gradient drop-caps on the first paragraph after every heading, "CHAPTER 01/02/03…" eyebrows above each heading, a numbered-chapter table of contents, a sticky section rail on wide screens (≥1200px) that highlights the section you're currently reading, a thin reading-progress bar at the top, and a Deep Slate "what to take away" recap card at the end of the guide. Body prose switches to the Fraunces serif typeface for long-read warmth; display + metadata stay in the existing Outfit. All changes are in the shared template, so the other three pillars will inherit the treatment once their `keyTakeaways:` frontmatter is populated. Guides remain `draft: true` and are not live in prod — preview via `npm run dev:web`.

### Fixed

- **Net worth chart now reflects manual balance adjustments.** Previously, when you manually edited an account balance (or any other balance adjustment recorded against an account), the historical net worth chart on the dashboard silently dropped the adjustment from its replay — so a $500k bump made yesterday would render as a flat line at the new amount across the entire chart history. The chart now correctly shows the step where the adjustment happened, with the prior history reflecting the pre-adjustment balance. Adjustments on credit-card or loan accounts move the line in the opposite direction (since balance changes there mean debt changes).
- **Net worth chart now respects when accounts and assets were created.** Adding a new account or asset today no longer makes it appear at its current value across the entire historical chart. Pre-creation chart points correctly omit the entity, so adding a $10k savings account today produces a step up at today rather than a flat line. Buying a $500k house with a $200k loan added the same day shows zero retroactive contribution (the asset and the linked loan account cancel each other out before that date).
- **Net worth chart now accounts for principal vs interest on loan payments.** Loan payments split into a principal portion (which reduces debt) and an interest portion (which is real cost). Previously the chart only reversed the cash side of a loan-payment expense, so historical net worth was overstated by the cumulative principal you'd paid. Now reflects the principal payback against the loan balance correctly — the chart only "drops" by the interest portion at each payment.
- **Reports "Income vs Expenses" chart no longer counts transfers and balance adjustments as expenses.** The bar chart's per-month aggregation was treating every non-income transaction as an expense via a binary classification — so a $500k positive balance adjustment would render as a $500k expense for that month, and every transfer between accounts would be double-counted. Income, expenses, and net cash flow stats on the Reports page also self-correct.
- **Activity feeds now show a distinct icon for manual balance adjustments.** The Nook "Recent Activity" card and global search results were rendering balance-adjustment transactions with the credit-card / expense icon. Adjustments now use a scale (⚖️) icon, with the tint reflecting the direction (green for positive, orange for negative). Transfers also pick up a distinct arrows icon and blue tint.

### Changed

- **More informative chart errors.** When the dashboard net worth chart can't render due to an unexpected error (data corruption, missing exchange rates, etc.), it now shows a brief "Could not render net worth history. Check the console for details." message in place of the silent empty state, while logging the underlying error to the console.

---

## 2026-04-21

### Added

- **Goal activity log + quick-contribute flow.** Tap a goal card to open a new read-only drawer showing progress, priority, deadline, and a chronological log of every contribution — automated transactions routed toward the goal and manual contributions you report outside the tracked system. A prominent **Contribute** button in the footer opens a lightweight modal where you enter an amount and an optional note about where the money came from ("mom's birthday money", "bonus", etc.). Crossing 25 / 50 / 75 / 100% of the target fires a celebratory moment; a Contribute that's tapped by mistake can be reversed for 6 seconds via an **Undo** button in the success toast. Manual contributions also get an inline trash icon in the activity log for persistent delete with confirmation. Clicking "View all →" from a goal's activity log filters the transactions page to that goal.
- **Goal edit form: "Current amount" → "Remaining amount".** The field is now labeled by what you have left to save rather than what you've accumulated — more intuitive for savings and debt-payoff goals alike. Reducing the remaining amount records as a positive contribution on the activity log.
- **Account activity log + manual balance audit trail.** Tap an account card to open a new read-only drawer showing balance, institution, and a filterable, date-grouped log of every credit, debit, and balance correction on the account. Filter chips let you narrow to Manual / Recurring / Loans / Goals / Transfers. Tap any row to jump straight to the transaction's detail view. Transfers appear in both source and destination accounts' logs with a direction arrow. Linked-to-asset accounts still redirect to the Assets page.
- **Manual balance edits now leave a paper trail.** When you change an account's balance by hand, a dedicated "balance adjustment" entry is recorded with the signed delta, the date, and which family member made the change. These entries show as `Adjusted by {name}` in the activity log (or "Adjusted by you" for your own edits). They're read-only — if a past correction needs tweaking, create a new adjustment instead. Balance adjustments are **excluded from all income/expense totals**, budgets, and dashboard summaries since they're corrections, not cash flow.
- **Account column on the transactions page.** At tablet+ widths, each transaction row now shows which account it belongs to as a small member-colored pill. Transfers render as `Main Checking → Savings`. On mobile, the account name appears inline under the description. Clicking "View all →" from an account's activity log filters the transactions page to that account (with a dismissible pill to clear the filter).
- **Close button on the medication view drawer.** The drawer now has a neutral **Close** button paired with the primary **Log a dose** button in the footer, matching the Cancel/Save convention used on other view-edit modals across the app.
- **Ended medications now tuck into a collapsible history section.** On each bean's medication tab, active medications stay in the primary grid while ended ones collapse into a **📋 Ended medications** section with a count pill — matches the pattern used for completed goals on the Goals page. Collapsed by default so current meds don't compete for attention with history; tap the section to expand.

### Changed

- **Tapping a goal card opens a view, not an edit.** Same pattern as accounts / medications / activities / todos. The pencil (✏️) icon on the card still opens the edit form directly; the primary footer action on the new drawer is Contribute, and edit now lives as a pencil icon in the drawer header.
- **Tapping an account card opens a view, not an edit.** Matches how medications, activities, and todos already behave — the card opens a read-only detail view first, with the pencil (✏️) icon still opening the edit form directly. The Edit button inside the view modal takes you straight into edit mode.
- **Transactions page header: "Family" → "Who".** Short, clear label for the member column on the transactions table.
- **Sidebar sub-navigation stays tight.** The Pod's sub-items (Meet the Beans, Scrapbook, Cookbook, Care & Safety, Emergency Contacts) now auto-collapse when you navigate away from `/pod/*` and auto-expand when you're inside it. You can still pin the sub-nav open on any page via the chevron — it just re-collapses the next time you move into a different top-level section. Paired with a small density tightening on the nav items themselves, the sidebar no longer overflows on typical laptop viewports.
- **About Greg page bio refresh.** Sentence-cased the opening copy and added a mention of vibe coding among the topics covered on the beanstalk blog.

### Fixed

- **Joiner Drives no longer get an empty `beanies.family` folder at sign-in.** Previously, opening the "Load from Drive" view eagerly created the app folder on every user's Drive — which was wasted for anyone about to accept an invite and load a pod shared from someone else's Drive. Sign-in listing now searches globally for `.beanpod` files with no folder-creation side effect; the folder is still created on-demand when you actually create a new pod or upload a photo.

### Changed

- **The medication detail view is now a right-side drawer** (instead of a centered modal), matching the app's convention for view/edit surfaces. The primary action "Log a dose" lives as the drawer's save button; its confirm dialog stacks cleanly on top.
- **"I gave this dose" → "Log a dose"** — shorter, clearer action label across the card quick-action and drawer CTA.
- **Dose-log flow is always a confirmation.** Tapping 💊 now opens a dialog that shows today's doses for the medication (or "No doses logged today yet"), plus an editable date + time defaulting to now. Future values blocked. Supports retroactive logging for doses you forgot to mark, and prevents over-dosing by showing you the last-given time before you confirm.

### Fixed

- **Tapping anywhere on a calendar activity's location field now opens Google Maps.** Previously tapping the location text opened a quick-edit box while only the pin icon opened the map — inconsistent. The whole field is now the map tap target; editing the location moves to the main **✏️ Edit** button. Consistent with the travel-plans pattern.

### Added

- **Medication view modal + one-tap dose log.** Tapping a medication card now opens a read-only detail view with the bottle photo up top, who it's for, and the dose/frequency meta. A big orange **"I gave this dose"** button records an administration entry with a single tap — date, time, and the signed-in family member are captured automatically. A recent-doses list sits below the button so everyone can see who gave the last dose and when. An **Undo** button appears in the success toast for a few seconds in case the tap was a mistake. If you'd already logged a dose for the same medication today, a friendly confirm asks "Already given today — do you want to log another dose?" before adding a duplicate, so multiple caregivers can't accidentally double up. A 💊 quick-action button on each medication card lets you log a dose without opening the modal for meds you give often. Ended medications hide the dose button and CTA entirely — no accidental logging on a med the family has stopped. Past entries can be removed via the trash icon on any row. Edit is still reachable via the ✏️ button inside the view modal, routing to the existing edit drawer.

### Changed

- **Deleting a medication now also removes its dose history.** Previously there was no dose history to cascade; now there is, and the delete confirmation explicitly tells you the history will go with it. Done in a single atomic CRDT change so the doc never holds orphan log entries.

### Fixed

- **Editing one travel segment's date no longer overwrites a different segment.** Inline-editing a date on any travel-segment card (flight, train, activity, car) was corrupting another segment's date — typically the earliest travel segment in the trip. Root cause was a Vue template-ref collision: every travel-segment type uses `departureDate` as its date field name, so the hidden-picker refs all piled into the same array and the "open picker" helper always opened the first one. User's intended edit would then fire on the wrong input, saving the new date onto the wrong segment. Refs are now scoped per segment (`input-<segmentId>-<field>`) so each card owns its own picker. If you had a date go sideways on a recent inline edit, you'll want to check the affected segment and restore it.

### Changed

- **The "today" marker on the trip timeline is now the date header itself.** Previously, on days when you had travel segments scheduled, the pulsing orange "TODAY · Wed Jun 5 · DAY 4 OF 10" banner sat above a second, duplicate `DAY 4 · Wed Jun 5` row with a calendar-icon circle — two rows saying the same thing. The banner now stands in for both: it replaces the calendar-icon circle and the date header for today's group, so you get one clear focal point on the rail regardless of whether today has segments or is a free day. Past and future days keep their usual calendar-icon circles.
- **Today's segment connector dots now echo the banner's Heritage Orange.** The tiny dot + short horizontal line that tether each segment card to the timeline rail used to be teal on every day; today's segments now render them in Heritage Orange (at slightly higher opacity so they actually register). Attention flows down the rail from the prominent pulsing banner, through the quieter orange connectors, into the neutral card content — a small nudge that ties today's segments visually back to the banner.

---

## 2026-04-20

### Added

- **Activity cards on the mobile timeline now show who it's for and where.** Small colored initial-circles (up to 3, matching each Beanie's color, stacked with a slight overlap) sit at the top-right of each card. Location appears inline after the time as `· 📍 <location>`. Works on both timed cards and the all-day row; hovering a circle shows the full name.
- **Tapping a day on the monthly calendar now opens that day's full timeline** instead of the agenda sidebar. The agenda view is still reachable via a new **Agenda** button in the daily view's nav bar (next to Today). Weekly-view day clicks also drill in, for consistency.
- **Richer loading spinner.** The "counting beans" loading state has been rebuilt: the beans breathe on their spin (subtle scale pulse), cast an animated color-cycling glow (orange → teal → terracotta), and sit in a soft orange halo that fades cleanly into the page. The label gained a gradient sweep through the brand palette, and the static ellipsis is now three bouncing dots — one per brand color — staggered around the baseline where a real ellipsis sits. All animations respect `prefers-reduced-motion`.

### Fixed

- **Pets now show "Pet Beanie" on the Bean detail page.** The role line under a Bean's name (and the "Role" row in their About ribbon) used to fall through to "Parent Bean" for pets because the logic only checked `ageGroup`. Both surfaces now check `isPet` first and match the label already used on the Family Nook row.
- **Tablet (iPad / small-laptop) view of the activity calendar no longer overflows.** At 768–1023px, the member-name pills on activity cards used to wrap below the time label and spill past the bottom edge of short (30-min) cards. Cards are now a clean two-row layout (title / time · location · assignee dots) and the name pills swap for the same compact initial-circles used on mobile. Desktop above 1024px keeps the full name pills.
- **Mobile daily view no longer duplicates the member filter.** The in-view Beanie pills inside the daily timeline were redundant with the page-level filter at the top of the planner, and looked cramped on phones. Removed the duplicate; the mobile timeline now follows whatever the page-level filter has set (same as desktop column-hiding).
- **Help article links to `app.beanies.family` now render as actual links.** Four mentions in the Getting Started and PWA install articles rendered as plain text; they're now proper clickable anchors that open in a new tab.
- **PWA install guide reminds you you don't need to sign in first.** A short note on step 1 of each device section so you don't sign in on the web page and then again inside the installed app.

### Changed

- **Spinner refinements based on feedback.** Scaled back the orange halo (wider, softer, no hard disc edge) and dropped the dashed orbit ring so the loading state reads as atmosphere rather than chrome. Dropped the ellipsis dots from mid-line to baseline so they sit where a typographic "…" would.

### Fixed

- **Moving a flight no longer silently shrinks your trip.** Trip start/end dates are now user-owned rather than derived from segment dates on every save (see ADR-023). Changing an outbound or return flight within your trip window leaves the trip unchanged; changing one _past_ the window extends the window. The only way to shrink is a manual date edit on the trip summary page. This fixes the "orphaned accommodation" error greg hit when moving a flight later — the hotel was never orphaned, the trip had silently contracted around it.

### Changed

- **Multi-line fields are now actually multi-line across every travel form.** Address, notes, agency-address, description — anywhere a user would reasonably type more than one line — used to be a mix of `<input>` and `<textarea>` depending on which form you opened. The wizard used textareas for some, the edit modals used single-line inputs for the same fields, and styling drifted between them. Now everything routes through one new shared `<BaseTextarea>` (3 rows for notes + descriptions, 2 rows for addresses). Same border, padding, focus ring, dark-mode treatment across the wizard's inline editor and the post-creation edit modal — so an "address" field looks and behaves identically whether you're creating a hotel in the wizard or editing one afterward.
- **Long text on the trip timeline now expands cleanly instead of being jammed into a single-line input.** Notes, description, location, and address fields on each segment card used to render as a single-line inline-editable `<input>` — fine for a short street address, unreadable for a multi-line note or anything longer than the column. They're now display-only, line-clamped to 2 lines by default, with a **SHOW MORE ↓** toggle that appears only when the text actually overflows. URLs in the text autolink safely (escaped first, then wrapped in `target="_blank" rel="noopener noreferrer nofollow"`; trailing sentence punctuation stays outside the link). Editing still lives on the ✏️ button on the card header, which opens the full edit modal — one clean path for editing, one for reading.
- **Flight and cruise segment editors now surface trip-shape fields first.** The flight edit modal starts with a single prominent row of Date | Departure airport | Arrival airport — the three fields every flight needs regardless of booking status — then a "Booking details" caption groups airline, flight number, times, and booking reference. Cruise gets the same treatment (embarkation + disembarkation dates + departure port on top). Field order now matches the mental model: "what shape is this leg?" first, "who did I book it with?" second. Wizard inline carries through the same asterisks-when-booked behavior from the prior fix.

### Added

- **"You are here" marker on the trip timeline.** When today falls inside your trip window, the timeline now shows a Heritage Orange rail marker at today's position — a single horizontal bar with `TODAY · Wed Jun 5` on the left and `DAY 4 OF 10` on the right, with a subtle pulsing diamond on the rail to say "this is live." If today has no segments, the marker calls it out as a "free and easy" day so you know it's not an error. Past days on the timeline dim to `opacity-55` with a hint of desaturation; today's date node switches its connector ring from teal to Heritage Orange so the transition from past to future is unmissable. Open the app mid-trip and you see today's plan at a glance.
- **Day-number prefix on every timeline date header.** Each date group now reads `DAY 3 · WED JUN 5`, giving a trip-relative reference that pairs with the "you are here" marker.
- **Trip dates display + click-to-edit at the top of the trip summary.** The date range now sits in a chip at the top of every trip's detail view; tapping **Edit dates** reveals the same start/end pickers used in the wizard (with the quick-add chips), and committing hits the store directly. `aria-expanded` / `aria-controls` wiring keeps the interaction accessible. Cancelling restores the previous values.
- **Out-of-range warning banner on the trip summary.** When any segment falls outside the trip window, an amber banner above the timeline shows the count and the current date range, with a **Show me** button that smooth-scrolls to the first misaligned segment. Per-segment amber badge surfaces on the card itself via the existing hint system — two layers of awareness for the same facts.
- **Trip start/end dates as first-class wizard Step 1 fields.** Creating a new trip now asks for start + end dates upfront — required to advance past Step 1. Below the two date pickers, three quick-add chips ("+3 days", "+1 week", "+2 weeks") set end from start in one tap; both dates remain manually editable. Below the inputs a live summary reads "Jun 1 → Jun 10 · 10 days". Validation messages are wired for screen readers via `aria-describedby`.
- **Segment dates auto-populate from the trip window on add.** Round-trip flight → outbound gets trip start, return gets trip end. Cruise → embarkation/disembarkation filled. Train/ferry/car → departure. First accommodation → check-in/out. Rental car / shuttle → pickup/return. Activities still pick their own day. Users can always override after prefill; existing dates on a segment are never overwritten.
- **Out-of-range segments now raise a visible amber hint.** If any segment's date falls before the trip start or after the trip end, the per-segment hint banner explains which side it's on. Uses the existing `computeTimelineHints` surface — one rendering path for all "something's up with this segment" states.

### Fixed

- **Travel plan segment modals no longer fire the "required" error state the moment you open them.** Opening a booked flight, cruise, or accommodation in the editor used to immediately paint empty booking-contingent fields (airline, ship name, confirmation number, etc.) with an orange error ring, even before you'd tried to save. The ring now only fires on a save attempt. In the meantime, an asterisk beside the label tells you which fields _will_ be required — so the same signal is there, just not shouting. Applies across the Flight/Cruise/Train/Ferry/Car/Activity segment editor, the Accommodation editor, and the Transportation editor.

### Changed

- **Renamed session-bracket skills.** `/start-of-day` → `/start-session`, `/end-of-day` → `/end-session`. Triggers broadened to cover switching machines and clearing context, not just day boundaries. `/good-morning` still works as the morning alias (symlink preserved).

### Fixed

- **Avatar photos now render on every surface that shows a member.** Seven call sites (Nook row, dashboard row, app header trigger + 3 dropdown slots, member filter dropdown trigger + option rows, login picker grid + selected card, settings profile header, accounts page section + row, goals page section) were passing `:variant` and `:color` to `<BeanieAvatar>` but skipping `:photo-url`, so the SVG fallback rendered even when the member had a real avatar. All wired up to a new shared helper.

### Changed

- **Consolidated "Your Beans" row into one component.** NookYourBeans + FamilyBeanRow were 90% identical (same structure, events, avatars, role labels) — and had drifted in three separate bugs today (pet sort, pet role label, missing photo-url). Extracted to `BeanListStrip` with `labelKey` / `addLabelKey` / `density` props. FamilyNookPage and DashboardPage now mount the shared component; both deleted files.
- **Shared `getMemberAvatarUrl` / `markMemberAvatarError` helpers** in `useMemberInfo`. Every avatar call site now uses the same two-liner — future rosters can't reintroduce the missing-photo bug by forgetting to wire the URL.
- **Tapping a bean on the Nook row opens the Meet-This-Bean overview** (`/pod/<memberId>`) instead of the edit modal. Dashboard row unchanged (still goes to `/family`).

### Fixed

- **Pet role label on "Your Beans" rows.** The grey role label under each avatar on the Nook and dashboard Family Bean rows fell back to "Parent" / "Big Bean" for pets because the mapping only checked `role === 'owner' || ageGroup === 'adult'`. Now pets show **"Pet Beanie"** (English) / **"pet beanie"** (beanie mode) — matching the role pill in the Add/Edit Beanie drawer. Extracted the role-label helper into a single shared `getMemberRoleLabel()` in `useMemberInfo` so the two components (and any future rosters) stop duplicating the same 5-line switch.

- **Pets now sort last everywhere, including on the Nook.** The earlier fix put pets last in `sortedMembers`, but five surfaces were iterating `familyStore.members` directly (unsorted) or `familyStore.humans` without sorting. Fixed NookYourBeans, FamilyBeanRow, MeetTheBeansPage, FamilyScrapbookPage member-filter chips, and PickBeanView login picker to use `sortedMembers` / `sortedHumans` consistently.

### Changed

- **Pets sort last in every member list.** The family-member sort is now a three-tier order: adults (oldest → youngest) → children (oldest → youngest) → pets (oldest → youngest, then alphabetical). Applied at the single source of truth (`familyStore.sortedMembers`), so every surface that lists members — Meet the Beans grid, Family Nook row, Scrapbook feed, member chip filters, calendar columns, etc. — picks up the new order automatically.

### Fixed

- **PhotoViewer lightbox layout + always-visible close button.** On mobile the read-only lightbox left a white gap below the photo (body's padding was visible + the black container maxed at `min-h-60vh`), and with no header + no footer there was no close affordance — only tapping the backdrop dismissed it. Added a `flushBody` prop to `BaseModal` that drops the body's default `overflow-y-auto p-6` for edge-to-edge media content, and an `overflow-hidden` on the modal wrapper so flush content clips to the rounded corners. PhotoViewer now passes `flush-body`, fills the body with `h-full bg-black/95`, and renders a floating X close button in the top-right of the black container that's always visible regardless of mode (read-only avatar lightbox or editable medication/recipe viewer).

### Added

- **Tap a family member's avatar to see it full-size.** On the Add/Edit Beanie drawer (next to the avatar picker) and on the Meet-This-Bean hero, tapping or clicking an avatar photo now opens it in a read-only lightbox — same component used for medication and recipe photos, same zoom-in cursor on hover. Tapping the default beanie SVG (no photo yet) is inert. Edit controls stay next to the picker and behind the ✏️ Edit button respectively so there's only one path to each edit action.

### Changed

- **Photo rendering switched to `lh3.googleusercontent.com`.** Freshly-uploaded photos (including brand-new avatars) were failing to load with the previous `drive.google.com/thumbnail?id=...` URL — Drive hasn't generated a thumbnail for a file yet at upload time, and `drive.google.com/*` URLs can also bounce anonymous loads to a sign-in interstitial even for anyone-with-link files. Switched every `getPublicUrl` call site to Google's image CDN (`lh3.googleusercontent.com/d/{id}=w{N}`): works immediately for fresh uploads (falls back to serving original bytes when a thumbnail isn't ready), no session sensitivity, same size-modifier support for server-side resizing.

### Fixed

- **Family member avatar now has a visible Remove button.** The avatar picker's Remove action used muted-gray text on a light drawer background — technically visible, easily missed. Restyled to the destructive red treatment used elsewhere (`border-red-300 text-red-700`, dark-mode equivalent) so it reads at a glance as "remove this photo."

- **PhotoViewer footer buttons are visible.** The Remove / Download / position-label elements in the full-screen photo viewer (opened from medication, recipe, and other photo surfaces) were styled for a dark image-overlay background — `text-white/80`, `text-red-300`, `text-white/60` — but the BaseModal footer they actually render inside is `bg-gray-50` (light mode) / `bg-slate-900` (dark mode), so those classes disappeared into it. Destructive Remove button now uses `border-red-300 text-red-700 hover:bg-red-50` with a dark-mode variant; Download stays neutral gray with proper contrast; position label reads clearly in both themes.

- **Family members can see photos uploaded by others — via public-link rendering.** Empirical test of the folder-Picker recovery banner (shipped earlier today) revealed it doesn't actually solve the problem: picking the `beanies.family` folder via Drive Picker does NOT extend `drive.file` OAuth scope to files created by other users inside it. Joined members kept 404ing on photos even after reconnect. Root architectural fix: every photo upload now sets `anyone-with-link → reader` permission on the Drive file, and rendering uses direct Drive CDN URLs (`drive.google.com/thumbnail?id=...&sz=wN` for thumbs, `drive.google.com/uc?export=view&id=...` for full). No OAuth token required to fetch bytes. A one-time migration sweep (`useEnsurePhotosPublic`) runs per-session when the `.beanpod` file ID resolves, iterating every photo in the Automerge doc and setting the permission; per-photo 403 (not this user's file) skipped silently — the file's owner runs the sweep on their own device. Privacy model: URLs live in the encrypted Automerge doc (family key required to decrypt), so effective exposure is the same trust boundary as every other piece of family data. Rolled back the recovery banner machinery (Banner + composable + 25 translation keys) since public-link rendering means there's nothing to reconnect. Kept the folder-pick join flow and the shared `<ErrorBanner>` — both useful independent of this issue. Full scope + privacy analysis in [ADR-021](docs/adr/021-photo-storage.md).

- **Family members can see photos uploaded by others.** Joined members were 404ing on every photo their family uploaded. Root cause: the app uses the `drive.file` OAuth scope (per-file authorization), and the join flow picked the `.beanpod` file — which grants API access to that one file only, not to sibling photos in the same folder. Drive-level folder sharing gives drive.google.com UI visibility but not API access under `drive.file`. Fix has two parts: (1) the join flow now picks the `beanies.family` **folder** via Drive Picker, which grants `drive.file` scope to the folder and every descendant (`.beanpod` + all photos) in a single pick; (2) for family members who joined before this change, a new amber **"Some photos aren't loading"** banner appears when photoStore detects any broken photo, with a **Reconnect** action that opens the same folder picker and validates the selection against the current pod before clearing caches. Both paths share new `findBeanpodInFolder` helper + `useRecoverPhotoAccess` composable, and feed into a new shared `<ErrorBanner>` component that both `SaveFailureBanner` and the new recovery banner now use. Full scope discussion added to [ADR-021](docs/adr/021-photo-storage.md).

### Added

- **Take-photo button on mobile photo attachments.** On phones and tablets, the Add Photo affordance is now two side-by-side tiles — **Take Photo** (opens the rear camera directly via `capture="environment"`) and **From Library** (opens the gallery). Desktop unchanged (single **Add Photo** tile → gallery). Prior behavior suppressed the OS camera option on Android Chrome because `multiple` was hardcoded on, which forces gallery-only. The change applies to every photo surface in the app — medication bottles, cook-log dish snaps, recipe photos, and future integrations. Detection uses `matchMedia('(pointer: coarse)')` so laptops with touchscreens (where the trackpad is still the primary pointer) get the desktop UX, not the mobile one.

### Fixed

- **PWA update-on-nav reliably fires after an overnight tab sleep.** The prior implementation installed the route guard only after a 60-second grace timer — which reset every time `needRefresh` flipped true. When a tab sat overnight and the new version was detected on wake (via the `visibilitychange` handler), the grace clock started fresh, so the user's first click slipped through before the guard armed and the update never applied. The grace timer is now gone: the guard arms the instant an update is detected and defers the reload only while a modal/drawer is open or a Drive save is in flight, so clicking nav never interrupts a mid-edit or an in-flight save. Also fixed a pre-existing bug where dismissing the update banner tore down the guard — dismiss now only hides the UI.

### Changed

- **Friendlier copy on the pet hint** in the Add/Edit Beanie drawer: "Pets are part of your pod, but don't ask them to sign in — they're notoriously bad at using computers." (Replaces the prior matter-of-fact "Pets are part of the pod but can't sign in, get invites, or manage anything.")

### Added

- **Clickable Bean Overview modules.** Each of the five overview modules (Allergies, Favorites, Sayings, Medications, Notes) on the Bean Detail Overview tab is now a keyboard-reachable button card — click anywhere, or press Enter/Space when focused, to jump to the matching tab. Previously only the small "View all →" link was actionable.

### Fixed

- **Medication active-state timezone bug.** Medications with a `startDate` of "today" could flip to **Ended** for users east of UTC — the `isActive()` check compared form dates (local) against `new Date().toISOString().slice(0,10)` (UTC). Consolidated three drift-prone copies (medicationsStore / MedicationCard / BeanMedicationsTab) into a single `isMedicationActive()` helper that uses local-today via `toDateInputValue`.
- **Sidebar "The Pod" expand/collapse on mobile.** The mobile hamburger menu's flat item mapper dropped `NavItemDef.children` entirely, so Pod's 5 sub-items (Meet the Beans / Scrapbook / Cookbook / Care & Safety / Emergency Contacts) were unreachable from phone. Rebuilt to mirror desktop's nested rendering via `useSidebarAccordion`; expand/collapse state now syncs across viewports via localStorage.
- **Pet avatar + role not rendering.** Five `getMemberAvatarVariant()` callers (BeanCard, BeanHero, FamilyBeanRow, MemberFilterDropdown, NookYourBeans) were cherry-picking `{ gender, ageGroup }` from member and dropping the new `isPet` flag — pets rendered as humans. Also hid the Member/Admin `MemberRoleManager` dropdown for pets on BeanCard (they have `role: 'member'` internally but no real access levels).
- **Care & Safety sidebar caps raised 5 → 6** with a "View all {N} →" overflow link to `/pod/safety` on the Heads-up / Today's Care cards, so medications beyond the fifth no longer disappear.
- **Invite modal skipped for pet saves.** The auto-open Invite modal after creating a family member now only fires for humans — pets can't receive invites.
- **Mobile responsiveness (two full passes).**
  - Round 1: 7 Pod hero headers (padding `px-8 py-7` → `px-4 py-5 sm:px-8 sm:py-7`), title `text-3xl` → `text-2xl sm:text-3xl` with leading-tight + break-words, inline buttons stack full-width at mobile.
  - BeanTabs — at mobile only the active tab shows its label; inactive tabs are emoji-only so all 6 fit without horizontal scroll.
  - Sayings rail cards `w-56` → `w-48` on mobile; StatStrip forces 2-col at mobile; BeanCard action icons bumped from 28 px → 36 px touch targets.
  - Round 2: 7 form modals' side-by-side grids `grid-cols-2` → `grid-cols-1 sm:grid-cols-2` so date / dose / phone-email pairs stack on 375 px; birthday picker uses weighted columns (`2fr_1fr_1.2fr`) so full month names fit; MedicationCard photo anchor `w-24 sm:w-28`.
- **E2E `invite-join` spec updated** for `/family` → `/pod` redirect and "Add a Beanie" → "Add Beanie" rename. Logged a webkit-only onboarding flake in `docs/E2E_HEALTH.md`.
- **Security lint unblock** — silenced a false-positive `security/detect-possible-timing-attacks` on `useFileDrop.ts`'s MIME-type equality check. This had been blocking the Security Scanning workflow (and therefore prod deploys) for ~15 pushes; deploys now green.
- **Pod overview sidebar card sizing + overflow** already noted above.

### Changed

- **Meet the Beans redesigned to the Pod overview mockup.** Unified header with kicker "The Pod · Family Scrapbook" + editable family name + one-line stats summary + inline **Invite Beanie** / **Add Beanie** buttons. Body switches to a pod layout (main column + 320 px right sidebar): bean cards sit in a 2-col responsive grid and read highlights directly from the content stores; Recent family sayings rail shows up-to-8 tilted pastel sticky notes; kraft-paper **Secret Family Recipes** strip surfaces up to 4 recipe thumbs + "Add a recipe" tile. Right sidebar replaces Family Stats / Events with **Heads up — Allergies** (severity-chipped list) + **Today's Care** (active meds) + compact Events-this-week.
- **About ribbon on Bean Overview** — moved from white card tiles with shadow to a single flat tinted ribbon (silk→slate gradient, thin vertical dividers, small 🫘 ABOUT kicker). Visually distinguishes informational facts from the clickable dashboard modules below.
- **Copy consistency** — "Add Bean" → **"Add Beanie"**, "Invite Bean" → **"Invite Beanie"**, pet role chip "🐾 Pet" → **"🐾 Pet Beanie"**, BeanCard heads-up label "Heads up" → **"Heads up — Allergies"**.
- **MedicationCard active-state colour** swapped from off-brand emerald to on-brand Sky Silk (#AED6F1).
- **Pets hidden from human-only surfaces across the app (#171).** Pets appear wherever they belong (Meet the Beans roster, scrapbook feed, member avatars, home Family Row, global search, milestones/birthdays, photo galleries) and are now filtered out of every surface where they'd be semantically wrong:
  - **Assignee pickers** — todos, activities, account/asset/goal owners, vacation travelers, onboarding activities. Fixed globally by filtering pets out inside `FamilyChipPicker` (used by every owner/assignee picker) and in the direct `memberOptions` map in `OnboardingFamily.vue`.
  - **Filter chips** — activity/todo/planner filter strips. Fixed globally by filtering pets out inside `MemberChipFilter`.
  - **Global member filter dropdown** (top of finance pages) — filtered at the `MemberFilterDropdown` options source.
  - **Finance member grouping** — AccountsPage "Group by member" sections, GoalsPage per-member sections, subtitle counts (Accounts / Goals). Pets never owned accounts/goals anyway; now they don't appear as empty sections either.
  - **Reports** — Financial reports member-filter dropdown now humans-only.
  - **Planner columns + member chips** — daily/weekly calendar views + FamilyPlannerPage filter panel.
  - **Todo page member chips** — FamilyTodoPage member filter strip.
  - **Cook log "who cooked this"** — CookLogFormModal dropdown humans-only.
  - **Login** — PickBeanView avatar grid (pets can't sign in). JoinPodView "unclaimed members" list filters pets explicitly (belt-and-suspenders; pets have `requiresPassword: false` so they were already excluded).
  - **Vote counts** — VacationIdeaCard's "everyone!" pill compares vote count to human count, not total members.
  - **Global filter store** (`memberFilterStore`) — scoped to humans only so `isAllSelected` doesn't flip off when a pet is added.

  Foundation: added `familyStore.humans` / `sortedHumans` / `hasPets` computed getters so every call site uses one consistent filter instead of hand-rolling `!m.isPet` checks.

## 2026-04-19

### Fixed

- **Mobile responsiveness — form modals + MedicationCard (round 2).**
  - 7 form modals (Saying, Allergy, Medication ×2 grids, CookLog, Recipe, EmergencyContact) had side-by-side field pairs using `grid-cols-2` at all breakpoints. On a 375px phone these fields shrink to ~140px each — dates and emails no longer fit. Switched to `grid-cols-1 sm:grid-cols-2` so paired fields stack on mobile and sit side-by-side from `sm:` up.
  - **Birthday picker** (FamilyMemberModal) was `grid-cols-3` with equal thirds — full month names ("September") clipped at mobile. Changed to `grid-cols-[2fr_1fr_1.2fr]` so month gets double width, day and year stay compact. Universal improvement — reads better at every viewport.
  - **MedicationCard** photo anchor narrowed from `w-28` to `w-24 sm:w-28` so the info column gets breathing room at 375px.
  - Verified: all 8 Pod form modals use `variant="drawer"` → BaseSidePanel → full-width on mobile already. FrequencyChips already uses `flex-wrap`. BeanOverview / Favorites / Sayings / Notes / Allergies / Medications tab grids all collapse to 1 column at mobile via `md:grid-cols-2` responsive modifier.
- **Mobile responsiveness across The Pod (round 1).** Full pass over every new Pod surface at the 375px baseline:
  - **Sidebar mobile nav** — "The Pod" is now expandable/collapsible on mobile (previously its 5 sub-items — Meet the Beans / Scrapbook / Cookbook / Care & Safety / Emergency Contacts — were simply dropped by the hamburger menu's flat item mapper). The mobile menu now mirrors desktop: tapping the chevron toggles the nested sub-nav, and `useSidebarAccordion` (module-scoped + localStorage-backed) keeps the expand/collapse state in sync across mobile and desktop.
  - **Hero headers** (Meet the Beans, Bean Detail, Cookbook, Scrapbook, Care & Safety, Emergency Contacts, Recipe Detail) — all dropped from `px-8 py-7` / `px-9 py-8` to `px-4 py-5 sm:px-8 sm:py-7` so they breathe at mobile instead of eating the viewport. Page titles shrink from `text-3xl` to `text-2xl` on mobile with `leading-tight` + `break-words` so long family names don't overflow.
  - **Header action buttons** (Invite Bean / Add Bean / Edit / "I cooked this" / Add Recipe) — stack full-width below the title on mobile and return to an inline row from `sm:` up.
  - **Bean Detail tabs (6-tab strip)** — at mobile, only the active tab shows its label; inactive tabs are emoji-only so all 6 fit without horizontal scrolling. Labels return from `sm:` up.
  - **Meet the Beans sayings rail** — sticky notes drop from `w-56` to `w-48` on mobile so two cards are visible at a glance on a 375px viewport.
  - **StatStrip** — forced to 2 columns on mobile (was 4 — stats were ~70px wide each), back to N columns at `sm:`.
  - **BeanCard action buttons** — bumped from `p-1.5` (~28px) to `h-9 w-9` (36px) touch targets.

### Added

- **Pet Beans.** Add your dog, cat, or other furry family member to the pod. The Add / Edit Bean drawer now has a third role pill — 🐾 **Pet Bean** — alongside Parent Bean and Little Bean. When Pet is selected, email and permissions fields disappear (pets never receive invites, sign in, or manage anything) and the avatar swaps to a cute beanie dog in the Heritage-Orange palette. Pets count toward the family total in stats and roster views, can have favorites / allergies / medications / sayings / notes like any other bean, and never show the amber "waiting to join" badge or the share-invite button. Uses a new `isPet` flag on `FamilyMember` (additive, non-breaking) plus a new `'pet-dog'` avatar variant backed by `public/brand/beanies_pet_dog_icon_transparent_350x350.png`.

### Changed

- **Meet the Beans — Pod overview redesign.** Page now matches the approved mockup: unified header with kicker ("The Pod · Family Scrapbook"), family name (editable), and one-line stats summary ("5 beans · 12 favorites · 9 sayings · 4 recipes · 2 active meds · 3 allergies"), plus inline **Invite Bean** + **Add Bean** buttons on the same row. Body switches to a pod layout (main column + 320px right sidebar): bean cards sit in a 2-col responsive grid and read their highlights directly from the content stores; a **Recent family sayings** rail shows up-to-8 tilted pastel sticky notes; a kraft-paper **Secret Family Recipes** strip surfaces up to 4 recipe thumbs + an "Add a recipe" tile. The sidebar replaces the old Family Stats / Events panel with a **Heads up — allergies** card (severity-chipped list across all beans) and a **Today's care** card (active meds across the family), with a compact Events-this-week list below.
- **MedicationCard — pharmacy-shelf aesthetic.** Medication cards now feature the bottle photo as a prominent left-side anchor when one exists; without a photo, a brand-colored capsule illustration on a prescription-paper gradient (diagonal hatching + "Rx" watermark) fills the slot so the card never feels half-empty. A 4px Sky-Silk spine on the left edge signals active state (slate when ended); the active/ended chip uses on-brand Sky Silk for active instead of the old emerald green.

### Added

- **The Pod (P6 — Family Scrapbook).** New `/pod/scrapbook` page merges favorites, sayings, and notes from every bean into a single newest-first feed. Pastel multicolor gradient hero with a faded 📖 watermark, filter toolbar (type chips + member chips + clear), CSS-columns masonry layout (3 → 2 → 1 col responsive), and a "Load more" button that appends 30 entries at a time. Sayings render as tilted sticky notes; favorites as category-emoji cards; notes as title + body clamps. Click any entry to jump to the owning bean's tab.
- **The Pod (P5 — Emergency Contacts).** New `/pod/contacts` page with a family phonebook for sitters, grandparents, or anyone minding the kids — doctors, dentists, teachers, schools, plus an "Other" category with a custom label (poison control, emergency pickup, etc.). Search across name/role/phone/email, filter chips per category with live counts, and a grouped list with inline call + email actions. The Care & Safety page now shows a real top-3 preview that routes to the full list (was a stub placeholder before).
- **The Pod (P4 — Family Cookbook + Cook Log).** New `/pod/cookbook` page holds the family's secret recipes — name, prep time, servings, ingredients, preparation steps, family notes, and up to 4 photos per recipe (placeholder illustration when none). `/pod/cookbook/:recipeId` is the recipe detail view with a "I cooked this today" action that opens the Cook Log form (5-star rating, what went well, what to try next time, optional dish photo). Cook logs roll up into per-recipe stats (times cooked, avg rating, last cooked) + a cookbook-wide stats band. A 5-star save fires a new `recipe-5star` celebration toast. Food favorites on a bean's Favorites tab can now link to a cookbook recipe and show a "🥘 From the Family Cookbook →" link-through.
- **The Pod (P3 — Care & Safety).** Allergies and Medications tabs on each bean are now fully editable. Allergy form captures type, severity, what to avoid, reaction, emergency response, diagnosed-by, last reviewed — severity drives a red/amber/green side-stripe and sort order. Medication form captures dose, frequency, start/end or "ongoing" toggle, notes, and an optional bottle photo (second production consumer of the photo foundation — photos land in `data/<familyId>/photos/` just like avatars). New **Care & Safety** page at `/pod/safety` gives a cross-family at-a-glance view: allergy count + severe count + active medication count, severity-sorted allergies across all beans, active medications across all beans, and a stub for Emergency Contacts (ships in P5).
- **The Pod (P2 — Bean Detail).** Each bean now has a dedicated detail page at `/pod/:memberId` with six tabs: Overview, Favorites, Sayings, Allergies, Medications, Notes. Clicking a bean card opens the detail page; the old edit drawer is still available via the new pencil button on the card. **Favorites, Sayings, and Notes** are fully editable: categorize favorites (food / place / book / song / toy / other), capture memorable quotes on pastel sticky notes with optional date + place, and jot freeform notes per bean. Allergies + Medications tabs show empty-state placeholders until Phase 3.
- **The Pod (P1 — foundation).** Sidebar restructured: "My Family" retires, "The Pod" (🌱) nests under Treehouse with five sub-items (Meet the Beans / Family Scrapbook / Family Cookbook / Care & Safety / Emergency Contacts). `/family` redirects to `/pod`. Sub-pages currently redirect to the Meet the Beans landing page until their phases ship (P3–P6).
- **Profile photos for family members.** Upload a photo in the edit-bean modal and your bean's card shows it in place of the beanie variant. Uses the existing Drive sync — photos are compressed locally (1024px, q=0.92) and stored at `beanies.family/data/<familyId>/photos/`. Removing a photo cleans up after the 24-hour grace period; deleting the member cascades the avatar automatically. First real consumer of the photo foundation.
- **Caveat accent font.** Added as the third brand font, reserved for handwritten-style content (saying quotes, polaroid captions, recipe notes). Never used for UI chrome; falls back to Outfit cursive if the webfont fails to load.
- **The Pod — family scrapbook plan + mockup.** Approved implementation plan for turning the Family area into a six-capability hub (Meet the Beans, Family Scrapbook, Family Cookbook, Care & Safety, Emergency Contacts, Family Scrapbook feed). Six-phase rollout, 8 new Automerge collections, photo integrations, Caveat accent font, first integration of the photos foundation. Full plan: `docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md`; mockup: `docs/mockups/family-pod-scrapbook.html`
- **Photo attachments (foundation)** — reusable capability for attaching photos to entities. Ships the plumbing (photoStore, usePhotos composable, PhotoThumbnail / PhotoViewer / PhotoAttachments components, client-side JPEG compression, offline upload queue, Drive-folder sharing on invite, one-time folder-share migration for existing families) without wiring it into any specific entity yet. Integration for activities, family avatars, etc. ships in follow-up plans. See [ADR-021](docs/adr/021-photo-storage.md).
- **`useFileDrop` composable** — drag-drop handler extracted from `JoinPodView.vue`; reusable by the new photo UI and any future drop-zone.
- **`useFilePicker` composable** — programmatic `<input type="file">` wrapper with accept filter, multi-file support, cancel handling, and `value` reset so re-picking the same file still fires `change`.

### Changed

- **`driveService.createFile`** now accepts `string | Blob | Uint8Array` with an optional `contentMimeType` (default `application/json` preserves existing `.beanpod` behavior). Required for binary photo uploads.
- **Invite flow** now shares the `beanies.family` Drive folder alongside the `.beanpod` file so photos uploaded by any member are accessible to everyone.

## 2026-04-18

### Added

- **Plan: general photo attachment capability** — reusable foundation for attaching photos across entities (activities, family members, etc.). Photos stored unencrypted in the shared `beanies.family` Drive folder (inherits `.beanpod`'s share model), referenced by Drive file ID in Automerge. Thumbnails + full-size via Drive's CDN `thumbnailLink`. Missing-photo UX (Replace / Remove). Tombstones + GC sweep. See `docs/plans/2026-04-18-photos-general-capability.md`

---

## 2026-04-17

### Added

- **New blog post: "buy fruit"** — greg's personal story about the moment his wife assigned him a "buy fruit" todo. Published at `/blog/buy-fruit` with screenshot (WebP, 118KB). Cross-linked from the overwhelmed guide's relatedPosts and inline "buy fruit" mention
- **Substack link** on greg's `/about/greg` bio page in the "find me elsewhere" section

### Changed

- **Overwhelmed guide updated** — merged Notion draft with new content: Brigid Schulte _Overwhelmed_ book reference (time confetti concept), new "5 minutes further" reset section, bold `**short answer:**` blocks at all 11 H2s for AIO/GEO extraction, book links to fairplaylife.com + brigidschulte.com
- **Greg bio rewritten** by greg in his own voice — updated copy, fixed typos
- **Travel plans blog** — replaced screenshot (redacted email), minor copy edits
- **MVO architecture pattern** documented across CLAUDE.md, docs/ARCHITECTURE.md, and GitHub wiki. beanies.family follows Model/View/Orchestrator, not MVC — this now drives all architecture and coding decisions

### Fixed

- **Blog index** now shows new posts immediately — removed stale "introducing todos" coming-soon card, fixed CloudFront cache invalidation (was gated on staging/production target; now always invalidates apex distribution)
- **E2E tests** updated for `/welcome` routing after HomePage.vue deletion — removed dead `homepage-get-started` references, fixed state leakage in google-drive spec with `about:blank` teardown pattern

### Removed

- **Staging infrastructure** cleaned up — removed `staging.beanies.family` CloudFront distribution, ACM cert, Route53 DNS records, and noindex response-headers policy from Terraform. Deleted `WEB_CLOUDFRONT_DISTRIBUTION_ID` GitHub variable. Deploy workflow simplified: no more staging/production dropdown, all deploys go to production

---

## 2026-04-16

### Performance

- **Self-hosted Outfit + Inter fonts** on the Astro marketing site using `@fontsource-variable` packages. Removed all Google Fonts third-party requests (`fonts.googleapis.com` + `fonts.gstatic.com`). Variable fonts with `unicode-range` mean browsers download only the latin subsets needed (~80KB per page vs 120+ KB previously across multiple round-trips). Privacy bonus: no request to Google on every page load
- **Converted 26 brand/blog/help images to WebP** (siblings, originals kept for legacy URLs). Total savings: 2.96 MB across the site. The largest win: the main mascot dropped from 1.24 MB PNG to 113 KB WebP (−91%). Blog screenshots and PWA-install guide images also converted
- **Lighthouse CI** now runs on every PR that touches `web/**`, `content/blog/**`, `content/guides/**`, or `packages/**`. Asserts performance ≥95, SEO ≥95, LCP ≤2.5s, CLS ≤0.1, TBT ≤200ms, script weight ≤30 KB/page. Blocks merges that regress perf

### Added

- **Blog posts now render Byline, Breadcrumbs, and RelatedArticles** components. Every post has a linked "by greg" author byline pointing to `/about/greg`, a breadcrumb trail with BreadcrumbList JSON-LD, and a "further reading" section (3 same-category posts, or latest 3 if fewer). Help articles also gained BreadcrumbList JSON-LD. Optional `updatedDate` frontmatter field on blog posts is now supported — sets `dateModified` in BlogPosting JSON-LD when present

- PWA re-install notice for users who installed the app **before** the Astro cutover (2026-04-14). Those users still have a home-screen icon pointing at the old apex origin — the Astro apex already redirects them to `app.beanies.family`, and now also flags the bounce with a query param so the Vue app shows a one-time dismissable modal explaining the situation, reassuring about data safety ("your family file, Drive sync, and password are untouched"), and walking through platform-specific re-install steps (iOS Safari Share menu, Android Chrome three-dot menu, desktop Chrome install icon). Dismiss persists in localStorage. Automatically clears when the user is detected running the new PWA at `app.beanies.family`. Plausible events `pwa_stale_detected`, `pwa_stale_dismissed`, `pwa_stale_install_clicked` track rollout impact. New reusable `noticeFlag(key)` utility (`src/utils/notice.ts`) for any future one-time-notice situations

### Changed

- Marketing surfaces consolidated to the Astro site — help, privacy, and terms now live only at `beanies.family/help`, `/privacy`, `/terms`. In-app links open in a new tab, preserving your PWA session. One codebase per page going forward. Direct visits to any `app.beanies.family/{help,privacy,terms}*` URL redirect cross-origin to the equivalent apex path so existing bookmarks keep working. Trade-off: these pages now require network (previously bundled into the PWA offline cache)

### Removed

- Five Vue pages (`HelpCenterPage`, `HelpCategoryPage`, `HelpArticlePage`, `PrivacyPolicyPage`, `TermsOfServicePage`), three help-only components (`HelpArticleCard`, `HelpArticleRenderer`, `HelpPublicHeader`), one help-search composable, 40+ `help.*` and 4 `legal.*` translation keys. Content at `src/content/help/` is untouched — still consumed by the Astro site. Net reduction: ~2100 lines deleted

---

## 2026-04-15

### Changed

- CI hygiene: migrated Vue deploy (`deploy.yml`, `translation-sync.yml`) from the legacy `CLOUDFRONT_DISTRIBUTION_ID` / `S3_BUCKET` secrets to `APP_CLOUDFRONT_DISTRIBUTION_ID` / `APP_S3_BUCKET` repo variables. Non-sensitive config is now visible in the GitHub UI and follows the `APP_*` / `WEB_*` / `APEX_*` naming scheme used elsewhere. Legacy secrets deleted after a verification deploy passed

### Added

- Draft scaffolds for `/help/glossary` (18 terms, `DefinedTermSet` JSON-LD) and `/help/faq` (20+ Q&As, `FAQPage` JSON-LD) — both hidden in prod via the `DraftPlaceholder` pattern. Content iteration happens locally via `npm run dev:web`; flip `DRAFT=false` to publish (#167)

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
- Vue PWA is now reachable at `app.beanies.family` (in addition to the apex). New CloudFront distribution shares the existing Vue S3 bucket via OAC. OAuth + Google Drive sign-in verified end-to-end on the new origin
- Astro homepage and blog are now pixel-perfect ports of the Vue production pages — same hero, mascot, decorative beans, 3-device showcase, security cards, personal story with pinyin ruby, contact modal, scroll progress bar, reveal-on-scroll animations, back-to-top, image lightbox. Vue interactive logic ported to vanilla JS in `<script>` tags so no Vue runtime ships with the Astro site
- Unified site chrome — pill nav + dark page-footer extracted into shared components and rendered on every page (homepage, blog, help, privacy, terms). One header + one footer everywhere
- Astro now loads Outfit + Inter from Google Fonts (matches the Vue prod typography 1:1; system-font fallback was making text look subtly stretched)
- Astro favicon set matches the Vue app — `beanies_small_bean_favicon_32x32.png` + apple-touch-icon `beanies_father_son_icon_192x192.png`
- Registry DDB split into prod + dev tables. The OAuth Lambda routes by request `Origin`: localhost dev sessions write to `beanies-family-registry-dev`; production origins write to `beanies-family-registry-prod`. Real-user metrics + outbound contact lists now come from a clean prod table (13 real users after migration; 232 historical "Test Family" E2E rows purged)
- E2E suite auto-cleans up after each test — every test pod is removed from the registry table in the Playwright fixture's `afterEach` hook (no more accumulating "Test Family" rows). E2E pod also renamed to "E2E Test Family" so any future cleanup can grep for it
- CORS allowlist on the registry + OAuth APIs extended to `https://app.beanies.family` and `http://localhost:4173` (preview server)

### Added

- Phase C cutover code authored — frontend Terraform module parameterized with `origin_bucket_regional_domain_name`, `viewer_request_function_arn`, and `enable_spa_fallback` variables (all defaults preserve current behavior). Merged `apex-cutover.js` CloudFront Function combines authenticated-path 301s, legacy `/beanstalk*` redirects, and Astro `.html` URL rewriter into one function. Cutover is now a 3-line edit in `infrastructure/main.tf` + one `terraform apply`
- `npm run dev:all` script — starts both the Vue dev server (5173) and the Astro dev server (4321) in parallel with color-coded prefixes, killable with one Ctrl+C
- Cutover runbook (`docs/runbooks/cutover-apex-to-astro.md`) — full step-by-step Phase B/C procedure with verification checklists, rollback plan, and a "Lessons from Phase B" section capturing CORS/OAuth/URL-rewriter/naming gotchas so future cutovers don't rediscover them
- Migration script (`scripts/migrate-registry-dev-rows.mjs`) — multi-mode tool for one-time cleanup of the registry tables. Auto-classifies by email pattern, supports `--keep-prod-only` with a hardcoded keep-list of confirmed real users, plus `--scrub-dev` for cleaning the dev table

### Fixed

- Apex distribution now invalidates correctly on `target=production` deploys via the new `APEX_CLOUDFRONT_DISTRIBUTION_ID` repository variable (gracefully no-op pre-cutover when unset)

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
