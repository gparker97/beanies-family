# Project Status

> **Last updated:** 2026-04-24 (late evening — permissions model cleanup + quick-add FAB permission filter + /guides copy pass, Astro + Vue prod deploy `a453c16`)
> **Updated by:** Claude (2026-04-24 late-evening session covered — fixed the three-toggle permission model (`canViewFinances` / `canEditActivities` / `canManagePod`) across the pod. Wife reported she couldn't save recipes or see edit/log-cook buttons despite having `canEditActivities: yes` (with `canManagePod: no` and `canViewFinances: no`). Research agent mapped every permission check site; two classes of bug found: (a) recipes/cookbook/cook-logs/emergency-contacts gated on `canManagePod` instead of `canEditActivities` (the "can-open-modal-but-can't-save" bug), (b) scrapbook/medications/allergies/todos/travel-plans had NO permission gates at all. Fixed by switching misplaced `canManagePod` gates to `canEditActivities` in `FamilyCookbookPage.vue`, `RecipeDetailPage.vue`, `EmergencyContactsPage.vue`; added fresh `canEditActivities` gates on add affordances + quick-add intents in `BeanAllergiesTab.vue`, `BeanMedicationsTab.vue`, `BeanFavoritesTab.vue`, `BeanSayingsTab.vue`, `BeanNotesTab.vue`, `FamilyTodoPage.vue`, `TravelPlansPage.vue`, and the forwarding handler in `CareSafetyPage.vue`. Final semantic split: `canViewFinances` = piggy bank; `canEditActivities` = everything non-finance + non-roster (recipes, cookbook, cook logs, medications, allergies, emergency contacts, scrapbook, sayings, favorites, notes, todos, travel plans); `canManagePod` = family roster + pod-level settings (no overlap). **Quick-add FAB permission filter**: added `requiredPermission: 'finance' | 'activities'` field to every item in `src/constants/quickAddItems.ts` (18 items), piped through `QuickAddItemShape` + `QuickAddItem` interfaces, and `QuickAddSheet.vue` now computes `allowedByGroup` from `usePermissions()` and hides individual items + entire empty group sections. Previously every member saw every action — finance items bounced to `/no-access` via route guard. **Toggle labels renamed** per user call: `modal.canEditActivities` "Can edit activities" → **"Can edit family content"**, `modal.canManagePod` "Can manage pod" → **"Can manage family members"**. Chinese translations auto-synced via `npm run translate` (2 keys updated). **Tests**: 3 bean-tab tests (`BeanNotesTab`, `BeanFavoritesTab`, `BeanSayingsTab`) needed a `usePermissions` mock since the new gating hid AddTile + empty CTAs in their default-mounted no-member state; mocked all four return keys to `true`. 1509 unit tests green. **Astro `/guides` copy pass bundled into same commit**: hero kicker "a reading curriculum · in order" → "a guide to family organization · in order"; pitch "how to go from…" → "how do we go from…" (question framing); stat "~X min total" → "X min reading time" and dropped the "· a lifetime to practice" flourish; footer now credits `<a href="https://claude.ai/">claude-bot</a>` for research/organization/structure with `<br><br>` before the weekly-thoughts line. **Deploys**: Astro `deploy-web.yml` run `24891528015` 1m0s ✅ and Vue `deploy.yml` run `24891647795` ~1m40s ✅ both shipped cleanly on commit `a453c16`. Main CI `24891514344` 2m48s ✅ + Security `24891514325` 2m0s ✅. **Deferred follow-up**: did NOT add read-only-mode support to pod form modals — so a view-only persona (all three toggles off except maybe `canViewFinances`) who clicks an allergy/medication/saying card still gets an editable modal with a working save button. User's scenario has `canEditActivities: yes` so this edge case doesn't affect her; flagged in commit body as follow-up. Would require a `read-only` prop across `AllergyFormModal`, `MedicationFormModal`, `FavoriteFormModal`, `SayingFormModal`, `MemberNoteFormModal` to hide the save CTA — pattern already exists on `ActivityViewEditModal` via `:read-only="!canEditActivities"`.)
>
> **Pending / Next Session:**
>
> - **Read-only pod form modals** — add a `read-only` prop to `AllergyFormModal`, `MedicationFormModal`, `FavoriteFormModal`, `SayingFormModal`, `MemberNoteFormModal` so a member without `canEditActivities` who clicks a card gets a view-only modal instead of an editable one. Copy the pattern from `ActivityViewEditModal` (`:read-only="!canEditActivities"` passed from the parent tab, modal hides the save/delete CTAs when true). Current scope gates only the add paths — see this session's "Deferred follow-up" note above.
> - **Secondary edit affordances on `TravelPlansPage`** — gated only the primary "Plan a Trip" header button + quick-add intent. Deeper edit paths inside selected-trip view (segment edits, idea edits, "add segment" menu) still render regardless of `canEditActivities`. Not the user's reported scenario; flag if we get a second report.
> - E2E onboarding wizard webkit flake at 2nd logged occurrence — monitor.
> - `seo-geo@opc-skills` plugin evaluation still pending from 2026-04-22.
>
> **Earlier 2026-04-24 update (evening — marketing-site polish: beanstalk + family library hero redesigns, ornamental divider, transparent mascot asset, Astro + Vue prod deploy `694d964`):** Claude (2026-04-24 evening session covered — marketing-site visual polish on `/blog` (the beanstalk) and `/guides` (the family library). **Beanstalk masthead**: wired a new transparent beanstalk-mascot WebP (no halo, replaces the bg-removed fallback from this morning); refreshed subtitles on the 3 existing posts to greg's preferred wording (welcome-to-the-beanstalk → "the story of this site written by an actual human", accidentally-built-greatest-family-app → "or: why vibe coding by yourself at 3am can be hazardous to your health", buy-fruit → "it's the little things that make up life"). Added a new zine-style ornamental divider between the masthead and the featured "latest issue" card — thin heritage-orange rules fading in from each side, bracketing a Fraunces-italic "fresh off the press" label flanked by two accent dots. Echoes the squiggle motif under the beanstalk title without repeating it. Centered symmetrically at 40px/40px desktop and 32px/32px mobile so the divider sits optically between the hero and the card. **Mobile beanstalk fix**: the tall ~0.6-aspect mascot was pushing the title + pitch past the fold once the flex column stacked it on top (130px wide = 222px tall on phones). Pulled it out of flex flow entirely — on mobile it's now a low-opacity watermark (`0.18` tablet / `0.16` phone) centered behind the masthead text, no drop shadow, 240px tablet / 200px phone. Base `.masthead-text` z-index: 1 keeps text above the watermark and above the gradient wash. Top padding trimmed further now that the mascot doesn't consume vertical space. **Family library hero**: greg supplied a new family-reading PNG (dad + three beanies around a book, square 627×627) — converted to `/brand/beanies-family-reading.webp` (512px, 58KB). Rebuilt the hero from an absolute-positioned corner mascot (which clipped on mobile + left desktop empty space) into a proper two-column flex mirroring the help-page hero pattern: text on the left, illustration on the right at 340px with a multi-stop radial halo (heritage orange → terracotta → sky silk → transparent) behind it, gentle 6.5s bob animation (killed by `prefers-reduced-motion`). Mobile stacks `column-reverse` so the scene leads; illustration renders at 260px full opacity, no cutoff. **Deploys**: Both Astro (`deploy-web.yml` run `24887814204`, 1m10s) and Vue (`deploy.yml` run `24887836553`, 1m45s) shipped cleanly on commit `694d964`. Main CI + Security already green for HEAD (runs `24887627249` / `24887627270`), so the Vue verify-gate passed in 5s.)
>
> **Earlier 2026-04-24 update (morning — themed date + time pickers across every modal, page, and quick-edit surface — 2 commits, Vue prod deploy `23d9941`):** Claude (morning session covered — replaced every native `<input type="date">` and `<input type="time">` across the Vue app with themed `BeanieDatePicker` and `BeanieTimeInput` components. Popovers teleport out of their parent so they escape overflow-hidden clipping on segment cards and collapsible modals. Deployed to `https://app.beanies.family` via `deploy.yml` run `24866912948`.)
>
> **New components** (in `src/components/ui/`): **`BeanieDatePicker.vue`** — pill-style trigger matching `TimePresetPicker`, opens a calendar popover with month navigator, Today/Tomorrow quick chips, 7-column day grid (filled orange-to-terracotta gradient for selected, ring for today, faded out-of-month, orange-tinted weekends), "Jump to Today" footer when the user has navigated away. Honours the user's `settingsStore.weekStartDay` — same offset formula as `CalendarGrid.vue`. Accepts `min`/`max`/`disabled`/`label`/`required`/`placeholder` for drop-in parity with `BaseInput`. **`BeanieTimeInput.vue`** — replaces the native browser time picker with a 3-column popover (Hour 1–12 · Minute 0–59 · AM/PM). Selected cell is the same orange gradient; minor (non-5-multiple) minutes dimmed to 60% so `:00 :05 :10…` reads cleanly at a glance. Scroll-snap columns auto-centre selected value on open. Now and Clear shortcuts in the footer. Min/max pass-through so `DoseLogConfirmModal` still blocks future times. Thin themed scrollbar (`scrollbar-color: var(--tint-slate-10)`, modern `rgb(... / 15%)` colour notation). Both components use `<Teleport to="body">` with `position: fixed` coords recomputed on `scroll`/`resize` and a viewport-aware flip-up when space is tight.
>
> **Call-site sweep** (28 files, 56 replacements): **Financial** — AccountModal, AssetModal, GoalModal, TransactionModal, TransactionViewEditModal, QuickAddTransactionModal. **Planner / To-Do** — ActivityModal, ActivityViewEditModal (reschedule flow), TodoViewEditModal (inline edit), QuickAddBar, NookTodoWidget. **Pod** — SayingFormModal, CookLogFormModal, AllergyFormModal, MedicationFormModal, DoseLogConfirmModal. **Travel / Vacation** — TravelSegmentEditModal (flight/cruise/car/activity/train/ferry), IdeaEditModal, TransportationEditModal, AccommodationEditModal, TripDatesInput, VacationIdeaCard, VacationStep2, VacationStep3, VacationStep4. **Travel plans segment cards** — `TravelPlansPage.vue` quick-edit date/time rows rewritten from hidden-`<input>` + `showPicker()` into inline themed pickers; night-flight hint (🌙 early morning / late night) preserved as a compact caption next to the date pill.
>
> **Layout fixes bundled in:** (a) Reschedule flow in `ActivityViewEditModal` — the old 3-column grid (date + startTime + endTime) got crushed on mobile; restructured so date takes its own row and times share a 2-column row below. Matches the new Activity one-off timed flow in `ActivityModal`. (b) Flight/train arrival rows in `TravelSegmentEditModal` + `VacationStep2` — the `+1 day` checkbox took ~80px which squeezed arrival time below departure width. Replaced with a compact `+1` toggle pill (active = Heritage Orange, inactive = slate tint, `aria-pressed`), grid changed from `[1fr_1.3fr_1fr]` to even `grid-cols-3`. (c) Custom date-input overlays in `QuickAddBar.vue` and `NookTodoWidget.vue` (hand-rolled hidden-input + placeholder + focus-state tracking, ~30 lines each) collapsed to a single `<BeanieDatePicker>` line each.
>
> **Teleport fix** — after the first pass users reported calendar popovers clipped at the bottom of `VacationSegmentCard` because its `overflow-hidden` transition wrapper on the collapsible body cut off any absolutely-positioned child. Fix: both pickers now teleport to `<body>` with `position: fixed`; popovers compute top/left from `getBoundingClientRect()` of the trigger and clamp to an 8px viewport margin; `scroll`/`resize` handlers recompute; `handleClickOutside` now checks both `dropdownRef.contains(target)` AND `popoverRef.contains(target)` (popover is no longer a DOM descendant of the trigger).
>
> **Tests**: `TripDatesInput.test.ts` updated — mount now seeds Pinia, aria-wiring assertion dropped (native `input` attributes no longer apply on a Teleport-ed button), two-way-binding tests use `wrapper.findAllComponents(BeanieDatePicker)[…].vm.$emit('update:modelValue', …)` instead of `setValue()` on `input[type="date"]`, and the quick-add chip query narrowed from `button[type="button"]` to `button[aria-disabled]` so the picker triggers don't count. 1509 unit tests green throughout.
>
> **Translations**: 7 new keys auto-synced to Chinese via `npm run translate` — `date.pick`, `date.jumpToToday`, `time.hour`, `time.minute`, `time.period`, `time.now`, `time.clear`.
>
> **Deploys**: Main CI ✅ 2m44s · Security ✅ passed · Deploy beanies PROD ✅ 1m35s (verify 5s + build 1m9s + S3 + CloudFront invalidation 22s). No Astro deploy — zero `web/` changes. Commit SHA deployed: `23d9941` (on top of feature commit `878d894`).

**Previous update (2026-04-23 — all-day marketing-site rebuild + FAB ship + nav overhaul + content sync — ~25 commits, multiple prod deploys):** Claude (2026-04-23 afternoon/evening session covered — massive marketing-site + content + FAB shipping day, deployed in multiple waves across `https://app.beanies.family` and `https://beanies.family`).

> **FAB shipped end-to-end** (commits `a17a575`, `76b526f`, `1f5f8b1`, `55b8616`): Phase 1 + Phase 2 of the quick-add FAB implementation plan from the morning session. New `src/constants/quickAddItems.ts` (18-item config after dropping redundant Recurring), `src/composables/useQuickAdd.ts` (module-singleton state + `buildIntentQuery` pure helper + `triggerQuickAddAction` + picker stage machine + history.pushState integration for back-gesture dismissal), `src/composables/useQuickAddIntent.ts` (per-page intent consumer), `QuickAddFab.vue` / `QuickAddSheet.vue` / `QuickAddPicker.vue` / `QuickAddMemberPicker.vue`. Router meta + beforeEach guard for hideQuickAdd routes. Inline member-picker renders under the tapped section (everyday/family/care) instead of view-swap; recipe + medication remain full view-swap. Corner × + "close" pill footer (filled slate) added to sheet; history-back gesture dismisses (pushState marker + popstate listener; `router.replace` overwrites marker on action nav so back from target → pre-sheet page). 19 unit tests cover history integration + open/close + navigation. Wired into 13 pages (AccountsPage, AssetsPage, BudgetPage, CareSafetyPage with giveDose, EmergencyContactsPage, FamilyCookbookPage, FamilyPlannerPage, FamilyScrapbookPage, FamilyTodoPage, GoalsPage, RecipeDetailPage, TransactionsPage, TravelPlansPage) + 5 bean tabs. 37 new `quickAdd.*` translation keys.
>
> **Marketing-site rebuild** — two full page redesigns + a nav overhaul. **`/guides` library (`cdcfa72`, `f117a77`, `1e64498`)** — rebuilt from a plain card list to "the family library": Fraunces-italic hero + corner family-hugging mascot, curriculum-arc nav (4 numbered nodes + gradient connectors + scroll-spy), 2×2 chapter-cover grid with per-pillar SVG textures (swirl/grid/ledger/circuit), oversized glyphs, "what's inside" bullets extracted from each guide's H2s at build time via `render()`, core-ribbon "start here" on pillar 1, tag chips, slate "read chapter N" CTA. Added `ItemList` + `CollectionPage` JSON-LD. Canonical pillar reading order (`PILLAR_ORDER` + `comparePillarOrder` helpers in `utils/content.ts`) — not chronological; shared between the library and prev/next on each guide. Also added prev/next guide nav at the bottom of `[...slug].astro`, back-to-top button, scroll-behavior:smooth global, per-pillar textures. **FAQ + Glossary (`73849fd`, `b910058`, `85de495`)** — rebuilt with "reference-book" aesthetic. FAQ: sticky left category sidebar (5 tint-colored categories) with scroll-spy, client-side filter-as-you-type with pre-computed per-item text and empty-state panel, circled Q-numbers, footer CTA. Glossary: sticky A–Z strip (inactive letters dimmed), alphabetical sections with oversized italic Fraunces dropcaps, core-vocabulary bookmark ribbons (5 terms), computed "see also" chip row via substring word-boundary regex across term bodies. Both get corner mascots + `<style is:global>` (needed for scoped CSS to reach `set:html` content in answers/definitions). **FAQPage + DefinedTermSet JSON-LD preserved unchanged. Guide detail polish (`8844091`, `65243cc`)** — fixed headings-wrap-too-soon (moved overflow-wrap:anywhere/word-break off `.guide-prose` root onto `p` only), added explicit `list-style: disc/decimal` (Tailwind preflight was stripping markers), drop-cap float containment via `display: flow-root` on `.guide-lead` (so list bullets after short leads don't get pushed right). **Nav overhaul (`3a983b8`, `c93dc45`)** — hamburger drawer below 820px (slide-from-top, full-width sheet with rounded-bottom corners + shadow, 320ms bezier, role=dialog + focus-trap + Esc-to-close + body-scroll-lock + matchMedia viewport-guard, animated-to-X hamburger icon); full pill nav stays above 820px. Added `family library` link to top nav. **Footer cleanup (`b373a90`)** — dropped GitHub from main link row (duplicated homepage CTA), moved privacy + terms to fine-print row alongside copyright (classic legal-strip pattern), added faq + glossary + family library. **Help index feature cards (`2a94edb`)** — new "quick reference" section between categories and popular articles; FAQ (orange wash) + Glossary (sky-silk wash) with count badges.
>
> **Content sync from Notion** (`510dca6`, `aa09f3d`) — greg edits FAQ/Glossary/Overwhelmed guide in Notion first (now a permanent memory at `~/.claude/projects/.../feedback_content_notion_canonical.md`). This session: pulled Notion via MCP, resolved all `<add link here>` annotations to real URLs, applied voice edits, preserved inline formatting (bold/italic/paragraph breaks) — FAQ template switched from `<p class="faq-a">` to `<div class="faq-a">` for multi-paragraph answers; 6 FAQ answers now render with their Notion paragraph breaks. Overwhelmed guide: restored bold on "Brigid Schulte" + "Eve Rodsky", moved book-title link onto italic `_Overwhelmed_`, italicized "make invisible labor more visible" to match Notion. **Em-dash sweep** (`f117a77`) — replaced every `—` and `–` with `-` across 4 pillar guides + welcome-to-beanstalk blog (218 instances). Per new `feedback_no_em_dashes.md` memory: em-dashes read as an AI-writing tell; greg wants ASCII hyphens in all authored content. **Contact routing** (`5f358cd`) — all non-coding feedback CTAs now route to `/#contact` (the Slack-backed modal from the footer's `💬 get in touch with me` button) instead of GitHub issues. FAQ empty-state, footer CTA, glossary footer, homepage story, and the "Can I give feedback" FAQ answer itself all updated. **Note:** the one FAQ Q/A text change couldn't be mirrored back to Notion via MCP — the `mcp__notion__API-update-a-block` wrapper has a schema bug (requires a `type` parameter that the Notion API rejects). Repo is correct; one manual Notion touch-up needed on the "Can I give feedback" block. **Pillar draft flips** (`25e5bb1`) — flipped `draft: true` → `false` on all 4 pillar guides' frontmatter + on `/help/faq` and `/help/glossary` pages. FAQ/Glossary use page-level `DRAFT` constant; guides use content-collection per-entry `draft` filtered by `isPublished()`.
>
> **Prod fix loop** (`1e64498`, `25e5bb1`, `3a983b8`) — greg reported 4 live issues mid-session: (a) header overflowing viewport on narrow phones; (b) `/guides` library page rendering blank cards because `.pillar > *:not(.pillar-texture):not(::after)` was invalid CSS (pseudo-elements can't go inside `:not()`; whole rule failed silently, leaving pillar children under the z-index:0 texture overlay); (c) FAQ + Glossary showing `DraftPlaceholder` on prod because `DRAFT = true` was still set; (d) blog hero mascot clipped by the now-wrapped mobile nav. Fixed all four: dropped invalid `::after` clause on pillar selector, flipped DRAFT flags, bumped mobile hero padding-top from 60-92px to 140px across blog/library/faq/glossary, added `flex-wrap: wrap` to nav. Then greg flagged the 140px padding felt excessive once the hamburger was in place (nav back to single-row), so reverted to 84-100px.
>
> **E2E harden** (`b364b7a`) — three webkit-only flakes on the "E2E Tests" supplementary workflow (cross-entity onboarding wizard + planner recurring tests) all had explicit `timeout: 5000` overriding the webkit 60s project default. Bumped to 15s to match the `dismissActivityCreatedConfirm` pattern already in `activity-modal.ts`. `docs/E2E_HEALTH.md` logged the flakes as (c) — onboarding is now at its 2nd logged occurrence.
>
> **Small polish** — chapter number format on guides library changed from `01/02/03/04` to `1/2/3/4` (removed `padStart`) per greg ("looks more natural"). Recipe detail "back to the cookbook" double-arrow fix (literal `←` removed from translation string; `<BeanieIcon name="chevron-left"/>` now owns the single visual cue). FAB recurring tile removed (redundant with Transaction tile — both opened the same drawer). Prev/next pillar nav on guide detail pages. Guides + FAQ/Glossary link styles unified (was scoped-css scoped out of `set:html` content; `is:global` fix made them reach).
>
> **Memories added**: `feedback_no_em_dashes.md`, `feedback_content_notion_canonical.md`, `project_pillar_order.md`.
>
> **Tests**: 1509 unit tests green throughout (no regressions from any change). E2E webkit tests harden in flight. **Deploys**: multiple prod waves — `a17a575` (FAB), `aa09f3d` (content sync), `8844091` (guide polish), `76b526f` (FAB close button), `1f5f8b1` (corner ×), `cdcfa72` (library rebuild), `f117a77` (hero + arc + em-dashes), `73849fd` (FAQ/glossary rebuild), `b910058` (count spacing), `85de495` (is:global), `5f358cd` (contact routing), `2a94edb` (help feature cards), `b373a90` (footer cleanup), `1e64498` (prod fixes), `25e5bb1` (draft flips), `3a983b8` (hamburger), `c93dc45` (drawer from top), `b1aad1e` (chapter numbers).
>
> **Pending / Next Session:**
>
> - **One-off Notion manual fix:** the FAQ "Can I give feedback" block (`343247d9-a99f-8158-b133-e93b649c2cc9`) needs the answer updated in Notion to match the repo version: _"Absolutely! Use the **get in touch** button at the bottom of any page to send me a message. Every message is read by a real human. Feedback from early users has a huge impact on what gets built next."_ MCP `update-a-block` endpoint has a schema bug; manual touch-up only.
> - Guide detail-page section counters still use `decimal-leading-zero` ("chapter 01" inside a pillar's H2 sections). Parallel to the library change; greg hasn't asked to update these, but worth mentioning for consistency.
> - E2E onboarding wizard flake is now at 2nd logged occurrence. If it flakes again after the 15s harden, will need a deeper look at webkit `<Transition>` timing on the wizard step-transitions.
> - Hamburger drawer currently slides from the top per greg's preview request. If he prefers the right-side slide, swap `translateY(100%)` → `translateX(100%)` (trivial). Both variants live in git history (`3a983b8` right vs `c93dc45` top).
> - **Try the `seo-geo@opc-skills` plugin** ([ReScienceLab/opc-skills](https://github.com/ReScienceLab/opc-skills), MIT, ~809★). Install via `/plugin marketplace add ReScienceLab/opc-skills` then `/plugin install seo-geo@opc-skills`. Point it at `https://beanies.family/guides/overwhelmed-family-planning` (and the homepage) and see whether its audit + Princeton-9-methods GEO framework surfaces anything the current CLAUDE.md rules don't already cover. If it's all duplication, uninstall — no lock-in. Be skeptical of one dated tip (`meta name="keywords"` — Google's ignored it since ~2009). Evaluate once, then decide whether to keep, codify its useful bits into `.claude/skills/beanies-theme/`, or drop.

**Previous update (2026-04-23 morning — design session, quick-add FAB mockup + implementation plan):** Claude (2026-04-23 session covered — no code shipped, design + plan only. **Quick-add FAB mockup and implementation plan for issue #37.** Session was purely exploratory + planning: (1) **GitHub issue #37 refreshed** — posted a "Requirements update" comment ([#issuecomment-4300983352](https://github.com/gparker97/beanies-family/issues/37#issuecomment-4300983352)) reflecting that the app has grown from 5 → 18 addable entities since the issue was filed in Feb 2026 (adds activities, todos, trips, sayings, favorites, notes, recipes, cook-logs, medications, allergies, emergency contacts, budgets, dose logs, trip ideas). Updated acceptance criteria + `MobileBottomNav` collision constraint. (2) **Interactive mockup built** at `docs/mockups/quick-add-fab.html` — single HTML file with 6 FAB variants side-by-side in a simulated phone frame: arc fan, bean-jar stack, bottom sheet, center-tab in bottom nav, draggable AssistiveTouch, and the combined recommended direction (sheet + jar-pop Money → reframed as "everyday beans"). Dark-mode toggle, fake dashboard page beneath for real-estate context, full working animations for all 6 variants. Iterated through several rounds with greg: reframed the top tier from domain-first (Money) to frequency-first (Activity/To-do/Transaction/Trip/Cook log/Saying); expanded from 5 → 6 items (3×2 grid); audited emoji/icon conventions against the actual codebase and fixed 6 mismatches (Transaction 💸→💳, Trip 🏝→✈️, Favorite ⭐→💝, Asset 🏠→🏢, Recipe 🍲→🍜, Allergy 🚨→⚠️ — all cross-referenced to `navigation.ts`, `BeanTabs.vue`, `VacationWizard.vue`); filled empty grid slots with missed entities (Budget, Trip idea, Dose log) — final 18-item audit complete. (3) **FAB design** — greg provided two Gemini-generated peek-a-boo beanie PNG concepts (orange + slate/blue versions, ~5 MB each). Wired them into the mockup's FAB (all variants 1/2/3/6 that have a classic FAB); added idle-bob animation (2.6s translateY -3px, killed by `prefers-reduced-motion`), hover halo, and 45° rotate on open. Orange = light-mode default; slate = dark-mode. PNGs resized 1824×2338 → 720w for mockup asset committed at `docs/mockups/assets/` (10 MB → 1.8 MB total; production will use a proper SVG greg is still refining). (4) **Implementation plan written** at `docs/plans/2026-04-23-quick-add-fab-and-sheet.md` — 3 structural decisions locked with greg (mobile = floating FAB above bottom nav NOT center-tab integration; sub-entity context = pre-fill parent id when on detail page; scope = all 18 entities wired end-to-end, drop draggable, defer Settings customization). Plan proposes 5 new files (`QuickAddFab.vue`, `QuickAddSheet.vue`, `useQuickAdd.ts`, `useQuickAddIntent.ts`, `quickAddItems.ts`) + surgical edits to App.vue, router meta, 13 per-page intent consumers, `uiStrings.ts` (22 new `quickAdd.*` keys, en + beanie). Phased as Phase 1 (FAB chrome + 6 everyday entities) + Phase 2 (remaining 12 + sub-entity context handlers). Explicit CIG reconciliation section: every font size ≥ 12px (mockup had 10-11px), Fraunces italic swapped for Inter italic (Fraunces is guide-scoped per status), `--tint-orange-8/15` vars replace inline hex, standard Tailwind radii only. Three open implementation items flagged: (a) final FAB SVG asset from greg, (b) `BudgetSettingsModal` must open cleanly in blank-create from FAB, (c) `IdeaEditModal` may need trip-picker-first mode for off-trip FAB invocation. Tests spec'd: comprehensive unit coverage, zero new E2E (over 25-test ADR-007 cap). **Next session:** pick up FAB implementation (Phase 1) OR layout/design pass on guides index + FAQ/glossary pages (greg's two carry-forward items). **Previous update (2026-04-22, evening — tier-1 zine-editorial redesign on pillar guides):** Claude (evening session covered — 1 commit on `main`, no prod deploy. **Tier-1 guides redesign shipped against pillar 1 as prototype** (`4a4a67a`). Prior sessions drafted 4 pillar guides as wall-of-text markdown with TOC + short-answer blocks; greg asked for a design pass to make them engaging, fun, and visually distinctive while preserving AIO/GEO as the top constraint. Direction chosen: **family-zine editorial** — magazine-article warmth (NYT Magazine long-read + Ink & Switch research log + beanies Pod/Scrapbook/Cookbook zine motifs) with every AIO crawlability requirement held. Prototyped Tier 1 end-to-end against pillar 1 (`overwhelmed-family-planning`) so greg can feel it in a real 3k-word piece before extending to the other 3. **What shipped:** (1) **Short-answer block component** — new rehype plugin `web/src/lib/rehype-guide-annotations.mjs` walks the HAST, detects `<p><strong>short answer:</strong> ...</p>` (case-insensitive, with-or-without colon), adds `guide-short-answer` / `guide-short-answer-label` class hooks. CSS turns them into kraft-paper cards with Heritage Orange left-rail + `::before` quote-glyph + `::after` TL;DR badge. Semantically still `<p><strong>...</strong></p>` — crawlers read unchanged. 11 blocks in pillar 1 all picked up. (2) **Drop-cap lead paragraphs** — same plugin tags first `<p>` after every `<h2>` with `guide-lead` (but skips the short-answer paragraph so the cap always lands on narrative body). `::first-letter` renders a 4.25rem Fraunces cap with Heritage Orange → Terracotta gradient-text via `-webkit-background-clip: text`. 14 applied in pillar 1. (3) **Body serif swap** — `@fontsource-variable/fraunces` installed in web workspace, imported in `[...slug].astro` only (NOT BaseLayout) so every non-guide marketing page stays lean. Font stack: Outfit (display) + Inter (body elsewhere) + Fraunces (guide body + italic excerpts) + Caveat (reserved for future callouts). (4) **Chapter eyebrows** — `.guide-prose h2::before` with CSS `counter(chapter, decimal-leading-zero)` renders "CHAPTER 01", "CHAPTER 02" etc. Zero content edits, zero AIO impact. `::after` adds a 48px Heritage Orange rounded bar under each H2 for chapter-opener feel. (5) **Decorative dividers** — `.guide-divider-top` between ToC and body renders a 🫘 between hairline gradient rules. (6) **Hero refresh** — brand kicker dot + "THE BEANIES GUIDES · PILLAR" eyebrow, `guide-emoji-breathe` 6s sine scale/rotate (killed by `prefers-reduced-motion`), title clamp(2rem, 5vw, 3.25rem) + `text-wrap: balance`, italic Fraunces excerpt with `font-feature-settings: 'ss01'`, meta line has reading-time derived from `guide.body.split(/\s+/).length / 220` (pillar 1 → 14 min read). (7) **Top ToC redesign** — numbered chapter list (Fraunces italic decimal-leading-zero numerals), hairline row separators, bean badge popping out of top-left of card. Still semantic `<ol>`. (8) **Sticky section rail** (≥1200px only via CSS grid columns) — right-margin nav with dotted vertical line, per-H2 dot + label, live-synced `.is-active` state via `IntersectionObserver` (rootMargin `-10% 0px -70% 0px`). Active dot fills Heritage Orange with 3px halo. On <1200px the rail simply doesn't render. (9) **Reading progress bar** — fixed 2px Heritage Orange → Terracotta gradient at top using CSS `@supports (animation-timeline: scroll())` with `scroll(root block)` timeline; no-op on non-supporting browsers (decorative, not load-bearing). (10) **"What to take away" recap card** — new optional `keyTakeaways: string[]` field on guides Zod schema (`web/src/content.config.ts`). Rendered as Deep Slate gradient panel with Heritage Orange radial glow before further-reading; numbered `<ol>` in Fraunces italic with Heritage Orange `decimal-leading-zero` markers. Plain semantic list — highly AIO-quotable. Pillar 1 populated with 5 structured takeaways. Other 3 pillars will get theirs in follow-up. (11) **"From the beanstalk" card** — renamed from generic "further reading", orange arrow slides on hover. (12) **Copy-link anchor** appears on H2 hover — `#` glyph in monospace right-aligned, fades in on `:hover`. **AIO guardrails held throughout:** short-answer blocks stay semantic `<p><strong>...</strong></p>`; recap is plain `<ol>`; no JS-gated content; `prefers-reduced-motion` kills all motion; initial DOM = fully visible (animations are pure enhancement). **Verified:** `curl /guides/overwhelmed-family-planning` → 200 OK, 146KB, 11ms. Grep-audit: 28 `guide-short-answer` class refs, 14 `guide-lead`, 41 `guide-rail`, 26 `guide-recap`, 6 Fraunces CSS references in rendered HTML. Adjacent routes `/guides`, `/`, `/blog`, `/help` all 200 — no regressions. Tests 1420 passed (no test changes this session). CI green; no prod deploys (guides all remain `draft: true`; `deploy-web.yml` is `workflow_dispatch` only). **FAQ/glossary investigation** — greg asked where those live and how to preview; clarified they're already fully authored at `web/src/pages/help/{faq,glossary}.astro` (25 Qs / 18 terms with FAQPage + DefinedTermSet JSON-LD) but gated behind `DRAFT = true` + `isDraftHidden()` (prod shows `DraftPlaceholder`, DEV shows full content). STATUS "needs content" marker was stale. Also discovered `@fontsource-variable/outfit` + `inter` weren't installed in workspace at start of session (ran `npm install` to fix a local-dev error). **Previous update (2026-04-22, afternoon):** Claude (afternoon session covered — 2 commits on `main`, no prod deploys. **(1) E2E webkit flake fix** (`ddd7bb1`): three webkit tests hard-failing/flaking on CI because the inline `dismissCreatedConfirm` helper used a 5s click timeout on the CreatedConfirmModal's OK button — trace showed the "Add Activity" save click succeeded but the confirm modal rendered later than the window allowed on webkit under contention. Extracted `dismissActivityCreatedConfirm` to new shared helper `e2e/helpers/activity-modal.ts` that waits for the "Activity Created" heading first (15s) as a semantic signal, then clicks OK. Deduplicates the inline helper that was copy-pasted across `planner.spec.ts` (4 call sites) and `cross-entity.spec.ts` (2 call sites). CI run 24758643613 confirmed: webkit 19/21 passed + 2 unrelated flakes that passed on retry; chromium 21/21 clean. E2E_HEALTH.md logged as (c) flake with fix rationale. **(2) 4 pillar guides authored** (Notion → repo sync, Notion is golden source going forward): all 4 marketing guides now live in `content/guides/` marked `draft: true`. **Pillar 1 (Overwhelmed with Family Planning)** already in repo — bumped `lastUpdated` + `buy-fruit` already in relatedPosts. **Pillar 2 (Family Organization)** new — ~3.1k words, 10 H2s with `short answer:` blocks, 4 typos fixed, 5 links inserted (overwhelmed guide ×2, travel-plans-intro blog, Four Thousand Weeks by Burkeman), 1 pending link to the cozi-alternatives blog post (placeholder + HTML comment; greg adds Friday when that post ships). **Pillar 3 (Family Finance Basics)** new — ~3.6k words, 11 H2s with `short answer:` blocks, 9 typos fixed, YMYL callout added as first body element ("not financial advice, consult a professional"), DTI thresholds softened and cited to CFPB's ability-to-repay rule, salary→expenses inconsistency fixed in the emergency-fund section, $10/mo compounding caveat added (nominal vs invested at 7%). **Pillar 4 (Local-first Family Tools)** new — ~3.2k words, 10 H2s with `short answer:` blocks, 6 typos fixed (incl. Automerge capitalization), 14 external link insertions (Mint sunset announcement, Sunrise TechCrunch, The Markup Life360 investigation, Ink & Switch ×2, Automerge ×2, Yjs, MDN: Web Crypto + IndexedDB + File System Access, Tauri, Capacitor, Cozi/Time Inc acquisition PR); family-app-shutdowns sentence rewritten to link both Sunrise and Mint. Link format is `[anchor](URL) ← <annotation> <!-- link added: greg confirm -->` — annotation preserved for greg's audit grep. **Notion bidirectional sync** — ~49 Notion block updates + 3 archives + 1 new callout block (Pillar 3 YMYL) to mirror the repo versions. Notion page title/properties untouched; STATUS/TARGET/PROPOSED FRONTMATTER working notes left intact. **Preview verified**: all 4 URLs return 200 on `npm run dev:web`; greg visually confirmed pages look good. Residual cleanup flagged for next session (arrow artifacts from Notion still in the repo markdown). **Previous update (2026-04-22, morning)**: 1 commit deployed to prod (`68186cf`). **Net-worth chart correctness + aggregation hygiene fix.** Five bugs (one user-reported, four latent) addressed in a single PR with comprehensive plan + test coverage. **Bug A — balance_adjustment in chart history** (the reported bug): `useNetWorthHistory` replay loop was silently skipping `balance_adjustment` transactions, so greg's +$500k manual adjustment yesterday rendered as a flat line at the new amount. Now correctly subtracts the adjustment when walking past it (with sign flipped via `accountNetWorthMultiplier` for liability accounts). **Bug B — Reports Income vs Expenses chart** (`ReportsPage.vue:444-462`): the per-tx loop classified every non-income transaction as an expense via a binary ternary, so transfers and balance adjustments rolled into `totalExpenses` / `netCashFlow`. Fixed with an early-continue guard. **Bug C — loan-payment principal in chart**: chart reversed the cash side of loan payments but not the corresponding debt-balance reduction; historical net worth was overstated by cumulative principal paid. Fixed by extending the expense branch to also reverse `loanPrincipalPortion`. **Bug 5 — `createdAt` clamping**: new accounts/assets created today appeared at their current value across the entire historical chart. Now clamped: pre-creation chart points correctly omit the entity. Asset+linked-loan combos cancel correctly to net-zero retroactive contribution. **Bug D — visual misclassification**: NookRecentActivity and GlobalSearch rendered `balance_adjustment` rows with the credit-card icon. Now use a dedicated ⚖️ icon with green/orange tint reflecting direction; transfers get 🔄 with blue tint. **Architecture refactor**: replay logic extracted to a pure `utils/netWorthHistory.ts` module built around a single `NetWorthChange` event abstraction. The composable becomes a thin orchestrator (~50 lines) with a try/catch chartResult wrapper exposing `chartError` to the hero card (3-way flat template: error / empty / chart). **DRY wins**: 6 sites of duplicated `credit_card || loan ? -1 : 1` multiplier logic eliminated via new `finance.ts` helpers (`isLiabilityType`, `accountNetWorthMultiplier`, `accountBalanceDeltaFromTx`); 2 local `isLiability(type)` definitions in DashboardPage + AccountsPage deleted. Sibling `getTransactionVisual` helper in `transactionLabel.ts` so any activity-row surface gets stable icons. Cash-flow computeds extracted out of `useNetWorthHistory` into new `useMonthOverMonthCashFlow` composable so the chart composable stays single-responsibility. **Safety**: `assertNever` (new `utils/assertNever.ts`) on every `tx.type` switch — compile-time exhaustiveness against future TransactionType additions. Warn-and-skip for data anomalies (missing `adjustment` metadata, missing `createdAt`, account not in store). Architectural non-goals doc-block in `netWorthHistory.ts` flags daily-snapshots as the only path forward for asset re-valuation history. Plan: `docs/plans/2026-04-22-net-worth-chart-and-aggregate-correctness.md`. **Tests**: 1339 → 1420 (+81 new tests across `finance.test.ts`, `transactionLabel.test.ts`, new `netWorthHistory.test.ts`, new `useMonthOverMonthCashFlow.test.ts`, new `useNetWorthHistory.test.ts`). 21 files changed, 2258 insertions, 302 deletions. CI + Security green; Vue deploy run `24755152864` succeeded in 1m26s.

**Previous update (2026-04-21):** Claude (session covered — 9 commits, all deployed to prod across multiple waves. \*\*Goal activity log + quick-contribute flow + account activity log + joiner-Drive fix + sidebar scrollbar + E2E regression fix + deploy-skill tooling)

> **Updated by:** Claude (2026-04-21 session covered — 9 commits, all deployed to prod across multiple waves. **Evening wave (2026-04-21):** **Goal activity log + quick-contribute flow** (`7709928`, deployed) — new `GoalViewModal` drawer that merges automated `Transaction` contributions (where `goalId === goal.id`) with user-reported manual contributions into a single chronological activity log via new shared `<EntityActivityLog>` component (AccountViewModal refactored onto the same component in-place; all 6 existing regression tests pass). Primary footer action is a new `GoalContributionModal` (centered modal, stacks over the drawer) — amount + optional note; crossing 25/50/75/100% of target fires `celebrate('goal-milestone')`; success toast carries an Undo action via existing `useToast.actionFn` (6s); manual rows gain an inline trash button for persistent delete with danger confirm. Manual contributions store inline as `Goal.manualContributions?: GoalManualContribution[] = {id, amount, at, updatedBy, note?}`. Store-level invariant inside `goalsStore.updateGoal(id, input, options?)` — optional `{contribution: {author, note?}}` appends atomically via `appendContributionIfChanged` helper; automated paths (`transactionsStore.applyGoalAllocation`, `recurringProcessor.updateGoalProgress`) omit the options and never emit audit entries. `GoalModal` edit field relabeled "Current amount" → "Remaining amount" with a two-way computed bridge (reducing remaining = positive currentAmount delta = positive contribution). New composables: `useAuthoringMember()` (centralizes `currentMember ?? owner` + no-author toast; `useAdjustBalance` refactored to use it), `useContributeToGoal()` (contribute + saveWithContribution + undoContribution). New shared `<EntityActivityLog>` takes a generic `ActivityEntry[]` with optional `onClick`/`onDelete` per row; fixed-width trailing slot on every row so amounts column-align even when some rows have delete buttons and others don't. Sort within a date group uses full-timestamp tiebreaker (`tx.createdAt` / `contribution.at`) so a just-added contribution appears at the top of today's group. `GoalsPage` card-tap flipped to `openViewModal`; ✏️ icon still opens edit; new `viewingGoalId`/`contributingToGoalId` refs (ids only, with live computeds) so the view modal stays reactive when the store updates the goal reference. `getPriorityConfig` extracted to `src/constants/goalDisplay.ts`. `transactionsStore.transactionsForGoal(id)` derived getter + `TransactionsPage` `?goal=<id>` URL filter + dismissible pill. Plan: `docs/plans/2026-04-21-goal-activity-log.md`. 1339 unit tests green (+49 this plan). **Account activity log v2** (`17ac108`, deployed earlier in session) — AccountViewModal bumped to `size="wide"` (max-w-xl) and gained a neutral Close button in `#footer-start` next to the primary Edit save button, matching MedicationViewModal convention. **Sidebar scrollbar fix** (`b504f80`, deployed) — `useSidebarAccordion` route watcher now auto-collapses parent sub-nav when navigating outside its subtree (Pod's 5 children only show while on `/pod/*`); parent item padding `py-2.5`→`py-2` + nav `space-y-1`→`space-y-0.5` tighten density by ~50px. **Joiner Drive fix** (`8c99ce5`, deployed) — `syncStore.listGoogleDriveFiles` now uses `searchBeanpodFilesGlobal(token)` instead of `getOrCreateAppFolder + listBeanpodFiles`, eliminating the eager empty `beanies.family` folder on joiner Drives. Create + photo-upload paths still resolve the folder on demand at write time. **E2E regression fix** (`6112103`, already live) — `cross-entity.spec.ts:402` Data integrity test hardcoded `2026-04-20` as a one-time activity's date, which dropped out of the Upcoming list the next day; replaced with runtime `tomorrow` date matching the convention in `planner.spec.ts`. **Deploy-skill tooling** (`818ba31`, not deployable — `.claude/` only) — extracted classify-changes shell logic to `scripts/deploy/classify-changes.sh` so the deploy skills can call a single pre-approvable command instead of inline subshells + regex alternations; simplified both `deploy-prod-auto` and `deploy-prod-auto-skip-ci` skill docs to use single-command forms + multi-`-m` commit bodies + `gh run watch --exit-status` (dropped `; echo "exit: $?"` noise); removed unused `deploy-prod` skill. **Bio refresh** (`fe268a2`, astro deploy fe268a2 in-flight at session close) — greg.astro sentence-cased + added "vibe coding" mention. **Account activity log feature** (shipped earlier 2026-04-21 — `89170da` committed, `17ac108` refined + deployed) is fully live. 1244 tests at start of day → 1339 at close (+95 over the day's sessions).

**Previous update (2026-04-21, earlier):** Claude (session covered — 2 commits, one deployed to prod (`09ff76d` — medication administration log), plus follow-up refinements not yet deployed. **Medication administration log — full feature** (`09ff76d`, deployed): new `MedicationLogEntry` type + `medicationLogs` Automerge collection auto-migrated via ALL_COLLECTIONS; `medicationLogRepository` thin wrapper on `createAutomergeRepository`; `deleteMedicationCascade` in medicationRepository atomically removes a med + all its logs in one changeDoc. Store extension on `medicationsStore`: `logsForMedication` (descending by administeredOn), `dosesToday` (local-timezone via `toDateInputValue`), `lastDoseAt`, plus `createMedicationLog`/`deleteMedicationLog` via wrapAsync (auto error toasts). `useGiveDose` composable as single orchestration primitive called from both the card 💊 quick-action and the drawer CTA. `useDoseConfirm` + `DoseLogConfirmModal` as a global singleton promise-based dialog mirroring `useConfirm` pattern; mounted in App.vue once. Dialog shows today's doses for the medication as read-only context (reuses `MedicationLogRow` with new `readOnly` prop — DRY) + editable date/time picker defaulting to now with future values blocked both via `max` attr and a gating computed. `useToast` extended with optional `{ actionLabel, actionFn, durationMs }` — first-class Undo primitive reusable by any future undoable action; errors from `actionFn` surface as an error toast + console.error (never silent). `MedicationCard` restructured from single `<button>` to `<div>` wrapping two sibling buttons (body emits `view`, corner 💊 emits `give-dose` with `@click.stop`) so tap targets can coexist; `ACTIVE` badge dropped (spine+opacity+button already signal it), `ENDED` chip kept where scannability matters. `BeanMedicationsTab` uses explicit `ModalState` variant (`none | viewing | editing`) instead of paired booleans; reactive watcher auto-closes the view modal if a medication is deleted remotely. `pluralize()` helper in new `src/utils/format.ts` + `toTimeInputValue()` in date.ts. Plan: `docs/plans/2026-04-21-medication-administration-log.md`. **Refinements** (committed locally but not yet pushed): view modal → right-side drawer (BeanieFormModal variant="drawer") matching site convention; "I gave this dose" → "Log a dose" everywhere; dose-log UX shifted from "warn if ≥1 dose today" to "always show a confirmation dialog" (supports retroactive logging + shows today's history in-context); Close button added to drawer footer alongside primary save (mirrors Activity view-edit modal's `#footer-start` pattern); calendar activity location field became a single whole-field Google Maps link (consistent with the travel-plans pattern — editing moves to main ✏️ Edit button); ended medications collapse into a `📋 Ended medications` section on `BeanMedicationsTab` mirroring the completed-goals pattern on GoalsPage (count pill + rotating chevron + `aria-expanded` wiring). 1244 unit tests green (+44 from the dose log foundation + 7 toast + 8 dose-confirm + 23 store).

**Previous update (2026-04-20, late-afternoon session):** Claude (session covered — 10 commits, all deployed to prod in two waves: **Planner mobile timeline polish, Bean pet role, spinner refresh, monthly→daily drill-in**)

> **Updated by:** Claude (session covered — 10 commits, all deployed to prod in two waves: **Planner mobile timeline, round 2** (`2c43a35`, `eb6b378`, `90b89a2`) — `<MemberChipFilter>` inside the mobile daily view was duplicating the page-level member filter; removed the local chip and made `mobileDayActivities` + weekly `dayDensities` honor `memberFilterStore` (same semantics as desktop's column hiding). Timeline cards gained compact assignee markers (up to 3 colored initial-circles, overlapping with `-space-x-1`) and inline location (`· 📍 <location>` after the time) on both timed and untimed rows. **Tablet (768-1023px) responsiveness fix** — at narrow desktop widths the flex-wrap card layout pushed `MemberChip` name pills below the time label and they overflowed past the duration-based card height; restructured to a clean two-row flex (title / time · location · chips), and `MemberChip` gained a new `size="dot"` variant (16px colored circle + first-initial, shared by mobile + tablet). `Daily` + `Weekly` calendar cards swap `size="sm"` → `size="dot"` at tablet and bump the visible cap 2→3. Desktop (≥1024px) keeps the readable name pills. **Pet role on Bean detail** (`b3f3ef8`) — `BeanHero.vue` and `BeanOverviewTab.vue` derived the role label from `ageGroup` only (`child ? 'Little Bean' : 'Parent Bean'`), so pets with `ageGroup='adult'` rendered as "Parent Bean". Added `isPet` first-check and reused the existing `dashboard.rolePet` ("Pet Beanie") key — no new i18n key needed (user caught a proposed duplicate). **Beanie spinner refresh** (`55479bb`, `2626ffb`, `8e5724c`) — signature loading state now has layered kinetics: 2.6s breath scale (0.98↔1.04) offset from the 1.8s spin for bouncy feel, animated drop-shadow glow cycling Heritage Orange → Teal → Terracotta, soft radial halo behind (`-40%` inset, fades fully by 85% — no orange disc boundary — after a round of user feedback to scale back the original 68% stop and drop the dashed orbit ring). Label "counting beans" got `background-clip: text` gradient sweep across the full brand palette at 3.2s, three bouncing dots (one per brand color, 150ms stagger) replacing the static ellipsis. Dots aligned with `align-items: baseline` + -0.15em translate so they sit where a typographic ellipsis would. All kinetic layers gated on `prefers-reduced-motion` with a gentle opacity-pulse fallback. New `halo` prop defaults to `label` — inline spinners (photo thumbs, avatar picker, login buttons) stay lean; only `<BeanieSpinner label />` in App.vue gets the atmosphere. **Monthly click → daily view + agenda button** (`0314dd8`) — previously day-cell click popped the agenda drawer. Now it drills into the daily timeline for that day; `CalendarNavBar.vue` gained an `#actions` slot before the Today button, `DailyCalendarView.vue` injects an Agenda icon-button (list icon + label, icon-only on mobile) that emits `open-agenda` with the current date; `FamilyPlannerPage` routes that to `sidebarDate` (the drawer is completely unchanged). New `focusedDate` ref cleanly separates "which day is highlighted on the grid + where daily view starts" from "which date's agenda drawer is open". Weekly view gets the same drill-in behavior for consistency. **Help docs follow-ups** (`423b82e`, `a47b6c7`) — four `https://app.beanies.family` mentions in getting-started.ts were plain text; converted to proper anchors with `target="_blank" rel="noopener"` and added `.help-article-content a` styling in Astro's `global.css` (Heritage Orange, underline offset, hover Terracotta). Also dropped a one-line nudge into each device's PWA-install step 1 so users don't sign in twice (once on the web page, once inside the app). All runtime changes deployed — Vue via `deploy.yml`, Astro via `deploy-web.yml` (the latter was missing from the earlier skill classifier because `src/content/help/` is consumed by both apps; `deploy-prod-auto` now classifies both workflows independently). 1206 unit tests green.)

Plan: shipped ad-hoc from conversation (no plan doc this session).

> **Previous update (2026-04-20, earlier session):** Claude (session covered — four commits not yet deployed: **C1 — `useBookingValidation` composable** — extracted the triplicated `bookedErrors` pattern from the Flight/Cruise/Train/Ferry/Car/Activity segment editor, Accommodation editor, and Transportation editor into a single typed-generic composable. Booking-contingent fields now show an asterisk only when `status === 'booked'` (live with status changes); the orange error ring is deferred until the user attempts to save. Try/catch around every rule predicate means a throwing rule marks the field missing with a `[useBookingValidation]` console.error (fail-safe, never silent). **C2 — First-class trip dates (ADR-023)** — promoted `FamilyVacation.startDate`/`endDate` from derived fields (min/max of segment dates, recomputed on every save) to user-owned state. Fixes the reported bug where moving an outbound flight later silently shrank the trip around a hotel whose dates were still valid. New `extendTripDates` (widen-only, `isValidISODate` guard, `[vacation]`-prefixed warn on bad input) + `prefillSegmentDates` / `prefillAccommodationDates` / `prefillTransportationDates` (each with exhaustive TS `switch` over its enum). `computeTimelineHints` refactored into five per-concern detectors composed at the top via a shared `addHint` helper that takes structured extras (`nightFlight`, `outOfRange`). Wizard Step 1 gained a new reusable `<TripDatesInput>` component (two date pickers + three quick-add chips + live "N days" summary + `aria-describedby` error wiring); required to advance past Step 1. Steps 2/3/4 call the prefill helpers on segment/accommodation/transportation add. `vacationStore.updateVacation` has a three-step date pipeline: manual-edit path → seed fallback for historical vacations → auto-extend with segment candidates. Activity-sync failure wrapped with `console.error` + warning toast ("Trip saved, but your calendar may be out of date"). **C3 — Summary-page trip-date display + out-of-range banner** — new `<TripDatesHeader>` on the trip detail view (date chip + click-to-edit affordance reusing `<TripDatesInput>` inline, `aria-expanded`/`aria-controls` wired). Out-of-range banner via `<ErrorBanner severity="warning">` — count + trip range + "Show me" button that smooth-scrolls to the first misaligned segment (wired via `data-segment-id`). The banner filters on the structured `outOfRange` flag, not string-matching hint messages. **C4 — Unified flight/cruise form layout + simplify pass** — flight form restructured into trip-shape (Date | From | To, responsive `sm:grid-cols-[1fr_1fr_1.3fr]`) + "Booking details" caption + booking-contingent rows; cruise parallel (embarkation + disembarkation + port top, then caption + line/ship/time). `/simplify` skill run over the diff surfaced three genuine cleanups: the three quick-add chips collapsed to a `v-for` over a const config array; `computeTimelineHints` now builds `acc`/`cruise`/`flight` item projections once and passes to the three overlap detectors (was rebuilding across detectors); `AddHint` type grew a structured `extras?: Partial<TimelineHint>` param so `detectNightFlights` / `detectOutOfRange` no longer need raw `hintMap` access — consistent signature across all five detectors. Also: `BaseInput` gained `inheritAttrs: false` + `v-bind="$attrs"` on the underlying `<input>` so aria/data/autocomplete attrs land where callers expect. **Not shipped this session:** the E2E regression test called out in the plan — unit coverage (`vacationStore.test.ts` covers "extend on later segment", "no-shrink on within-range move", "seed fallback on undefined existing dates", "activity-sync failure toast" — 6 new cases) is strong enough that the E2E was deferred to a broader E2E-budget revisit (current suite is at 33 tests, already above ADR-007's 25-test cap; consolidating `cross-entity.spec.ts:81` is a separate scope). 1184 unit tests green (+87 this session).

Plan: `docs/plans/2026-04-20-travel-plans-ux-refactor.md`. ADR: `docs/adr/023-user-owned-trip-dates.md`.

> **Previous update (2026-04-20, earlier session):** Claude (session covered — 10 commits, all deployed to prod: **PWA update reliability** — arm the route guard the moment `needRefresh` flips true (prior 60s grace period reset whenever the tab woke up, so overnight-sleep + morning-click tabs never received the update); defer the reload while a modal is open (`hasOpenOverlays()` from overlayStack) or a Drive save is in flight (`syncStore.isSyncing`); fix the pre-existing dismiss bug where hiding the banner tore down the guard via the watcher. **Take-photo button on touch-primary devices** — PhotoAttachments renders a second tile (Take Photo / From Library) on phones+tablets (`matchMedia('(pointer: coarse)')`); camera input uses `capture="environment"`; `useFilePicker` gained an optional `capture` binding; gallery `multiple` now conditional on `max > 1`. **Photo access for family members — public-link rendering (ADR-021).** First attempted folder-Picker "recovery" flow (`pickBeanpodFolder` + `findBeanpodInFolder` + recovery banner + `useRecoverPhotoAccess` composable) — shipped then proved architecturally wrong: `drive.file` scope grants picking-a-folder access to the folder and its future-created files only, NOT to existing files other users put in it. Rebuilt with the correct approach: every photo upload now sets `anyone-with-link → reader` permission via new `setPublicLinkPermission` in driveService (called from `finalizeUpload`, `addAvatarPhoto`, `replacePhotoFile`); rendering switched to `lh3.googleusercontent.com/d/{id}=w{N}` (Google's image CDN, no session state, serves originals as fallback when a thumbnail hasn't been generated yet — `drive.google.com/thumbnail?id=...` failed for fresh uploads); migration sweep in new `useEnsurePhotosPublic` composable mounted from App.vue runs once per session after `driveFileId` resolves. Old recovery-banner machinery deleted (PhotoAccessRecoveryBanner + useRecoverPhotoAccess + 25 recoverPhotos.\* translation keys + photoStore.hasBrokenPhotos/clearUnresolved). Folder-pick join + `findBeanpodInFolder` helper kept — marginally cleaner join UX. **Shared `<ErrorBanner>`** extracted from SaveFailureBanner's structure so banners share transitions + severity colors; also fixed a silent catch in SaveFailureBanner's backup-download path (now toast + console.error). **PhotoViewer upgrades** — `readOnly` prop hides the footer for surfaces that own their own edit controls (avatar picker, BeanHero); `flushBody` prop on BaseModal bleeds the body edge-to-edge (fixed white gap below photo on mobile); always-visible floating X close button (top-right of the black container) regardless of readOnly; footer buttons restyled with explicit contrast colors (were white/80 on bg-gray-50 — invisible); `max-h-[80vh]` → `max-h-full` for edge-to-edge mobile. **Avatar lightbox on Add/Edit Beanie + Meet-This-Bean hero** — tap a member avatar to open a read-only lightbox; edit controls stay in the admin drawer / ✏️ button to avoid duplicate Replace paths with different tombstoning semantics. **BeanAvatarPicker Remove button** restyled from muted-gray (invisible on light drawer bg) to the destructive red treatment used elsewhere. **Pets always sort last everywhere** — `familyStore.sortedMembers` comparator rewritten as three-tier: adults (oldest→youngest) → children (oldest→youngest) → pets (alphabetical). Audited all call sites: fixed NookYourBeans, FamilyBeanRow, MeetTheBeansPage grid, FamilyScrapbookPage member-filter chips, PickBeanView login picker — all five were iterating `familyStore.members`/`humans` directly without using the sorted getters. **Pet role label** — "Your Beans" row was showing "Parent" / "Big Bean" for pets because `getRoleLabel` only checked role/ageGroup. Added `dashboard.rolePet` ("Pet Beanie" / "pet beanie") and a shared `getMemberRoleLabel()` helper in useMemberInfo; pet check comes first so `isPet` overrides any ageGroup classification. **BeanListStrip consolidation** — NookYourBeans + FamilyBeanRow were 90% identical and drifted through 3 separate bugs today (pet sort, pet role label, missing photo-url). Extracted to single `<BeanListStrip>` with `labelKey` / `addLabelKey` / `density` props. FamilyNookPage + DashboardPage now mount the shared component; both original files deleted. **Avatar photos render everywhere** — 7 surfaces were passing `:variant`+`:color` but skipping `:photo-url` to BeanieAvatar: AppHeader (4 dropdown slots), MemberFilterDropdown (trigger + options), PickBeanView (grid + selected card), ProfileHeader, AccountsPage (section + row), GoalsPage (section). Fixed via new shared `getMemberAvatarUrl` / `markMemberAvatarError` helpers in useMemberInfo. **Nook nav change** — tapping a bean on the Nook "Your Beans" row now routes to `/pod/<memberId>` (Meet-This-Bean overview) instead of `/family?edit=` (admin edit modal). Dashboard unchanged. **ADR-021 updated** twice: once with the `drive.file` scope implications (folder-pick attempt) and again with the public-link decision + privacy analysis (final). **Copy upgrade** — pet hint on Add/Edit Beanie drawer from matter-of-fact to friendlier ("Pets are part of your pod, but don't ask them to sign in — they're notoriously bad at using computers"). 1097 unit tests green.)
>
> **Previous update (2026-04-20, earlier session):** Claude (session covered: **The Pod P5** Emergency Contacts page (`/pod/contacts`) with hero, category chips, search, CRUD via EmergencyContactFormModal; Care & Safety preview wired live (no longer stub). **P6** Family Scrapbook (`/pod/scrapbook`) — merged feed of favorites/sayings/notes across all beans with type+member filter chips, masonry layout, load-more (30+30), sticky-note saying tiles using paper-colored whole-card treatment. **Meet the Beans** page redesigned faithfully to the Pod overview mockup — unified header with kicker + family name + stats summary + inline Invite Beanie / Add Beanie buttons, pod layout (main + 320px sidebar), bean-card grid pulling highlights directly from content stores, Recent-sayings rail with tilted pastel sticky notes, kraft-paper Secret Family Recipes strip with recipe thumbs + Add-a-recipe tile, right sidebar with Heads up—Allergies + Today's Care + compact Events-this-week cards. **Pet Beanies** — third role pill alongside Parent/Little Bean; pets get new beanie-dog avatar (`public/brand/beanies_pet_dog_icon_transparent_350x350.png`), `FamilyMember.isPet?: boolean` (additive), hide email/permissions/invite UI, count toward roster total but skip invitable-count + Drive folder-share migration + invite-modal auto-open after save. **#171 pet visibility audit** across ~18 surfaces — added `familyStore.humans`/`sortedHumans`/`hasPets` getters; `FamilyChipPicker` + `MemberChipFilter` + `memberFilterStore` + `MemberFilterDropdown` filter pets globally; AccountsPage/GoalsPage member sections, ReportsPage filter, PickBeanView login, JoinPodView unclaimed, VacationIdeaCard vote count, CookLogFormModal "cookedBy", DailyCalendarView/FamilyPlannerPage columns, FamilyTodoPage chips, OnboardingFamily assignee — all humans-only. **Full mobile responsiveness pass (two rounds)** — fixed sidebar Pod expand/collapse on mobile via nested `AppSidebarSubNav` rendering in MobileHamburgerMenu; hero headers on 7 Pod pages (padding + title size + button stacking); BeanTabs emoji-only for inactive tabs at mobile; sayings rail width; StatStrip forces 2-col at mobile; BeanCard touch targets 28→36px; 8 form-modal grid-cols-2 → grid-cols-1 sm:grid-cols-2; FamilyMemberModal birthday picker weighted columns; MedicationCard photo width w-24 sm:w-28. **Mobile sidebar caps 5→6** with "View all N →" overflow link to /pod/safety. **Medication timezone bug fix** — three `isActive` implementations (medicationsStore, MedicationCard, BeanMedicationsTab) consolidated into one `isMedicationActive()` helper using local-today via `toDateInputValue`; prev implementations used `new Date().toISOString()` (UTC) which flipped meds to "Ended" for users east of UTC when start-date equalled local-today. **Bean Overview clickable cards** — OverviewModule becomes a keyboard-reachable button card (click/Enter/Space emits `activate`); all 5 modules (Allergies/Favorites/Sayings/Medications/Notes) navigate to their tab. **Copy consistency** — "Add Bean"→"Add Beanie", "Invite Bean"→"Invite Beanie", pet role "🐾 Pet"→"🐾 Pet Beanie", BeanCard heads-up label "Heads up"→"Heads up — Allergies". **About ribbon redesign** — BeanAboutStats moves from white tiles to a single flat tinted info ribbon with thin vertical dividers + 🫘 ABOUT kicker, visually distinct from the clickable dashboard modules below. **Security lint unblock** — silenced false-positive timing-attack on `useFileDrop.ts` MIME-type equality, which had been blocking the Security Scanning workflow (and therefore deploys) for ~15 pushes. **E2E invite-join fix** — updated for /family→/pod + "Add a Beanie"→"Add Beanie" rename; logged webkit-only onboarding wizard flake in docs/E2E_HEALTH.md. **ADR-022 + ARCHITECTURE.md Pod section** — 10 architectural decisions captured (per-type collections, no new encryption, Caveat accent font, share-as-image mechanism, sidebar nesting, DRY cadence, no-silent-catches, presentation-free types, page composition, pets as isPet flag). **Deployed to prod** (commit 31fffba earlier in session). 1083 unit tests green; chromium + webkit E2E green.)
>
> **Previous update (2026-04-19, Pod P4):** Claude (session covered: The Pod — Phase 4 Family Cookbook + Recipe detail + Cook Log. Single commit: shared components PolaroidImage + MemberPill; recipes + cookLogs stores wired into app load; photoStore GC cascades registered for `recipes` + `cookLogs`; FamilyCookbookPage at /pod/cookbook with kraft-paper hero, stat strip, recipe grid using polaroid photo (or kraft-paper placeholder illustration) + prep/servings/ingredient-count meta, "+ Add a recipe" action; RecipeFormModal with eager-create-on-first-photo pattern (reused from P3 medications); RecipeDetailPage at /pod/cookbook/:recipeId with polaroid hero, ingredients + steps panels, Caveat family-notes card, per-recipe cook-log stats + entry cards, "I cooked this today" flow; CookLogFormModal with 5-star rating input, dish photo (max=1), celebration trigger on new 5-star entries (new `'recipe-5star'` trigger added to useCelebration registry); food favorites now link to cookbook recipes via a picker in FavoriteFormModal + "🥘 From the Family Cookbook →" chip on the favorite card that routes to the recipe. 1083 unit tests green.)
>
> **Previous update (2026-04-19, Pod P3):** Claude (session covered: The Pod — Phase 3 Allergies + Medications + Care & Safety. Single sub-commit: AllergyFormModal (type + severity chips, avoid-list / reaction / emergency-response fields, diagnosed-by + reviewed-on defaults to today), MedicationFormModal (dose / frequency / ongoing toggle, startDate defaults to today, PhotoAttachments max=1 for bottle photos with eager-create-on-first-upload), BeanAllergiesTab (severity-sorted grid with red/amber/green side-stripes + inline emergency-response line), BeanMedicationsTab (active-first then alphabetical, dim for ended), Overview dashboard Allergies/Medications tiles now show live data with severity dots, CareSafetyPage (/pod/safety) with cross-family StatStrip + severity-sorted allergy list + active-medications list + Emergency Contacts preview stub. `registerPhotoCollection` calls moved out of store module scope to App.vue init to break the photoStore→syncStore→medicationsStore→photoStore import cycle that surfaced in P3 dev. 1062 unit tests green.)
>
> **Previous update (2026-04-19, Pod P2):** Claude (session covered: The Pod — Phase 2 Bean Detail. Three sub-commits (P2-A through P2-C): shared pod components, BeanDetailPage shell + Overview tab, Favorites/Sayings/Notes tabs with form modals, avatar-photo robustness passes, `data/<familyId>/photos/` Drive layout. 1062 unit tests green.)
>
> **Previous update (2026-04-19, Pod P1):** Claude (session covered: The Pod — Phase 1 foundation. Plan: `docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md`. Five sub-commits (P1-A through P1-E): 8 new Automerge collections + entity types, 7 stubbed stores wired through `wrapAsync` + `automergeRepository`, photo-foundation extensions (`maxDimension`, `max` prop, `photoUrl` on BeanieAvatar, Caveat font), sidebar two-level nesting (`AppSidebarSubNav`) with The Pod parent + 5 children under Treehouse, `/family` → `/pod` redirect, FamilyPage → MeetTheBeansPage + FamilyMemberCard → BeanCard renames, end-to-end avatar photo upload, BeanCard renders uploaded avatars, "Meet the Beans" page title. 1062 unit tests green.)
>
> **Previous update (2026-04-19, photos):** Claude (session covered: photo attachment foundation — full reusable capability across services, store, composables, UI components, invite-flow migration, ADR, and docs. 10 commits pushed; 1060 unit tests green.)
>
> **Previous update (2026-04-17):** Claude (session covered: blog publishing, content authoring, infrastructure cleanup, architecture documentation, E2E fixes)
>
> **Previous update (2026-04-16):** Claude (Four PRs:
>
> (4) Epic #167 engineering cleanup — self-hosted Outfit + Inter fonts (fontsource variable, removed Google Fonts externals); 26 images converted PNG/JPG → WebP (2.96 MB saved, −91% on the main mascot); blog posts now render Byline/Breadcrumbs/RelatedArticles with BreadcrumbList JSON-LD; help articles get BreadcrumbList schema; optional `updatedDate` blog frontmatter; Lighthouse CI workflow added (gates perf ≥95, LCP ≤2.5s, CLS ≤0.1, TBT ≤200ms, JS ≤30KB/page on web/content PRs). Plan: `docs/plans/2026-04-16-epic-167-engineering-cleanup.md`.
>
> (1-3) See prior runs on this date: (1) Help + Privacy + Terms consolidated to Astro — 5 Vue pages + 3 components + 1 composable deleted, ~2100 lines removed; in-app links open `beanies.family/{help,privacy,terms}` in new tab; `MARKETING_URL` constant + reusable `externalRedirect()` router helper. Plan: `docs/plans/2026-04-16-consolidate-help-to-astro.md`. (2) Stale-PWA re-install notice — pre-cutover PWA users (start_url baked to old apex) land at Astro → inline script redirects them to app.beanies.family with `?from-stale-pwa=1` flag → Vue app activates a one-time dismissable modal with platform-aware re-install steps (iOS/Android/desktop), reassurance copy, and link to install guide. Auto-clears flag once user is detected on the new PWA at app.beanies.family. New reusable `noticeFlag(key)` utility + `useStalePwaNotice()` composable. Plan: `docs/plans/2026-04-16-stale-pwa-reinstall-notice.md`)
> **Previous update (2026-04-15):** Claude (Phase C cutover confirmed live at apex; legacy Vue-deploy secrets CLOUDFRONT*DISTRIBUTION_ID + S3_BUCKET migrated to APP*\_ repo variables matching WEB\_\_/APEX\_\* naming; draft glossary + FAQ pages scaffolded with DefinedTermSet + FAQPage JSON-LD, hidden in prod via DraftPlaceholder — #167)

## Pending / Next Session

**🟠 Quick-add FAB — implementation (from 2026-04-23 design session):**

- Plan: `docs/plans/2026-04-23-quick-add-fab-and-sheet.md`. Mockup: `docs/mockups/quick-add-fab.html` (open variant 06 — the recommended direction — in a browser; toggle dark mode in top-right).
- **Phase 1 (first PR):** scaffold `QuickAddFab.vue` + `QuickAddSheet.vue` + `useQuickAdd.ts` + `useQuickAddIntent.ts` + `quickAddItems.ts` config array with all 18 entries. Mount FAB globally in `App.vue` gated by `meta.hideQuickAdd`. Wire 6 everyday entities end-to-end (Activity, To-do, Transaction, Trip, Cook log, Saying). Add 22 new `quickAdd.*` i18n keys (en + beanie). Comprehensive unit tests, no new E2E.
- **Phase 2 (second PR):** wire remaining 12 entities (Family 4 + Money 5 + Care 4, includes **Budget** which was missing from the FAB's original spec). Add sub-entity context pre-fill — when on `/pod/:memberId` or `/pod/cookbook/:recipeId` or `/travel/:vacationId` or medication detail, skip the picker and pre-fill the parent id in the opened modal.
- **Blocking/awaiting:** final SVG asset for the peek-a-boo beanie (greg refining from the Gemini concepts) to live at `public/brand/beanies_plus_sign.svg` (single file, themeable via CSS var for orange/slate).
- **Implementation-time verification items:** (a) `/budgets` route confirmed exists; `BudgetSettingsModal` must open in blank-create mode when triggered from FAB. (b) `IdeaEditModal` may need a trip-picker-first mode for when user taps Trip idea from outside a trip. (c) Per-page modal pre-fill props — verify each per-bean modal accepts a `memberId` pre-fill prop; add where missing.
- **CIG reconciliation locked in the plan:** mockup had 10-11px text — all bumped to `text-xs` (12px min); Fraunces italic (guide-scoped) replaced with Inter italic in FAB context; `--tint-orange-8/15` CSS vars in place of inline hex; standard Tailwind radii only (`rounded-3xl` sheet / `rounded-2xl` kraft card / `rounded-xl` items / `rounded-full` FAB).

**🟠 Guides index + FAQ/glossary pages — layout & design pass (from 2026-04-22 evening, explicit carry-forward):**

- Pillar pages now have their family-zine editorial treatment. The `/guides` index page (`web/src/pages/guides/index.astro`) is still the pre-redesign layout — weakest link in the new aesthetic; needs a pass to feel continuous with the pillar pages (kicker, zine typography, card density, relationship between pillars).
- FAQ (`web/src/pages/help/faq.astro` — 25 Qs + FAQPage JSON-LD) and glossary (`web/src/pages/help/glossary.astro` — 18 terms + DefinedTermSet JSON-LD) both fully authored but gated behind `DRAFT = true` + `isDraftHidden()` (prod shows `DraftPlaceholder`, DEV shows full content). Open design questions: do these get the same editorial treatment as the pillars, or a distinct help-center-reference treatment? Where do we surface them — cards on `/help` index, inline links from guides (e.g. glossary terms linked via `<dfn>`), promote glossary to its own top-level nav, or keep as deep-links? How does overall IA thread guides ↔ help ↔ FAQ ↔ glossary coherently? Discussion first, design second.
- **Residual content cleanup before flipping pillars `draft: false`:** arrow artifacts `←` + `<!-- link added: greg confirm -->` annotations still in pillars 1-4 (repo AND Notion). Greg's cozi-alternatives blog post targeted Friday 2026-04-24 — once it ships, Pillar 2's placeholder `<link to cozi app options post>` gets filled in. Greg handles that reminder himself.

**🟢 Net-worth chart follow-ups (from 2026-04-22 plan, explicitly deferred):**

- **Asset value re-valuations have no history.** Changing `asset.currentValue` today retroactively rewrites every historical chart point for that asset. Per-asset valuation events would fix it; deferred. Documented in the doc-block of `utils/netWorthHistory.ts`.
- **Asset-to-liability `transfer` semantics.** `calculateBalanceAdjustment` increments destination balance by `+amount` for `transfer` type — wrong direction for credit-card payoffs (where dest balance should DECREASE). Needs a UX decision: restrict transfers to same-side accounts, or interpret cross-side transfers differently. Separate plan when prioritised.
- **Daily snapshots architecture.** Long-term, writing a daily `combinedNetWorth` snapshot to its own Automerge collection would obsolete the entire historical-replay module and immune the chart to whole classes of subtle miscount. Not a near-term priority; flagged in the `netWorthHistory.ts` doc-block as the right next step if more replay branches are needed.
- **`convertAmount` silent identity-fallback** when no FX rate path exists. Currently returns `amount` unconverted with no warning. Used app-wide; out of scope for the chart fix. Right fix is to return `undefined` and force callers to decide — bigger surgery.

**🟡 E2E triage (unchanged from 2026-04-21):**

- `cross-entity.spec.ts:81` ("Custom institution persists and appears in asset lender dropdown" — pre-existing, consolidation candidate) + the WebKit onboarding flake from 2026-04-20 still in `docs/E2E_HEALTH.md`.
- Full E2E run not yet executed against the net-worth chart correctness changes (1420 unit tests + manual hero-card check covered the regression surface). Worth a one-off run if anything chart-related surfaces in production.
- Current suite: 33 tests (over ADR-007's 25-test cap). Consolidation still pending.

**🟢 Goal-activity-log follow-ups (from 2026-04-21 plan, still deferred):**

- Full goal-history view if users accumulate >20 manual contributions (the visible cap) and want everything visible. Currently overflow goes to `/transactions?goal=<id>` which only surfaces automated contributions.
- Automated contribution milestone celebrations (recurring processor path bypasses `useContributeToGoal`, so automated crossings of 25/50/75/100% don't fire celebrations). Add if it feels missing in practice.
- `GoalManualContribution` + `BalanceAdjustmentMeta` consolidation at N=3 (if a third adjustment type lands).
- `<EntityActivityLog>` richer variants if a third surface adopts the pattern.
- Soft-cap / rollup when `manualContributions` exceeds ~50 entries per goal (not expected to hit in v1).

**The Pod — deferred v1 items:**

- **P5 share-as-image** — `useShareAsImage` composable + `ShareAsImageButton` component deferred pending `html-to-image` dep decision (~6kB gzipped). Planned for Emergency Contacts "share with sitter" flow. See ADR-022 §4 for the chosen mechanism (`navigator.share({ files })` with download fallback, NOT reusing `ShareInviteModal`).
- **Concurrent-edit E2E tests** — plan called for one per phase covering Automerge merge semantics. P2 (saying), P4 (cook-log) not yet shipped.
- **Pet follow-ups** (filed):
  - #169 — pet species variants beyond dog (cat/bird/rabbit avatars) — needs brand assets
  - #170 — pet-specific fields (species, breed, microchip, vet info)
  - ~~#171~~ — **closed, shipped this session**
- **Mobile visual QA** — all responsiveness fixes are code-level only. A 10-min iPhone SE / Chrome DevTools pass could catch anything subtle the audits missed (hard to verify from CLI).
- **WebKit onboarding flake** — logged in docs/E2E_HEALTH.md as (c) on 2026-04-20. Harden testids if it recurs on a third run.

**Photo attachments — integrations (follow-ups):**

- **Activity photos** — first non-Pod integration surface per the plan. Add `photoIds?: UUID[]` to `FamilyActivity`, drop `<PhotoAttachments>` into `ActivityViewEditModal.vue`, wire `updatePhotoIds` through `activityStore.update`, call `registerPhotoCollection('activities')` on app init.
- **E2E for photo flow** — deferred. Needs Drive mocking; tracks against the 25-test budget when added.
- **`gcOrphanedDriveFiles` Drive-side sweep** — noted as follow-up in ADR-021. Only needed if synchronous rollback ever fails silently; low priority.
- **Delete deprecated `getBlobUrl` + `getImageUrl` in photoStore** — kept for one release after the public-link switch (2026-04-20). No external callers remain. Remove in the next photo-related touch.
- **Empty beanies.family folder on joiner Drives** — `getOrCreateAppFolder` eagerly creates a `beanies.family` folder in every user's Drive on first connect, which for joiners is duplicative (the real folder is shared from the inviter's Drive and the joiner's is left empty). Defer the eager-create until first write, or detect join-flow context and skip. Low urgency — cosmetic only (two `beanies.family` folders in the Picker during recovery).

**🟠 Guides redesign — continue tomorrow (from 2026-04-22 evening session):**

- **Review Tier 1 in-browser on pillar 1.** Start `npm run dev:web`, visit `http://localhost:4321/guides/overwhelmed-family-planning`, scroll the full 3k-word piece. Specifically want greg's read on: drop-cap + Fraunces combo (magazine-warm or too serious); short-answer TL;DR block (right amount of "pop" or overcooked); sticky section rail ≥1200px (helpful or noisy); Deep Slate gradient recap card tone. Based on reactions, either refine Tier 1 or proceed to Tier 2.
- **Tier 2 candidates** (not yet built — needs greg's decision after in-browser review): callout card family with 5 semantic variants mapped to GFM alert syntax (`> [!short-answer]`, `> [!heads-up]`, `> [!try-this]`, `> [!real-talk]`, `> [!behind-the-scenes]`); optional marginalia (left-margin Caveat annotations on ≥1440px); inline "read next →" sticky-note cards woven mid-article (bridges hub-and-spoke pillar↔blog); scroll-triggered opacity fade-in on H2s + callouts via CSS `animation-timeline: view()` (gated on feature support so initial DOM stays visible).
- **Tier 3 candidates:** paper-texture SVG overlays; Caveat-accent pull-quotes; footnote rail in right margin; "back to top" bean mascot on long scroll.
- **Extend Tier 1 to pillars 2/3/4.** If greg accepts Tier 1: (a) populate `keyTakeaways: []` in pillars 2-4 frontmatter (5-ish structured bullets each), (b) the rehype plugin + template changes are already global — zero code per pillar, just author the takeaways.
- **FAQ + glossary integration (greg's explicit ask for next session).** Now that the guides have their own visual identity, open questions: do `web/src/pages/help/faq.astro` (25 Qs, FAQPage JSON-LD, gated behind `DRAFT=true`) and `web/src/pages/help/glossary.astro` (18 terms, DefinedTermSet JSON-LD, also gated) get the same editorial treatment, or a distinct help-center-reference treatment? Where do we surface them — add cards to `/help` index, link from individual guides (e.g. glossary terms linked inline via `<dfn>` or `<abbr>`), promote glossary to its own top-level nav item, or keep them as deep-links? How does the site's overall IA (nav, breadcrumbs, footer links) thread guides ↔ help ↔ FAQ ↔ glossary coherently? Discussion first, design second.
- **`/guides` index page design.** Currently `web/src/pages/guides/index.astro` is the pre-pillar layout (pre-redesign). Now that pillar pages have their editorial treatment, the index is the weak link — needs a pass to feel continuous with the new pillar aesthetic (kicker, zine typography, card density, relationship between pillars). Tied to the FAQ/glossary integration question above — the /guides index may also be the natural home for surfacing glossary + FAQ as adjacent help surfaces.
- **Residual content cleanup before flipping pillars `draft: false`:**
  - **Arrow artifacts.** The link-insert format `[anchor](URL) ← <annotation>` still has the leftover `←` characters from Notion's original placeholder style, plus the `<annotation>` text itself. Both were kept on purpose so greg could audit each link in place; once confirmed, sweep-remove the arrows + annotations from pillars 1-4 in the repo AND in Notion to keep them in sync. Grep `<!-- link added` or `←` in the 4 guide files to find them.
  - **Cozi-alternatives link in Pillar 2** — placeholder `<link to cozi app options post>` stays until the cozi-alternatives blog post ships (targeted Friday 2026-04-24). Greg is handling the reminder himself; Claude should not proactively add the link unless asked.
  - **Hyphen vs em-dash sweep in Notion** — deferred. The Notion draft uses ASCII hyphens consistently; the repo markdown uses em-dashes. Subagent treated as intentional style difference. If greg wants Notion normalized, it's a one-pass sweep.

**Content authoring (greg is driving, Notion is source of truth):**

- **Blog drafts reviewed** — 8 unpublished posts in Notion (from aloe vera memoir to vibe coding essay). Suggested publish order: cozi alternatives (Apr 24) → aloe vera (May 1) → beanies by your side → vibe coding (merge two drafts) → japan trip → overwhelmed spoke.
- **Comparison posts** — cozi & maple alternatives post nearly ready (In Review status, Apr 24 target). beanies vs YNAB, Actual Budget, Copilot Money still planned.
- **Glossary + FAQ pages** — fully authored in repo (`web/src/pages/help/{faq,glossary}.astro`), hidden via `DRAFT=true`. STATUS previously said "needs content" — stale. Real open question is integration/discoverability (see guides-redesign block above).

**Engineering follow-ups:**

- **Lighthouse CI first real run** — fires on next PR touching `web/`. May need perf tuning if assertions fail.
- **Vue app fonts still on Google Fonts** (`index.html`). Out of scope for #167.
- **Dependabot `tmp` vulnerability** — transitive dep in `@lhci/cli`. Not actionable; resolves when `@lhci/cli` updates.

**External ops (outside repo, user actions):**

- Google Search Console — verify property + submit sitemap
- Bing Webmaster — verify property + submit sitemap
- Otterly.ai — subscribe + configure 20 tracked prompts
- Wikidata, directory listings, YouTube demo, Show HN — all pending

**E2E tests:**

- `google-drive.spec.ts` — fixed (was broken by HomePage.vue deletion). Both tests now pass with `about:blank` state reset pattern.
- `cross-entity.spec.ts:81` + `:333` — still flaky candidates for hardening

## Current Phase

**Phase 1 — MVP** (In Progress)

## Completed Work

### Infrastructure

- Project scaffold with Vite + Vue 3 + TypeScript
- IndexedDB service with repositories (native IndexedDB APIs)
- Pinia stores for all entities (family, accounts, transactions, assets, goals, settings, sync, recurring, translation, memberFilter)
- Vue Router with all page routes (lazy-loaded)
- Dark mode / theme support
- E2E test infrastructure (Playwright — Chromium in CI, 21 focused tests covering critical user journeys)
- Unit test infrastructure (Vitest with happy-dom)
- Linting (ESLint + Prettier + Stylelint + Husky pre-commit hooks)
- File-based sync via File System Access API (with encryption support)
- Google Drive cloud storage integration (StorageProvider abstraction, OAuth PKCE with Lambda proxy, Drive REST API, offline queue, file picker, Google Picker API for join flow, email sharing via Drive Permissions API, reconnect toast, scope validation, cross-account folder cache fix, PWA re-consent loop fix with persistent storage + localStorage token fallback) — ADR-016, #112
- OAuth Lambda proxy (`beanies-family-oauth-prod`) — stateless token exchange & refresh at `api.beanies.family/oauth/google/*`, keeps client_secret server-side
- IndexedDB naming convention: `beanies-data-{familyId}`, `beanies-registry`, `beanies-file-handles` (migrated from `gp-finance-*`)
- Cross-device sync hardening: record-level merge (v3.0 file format), deletion tombstones, 6 sync bug fixes — ADR-017
- Exchange rate auto-fetching from free currency API
- Recurring transaction processor (daily/monthly/yearly)
- Multilingual support (English + Chinese) via MyMemory API with IndexedDB caching
- Project documentation: `docs/ARCHITECTURE.md`, `docs/adr/` (13 ADRs)
- Generic IndexedDB repository factory (`createRepository.ts`) — shared CRUD for 8 entity stores
- Toast notification system (`useToast.ts` + `ToastContainer.vue`) — error/success/warning/info toasts
- Store action helper (`wrapAsync()`) — centralized try/catch/finally for all store CRUD operations
- Node.js 24 across all CI/CD workflows and local development
- Family key encryption service: AES-256-GCM family key with AES-KW per-member wrapping, invite link service, v4.0 beanpod file format types, QR code utility, shared encoding helpers (#111)
- Permission roles: `canViewFinances`, `canEditActivities`, `canManagePod` fields on FamilyMember, `usePermissions()` composable, route guards, sidebar/mobile nav filtering, readOnly modal pattern, NoAccessPage (#132)
- Cache-first loading architecture: loads from encrypted IndexedDB persistence cache for instant display (<500ms), then background-syncs from Google Drive via CRDT merge. Skeleton screens replace full-screen spinner when no cache. BackgroundSyncBar (3px Heritage Orange progress bar) shows sync activity. Manual refresh in profile dropdown. Success toasts on reconnection/online recovery

### UI Components

- Base component library: BaseButton, BaseCard, BaseCombobox, BaseInput, BaseModal, BaseSelect
- AppHeader, AppSidebar layout components

### Photo Attachments — Foundation Shipped (2026-04-19)

General-purpose reusable capability for attaching photos to any beanies entity. Delivers the plumbing only; integration into activities, family avatars, and other entities happens in follow-up plans. See `docs/plans/2026-04-18-photos-general-capability.md` and [ADR-021](adr/021-photo-storage.md).

- **Storage model:** photo bytes in the user's Google Drive inside the shared `beanies.family` app folder; only metadata in Automerge (new `photos: Record<UUID, PhotoAttachment>` collection). Not encrypted — matches the existing trust the user already places in Drive for every other file.
- **Multi-member access:** invite flow now shares the app folder alongside `.beanpod`. One-time migration sweep back-fills folder shares for existing families when `syncStore.driveFileId` becomes available.
- **Rendering:** Drive's native `thumbnailLink?sz=w{N}` CDN serves both thumbnails (`=s400`) and full-size (`=s2048`) directly as `<img src>`. No IndexedDB full-size cache; no client-side thumbnail generation.
- **Offline:** IndexedDB `beanies-photo-queue-{familyId}` queues compressed uploads; drains on the `online` event; cleared on sign-out alongside the Automerge cache.
- **Missing-photo UX:** 404/403 from Drive flips a runtime `unresolved` flag; thumbnail shows a broken-image tile; viewer surfaces Replace (swap `driveFileId`, keep UUID stable so entity references survive) / Remove (tombstone) actions.
- **Deletion:** tombstones + 24h-grace GC sweep. Zero-reference cascade gated on integration plans registering their collection via `registerPhotoCollection(name)` so the foundation doesn't auto-delete photos before any entity points to them.
- **DRY refactors shipped alongside:** `driveService.createFile` generalized to accept `string | Blob | Uint8Array` with optional mime (default preserves existing `.beanpod` behavior); drag-drop extracted from `JoinPodView.vue` into a reusable `useFileDrop` composable; `useFilePicker` composable wraps the `<input type="file">` pattern; new `DriveFileNotFoundError` subclass cleanly distinguishes 404/403 from other Drive errors.
- **New modules:** `src/services/photos/photoCompression.ts`, `src/services/sync/photoUploadQueue.ts`, `src/stores/photoStore.ts`, `src/composables/{useFileDrop,useFilePicker,usePhotos}.ts`, `src/components/media/{PhotoThumbnail,PhotoViewer,PhotoAttachments}.vue`.
- **Tests:** 74 new unit tests (compression, queue, store, composables) — all 1060 existing + new tests green.

### Pages / Features

- Dashboard with summary cards (combined one-time + recurring totals)
- Accounts management (full CRUD, card-based layout)
- Transactions management (full CRUD, with date filter, category icons, projected recurring transactions, Today button on month navigator)
- Assets management (full CRUD, loan tracking, combined net worth)
- Goals management (full CRUD, collapsible completed goals section)
- Reports page (net worth, income vs expenses, extended date ranges, category breakdowns)
- Family member management (global member filter)
- Settings page (currency, theme, sync, encryption)
- First-run setup wizard
- Multi-currency display with global display currency selector
- Family Nook home screen (`/nook`) — greeting, status toast, family beans row, schedule cards (merged todos + planner activities with view-first modals, "This Week" card grouped by day/date matching planner sidebar pattern), inline todo widget with view/edit modals, milestones, piggy bank card, recent activity feed (view-first modals for todos + transactions). Overdue task detection with orange pill + ⏰ indicator. Task description preview (2-line clamp) on cards. `/` redirects to `/nook`
- Family Hub / Bean Pod (`/family`) — v7 redesign (#73): 3-column layout (sidebar, member cards, quick-info panel), activity-focused member cards (upcoming events, milestones, activity count, tasks — no financial data), role tags ("Parent Bean"/"Little Bean"), Heritage Orange selected state, events this week panel. Calendar removed (→ Family Planner #98)
- Travel Plans page (`/travel`) — dedicated trip planning with timeline, edit modals, ideas, helpful hints, inline editing. Route `/planner` renamed to `/activities`
- Landing page (`/home`) — full implementation from mockup (#72): hero with hugging beanie mascot + animated headline, 3 floating device screenshots (Nook, Piggy Bank, Planner), trust badges, security section with 6 cards, Greg's full beanies story, animated CTA with celebrating beanies circle, footer with Slack-wired contact form (`VITE_CONTACT_WEBHOOK_URL`), scroll progress bar, IntersectionObserver reveal animations, smooth-scroll anchor navigation, back-to-top button. Scoped CSS (not Tailwind) for pixel-perfect mockup fidelity. Decorative brand character images as low-opacity background accents. E2E tests updated.

### SEO + AIO/GEO Initiative — Phases A + B Shipped, Phase C Authored (2026-04-14)

The marketing surface moved off the Vue SPA (invisible to AI crawlers) onto a dedicated Astro 5 static site at `staging.beanies.family`, with the apex cutover authored and pre-staged for tomorrow. Tracked in epic #167 and `docs/plans/2026-04-14-seo-aio-optimization.md`.

**Architecture:** Astro at apex `beanies.family` for marketing/blog/help (zero-JS static HTML — readable by GPTBot/ClaudeBot/PerplexityBot/CCBot, none of which execute JS). Vue PWA moves to `app.beanies.family` to cleanly isolate service-worker scope, cookies, and the auth entry point.

**Stage 1 — Astro scaffold + content (live on staging.beanies.family):**

- npm workspaces monorepo: root (Vue PWA), `web/` (Astro 5.14), `packages/brand/`
- `@beanies/brand` package: `theme.css` (Tailwind v4 `@theme` block — single source of truth, both apps `@import`), `nav.ts`, `schema.ts` (Organization/WebSite/SoftwareApplication/Author JSON-LD)
- 36 Astro pages — homepage, /about/greg, /blog (index + 3 posts), /help (index + 5 categories + 24 articles), /privacy, /terms — each with unique title, canonical, OG/Twitter meta, JSON-LD in raw HTML
- Help search: MiniSearch island lazy-loaded on /help only (~10 KB JS)
- SEO plumbing: `robots.txt` with allowlist for 24 AI/search crawlers, hand-curated `llms.txt`, auto-generated `llms-full.txt` (56 KB), RSS feed at `/blog/rss.xml`, IndexNow key file, dynamic sitemap (36 URLs)
- Dynamic 1200×630 OG images per blog post via `astro-og-canvas`
- Web Vitals RUM (LCP/INP/CLS/FCP/TTFB) → Plausible custom events
- `npm run dev:all` (concurrently): runs Vue (5173) + Astro (4321) in parallel with color-coded prefixes
- Pixel-perfect Vue port of homepage (3,535 lines), blog index (547), blog post (535) — full hero, mascot, decorative beans, 3-device showcase, trust badges, security cards, personal story with pinyin ruby, contact modal, scroll progress, reveal animations, image lightbox. Vue interactive logic ported to vanilla JS (no Vue runtime in Astro). Google Fonts loaded in BaseLayout (Outfit + Inter) matching prod 1:1. Favicon set matches prod 1:1. Pill nav + dark page-footer extracted into shared `Nav.astro` + `Footer.astro` so every page renders identical chrome.

**Stage 2 Phase A — Infrastructure (applied to AWS):**

- New `modules/app-subdomain/`: ACM cert + CloudFront distribution + Route53 alias for `app.beanies.family` (origin shares Vue S3 bucket via OAC).
- New `modules/web/`: S3 bucket `beanies.family-web-prod` + CloudFront distribution for `staging.beanies.family` with `X-Robots-Tag: noindex` response-headers policy.
- CloudFront Function `rewrite-to-html.js` attached to staging — rewrites Astro clean URLs to `.html` paths (S3 doesn't serve clean URLs natively).
- New `deploy-web.yml` workflow (manual-trigger, staging|production target, builds Astro, syncs S3, invalidates CF, pings IndexNow on production). Conditional apex invalidation gated on `APEX_CLOUDFRONT_DISTRIBUTION_ID` variable (no-op pre-cutover).
- GitHub repo VARIABLES (not secrets — see `tasks/lessons.md`): `WEB_S3_BUCKET`, `WEB_CLOUDFRONT_DISTRIBUTION_ID`.
- CORS + OAuth fixes for new app subdomain: oauth/registry Lambda CORS allowlists extended to `https://app.beanies.family` + `http://localhost:4173`; oauth Lambda hardcoded `ALLOWED_REDIRECT_URIS` extended likewise; Google Cloud Console OAuth client redirect URI added.
- Self-unregistering SW shipped at apex (`web/public/sw.js`, 10 lines) — takes effect at Phase C cutover.

**Stage 2 Phase C — Authored, awaiting trigger:**

- Frontend module parameterized: `origin_bucket_regional_domain_name`, `viewer_request_function_arn`, `enable_spa_fallback`. All defaults preserve current behavior — Phase C is a no-op until you set these vars.
- Merged CloudFront Function `apex-cutover.js` authored — combines authenticated-path 301s (→ `app.beanies.family`), legacy `/beanstalk*` → `/blog*` 301s, and Astro `.html` URL rewrites in a single function.
- Web bucket policy pre-authorizes apex distribution to read it.
- Cutover is now a 3-line edit in `infrastructure/main.tf` + one `terraform apply`. See `docs/runbooks/cutover-apex-to-astro.md`.

**Registry DDB Split (prod / dev):**

- New DDB table `beanies-family-registry-dev` alongside existing `beanies-family-registry-prod`.
- Lambda env vars `DEV_TABLE_NAME` + `DEV_ORIGINS`; `tableForOrigin()` helper picks table from request `Origin` header — localhost → dev table, production origins → prod table. IAM extended for both tables.
- Migration script `scripts/migrate-registry-dev-rows.mjs` with multiple modes (auto-classify by email, `--keep-prod-only` with hardcoded keep-list of 13 confirmed real-user familyIds, `--scrub-dev` for cleaning Test Family rows from dev table).
- E2E pod renamed "Test Family" → "E2E Test Family" (distinctive grep target). E2E `afterEach` cleanup: `__e2eDataBridge.cleanupActiveFamily()` calls `removeFamily()` on the active familyId — wired via the existing Playwright fixture base, all 7 specs inherit automatically.
- Migration result: prod table reduced from 248 rows to **13 real users**; dev table cleaned to **3 named non-prod rows**.

**Production state after today:**

- `beanies.family` (apex) — still serves Vue PWA (cutover deferred to tomorrow)
- `app.beanies.family` — new, serves Vue PWA (origin shared with apex), OAuth verified end-to-end
- `staging.beanies.family` — Astro marketing site preview with `X-Robots-Tag: noindex`
- `api.beanies.family` — registry + OAuth APIs with extended CORS allowlist + Lambda redirect-URI allowlist
- Two DDB tables — prod (13 real) and dev (3 preserved)

### WebKit Overlay Fixes & E2E Hardening (2026-04-13)

- **Onboarding overlay stuck on Safari/iOS (#153)**: Vue's `<Transition>` inside `<Teleport>` was stalling the leave transition on WebKit, leaving an invisible click-blocking overlay on top of the app after onboarding completion. Replaced the outer fade `<Transition>` with a deterministic class toggle (`ob-overlay-hidden`) + `setTimeout`-driven unmount. Visual behaviour identical, no Vue-transition dependency. Inner step `<Transition>` untouched (never the issue).
- **Global E2E reduced-motion**: `playwright.config.ts` now sets `reducedMotion: 'reduce'` on the shared `use` block. `src/style.css` extends the `prefers-reduced-motion` block with a universal `*, *::before, *::after { animation-iteration-count: 1; animation-duration: 0.01ms }` rule that disables all infinite keyframe animations at once — resolved WebKit "waiting for element to be stable" stalls caused by HomePage decorative float animations. Real users with the accessibility preference also benefit.
- **App loading overlay defused**: The init spinner in `App.vue` (`z-[300]` full-screen div in a `<Transition>`) was getting stuck at `opacity: 0` on WebKit and blocking all clicks. Added `pointer-events-none` — the overlay only holds a spinner, nothing clickable, so this is always the correct behaviour.
- **E2E workflow consolidation**: Deleted the duplicate `e2e-tests` job from `main-ci.yml`. `e2e.yml` is now the single source of truth, with an event-aware matrix: push to `main` → Chromium only (temporarily, pending #155), `run-e2e` PR label → Chromium + WebKit on demand, weekly → full 3-browser sweep. Playwright browser cache added.
- **Follow-up #155** tracks 10 remaining WebKit-only timeouts (Account Institution combobox, planner recurring flows, financial data dashboard) — unrelated to overlays; look like CI perf / timing or genuine WebKit-specific app behaviour. Chromium + Firefox still green.

### WebKit E2E Restored to Main-Push CI (2026-04-13 — later)

- **#155 resolved (PR #156)**: reduced-motion rule now zeroes out `transition-duration` globally (not just `animation-*`), so Vue modal/drawer enter transitions no longer keep dialog buttons "unstable" on webkit. Page-object `goto()` uses `waitUntil: 'domcontentloaded'` to fix the `/transactions` navigation hang on webkit's `load` event. Webkit Playwright project gets its own 40s test timeout for headroom.
- **Webkit flakiness hardened (PR #165)**: a duplicate parallel PR run exposed residual flakiness on identical SHAs — webkit timeout raised to 60s and webkit retries to 2 (CI only) to absorb transient "WebKit encountered an internal error" crashes on page.goto. Also hardened `google-drive.spec.ts` "Create Pod step 2" with an explicit `waitFor` before the Create click — previously raced the WelcomeGate → CreatePodView transition.
- **CI cleanup (PR #166)**: (a) duplicate E2E runs fixed — `e2e.yml` now gates on `github.event.label.name == 'run-e2e'` so only the actual `run-e2e` label add triggers a run (previously every label added to a PR with `run-e2e` fired another run on the same SHA). (b) Webkit is back on every main-push alongside chromium — Safari/iOS is a large share of our users. ADR-007 updated.
- **Current matrix**: PR (opt-in `run-e2e`) → chromium + webkit; push to main → chromium + webkit; weekly schedule → chromium + firefox + webkit.
- **ADR-007 updated** to reflect the new browser-coverage policy.

### Product Hunt Launch Day (2026-04-09)

- **Privacy Policy page** (`/privacy`): Full privacy policy covering local-first data model, no data collection, Plausible analytics, Google Drive encryption, cookies (none), children's privacy, data portability. Uses `HelpPublicHeader` for unauthenticated visitors.
- **Terms of Service page** (`/terms`): Terms covering "as is" warranty, not financial advice, liability limitations, open source license, acceptable use, data responsibility.
- **Routes & footer links**: Both legal pages added to Vue Router (`requiresAuth: false`), footer links added to `HomePage.vue` and `PublicFooter.vue`.
- **SEO & social sharing**: Twitter Card meta tags, canonical URL, OG image alt/width/height, `robots.txt`, `sitemap.xml` added for Product Hunt launch readiness.
- **Security audit**: Full security, SEO, and UX audit via 3 parallel agents. No launch blockers found. npm audit vulnerabilities resolved (0 remaining).

### Blog, Planner & Skills (2026-04-10)

- **Blog post #3 published** ("does family trip planning stress you out? me too"): Travel plans intro with screenshot, UTM-tracked links across all blog posts, image lightbox on post pages. Blog URL changed from `/beanstalk` to `/blog` (redirects from old URLs). Blog title renamed to "beanie beanstalk". Coming soon cards updated.
- **Daily calendar view** (`DailyCalendarView.vue`): Per-member columns showing one day's schedule for the whole family. Adults sorted first (oldest→youngest), then children. Column separators with member-color accent bars and subtle gradient tints. Click-to-create pre-fills date + time + member. Mobile: MemberChipFilter strip + ActivityListCard agenda.
- **Hover time labels**: Weekly and daily calendar hover "+" indicators now show the time range (e.g., "3pm – 4pm") for clarity.
- **Activity drawer improvements**: Field order reordered to Title → Schedule → Who → Category (matches natural "what + when + who" flow). One-time activities no longer show fee schedule chips, monthly charge, or per-session breakdown — linked payment wired as one-time. All-day activities show "all day" label in list views. `defaultAssigneeIds` prop added for pre-filling from daily view.
- **DRY cleanup**: `familyStore.sortedMembers` computed consolidates 3 duplicated inline member sorts (MemberChipFilter, FamilyChipPicker, FamilyTodoPage). `useDayNavigation` composable + `formatDayLong` utility added.
- **View toggle**: Day view added to month/week toggle. Auto-scroll on view switch fixed (only scrolls on fresh page load).
- **Pilot-scout skill** (`/pilot-scout`): Multi-platform internet scouting for potential pilot users across Reddit, HN, Twitter/X, Quora, MetaFilter, Product Hunt, Indie Hackers, and more. Logs to Notion. Platform-specific freshness cutoffs, dedup against existing entries.
- **Nav link rename**: "blog" → "beanstalk" across all nav links and footers (URL remains `/blog`).
- **Plausible custom events**: Added analytics tracking for `signup`, `member_joined`, `family_deleted`, `login` (with method prop), `feature_used` (with feature prop). Uses `window.plausible?.()` (optional chaining for test safety). Type declaration at `src/types/plausible.d.ts`. Privacy Policy updated with disclosure.
- **Substack auto-subscribe**: New families auto-subscribed to Beanstalk newsletter (gpbeanies.substack.com) during signup via pre-checked opt-out checkbox in `CreatePodView`. Fire-and-forget POST to Substack's `/api/v1/free` endpoint (`mode: 'no-cors'`).
- **end-session skill** (`.claude/skills/end-session/SKILL.md`): Session wrap-up skill — cleans working tree, updates STATUS.md/CHANGELOG.md, Notion Launch HQ, checks for unfinished work. (Renamed from `end-of-day` on 2026-04-20 — now usable whenever wrapping a session, not just end of day.)
- **Saved plan**: Server-side DynamoDB stats counters (`docs/plans/2026-04-09-server-side-stats-counters.md`) — not yet implemented, saved for later.

### Budget Currency Fixes, Setup Progress Modal, Blog & Substack (2026-04-08)

- **Budget currency normalization**: All budget amounts now correctly captured and displayed in the user's display currency, fixing inconsistencies when mixing currencies (#e01441e, #69bf6b8)
- **Setup wizard progress modal**: Added progress modal to the setup wizard finish step for better UX feedback during initial data creation (#bb9eab3)
- **Substack subscribe embed**: "The Beanstalk" newsletter subscribe widget added to blog index and individual post pages (#371a8ce)
- **Blog post #4 drafted** (Notion): "best cozi & maple alternatives in 2026" — SEO comparison post covering Cozi, Maple, TimeTree, FamilyWall, YNAB, Greenlight + 7 notable mentions. Status: Draft, pending review
- **Product Hunt Alpha Day**: Launch page submitted and scheduled for Apr 9

### Help Center Expansion & beanies-help-docs Skill (2026-03-27)

- **beanies-help-docs skill** (`.claude/skills/beanies-help-docs/SKILL.md`): Project-level Claude Code skill for creating, reviewing, and auditing help center articles. Defines four article types (how-to, explainer, reference, troubleshooting), writing standards, quality checklist, audit workflow, and beanies voice guidelines. Invoke via `/beanies-help-docs`.
- **4 new help articles** (17 → 21 total):
  - "Your Daily Briefing" (explainer, `how-it-works`) — critical activities orange box logic on Family Nook
  - "Family To-Do Lists" (how-to, `features`) — creating, editing, completing, filtering, Nook integration
  - "Travel Plans & Vacations" (how-to, `features`) — 5-step wizard, timeline, booking progress, ideas voting
  - "The Family Nook — Your Home Base" (explainer, `features`) — every Nook widget documented
- **Bug fix**: "View all articles" link was hardcoded to `/help/getting-started` — now smooth-scrolls to article index
- **Help Center landing page**: Article index redesigned as clickable category cards with article previews (up to 4 per card, "+N more" overflow). Popular articles capped at 3.
- **Category page redesign**: Hero banner with glow effect, article count badge, "Explore other topics" cross-navigation section

### E2E Test Strategy Overhaul (2026-03-25)

- **Suite reduction**: 87 → 21 tests (76%), 15 → 7 spec files (53%)
- **CI optimization**: Chromium-only (dropped Firefox matrix), CI time 10+ min → 4.5 min
- **Three-Gate Filter**: Every E2E test must pass business-critical outcome, full-stack integration, and deterministic gates
- **Budget cap**: 25 tests max — forces prioritization when adding new tests
- **8 conventions**: Assert data not DOM, no testing mocks, no `waitForTimeout`, separate tests for separate outcomes, etc.
- **Removed**: Homepage routing (4), date filters (3), beanie avatars (4), beanie mode (4), sound effects (3), Google Drive mock API (6), onboarding step-by-step (9), simple CRUD duplicates
- **Consolidated**: Planner 16 → 5, invite/join 9 → 3, combobox 9 → 3, loan-activity 4 → 3
- **Health tracking**: `docs/E2E_HEALTH.md` — log each CI failure as bug/intentional/flake, quarterly review
- **ADR-007 revised**: Full strategy, conventions, and health tracking documented
- Plan: `docs/plans/2026-03-25-e2e-test-strategy-overhaul.md`

### Travel Link Field & Transaction Schedule Summary (2026-03-25)

- **Link field on all travel segments**: Optional URL added to flights, cruise, train/ferry, car, accommodations, and transportation (previously only activities and ideas). Shares row with booking ref or contact phone for space efficiency
- **Transaction view schedule summary box**: Grey summary box matching activity view convention — shows recurrence pattern + start/end dates for recurring, or formatted date for one-time transactions. Replaces standalone recurrence pill
- **Changelog introduced**: `CHANGELOG.md` with Keep a Changelog format, 2-week git history backfill. CLAUDE.md updated to mandate changelog update on every push

### Dedicated Travel Plans Page (2026-03-21)

- **New `/travel` route**: Full dedicated page for vacation/trip planning with list + expanded views. Route `/planner` renamed to `/activities`
- **Trip list view**: Card grid with countdown badges, member chips, progress bars, collapsible past trips section, empty state
- **Expanded trip view**: Teal gradient hero banner, visual timeline with date nodes, ideas panel with quick-add
- **Visual timeline**: Chronological date groups with segment cards, inline accommodation gap warnings at correct positions, connector dots and vertical line
- **Inline editing**: Detail rows with auto-sizing inputs + pencil hint on hover, saves on blur via `saveInlineField()`. Copy badge restricted to booking ref only
- **Segment edit modals**: `TravelSegmentEditModal`, `AccommodationEditModal`, `TransportationEditModal`, `IdeaEditModal` — all using BeanieFormModal
- **Ideas system**: VacationIdeaCard with vote/title/description/meta layout matching mockup. IdeaEditModal with category pills, currency amount input, link field (auto-prepends https://), duration, booking needed. "Other" category added
- **Helpful hints**: Overlap detection (accommodation/accommodation, accommodation/cruise, flight/cruise) with amber card tint + ⚠️ toggle indicator
- **Trip-type countdown language**: "days until takeoff" (fly), "days until we set sail" (cruise), "days until we hit the road" (road trip), etc.
- **Business trip support**: `tripPurpose` field on `fly_and_stay` trips — 💼 icon, muted countdown
- **Flight UX**: Arrival date replaced with "+1 day" checkbox, compact 3-column layout (date/dep time/arr time)
- **Cruise**: Embarkation time field added
- **Car segment type**: New `car` travel type with car type toggle (family/rental/other), car name, leaving time. Auto-selected for road trips
- **Train updates**: Icon → 🚅 bullet train, labels → "Train Company"/"Train Number"
- **Status simplification**: `VacationSegmentStatus` reduced to `booked | pending`. Pending items show in timeline with gold dashed-border tint
- **Accommodation pre-fill**: Hotel check-in/out auto-populated from outbound arrival / return departure dates
- **Wizard steps 3 & 4 refactored**: Match Step 2 convention — `+ type` pills at bottom that always append (no toggle/replace). Single type per entry, immutable after creation
- **"+ add a plan" button**: Bottom of timeline with animated type picker (Travel/Stay/Getting Around) → opens wizard at correct step
- **Delete support**: Delete button on all timeline cards (including undated), delete trip from detail page hero, idea delete with confirmation
- **NookSectionCard**: Shared card wrapper for consistent nook/activities section styling. NookVacationCard with blue gradient tint + countdown hero badge
- **Accommodation gap warnings**: `computeAccommodationGaps()` extracted to shared utility. Shown on trip cards (list, sidebar, nook) + inline in timeline
- **Onboarding fixes**: Google Drive modal de-emphasized "View in Drive" + auto-advances, loading spinners on Add Member/Finish, accounts displayed in list
- **Todo mobile UX**: Skip auto-focus on quick-add bar for mobile/tablet (prevents keyboard popup)
- **DRY**: `useVacationTimeline` composable, shared option builders in `vacation.ts`, `buildTravelKeyValue` shared function
- **Files**: 6 new components, 1 new composable, ~25 modified files. VacationViewModal deleted (replaced by dedicated page)
- Plan: `docs/plans/2026-03-21-dedicated-travel-plans-page.md`

### Cache-First Loading & Reconnection UX (2026-03-24)

- **Cache-first loading**: App loads from encrypted IndexedDB persistence cache first (<500ms), then background-syncs from Google Drive via Automerge CRDT merge. Eliminates 4-5s blocking spinner for returning users
- **Skeleton screens**: `ContentSkeleton.vue` — generic card-grid skeleton with Heritage Orange shimmer animation (`beanie-shimmer`), shown in content area while data loads from Drive. Matches NookSectionCard styling
- **App shell renders immediately**: `isInitializing` dismissed after auth (~150ms) instead of after data load. New `isLoadingData` ref gates skeleton vs router-view
- **BackgroundSyncBar**: 3px Heritage Orange indeterminate progress bar at top of viewport (z-200), shown during background sync
- **Manual refresh**: Refresh icon in profile dropdown banner (both mobile and desktop). Triggers Drive sync + SW update check. Spinning icon during refresh, success/error toasts
- **Reconnection success toasts**: Explicit confirmation when Google Drive reconnects ("Reconnected — all data saved"), silent auto-reconnect recovery, "Back online" toast on network restore
- **DRY refactor**: `tryDecryptWithCachedKey()` shared helper in syncStore deduplicates needsPassword pattern from 3 call sites. `preservePermissionState` option on `loadFromPersistenceCache()`
- **Files**: 2 new components (`ContentSkeleton.vue`, `BackgroundSyncBar.vue`), 5 modified files
- Plan: `docs/plans/2026-03-24-cache-first-loading.md`

### Nook Schedule Card Grouping (2026-03-19)

- **"This Week" card grouped by day/date**: Items in the ScheduleCards "This Week" panel are now grouped under date headers (Today, Tomorrow, weekday + date), matching the existing pattern in DayAgendaSidebar and UpcomingActivities. Removes per-item date display in favor of group headers for clearer temporal context

### Weekly Calendar View & Planner Enhancements (2026-03-17)

- **Weekly calendar view** (`WeeklyCalendarView.vue`): 7-column hourly time grid with activity blocks positioned at time slots, current time indicator, auto-scroll to now. Mobile: horizontal day tab strip with card list
- **Shared component extractions (DRY)**: `ActivityListCard.vue` (eliminated 3× card duplication), `CalendarNavBar.vue` (shared prev/next/today nav), `useCalendarNavigation.ts` composable (week navigation + time grid positioning + overlap grouping)
- **All-day activities**: `isAllDay` and `endDate` fields on FamilyActivity model. ActivityModal checkbox to toggle all-day mode (hides time pickers, shows optional end date for multi-day). Multi-day all-day activities span across day columns as a single bar in weekly view
- **TodoItemRow shared component**: Extracted from TodoItemCard and NookTodoWidget, reused in DayAgendaSidebar and weekly view for todo display
- **DayAgendaSidebar enhanced**: Added "Tasks Due" purple section showing todos for selected date
- **Form validation UX**: `FormFieldGroup` error prop with orange ring highlight. ActivityModal highlights missing required fields on save attempt instead of disabling save button
- **InlineEditField z-index fix**: Active edit controls layer above neighboring grid cells
- **Todo modal button**: Changed "Done" to "Close" in TodoViewEditModal to avoid confusion with completing
- **ViewToggle**: Removed day/agenda options (redundant with weekly + sidebar). Default view changed to week
- **E2E tests updated**: Planner tests adapted for week-view default with scoped selectors
- Plan: `docs/plans/2026-03-17-weekly-daily-calendar-views.md`

### Assets Page Visual Polish (2026-03-13)

- **Stat card subtexts**: All 4 SummaryStatCards on Assets page now show contextual subtitles (asset count, active loan count, "After loan deductions", appreciation %)
- **Equity progress bar**: Green gradient bar above loan panel showing equity % for assets with loans
- **Loan panel restructure**: Header row with label + amount side-by-side, 2-column detail grid below
- **Card stagger animation**: `fade-slide-up` keyframe extracted from GoalsPage to global `style.css` for reuse, cards animate in with 70ms stagger delay
- **Card hover effects**: `group-hover:scale-[1.08]` on icon, `opacity-0 group-hover:opacity-100` on action dots
- **Notes quote style**: `border-l-2 border-gray-200 pl-3` left-border quote styling
- **SummaryStatCard fix**: Subtitle font `text-[10px]` → `text-xs` (CIG min 12px), label/subtitle stacked vertically instead of horizontal to prevent wrapping
- **InfoHintBadge fix**: Rewrote from `position: absolute` to `<Teleport to="body">` with `position: fixed` to escape `overflow-auto` clipping on `<main>`
- 4 new translation keys: `assets.equity`, `assets.activeLoans`, `assets.afterLoanDeductions`, `assets.overall`
- Plan: `docs/plans/2026-03-13-assets-page-visual-polish.md`

### Goals & Assets Page Revamp (2026-03-13)

- **GoalsPage rewrite**: Sectioned layout with group-by toggle (member/priority), encouragement messages, milestone dots, "almost there" glow, achieved goals section
- **AssetModal extraction**: Extracted ~720 lines of duplicated inline modal forms from AssetsPage into `AssetModal.vue` component
- **DRY fix**: `persistCustomInstitutionIfNeeded` moved to shared `useInstitutionOptions.ts` composable
- **SummaryStatCard**: Added `rawValue` prop for non-currency display (goal counts)

### E2E Shared UI String Resolver (2026-03-13)

- **`e2e/helpers/ui-strings.ts`**: Shared resolver that imports `UI_STRINGS` from the app's translation system, so E2E tests reference translation keys instead of hardcoded English strings
- **ComboboxHelper fix**: Updated constructor to handle both BaseCombobox wrapper (`.relative.space-y-1`) and FormFieldGroup wrapper (`.space-y-2`) using `.or()` pattern
- **Full migration**: All E2E helpers, page objects, and spec files migrated to use `ui()` — covers auth.ts, AccountsPage, TransactionsPage, AssetsPage, and 8 spec files
- Strings without matching uiStrings keys (setup flow form labels, brand tagline, beanie-mode assertions) left as-is

### Beanie Brand Asset Icons

- `beanies_covering_eyes_transparent_512x512.png` — replaces all lock/closed-padlock SVG icons (privacy mode active, data encrypted, data hidden)
- `beanies_open_eyes_transparent_512x512.png` — replaces all open-padlock SVG icons (privacy mode off, data visible, data unencrypted)
- `beanies_impact_bullet_transparent_192x192.png` — replaces warning/alert/exclamation SVG icons and all feature bullet point icons (SyncStatusIndicator warning, PasskeySettings alert, LoginPage security bullets, SetupPage security bullets)
- Theme skill (`.claude/skills/beanies-theme.md`) updated with icon usage guide

### Centralized Icon System (Issue #44)

- **`src/constants/icons.ts`** — Central registry of ~72 beanie-styled SVG icon definitions with `BeanieIconDef` type. Organized into: NAV (9), ACTION (8), SUMMARY (5), UTILITY (10), STATUS (4), CATEGORY (28), ACCOUNT_TYPE (8), ASSET_TYPE (9). Helper functions: `getIconDef()`, `getAccountTypeIcon()`, `getAssetTypeIcon()`
- **`src/components/ui/BeanieIcon.vue`** — Universal icon component enforcing brand style (stroke-width 1.75, round linecap/linejoin). Props: `name`, `size` (xs/sm/md/lg/xl), `strokeWidth`. Falls back to three-dot circle for unknown icons
- **`src/components/common/PageHeader.vue`** — Shared page header with 40px rounded-xl icon container + title + subtitle + action slot
- **15 files migrated** — All inline SVGs replaced with BeanieIcon in: AppSidebar, AppHeader, BaseModal, CategoryIcon, AccountTypeIcon, DashboardPage, AccountsPage, TransactionsPage, AssetsPage, GoalsPage, ReportsPage, ForecastPage, FamilyPage, SettingsPage
- CategoryIcon.vue reduced from ~365 lines to ~45 lines (19-branch v-if chain → single BeanieIcon)
- AccountsPage reduced from 893 to ~591 lines; AssetsPage collapsed 2x 9-branch asset type icon chains
- Zero inline `<svg>` elements remaining in all migrated files

### Micro-Animations (Issue #45)

- Page header icon bounce on load, sidebar hover wobble/scale, card hover lift
- Summary card count-up animation, goal progress bar fill animation
- Empty state floating/breathing animation
- Privacy toggle beanie blink, theme toggle rotation
- All animations respect `prefers-reduced-motion`
- CSS `@keyframes` using hardware-accelerated `transform` + `opacity`

### Empty State Beanie Illustrations (Issue #47)

- Beanie character illustrations for all empty states: accounts, transactions, recurring, assets, goals, reports, dashboard
- `EmptyStateIllustration.vue` component with variant prop
- Stored in `public/brand/empty-states/`

### 404 Page Redesign (Issue #48)

- Full beanie-themed 404 page with lost beanie illustration
- Playful heading and encouraging subtext, brand-styled CTA

### Loading States with Brand Spinner (Issue #49)

- `BeanieSpinner.vue` component using `beanies_spinner_transparent_192x192.png`
- Brand spinner for all loading states (app load, language switching, data fetch, button loading)
- Loading text: "counting beans..." (never "Loading...")

### Forecast "Coming Soon" Redesign (Issue #50)

- Beanie with telescope illustration
- Warm brand-voice copy, beanie impact bullet icons for feature list

### Sound Effects System (Issue #46)

- **`src/composables/useSounds.ts`** — Web Audio API synthesised sounds (zero bundle size, sub-ms latency)
- 6 sound functions: `playPop()`, `playClink()`, `playChime()`, `playFanfare()`, `playWhoosh()`, `playBlink()`
- `soundEnabled` global setting (defaults to `true`) with toggle in Settings > General
- AudioContext created lazily on first user gesture (browser autoplay compliance)
- Celebration integration: `playChime()` on toast celebrations, `playFanfare()` on modal celebrations
- Delete actions: `playWhoosh()` on account/transaction/recurring/asset/goal deletes
- Privacy toggle: `playBlink()` on header privacy eye toggle
- App.vue watcher syncs `soundEnabled` setting to composable
- Goal completion detection fixed: `updateGoal()` now detects completion transitions and fires celebrations (previously only `updateProgress()` did, which was never called from UI)
- Goals empty state fixed: shows when all goals are completed (was checking all goals instead of active goals)
- Celebration toast image enlarged from 40px to 80px
- Unit tests (5) and E2E tests (3)

### Multi-Family Architecture (Stage 1)

- Per-family database architecture: each family gets its own IndexedDB (`beanies-data-{familyId}`)
- Registry database (`beanies-registry`): stores families, user mappings, global settings
- Family context orchestrator (`familyContext.ts`) and Pinia store (`familyContextStore.ts`)
- Legacy migration service: auto-migrates single-DB data to per-family DB on first boot
- Global settings split from per-family settings (theme, language, exchange rates are device-level)
- Sync file format v2.0: includes `familyId` and `familyName` (backward-compatible with v1.0)
- Per-family file handle storage for sync
- New types: `Family`, `UserFamilyMapping`, `GlobalSettings`
- All existing repositories work unchanged (transparent multi-tenancy via `getDatabase()`)
- E2E test helpers updated for dynamic per-family DB discovery

### File-Based Authentication (replacing Cognito)

- **Password service** (`src/services/auth/passwordService.ts`): PBKDF2 hashing (100k iterations, SHA-256, 16-byte salt, 32-byte hash) with constant-time verification
- **Auth store** (`src/stores/authStore.ts`): complete rewrite — signIn (member picker + password), signUp (owner creates pod), setPassword (joiner onboarding), signOut
- **Login flow**: WelcomeGate → LoadPodView (file picker + decrypt modal) → PickBeanView (member picker + password) / CreatePodView (3-step wizard) / JoinPodView (family code entry)
- **Data model**: `passwordHash` and `requiresPassword` fields on `FamilyMember`
- Route guards: all app routes have `requiresAuth: true`, login route exempt
- App.vue bootstrap simplified: global settings → auth init → family resolution → data load
- ADR-014 (file-based auth decision), supersedes ADR-010 and ADR-013

### Passkey / Biometric Authentication (Issue #16)

- `passkeyCrypto.ts`: PRF helpers, HKDF key derivation, AES-KW DEK wrapping/unwrapping
- `passkeyService.ts`: Full WebAuthn registration + assertion with PRF and non-PRF paths
- `passkeyRepository.ts`: IndexedDB CRUD for passkey registrations (registry DB v3)
- Dual-path strategy: PRF (true passwordless) + cached password fallback (Firefox)
- `BiometricLoginView.vue`: One-tap biometric login on returning devices
- `PasskeyPromptModal.vue`: Post-sign-in prompt to enable biometric login
- `PasskeySettings.vue`: Full management UI (register, list, remove passkeys)
- Password change invalidates PRF-wrapped DEKs, updates cached passwords
- ADR-015 documents the architectural decision
- `PasskeySettings.vue` component: lists registered passkeys, register new, remove existing
- Requires server-side challenge generation for full flow (deferred)

### Cognito Removal

- Deleted: `src/config/cognito.ts`, `src/services/auth/cognitoService.ts`, `src/services/auth/tokenManager.ts`, `src/services/auth/index.ts`, `src/services/api/adminApi.ts`
- Deleted: `src/pages/MagicLinkCallbackPage.vue`, `src/components/login/VerificationCodeForm.vue`, `src/components/family/CreateMemberAccountModal.vue`
- Deleted: `infrastructure/modules/auth/` (Cognito User Pool), `infrastructure/modules/api/` (Lambda + API Gateway), `infrastructure/scripts/cognito-sync-check.sh`
- Removed `amazon-cognito-identity-js` package (~165KB bundle reduction)
- Removed `cachedSessions` object store from registry database (v1 → v2 migration)
- Removed `CachedAuthSession` type, `isLocalOnly` from `UserFamilyMapping`, `isLocalOnlyMode` from `GlobalSettings`
- Removed Cognito env vars from `.env.example`, `.github/workflows/deploy.yml`, `vite.config.ts`

### File-First Architecture

- Encrypted data file is the source of truth; IndexedDB is a temporary cache deleted on sign-out
- Sign-out cleanup: `deleteFamilyDatabase()`, `resetState()` on all data stores, file handle preserved
- App startup always loads from data file when configured; IndexedDB fallback only when file permission not yet granted
- Auto-sync always on when file is configured (no toggle)
- Setup wizard adds Step 3 "Secure Your Data": requires file creation with encryption password
- Default `encryptionEnabled` changed to `true`
- Settings renamed "File Sync" → "Family Data Options"; removed Sync Now, Disconnect, Auto-sync toggle
- Encryption toggle warns before disabling
- SyncStatusIndicator: "Syncing..." → "Saving...", "Synced to..." → "Data saved to..."
- Login page: three security benefit bullet points (encrypted file, no server storage, cloud backup via folder)
- ADR-011: file-first architecture decision record

### beanies.family Rebranding (Issue #22)

- Renamed app from "GP Family Planner" to `beanies.family` across all UI, metadata, and configuration
- Updated `index.html` title and Google Fonts (Outfit + Inter replacing Poppins)
- Updated `vite.config.ts` PWA manifest: name, short_name, description, theme_color, background_color
- Updated `package.json` name, `router/index.ts` title, `passkeyService.ts` RP_NAME, `uiStrings.ts` app name/tagline
- Rewrote `src/style.css` with Tailwind 4 `@theme` brand colour scales (Heritage Orange, Deep Slate, Sky Silk, Terracotta)
- Replaced `public/favicon.svg` with beanies-branded SVG
- Updated all UI components to squircle shape language (`rounded-2xl`/`rounded-3xl`/`rounded-xl`)
- Replaced all blue/indigo colours with brand primaries (`primary-500` Heritage Orange, `secondary-500` Deep Slate)
- Updated AppSidebar: beanies logo, brand wordmark, Outfit font, primary active states
- Updated AppHeader: primary colours for active states and privacy toggle
- Updated all 12 page files: brand colours, brand name, brand backgrounds
- Added `CelebrationOverlay.vue` component with toast (4s auto-dismiss) and modal modes
- Added `useCelebration` composable with six celebration triggers wired to key app events:
  - Setup complete, first file save, first account, first transaction, goal reached, debt paid off
- Added pod spinner loading overlay in `App.vue` ("counting beans..." copy)
- Added project-local skill `.claude/skills/beanies-theme.md`

### Beanie Character Avatars (Issue #39) — Closed

- **`src/constants/avatars.ts`** — 8 SVG avatar variant definitions (`adult-male`, `adult-female`, `adult-other`, `child-male`, `child-female`, `child-other`, `family-group`, `family-filtered`). Bean/pill body shapes with dot eyes, arc smiles. All children wear beanie hats (brand signature). Adults have optional cap (male), bow + shoulder-length hair (female), or clean body (other). Female variants have full hair dome + flowing side strands + clear bowtie (two triangles meeting at a point)
- **`src/components/ui/BeanieAvatar.vue`** — Avatar rendering component with `variant`, `color`, `size` (xs/sm/md/lg/xl), `ariaLabel` props. Renders inline SVG filled with member's profile color, features in Deep Slate. `family-group` renders 4 distinct characters (2 adults + 2 children with beanies) in brand colors (Heritage Orange, Sky Silk, Terracotta, Soft Teal). `family-filtered` renders bean + funnel overlay
- **`src/composables/useMemberAvatar.ts`** — `getAvatarVariant(gender, ageGroup)`, `getMemberAvatarVariant(member)` (with defaults for legacy records), reactive `useMemberAvatar(memberRef)` and `useFilterAvatar(allSelectedRef)` composables
- **Data model** — Added `Gender` (`male`|`female`|`other`), `AgeGroup` (`adult`|`child`), and optional `DateOfBirth` (`{ month, day, year? }`) to `FamilyMember` interface
- **Repository migration** — `applyDefaults()` in `familyMemberRepository.ts` ensures legacy records get `gender: 'other'`, `ageGroup: 'adult'`
- **FamilyPage** — Gender + age group selects (Male/Female/Other, default Male), date of birth dropdowns (month Jan-Dec, day 1-31, optional year), live avatar preview in add/edit member modals. Member cards show BeanieAvatar instead of initial circles. Full edit member modal with pencil icon on each card
- **Header filter icons** — MemberFilterDropdown trigger shows: family-group BeanieAvatar (lg) + "all" when all selected, individual member avatar + name when one selected, filtered icon + count for partial selection. Borderless trigger style (no border/background, tight spacing with arrow)
- **BaseMultiSelect** — Added `#trigger` and `#option` scoped slots + `borderless` prop (backward compatible)
- **BaseSelect** — Fixed right padding (`pl-3 pr-8`) so dropdown arrow is always visible
- **AppHeader** — Profile avatar replaced with BeanieAvatar (falls back to `adult-other`)
- **SetupPage + AuthStore** — Default `gender: 'male'`, `ageGroup: 'adult'` for owner creation
- 15 new translation keys with beanie mode overrides
- Unit tests: 14 tests (composable + avatar definitions)
- E2E tests: 4 specs (header avatar, family cards, add child member, filter dropdown)

### Sidebar Redesign (Issue #59)

- **`src/constants/navigation.ts`** — Shared `NavItemDef` interface and `NAV_ITEMS` array with `PRIMARY_NAV_ITEMS`/`SECONDARY_NAV_ITEMS` exports. Emoji icons, primary/secondary section split. Ready for reuse by mobile bottom nav
- **`src/components/common/AppSidebar.vue`** — Full v3 redesign:
  - Permanent Deep Slate (`#2C3E50`) background — always dark, no light/dark toggle needed
  - Brand logo in 42px squircle with `bg-white/[0.08]` tint
  - Wordmark: "beanies" white + ".family" Heritage Orange, italic tagline at 0.5rem/25% opacity
  - Emoji nav icons replacing BeanieIcon SVGs for warmth (per CIG v2)
  - Active nav item: Heritage Orange gradient (`from-[rgba(241,93,34,0.2)]`) + 4px left border
  - Hover: subtle `bg-white/[0.05]` with text brightening from 40% to 70%
  - Primary/secondary nav separated by `h-px bg-white/[0.08]` divider
  - User profile card at bottom: BeanieAvatar + owner name/role in `bg-white/[0.04]` rounded card
  - Security indicators at 30% opacity ("felt not seen"): file icon + name, lock/unlock, version
  - Removed: `SyncStatusIndicator` component, `BeanieIcon` import, `hoveredPath` ref, hover event listeners, all dark mode conditional classes

### Header Redesign (Issue #67) — Closed

- Removed bottom border, background color, and theme toggle from header
- Page title moved into header left side (Dashboard shows greeting, other pages show `route.meta.title`)
- Removed `PageHeader` component from 7 pages (Accounts, Transactions, Assets, Goals, Reports, Forecast, Settings)
- All controls restyled as squircle containers (`h-10 w-10 rounded-[14px]`) with subtle hover backgrounds
- Currency selector: symbol only (e.g. `$`), language selector: flag only
- Privacy toggle: green status dot (`bg-[#27AE60]`) when figures visible
- Notification bell: BeanieIcon with Heritage Orange dot (static for now)
- Profile: avatar + chevron only, name/email shown in dropdown panel
- `bell` icon added to `UTILITY_ICONS` in `icons.ts`

### Configurable Currency Chips (Issue #36) — Closed

- `preferredCurrencies` added to Settings model and IndexedDB repository
- Settings page: multi-select for up to 4 preferred currencies with removable chips
- Header: inline currency chips in white-bg pill — active chip in Heritage Orange, click to switch instantly
- All currency dropdowns show preferred currencies first via shared `useCurrencyOptions()` composable
- Fallback to baseCurrency if active display currency is removed from preferred list

### Branded Language Picker Flags (Issue #38) — Closed

- SVG flag images (`/brand/flags/us.svg`, `/brand/flags/cn.svg`) for cross-platform rendering (emoji flags don't render on Windows)
- Language picker uses `<img>` tags with SVG flags in white-bg pill + chevron
- Dropdown rows show flag in squircle container + native name with Heritage Orange active highlight
- `flagIcon` field added to `LanguageInfo` interface

### Design System Foundation (Issue #57) — Closed

- All dashboard components created: NetWorthHeroCard, SummaryStatCard, GoalProgressItem, ActivityItem, FamilyBeanRow, RecurringSummaryWidget
- UI components: ToggleSwitch, ToastNotification, BeanieAvatar
- CSS custom properties (--card-shadow, --sq, --silk10, etc.) added to style.css
- v3 Nook UI styling: 24px rounded corners, soft shadows, gradient cards, Heritage Orange accents

### Dashboard Redesign (Issue #58) — Closed

- Greeting header with time-of-day message + date subtitle
- Net Worth Hero Card with sparkline chart, time period selector, and change indicators
- 3 Summary stat cards (Income / Expenses / Cash Flow) in grid layout
- Family Beans row with beanie avatars, role labels, and Add Bean button
- 2-column grid: Savings Goals with progress bars + Recurring Summary widget
- All cards use v3 rounded-3xl styling with hover lift

### i18n Full String Extraction

- Audited all 15+ Vue files, extracted ~200 hardcoded English strings to `uiStrings.ts`
- All UI text now uses `t('key')` translation calls — enables Chinese translation and beanie mode for all strings
- Files updated: DashboardPage, AppHeader, AppSidebar, SettingsPage, TransactionsPage, ReportsPage, FamilyPage, SetupPage, LoginPage, MagicLinkCallbackPage, PasswordModal, FamilyBeanRow, RecurringSummaryWidget, NetWorthHeroCard
- Project documentation updated: all new UI text must use the translation system, never hardcoded

### Net Worth Chart Axis Labels

- Y-axis compact labels with currency symbol (e.g. `$125k`, `$1.2M`)
- X-axis date labels with Outfit font, last label shows "Today"
- Horizontal grid lines at 4% white opacity
- Chart height increased from h-20 to h-28

### Plans Archive

- `docs/plans/` directory created with naming convention and workflow documentation
- Accepted implementation plans saved before work begins for historical reference
- Rule added to CLAUDE.md project documentation

### Performance Reference Document

- `docs/PERFORMANCE.md` created covering client-side resource boundaries, growth projections, and 8 prioritized mitigation strategies
- Published to GitHub wiki

### Family Member Role Display Fix

- `FamilyBeanRow.vue` `getRoleLabel` now checks `member.ageGroup` (adult/child) instead of only `member.role`
- Adults with 'member' role correctly show "Parent"/"Big Bean" instead of "Little Bean"

### Functional Net Worth Chart (Issue #66) — Closed

- **`src/composables/useNetWorthHistory.ts`** — Computes historical net worth by replaying transactions backwards from current account balances. Supports 5 time periods (1W daily, 1M daily, 3M every 3 days, 1Y biweekly, All auto-scaled ~30 points). Returns period-over-period change amount and percentage. Computes last-month vs this-month deltas for income, expenses, and cash flow. Respects global member filter
- **`NetWorthHeroCard.vue`** — Static SVG sparkline replaced with Chart.js `<Line>` area chart via vue-chartjs. Heritage Orange line (`#F15D22`) with gradient fill (30% → transparent). Subtle grid lines at 4% white opacity. Glowing dot marks current value. Period pills now functional — clicking changes chart range and recomputes comparison. Dynamic period label ("this week"/"this month"/"past 3 months"/"this year"/"all time"). Privacy mode shows "Chart hidden" placeholder. Empty state shows "No data yet". Custom tooltip with brand styling
- **`DashboardPage.vue`** — Wired up composable: `changeAmount`/`changePercent`/`selectedPeriod`/`historyData` to hero card, `incomeChange`/`expenseChange`/`cashFlowChange` to summary stat cards for "vs last month" comparison
- Assets treated as constant in history (no historical valuation data in MVP)

### PNG Brand Character Avatars (Issue #65) — Closed

- Replaced inline SVG avatar rendering with hand-crafted PNG brand assets from `public/brand/`
- **`BeanieAvatar.vue`** — Rewritten from `<svg>` to `<div>` + `<img>`. Each avatar shows colored ring border (2px solid in member's color) + soft pastel background (member color at ~12% opacity). `family-filtered` variant shows small funnel badge overlay (SVG icon in dark circle)
- **`avatars.ts`** — Removed `BeanieAvatarDef` interface, `BEANIE_AVATARS` SVG paths, `getAvatarDef()`. Replaced with `AVATAR_IMAGE_PATHS` mapping variants to PNG paths, `getAvatarImagePath()`. `AvatarVariant` type preserved
- PNG asset mapping: `adult-male` → father, `adult-female` → mother, `child-male` → baby boy, `child-female` → baby girl, `adult-other`/`child-other` → neutral, `family-group` → family, `family-filtered` → neutral + funnel badge
- Unit tests rewritten (8 tests — PNG path assertions replace SVG path assertions)
- E2E tests updated to check for `<img>` elements with `/brand/beanies_*.png` sources

### Branded Confirmation Modal (Issue #56) — Closed

- `useConfirm` composable (singleton pattern matching `useCelebration`): `confirm()` and `alert()` return `Promise<boolean>`
- `ConfirmModal.vue` component wrapping `BaseModal` + `BaseButton` + `BeanieIcon` with danger (red) and info (orange) variants
- All 9 native `confirm()`/`alert()` calls replaced across 6 files (Accounts, Transactions, Assets, Goals, Family, PasskeySettings)
- 14 new i18n keys for dialog titles and messages with beanie mode overrides
- Wired into `App.vue` alongside `CelebrationOverlay`

### Dashboard Count-Up Animation Restore

- Re-integrated `useCountUp` composable into `SummaryStatCard` for animated number transitions
- Animation triggers on page load, view switching (component remount), and privacy mode reveal (target returns 0 when masked)
- Respects `prefers-reduced-motion` accessibility setting

### Blurred Masked Chart

- Dashboard net worth chart shows blurred view (`blur-md`) instead of "chart hidden" placeholder when privacy masking is on
- Matches Reports page pattern; `pointer-events-none` prevents tooltip data leaks
- Smooth CSS transition (`transition-all duration-300`) between blurred and clear states

### Mobile Responsive Layout (Issue #63)

- **`src/composables/useBreakpoint.ts`** — Reactive `isMobile` / `isTablet` / `isDesktop` refs using `matchMedia` with singleton listeners, SSR-safe defaults
- **`src/components/common/MobileBottomNav.vue`** — Fixed bottom tab bar (5 tabs: Nook, Planner, Piggy Bank, Budget, Pod) with safe area insets, Heritage Orange 8% background pill active state, nested route matching, dark mode support
- **`src/components/common/MobileHamburgerMenu.vue`** — Full-screen slide-in overlay from left with Deep Slate background, brand logo, controls section (member filter, privacy toggle, language selector, currency chips), all 9 nav items, user profile card, security indicators footer. Closes on backdrop click, Escape key, and route change
- **`src/components/common/AppHeader.vue`** — Mobile: hamburger button + greeting/page title + notification bell. Desktop: unchanged (all controls preserved)
- **`src/App.vue`** — Sidebar hidden on mobile (`v-if="isDesktop"`), bottom nav shown on mobile, hamburger menu wired up, reduced mobile padding (`p-4 md:p-6`), bottom padding clearance (`pb-24`)
- **`src/components/ui/BaseModal.vue`** — `fullscreenMobile` prop: removes rounded corners and max-width on mobile viewports
- **`src/constants/navigation.ts`** — `MobileTabDef` interface and `MOBILE_TAB_ITEMS` constant (5 tabs: Nook, Planner, Piggy Bank, Budget, Pod)
- **`src/services/translation/uiStrings.ts`** — 7 new i18n keys: `mobile.nook`, `mobile.pod`, `mobile.menu`, `mobile.closeMenu`, `mobile.navigation`, `mobile.controls`, `mobile.viewingAll`
- **Responsive page pass** — Fixed hardcoded grid/width classes across 5 pages:
  - TransactionsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - GoalsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (2 form modals)
  - AssetsPage: `grid-cols-2` → `grid-cols-1 md:grid-cols-2` (card value display)
  - ReportsPage: `w-64`/`w-48`/`w-40` → `w-full md:w-*` (4 fixed-width selects)
  - FamilyPage: `grid-cols-2`/`grid-cols-3` → responsive variants (4 form grids)

### PWA Functionality (Issue #6) — Closed

- **`index.html`** — Added PWA meta tags: `theme-color` (with dark mode media variant), `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, `description`
- **`vite.config.ts`** — Completed manifest (`start_url`, `scope`, `orientation`, `categories`); changed `registerType` from `autoUpdate` to `prompt` for user-controlled SW updates
- **`src/composables/useOnline.ts`** — Singleton reactive `isOnline` ref with `online`/`offline` event listeners
- **`src/composables/usePWA.ts`** — `canInstall`, `isInstalled`, `installApp()`, `dismissInstallPrompt()` with 7-day localStorage dismissal persistence; `beforeinstallprompt` handling, standalone mode detection
- **`src/components/common/OfflineBanner.vue`** — Heritage Orange slide-down banner when offline ("You're offline — changes are saved locally"), `aria-live="polite"`
- **`src/components/common/InstallPrompt.vue`** — Dismissible install card shown 30s after page load with brand icon, install/dismiss buttons, bottom-positioned on mobile, bottom-right on desktop
- **`src/components/common/UpdatePrompt.vue`** — Deep Slate banner using `useRegisterSW` from `virtual:pwa-register/vue` with "Update now" / "Later" buttons, hourly background update checks
- **Settings page** — "Install App" card section visible when installable or already installed (green checkmark)
- **`MobileHamburgerMenu.vue`** — Added loading spinner to mobile language selector (was missing visual feedback during translation)
- 12 new i18n keys with beanie mode overrides (`pwa.*`, `settings.installApp*`)
- 4 new test files (19 tests): useOnline, usePWA, OfflineBanner, MobileBottomNav
- **E2E fix** — TrustDeviceModal dismissed in auth helper to prevent pointer event interception in CI

### Automated Translation Pipeline

- Fixed broken `scripts/updateTranslations.mjs` parser (was matching `UI_STRINGS`, now parses `STRING_DEFS` line-by-line)
- Added `--all` flag for multi-language translation (default behavior), stale key cleanup, CI-friendly summary output
- Populated `public/translations/zh.json` with all 655 translations (was 287)
- Created `.github/workflows/translation-sync.yml` — daily cron at 3 AM UTC with conditional auto-deploy
- Updated `package.json` translate scripts, `scripts/README.md`, ADR-008, new `docs/TRANSLATION.md`
- Added Playwright browser caching to CI workflow (saves ~8 min per E2E run)

### Mobile Privacy Toggle

- Show/hide financial figures icon now always visible in mobile/tablet header (previously buried in hamburger menu)
- Sits next to notification bell with same squircle styling, beanie blink animation, and green status dot

### Count-Up Animation for All Summary Cards

- **`src/composables/useAnimatedCurrency.ts`** — Reusable composable wrapping `useCountUp` + `convertToDisplay` + `formatCurrencyWithCode` + privacy mode masking. Returns `{ formatted, displayValue }`. When privacy mode is on, target drops to 0 so revealing figures triggers a fresh count-up from zero
- **NetWorthHeroCard** — Hero net worth amount (800ms duration) and change amount (200ms delay) now animate on load and when values change
- **AccountsPage** — 3 summary cards (Total Assets, Total Liabilities, Net Worth) with staggered delays (0/100/200ms)
- **TransactionsPage** — 6 summary cards: 3 transaction tab (Period Income, Expenses, Net) + 3 recurring tab (Monthly Income, Expenses, Net) with staggered delays
- **AssetsPage** — 4 summary cards (Total Asset Value, Total Loans, Net Asset Value, Appreciation/Depreciation) with staggered delays (0/100/200/300ms)
- **GoalsPage** — 3 integer count cards (Active, Completed, Overdue goals) using `useCountUp` directly with staggered delays
- All animations respect `prefers-reduced-motion` accessibility setting

### Trusted Device Mode (Issue #74) — Closed

- `isTrustedDevice` and `trustedDevicePromptShown` flags in GlobalSettings (registry DB)
- `signOut()` conditionally preserves IndexedDB cache when trusted device is enabled
- `signOutAndClearData()` action always deletes cache regardless of trust setting
- One-time `TrustDeviceModal` shown after first successful sign-in + data load
- Settings toggle in Security section to enable/disable trusted device
- Hamburger menu shows dual sign-out options when trusted device is on
- 8 new i18n keys for trust prompt, settings toggle, and sign-out options

### Login Page UI Redesign (Issue #69) — Closed

- **5-view login flow** per v6 wireframes replacing the old 4-view monolithic flow:
  - **Welcome Gate (00a)** — Three large branded path cards: "Sign in to your pod", "Create a new pod!" (Heritage Orange gradient), "Join an existing pod"
  - **Load Pod (00b)** — File picker drop zone, disabled cloud connector placeholders (Google Drive, Dropbox, iCloud), security messaging cards, integrated decrypt modal (BaseModal with password input, auto-decrypt via sessionStorage cached password)
  - **Pick Bean (00b-3)** — Avatar grid with `BeanieAvatar` at 88px, green/orange status indicators, password form for sign-in or create-password for new members, back button returns to avatar grid when member selected
  - **Create Pod (00c)** — 3-step mini-onboarding wizard: Step 1 name/password → Step 2 choose storage (local file via `showSaveFilePicker`) → Step 3 add family members. Navigates directly to `/dashboard`
  - **Join Pod (00d)** — Family code input with dark slate "What happens next?" info card. Shows informative error (server-side registry not yet implemented)
- **`/welcome` dedicated route** — Unauthenticated users always land on Welcome Gate first; auto-load to Load Pod only triggers after clicking "Sign in to your pod"
- **`LoginBackground.vue`** — Warm gradient (`from-[#F8F9FA] via-[#FEF0E8] to-[#EBF5FD]`), wider `max-w-[580px]`
- **`LoginSecurityFooter.vue`** — Compact inline footer with 4 security badges at `opacity-30`
- **`LoginPage.vue`** — 5-view orchestrator with store initialization on mount, auto-load deferred to navigation
- **Legacy setup wizard removed** — `SetupPage.vue` deleted, `/setup` route removed, create pod wizard handles full onboarding
- **Deleted**: `SignInView.vue`, `TrustBadges.vue`, `SetupPage.vue`
- **~50 new i18n keys** in `uiStrings.ts` under `loginV6.*` namespace

### Encryption Pipeline Security Hardening (Issue #84) — Closed

- **Critical security fix**: 7 bugs in the sync pipeline could cause encrypted `.beanpod` files to be silently written in plaintext
- **`syncService.ts`**: Added `setEncryptionRequiredCallback()` — `triggerDebouncedSave()`, `flushPendingSave()`, and `save()` now refuse to write when encryption is required but no password is available (defense-in-depth)
- **`syncStore.ts`**: Removed hardcoded `encryptionEnabled: false` from `loadFromFile()`, `loadFromNewFile()`, and `disconnect()` — encryption setting now persists correctly across file operations
- **`syncStore.ts`**: `requestPermission()` no longer arms auto-sync before password is available; `decryptPendingFile()` sets password and encryption flag before reloading stores, then arms auto-sync
- **`MobileHamburgerMenu.vue`**: Fixed sign-out order — `signOut()` now flushes pending saves before `resetAllStores()` clears the session password (matching AppHeader pattern)
- **`fileSync.ts`**: `exportToFile()` now respects encryption settings; `importSyncFileData()` preserves local `encryptionEnabled` value instead of importing from file

### Family Member Role Display Fix

- `FamilyBeanRow.vue` `getRoleLabel` now checks `member.ageGroup` (adult/child) instead of only `member.role`
- Adults with 'member' role correctly show "Parent"/"Big Bean" instead of "Little Bean"

### Cross-Device Passkey Authentication Fix (Issue #108) — Superseded

- **Implemented but superseded** by the Automerge + Family Key migration (#119)
- Level 1 (cross-device UX) and Level 2 (PRF-wrapped password in .beanpod) were fully implemented
- The family key model eliminates the cross-device problem entirely — passkeys wrap the family key directly, which is always available in the file envelope
- All #108 code (PasskeySecret type, passkeyCrypto wrapPassword/unwrapPassword, cross-device flow in BiometricLoginView/LoginPage, passkeySecrets in sync layer) will be replaced or removed during the migration (#114, #115, #116)

### Biometric Login After Family Switching (Issue #16 follow-up)

- **LoadPodView.vue** — Added biometric detection before password modal: checks `isPlatformAuthenticatorAvailable()` + `hasRegisteredPasskeys()` when encrypted file is loaded, emits `biometric-available` event to switch to BiometricLoginView
- **LoginPage.vue** — Handles `biometric-available` event from LoadPodView, `biometricDeclined` flag prevents loops when user clicks "Use password instead", resets on family switch/navigation
- **authStore.ts** — Fixed `signInWithPasskey()` using stale `familyContextStore.activeFamilyId` instead of the authoritative `familyId` parameter during family switching
- **passwordCache.test.ts** — Added missing `setSessionDEK` and `flushPendingSave` to syncService mock (pre-existing CI failure)

### Cross-Device Sync (Issue #103) — Closed

- **`syncStore.ts` — `reloadIfFileChanged()`**: Lightweight `getFileTimestamp()` check, full reload only when file is newer. Handles encrypted files via session password → session DEK → cached password fallback chain
- **`syncStore.ts` — `startFilePolling()` / `stopFilePolling()`**: 10-second interval polling for external file changes, auto-started by `setupAutoSync()`, stopped on sign-out/disconnect
- **`App.vue` — visibility change handling**: `reloadIfFileChanged()` on tab/app resume; `syncStore.syncNow(true)` force save on `hidden` to prevent data loss on quick reload
- **Data loss fix**: `flushPendingSave()` + `syncNow(true)` on `visibilityState: hidden` ensures debounced saves are flushed before page reload
- Cloud relay for near-instant sync planned as follow-up (#118, supersedes #104)

### Family Nook Landing Page Fix

- All 5 login components (PickBeanView, BiometricLoginView, JoinPodView, CreatePodView, LoadPodView) now redirect to `/nook` instead of `/dashboard` after sign-in
- NotFoundPage "Go Home" button navigates to `/nook`
- E2E tests updated to expect `/nook` after authentication

### Biometric Login Fallback Fix (LoadPodView)

- Fixed bug where "use password instead" after biometric prompt showed old family members instead of decrypt modal
- Root cause: `autoLoadFile()` called `syncStore.loadFromFile()` reading from old configured file handle instead of pending encrypted file
- Fix: check `syncStore.hasPendingEncryptedFile` before re-reading

### Deploy Workflow CI Gating

- Updated `.github/workflows/deploy.yml` to poll for CI/security check completion (15s interval, 10min timeout) instead of failing immediately
- Fails immediately if no CI run exists for the latest commit (prevents bypassing CI)

### NookGreeting UI Cleanup

- Removed duplicate notification bell and privacy mask icons from `NookGreeting.vue` (already present in header)

### Codebase Deduplication & Cleanup (PR #107) — Closed

Comprehensive review of 243 source files (~49,700 lines) identified and consolidated ~2,000+ lines of duplicated or redundant code across 6 phases (84 files changed, net reduction of 544 lines):

- **Shared utilities:** Extracted `currency.ts` (currency conversion, 6 consumers), `useMemberInfo.ts` (member lookup, 5 pages), `toDateInputValue()` (date formatting, 4 files)
- **Generic repository factory:** `createRepository.ts` eliminates identical CRUD boilerplate across 8 IndexedDB repositories (~474 lines)
- **Toast notification system:** `useToast.ts` + `ToastContainer.vue` — module-level singleton for user-visible error/success/warning/info notifications. Error toasts are sticky. Replaces silent `console.error` calls
- **Store action helper:** `wrapAsync()` in `useStoreActions.ts` replaces 23 identical try/catch/finally blocks across 8 stores (~484 lines). CRUD failures automatically show sticky error toasts
- **Member filter factory:** `useMemberFiltered.ts` consolidates 20+ filtered getter patterns across 5 stores
- **Component consolidation:** Unified `MemberChipFilter.vue` (replaced 2 near-identical components), `useFormModal.ts` composable (5 modals), `ActionButtons.vue` (4 pages)
- **CSS cleanup:** 172 hardcoded hex colors replaced with Tailwind semantic tokens, `nook-section-label` utility applied to 8 inline duplicates, shared `nook-card-dark` class for 4 nook widgets
- **Dead code removal:** 6 unused date utility functions removed
- 10 new shared modules created. 462/462 unit tests passed, 54/57 E2E tests passed (1 pre-existing flaky)
- Full plan: `docs/plans/2026-03-01-codebase-dedup-cleanup.md`

### Node.js 24 Upgrade

- Upgraded all CI/CD workflows and `.nvmrc` from Node 20 to Node 24
- Eliminated recurring TypeScript strictness mismatches between local dev (Node 24) and CI (Node 20)
- Removed Node version matrix from `main-ci.yml` (was `[20.x, 24.x]`, now single `24`)
- Fixed `createRepository.ts` TS2352 error exposed by Node 24's stricter TypeScript

### Text Casing Standardization

- Standardized all non-sentence UI text to lowercase across `uiStrings.ts` (~150 strings)
- Fixed AppHeader page title system: reads `route.meta.titleKey` → `t(titleKey)` instead of empty `route.meta.title`
- Dashboard and Nook pages show greeting instead of page title in AppHeader
- Removed duplicate `<h1>` page titles from AccountsPage, TransactionsPage, FamilyPlannerPage, FamilyTodoPage
- Updated E2E planner tests to use case-insensitive matchers
- Documented casing standard in `.claude/skills/beanies-theme.md` and `CLAUDE.md`
- Regenerated Chinese translations for all changed strings

### Budget Page (Issue #68) — Closed

- **Data model** — `Budget`, `BudgetCategory`, `BudgetMode` types in `models.ts`. `CreateBudgetInput`/`UpdateBudgetInput` aliases. `'budget'` added to `EntityType` union. `budgets` added to `SyncFileData.data`
- **Database** — DB_VERSION 5→6. `budgets` object store with `by-memberId` and `by-isActive` indexes. Export/import/clear support
- **`src/services/indexeddb/repositories/budgetRepository.ts`** (new) — Standard `createRepository` pattern + `getActiveBudget()` helper
- **`src/stores/budgetStore.ts`** (new) — Core budget state + cross-store computed getters: `activeBudget`, `effectiveBudgetAmount` (resolves percentage mode), `categoryBudgetStatus` (per-category spend tracking with ok/warning/over), `budgetProgress`, `paceStatus` (great/onTrack/caution/overBudget), `upcomingTransactions` (next 5 recurring), `monthlySavings`, `savingsRate`, recurring/one-time breakdowns
- **`src/components/budget/BudgetSettingsModal.vue`** (new) — BeanieFormModal with mode toggle (% of income / fixed), percentage input with live effective budget preview, fixed amount input, currency selector, FamilyChipPicker for owner, collapsible category allocations with per-category AmountInput
- **`src/components/budget/QuickAddTransactionModal.vue`** (new) — Simplified transaction entry: direction toggle (Money In/Out), hero AmountInput, CategoryChipPicker, description, date, account select
- **`src/pages/BudgetPage.vue`** (new) — Full budget tracking page:
  - Hero card: Deep Slate gradient, Heritage Orange progress bar with time-position marker, motivational message + emoji based on pace
  - 3-column summary cards: Monthly Income, Current Spending, Monthly Savings (with recurring/one-time breakdowns, count-up animation)
  - Two-column content: Upcoming Transactions (next 5 scheduled) + Spending by Category (progress bars, color-coded status)
  - Bottom section: Budget Settings card + Add Transactions card (Quick Add functional, Batch Add + CSV Upload with "beanies in development" badge)
  - Empty state with EmptyStateIllustration when no budget exists
  - Privacy mode, dark mode, and mobile responsive support
- **Router + navigation** — `/budgets` route changed from DashboardPage to BudgetPage. `comingSoon` removed from budgets nav item
- **Sync infrastructure** — Budgets added to mergeService, fileSync validation + change detection, syncStore auto-sync watch + reload, App.vue data loading
- **EmptyStateIllustration** — Added `'budget'` variant with beanie + bar chart SVG
- ~70 new translation strings under `budget.*` namespace with beanie mode overrides
- Plan saved: `docs/plans/2026-03-01-budget-page.md`
- **Bug fixes (post-launch):**
  - Fixed zero spending bug: `isDateBetween()` normalized to date-only string comparison to eliminate timezone-dependent filtering failures
  - Fixed member filter not applied to budget summary cards (income, spending, savings, category breakdowns now use filtered variants)
  - Fixed multi-currency category aggregation (raw amounts now converted via `convertToBaseCurrency()` before summing)
  - Fixed emoji unicode escapes rendering as literal text on Add Transactions card
  - Redesigned Budget Settings card to match v7 UI mockup (side-by-side mode cards, Heritage Orange info callout)

### Projected Recurring Transactions (2026-03-03)

- **Projected transactions** — Future recurring transactions now appear as projections in the transactions list for any future month, giving users visibility into upcoming expenses/income
- **Deferred side effects** — Clicking a projected transaction offers scope selection (this only / this and future / all). Side effects (materializing a transaction or splitting a recurring item) are deferred until the user saves, preventing orphaned records on cancel
- **RecurringEditScopeModal** — Shared global modal for scope selection, registered in `App.vue`
- **`useProjectedTransactions` composable** — Generates ephemeral projected `DisplayTransaction` entries from active recurring items for the selected month
- **startDate → dayOfMonth sync** — Changing a recurring item's start date now auto-syncs the `dayOfMonth` field (clamped to 28) so that `syncLinkedTransactions` picks up the new day. Also syncs `monthOfYear` for yearly items
- **dayOfMonth field repositioned** — Moved between start date and end date in the recurring editor for better discoverability
- **Store immutability fixes** — Replaced all 19 in-place array mutations (`.push()`, `array[index]=`) with immutable patterns (spread, `.map()`) across 9 stores (accounts, family, goals, assets, todo, activity, budget, familyContext, tombstone). Prevents Vue 3.4+ computed reference-equality optimization from skipping re-evaluation
- **Today button on MonthNavigator** — Heritage Orange pill button appears next to month arrows when viewing a non-current month; clicking it jumps back to the current month
- 5 new TDD tests for startDate→dayOfMonth sync, all 659 tests passing

### Income-to-Goal Linking

- **Income transactions can be linked to financial goals** with automatic progress tracking — percentage or fixed-amount allocation with guardrail (auto-cap to remaining amount)
- `goalId`, `goalAllocMode`, `goalAllocValue`, `goalAllocApplied` fields added to `Transaction`; `goalId`, `goalAllocMode`, `goalAllocValue` added to `RecurringItem`
- `EntityLinkDropdown.vue` — generic dropdown extracted from `ActivityLinkDropdown.vue` (same mechanism, prop-driven data source); `ActivityLinkDropdown` simplified to thin wrapper
- Goal link section in `TransactionModal` — visible for income transactions only, with goal dropdown (currency-filtered), percentage/fixed toggle, allocation preview with capped indicator
- Store-level goal progress: `applyGoalAllocation()` and `adjustGoalProgress()` in `transactionsStore.ts` — mirrors `adjustAccountBalance` pattern; integrated into create/update/delete flows
- Recurring processor goal allocation — computes and applies allocation at transaction generation time (repo-level, outside Vue reactivity)
- Goals store reload after `processRecurringItems()` in `TransactionsPage.vue` (2 sites) and `App.vue` (4 sites) to fix stale reactive state
- 7 `goalLink.*` translation keys with beanie overrides
- Plan: `docs/plans/2026-03-05-income-to-goal-linking.md`

### CurrencyAmountInput Reusable Component

- **`CurrencyAmountInput.vue`** — extracted inline currency dropdown + `AmountInput` pattern used in 4 modals (Transaction, Account, Goal, Activity) into single reusable component with `v-model:amount` and `v-model:currency` two-way bindings
- Added currency dropdown to `ActivityModal` (was previously locked to base currency with no UI selector); changed default from `baseCurrency` to `displayCurrency`
- Restyled `GoalModal` currency dropdown to match Transaction/Account inline pattern (replaced separate `BaseSelect`)
- Net -64 lines across all modals

### Nook Card Click-to-Edit Modals

- **ScheduleCards** — merged planner activities (from `activityStore.upcomingActivities`) into Today and This Week cards alongside todos; unified `ScheduleItem` type with click-to-edit via emits
- **RecentActivityCard** — added click handlers emitting `open-todo` / `open-transaction` for inline editing
- **FamilyNookPage** — wired `TodoViewEditModal`, `ActivityModal`, and `TransactionModal` with save/delete handlers (edit-only, no create); all card items open modals directly on the Nook page without navigation
- **NookTodoWidget reactivity fix** — changed `selectedTodo: ref<TodoItem | null>` to `selectedTodoId: ref<string | null>` + computed lookup from `todoStore.todos` (same pattern as FamilyTodoPage)

### Recurring Activity/Transaction Scope UX (2026-03-09)

- **Scope modal moved to save time** — "This only / This & all future / All occurrences" modal now appears after the user clicks Save (not before opening the edit modal). Applies to both recurring activities and projected transactions. Users can see what they're changing before deciding scope.
- **Occurrence date banner** — Edit modals for recurring activities and projected transactions show the specific occurrence date being edited (e.g. "Editing occurrence on Mon, Mar 16, 2026").
- **Inline edit scope handling** — `ActivityViewEditModal` uses `scopeResolved` flag so scope is only asked once per editing session. After "this only" materialization, the override has `recurrence: 'none'` so scope check is naturally skipped.
- **`useActivityScopeEdit` composable** — Shared between `FamilyPlannerPage` and `FamilyNookPage` to eliminate duplicated scope logic (DRY).
- **Automerge proxy fix** — `splitActivity` and `materializeOverride` now use `JSON.parse(JSON.stringify())` to deep-clone proxy objects, fixing `'get' on proxy: Symbol(_am_meta)'` errors.
- **`materializeOverride` spread order fix** — `recurrence: 'none'` is now applied after `...overrides` spread to prevent form data from overwriting it.
- Plan: `docs/plans/2026-03-09-per-instance-activity-overrides.md`

### Google Drive Resilience Fixes (2026-03-09)

- **5xx retry with exponential backoff** — `GoogleDriveProvider` now retries on 503/5xx errors up to 3 times with exponential backoff (1s, 2s, 4s). After exhausting retries on write, queues to offline flush instead of throwing unhandled.
- **Init file polling suppression** — `deferPolling()` / `startDeferredPolling()` prevents `setupAutoSync` from starting file polling until after `processRecurringItems` completes, breaking the init mutation → file poll → reload → more mutations cascade.
- **30-second init timeout** — If `loadFamilyData` takes longer than 30s (due to Drive API issues), the spinner is dismissed so the app is usable. Data continues loading in the background.

### Multi-Owner Activities & Todos (2026-03-11)

- **Multi-assignee support** — Activities and todos now support multiple owners via new `assigneeIds: UUID[]` field alongside legacy `assigneeId` (backward compatible). Activities require 1+ owners, todos allow 0+
- **Normalizer pattern** — `normalizeAssignees()` and `toAssigneePayload()` in `src/utils/assignees.ts` are the single source of truth for all assignee reads/writes. All consumers call the normalizer, never read `assigneeId` directly
- **`MemberChip.vue` extraction** — Reusable presentational component (`sm`/`md` size variants) replacing 5+ duplicated inline member-chip patterns across `DayAgendaSidebar`, `UpcomingActivities`, `TodoPreview`, `TodoItemCard`, `NookTodoWidget`, `ActivityViewEditModal`, `TodoViewEditModal`
- **Multi-select UX** — `FamilyChipPicker` switched to `mode="multi"` for assignees with confirm (✓) / cancel (✕) buttons in inline edit slots. Dropoff/pickup stay single-select with auto-save + cancel button
- **Data layer updates** — `useMemberFiltered` composable widened to accept `string | string[] | undefined | null` (array-aware filtering). `useCriticalItems` shows notifications for all assignees. Activity and todo repositories use `normalizeAssignees().includes()` for queries
- **All consuming components updated** — 23 files modified across stores, composables, repositories, modals, list views, pages, and quick-add flows
- **Tests** — 9 new unit tests for normalizer/payload builder, 4 new `useCriticalItems` multi-assignee tests, 3 new `activityStore` filter tests, 12 E2E planner tests updated to select assignee (required by new `canSave` validation)
- Plan: `docs/plans/2026-03-11-multi-owner-activities-todos.md`

### beanies-plan Skill (2026-03-11)

- **`.claude/skills/beanies-plan/SKILL.md`** — Standardized plan & issue creation skill for consistent plan documents and GitHub issues with full context preservation
- 5-phase workflow: Gather & Clarify → Draft Plan → Iterate Until Approved → Save Plan → Create GitHub Issue (optional)
- Captures all user prompts verbatim (initial + follow-ups + redirections) as a permanent prompt log
- Enforces plan document format, GitHub issue format with 2-way links, and project labeling conventions
- Always asks whether to create a GitHub issue or implement directly

### Recent Improvements (2026-03-11)

- **Activity start+end time display** — All activity time displays (Nook schedule cards, planner sidebar upcoming section) now show both start and end times (e.g. "10:00 - 11:30") instead of just start time
- **Activity view modal readability overhaul** — Cleaner, more compact layout:
  - Pick-up/drop-off duties promoted into grey summary box at top (with inline editing)
  - Date and times consolidated into a single row (3-col for one-off, 2-col for recurring)
  - Empty optional fields (location, cost, instructor, notes) hidden in view mode — use Edit to add
  - "Created by" reduced to subtle inline footer text
  - Edit button moved to modal footer alongside Close (was a full-width row in the body)
  - BeanieFormModal now supports `footer-start` slot for extra footer actions
- **Sign-out modal improvements:**
  - Fixed InfoHintBadge tooltip overflow on mobile (positioned from right edge with viewport max-width)
  - Both sign-out options now side by side with emojis (🚪 Sign Out / 🗑️ Clear & Sign Out) and equal-height buttons
  - Cancel moved to subtle text link below
- **Family member data loss bug fix** — `CreatePodView.handleFinish()` now checks `syncNow()` return value and retries on failure; `OnboardingWizard` skip/finish handlers explicitly save via `syncNow(true)`

### Recent Fixes

- **Join flow cross-browser decrypt fix** — When a new member joined via invite link and created a password, the `joinFamily()` flow only stored a `passwordHash` in the Automerge doc but never created a `wrappedKey` entry in the V4 envelope. This meant password-based file decryption failed on different browsers/devices (e.g. Safari PWA after joining via Chrome on iOS, where storage is completely isolated). Fix: added `wrapFamilyKeyForMember()` to syncStore that derives an AES-KW wrapping key from the password and wraps the family key, called from `JoinPodView.handleCreatePassword()` before syncing.
- **Envelope merge race condition fix** — `fetchAndMergeRemote()` in `doSave()` was doing wholesale `currentEnvelope = remoteEnvelope` replacement, which could overwrite locally-added `inviteKeys`, `wrappedKeys`, and `passkeyWrappedKeys` when a prior auto-save wrote a version without them. Fix: merge local keys into remote envelope before assignment.
- **Family key cache on join fix** — `cacheFamilyKey()` silently returned when device was not trusted, causing data loss after page refresh or PWA install following a successful join. Fix: added `force` option to `cacheFamilyKey()` and force-cache during join/decrypt flows. Also fixed `App.vue` to redirect to `/welcome` when auto-decrypt fails instead of falling through to an empty Automerge doc.
- **Google Picker API for join flow** — When `drive.file` scope can't read a file shared by another user (returns 404), the join flow now shows a Google Picker button to let the invitee select the shared `.beanpod` file from their Drive (grants `drive.file` access). Includes `drivePicker.ts` service, `google-picker.d.ts` type declarations, and picker fallback UI in `JoinPodView.vue`. Plan: `docs/plans/2026-03-05-google-picker-invite-email-sharing.md`.
- **Email sharing in invite modal** — Optional email field in the invite modal (`FamilyPage.vue`) lets the pod owner share the `.beanpod` file with a family member's Google account directly via the Drive Permissions API. Uses `shareFileWithEmail()` in `driveService.ts`.
- **Google OAuth re-consent loop fix** — Three-layer fix preventing PWA users from being forced to re-consent on every page refresh:
  1. `getValidToken()` and 401 fallbacks in `googleDriveProvider.ts` now pass `forceConsent: true` when no refresh token exists (Google only issues refresh tokens with `prompt=consent`)
  2. `App.vue` requests `navigator.storage.persist()` on startup to prevent browser eviction of IndexedDB
  3. Refresh tokens dual-written to IndexedDB + localStorage as defense-in-depth against storage eviction (iOS Safari 7-day policy, PWA storage pressure)
  - New `hasRefreshToken()` export in `googleAuth.ts` for cross-module access
  - Plan: `docs/plans/2026-03-04-fix-oauth-reconsent-loop.md`
- **Multi-family isolation hardening** — Fixed cross-family data leakage when authenticated user's familyId could not be resolved:
  - Added cached session familyId as 4th fallback in auth resolution chain (JWT → getUserAttributes → registry → cached session)
  - Authenticated users no longer fall back to `lastActiveFamilyId` (which could belong to a different user)
  - Placeholder family creation now uses auth-resolved ID instead of random UUID (`createFamilyWithId()`)
  - Sync service refuses to load sync file whose `familyId` doesn't match the active family (in `loadAndImport`, `openAndLoadFile`, `decryptAndImport`)
  - Sync service skips initialization when no active family is set (prevents legacy key fallback)
  - Sync service `reset()` clears stale file handles and session passwords on family switch
  - Sync service tracks `currentFileHandleFamilyId` — `save()` blocks writes if handle belongs to a different family
  - Added `closeDatabase()` before loading family data to ensure clean DB connection
  - 22 multi-family isolation tests (up from 19)
- **BaseModal scroll fix** — Modal body now uses `flex-1 overflow-y-auto` with `max-h-[calc(100vh-2rem)]` so tall content scrolls instead of overflowing below the viewport (discovered via asset loan form E2E tests)
- Restored ReportsPage that was wiped during bulk ESLint/Prettier formatting
- Added data-testid attributes to transaction items and account cards for E2E tests
- Fixed E2E tests to switch to transactions tab before interacting with elements
- Switched from idb library to native IndexedDB APIs

### AWS Infrastructure & Deployment (Issue #7) — Closed

- **Terraform IaC** (`infrastructure/`) — Modular Terraform configuration with S3 backend + DynamoDB locking
  - `frontend` module: S3 bucket (CloudFront OAC), CloudFront distribution (HTTPS, gzip, SPA routing), ACM cert (DNS-validated), Route53 A/AAAA records
- **CI/CD Pipeline** (`.github/workflows/deploy.yml`) — Two-job GitHub Actions workflow:
  - `test` job: lint, type-check, Vitest unit tests, Playwright E2E (chromium), production build
  - `deploy` job: S3 sync + CloudFront cache invalidation (only runs after tests pass)
  - All secrets (AWS credentials, S3 bucket, CloudFront ID) stored in GitHub Secrets
- **Live at** `https://beanies.family` (and `https://www.beanies.family`)
- All sub-issues closed: #8, #9, #10, #11, #12, #13, #14

## In Progress

- **Multi-Family with File-Based Auth** — Per-family databases, file-based authentication (Cognito removed), passkey/biometric login implemented

### Completed Goals Section (Issue #55)

- Collapsible "Completed Goals" disclosure section below active goals list (collapsed by default)
- Completed goals sorted by most recently completed, showing name, type, member, completion date, and final amounts
- Reopen button moves a goal back to the active list; delete button removes with whoosh sound
- Muted styling distinguishes completed from active goals; privacy mode blur on amounts
- Renamed "All Goals" card to "Active Goals" for clarity
- 3 new translation keys with beanie mode overrides (`goals.reopenGoal`, `goals.noCompletedGoals`, `goals.completedOn`)

### Financial Institution Dropdown (Issue #42) — Closed

- **`BaseCombobox.vue`** — Reusable searchable single-select dropdown with "Other" support, custom text input, clear button, backward compatibility for free-text values
- **`src/constants/institutions.ts`** — 22 predefined global banks (BoA, HSBC, DBS, JPMorgan Chase, etc.) with name/shortName
- **`src/constants/countries.ts`** — 249 ISO 3166-1 countries for optional country selector
- **`useInstitutionOptions`** composable merges predefined + user-saved custom institutions into sorted dropdown options
- Replaced plain text institution input on AccountsPage (add + edit modals) with institution combobox + country combobox
- Replaced plain text lender input on AssetsPage loan section (add + edit modals) with institution combobox + country combobox
- Custom institutions only persisted when form is saved (not on typing); deletable from dropdown with X button
- Deleting a custom institution clears it from all linked accounts and asset loans
- `institutionCountry` added to Account, `lenderCountry` added to AssetLoan, `customInstitutions` added to Settings
- 7 new translation keys with beanie mode overrides
- **E2E tests** (8 tests): predefined selection, search/filter, custom "Other" entry, country selection, edit pre-population, shared custom institutions across accounts and assets
- **`ComboboxHelper`** E2E helper class and **`AssetsPage`** page object created
- **BaseModal scroll fix**: tall modal content (e.g. asset loan form) now scrolls instead of overflowing below viewport

### Beanie Language Mode (Issue #35) — Closed

- Optional beanie mode toggle in Settings replacing standard UI strings with friendly bean-themed alternatives
- Single source of truth `STRING_DEFS` in `uiStrings.ts` with side-by-side `en` + `beanie` fields
- `t()` resolution: beanie override applied only when `language === 'en'` and `beanieMode === true`
- Translation pipeline always sources from plain English `UI_STRINGS` (hard requirement)
- Toggle disabled and greyed out when non-English language is active
- ~100+ beanie string overrides across all pages
- Unit tests and E2E tests (4 specs)

## Up Next

### Automerge + Family Key Migration (Epic #119)

Major data layer migration from IndexedDB + file-based sync to Automerge CRDT + family key encryption. Plan: `docs/plans/2026-03-02-automerge-family-key-migration.md`

**Phase 1 — Foundation (parallelizable):**

- [x] #110 — Automerge CRDT document service and repository factory
- [x] #111 — Family key encryption, wrapping, and invite link service (PR #121)
- [x] #112 — Google Drive OAuth PKCE migration (replaces GIS implicit grant) — PR #122, deployed to prod

**Phase 2 — Core Migration:**

- [x] #113 — Data layer switchover: IndexedDB → Automerge, sync rewrite, old code removal. Merged to `feature/automerge-migration`. Includes: all 10 stores switched to Automerge repos, sync/persistence layer rewritten for V4 beanpod, 15 deprecated files deleted, regression fixes (Automerge proxy cloning, auth session persistence, passkey lifecycle, exchange rate save). 615 tests passing.

**Phase 3 — Auth & UI:**

- [x] #114 — Auth and onboarding flows for family key model (includes #108 code cleanup). Merged to `feature/automerge-migration`. Includes: family key generation/wrapping, single-password sign-in (no separate file decrypt), passkey PRF-based key unwrapping, magic link invites with crypto tokens, trusted device file caching (passwordless shortcut removed), auto-sign-in after decrypt, inline sign-in form UX. 622 tests passing.
- [x] #115 — UI updates for family key model and invite flow. Merged to `feature/automerge-migration`. Includes: encryption toggle removed from Settings, family key status section, InviteMemberModal (magic link + QR), InviteLinkCard component, JoinPodView invite redemption, CreatePodView/LoadPodView/BiometricLoginView/PasskeySettings updated, useClipboard composable, JSON export. 622 tests passing.

**Phase 4 — Cleanup:**

- [x] #116 — Dead code removal, documentation updates, final verification. Completed on `feature/automerge-migration`. Includes: removed 6 orphaned V3 types from models.ts, deleted legacy migration module (legacyMigration.ts + related imports), removed V3 encryption wrappers, cleaned up stale comments, fixed broken E2E import, rewrote ARCHITECTURE.md for Automerge architecture, updated CLAUDE.md and SECURITY_GUIDE.md, added supersession notes to 6 existing ADRs, created ADRs 018/019/020

**Follow-up:**

- [ ] #117 — Family key rotation on member removal
- [ ] #118 — WebSocket push relay for real-time cross-device sync (supersedes #104)

**Superseded issues (closed):**

- #104 — Cloud relay → superseded by #118
- #108 — Cross-device passkey auth → superseded by family key model (#114)
- #17 — Password rotation → obsoleted by family key model
- #15 — Password recovery → superseded by invite links (#111/#114)

### Phase 1 Remaining (non-migration)

- [x] Financial institution dropdown (Issue #42) ✓
- [x] Beanie language mode (Issue #35) ✓
- [x] Functional net worth chart (Issue #66) ✓
- [x] PNG brand avatars (Issue #65) ✓
- [x] Header redesign (Issue #67) ✓
- [x] Design system foundation (Issue #57) ✓
- [x] Dashboard redesign (Issue #58) ✓
- [x] Configurable currency chips (Issue #36) ✓
- [x] Branded language picker flags (Issue #38) ✓
- [x] Replace native confirm/alert dialogs with branded modal (Issue #56) ✓
- [x] Budget page (Issue #68) ✓
- [ ] Switchable UI themes (Issue #41)
- [ ] Data validation and error handling improvements
- [x] Mobile responsive layout (Issue #63) ✓
- [ ] Responsive design polish
- [ ] Financial forecasting / projections page

## v6 UI Framework Proposal

A v6 UI framework proposal has been uploaded to `docs/brand/beanies-ui-framework-proposal-v6.html`, superseding v5 with detailed login flow screens for the new file-based authentication model. The v3 proposal was previously removed as obsolete.

v6 introduces a **six-screen authentication flow** built around the Pod concept (encrypted `.beanpod` data files):

- **00a: Welcome Gate** — Three paths: sign in, create pod, join pod
- **00b: Load Your Pod** — File picker + drag-drop zone + cloud storage connectors (Google Drive, Dropbox, iCloud)
- **00b-2: Unlock Your Pod** — Decrypt loaded file with pod password
- **00b-3: Pick Your Bean** — Family member selection with 88px avatars and onboarding status indicators
- **00c: Create a New Pod** — 3-step wizard (name/password → storage → invite)
- **00d: Join an Existing Pod** — Family code or magic link entry

Additionally, v6 includes all previous v4/v5 screens: Dashboard, Accounts (card + list), Budgets, Transactions, Onboarding, Family Hub, Mobile (4 phone mockups), Landing Page, and Settings.

| Issue | Screen                                                               | Status     |
| ----- | -------------------------------------------------------------------- | ---------- |
| #68   | Budget page — family budget tracking with category budgets           | New screen |
| #69   | Login page UI redesign — Welcome Gate + full auth flow per v6        | **Done** ✓ |
| #70   | Accounts page redesign — Assets/Liabilities hero + Cards/List toggle | Redesign   |
| #71   | Transactions page — full ledger view                                 | Redesign   |
| #72   | Landing page — public-facing hero page                               | New screen |
| #73   | Family Hub — 3-column layout with calendar and events                | Redesign   |
| #62   | Onboarding redesign — v6 welcome flow with illustrations             | Redesign   |

Existing issues updated with v5/v6 references: #60, #61, #62, #69.

## v7 UI Framework Proposal

A v7 UI framework proposal has been uploaded to `docs/brand/beanies-ui-framework-proposal-v7.html`, introducing a major structural reorganisation: the app shifts from finance-first to **family-first**, with three new pages and a collapsible accordion sidebar.

### Key Changes in v7

1. **Sidebar accordion restructure** — Flat nav replaced with two collapsible sections:
   - **The Piggy Bank 🐷** (finance): Overview, Accounts, Budgets, Transactions
   - **The Treehouse 🌳** (family): Family Nook, Family Planner, Family To-Do, Family Hub
   - Settings pinned at bottom, outside both accordions

2. **Family Nook 🏡** — New home screen after login (replaces finance dashboard as entry point). Shows today's schedule, events, milestones, activity feed, shared to-do widget, and Piggy Bank quick-access card

3. **Family Planner 📅** — Calendar and scheduling hub absorbing the old Family Hub calendar. Month/week/day/agenda views, event categorisation, family member filtering

4. **Family To-Do ✅** — Standalone task management page at `/todo`. Quick-add, assignees, date integration with calendar. Purple (#9B59B6) accent colour for to-do elements

5. **Updated mobile bottom tab bar** — 5 tabs: 🏡 Nook, 📅 Planner, 🐷 Piggy Bank, 📋 Budget, 👨‍👩‍👦 Pod

6. **Family Hub updated** — Calendar removed (→ Family Planner), now focused on personal member activity and milestones

7. **Budget page enhancements** — 3 transaction entry methods (Quick Add, Batch Add, CSV Upload), time-position marker, motivational emoji messages, category spending bars

8. **Transactions ledger** — Recurring/one-time type pills, summary pills, enhanced add modal with recurring toggle

### New Issues Created

| Issue | Title                                                           | Priority |
| ----- | --------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| #97   | Family Nook 🏡: home screen with schedule, events, to-do widget | High     | ✅ Done                                                |
| #98   | Family Planner 📅: calendar and scheduling hub                  | High     | 🔧 In Progress (weekly view done, month view existing) |
| #99   | Family To-Do ✅: standalone task management page                | High     | ✅ Done                                                |
| #100  | Sidebar accordion restructure: Piggy Bank + Treehouse           | High     | ✅ Done                                                |
| #101  | Mobile bottom tab bar: 5-tab layout                             | Medium   | ✅ Done                                                |

### Existing Issues Updated

- **#73** (Family Hub redesign) — Updated for v7: calendar removed, personal activity focus
- **#68** (Budget page) — Updated with 3 entry methods, motivational messages, category bars
- **#71** (Transactions page) — Updated with recurring/one-time type pills, enhanced modal
- **#20** (Family activity tracking) — Closed, superseded by Family Nook + Family Planner

### New Brand Vocabulary (v7)

| Term               | Meaning                                         |
| ------------------ | ----------------------------------------------- |
| The Piggy Bank 🐷  | Finance section (sidebar accordion)             |
| The Treehouse 🌳   | Family section (sidebar accordion)              |
| The Family Nook 🏡 | Home screen after login (family-first overview) |
| Family Planner 📅  | Calendar and scheduling hub                     |
| Family To-Do ✅    | Shared family task management                   |

## Future Phases

### Phase 2 — Enhanced Features

- [ ] Data import/export (CSV, etc.)
- [x] PWA offline support / install prompt / SW update prompt (#6) ✓
- [x] Google Drive sync (OAuth PKCE + Lambda proxy) — #78, #112, ADR-016
- [x] Projected recurring transactions with scope-based editing (this only / this and future / all) ✓
- [ ] Skip individual recurring occurrences
- [x] Landing/marketing page (#72) ✓

### Phase 3 — AI & Advanced

- [ ] AI-powered insights (Claude/OpenAI/Gemini)
- [ ] Additional language support

## Known Issues

- **Single-family re-login shows LoadPodView instead of auto-decrypting:** When a single family exists and the user clicks "Sign In" after sign-out, `tryAutoDecrypt` fails because `cacheFamilyKey()` only stores the key on trusted devices (`isTrustedDevice === true`). On non-trusted devices, the cached family key is empty, so auto-decrypt falls through to the LoadPodView password form. Needs investigation: either always cache the family key after explicit password entry, or prompt for trusted device earlier in the flow.
- ~~**Data loss after tab idle/sleep — saves fail silently:** After waking from sleep and visiting Settings to check last-saved timestamp, all subsequent saves failed with "no family key or envelope". Data created after visiting Settings was lost on refresh.~~ **Fixed 2026-03-10** — Root cause: `SettingsPage.vue` called `syncStore.initialize()` on mount, which called `syncService.reset()` clearing the encryption key from the sync service (but not the Vue ref). Four-layer fix: (1) removed redundant init from SettingsPage, (2) `syncService.initialize()` skips destructive re-init when already active for same family, (3) `loadFromFile()` now calls `setFamilyKey()` instead of `setEnvelope()` to restore key on every file poll, (4) save-on-hide/unload handlers recover the key from the store ref before saving.
- ~~**Google Drive new account registration fails:** Two errors: (1) "authorization scope was not enough" — granular consent lets users deselect scopes, (2) "File not found" — global folder cache reuses a previous account's folder ID.~~ **Fixed 2026-03-04** — clear folder cache + force consent in `createNew()`, validate `drive.file` scope after token exchange, clear cache on auth failure.

## Decision Log

| Date       | Decision                                                    | Rationale                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-02-17 | Created docs/STATUS.md for project tracking                 | Multiple contributors need shared context                                                                                                                                                                                                                                                                                                  |
| 2026-02-17 | Added ARCHITECTURE.md and 8 ADR documents                   | Document key decisions for contributor onboarding                                                                                                                                                                                                                                                                                          |
| Prior      | Switched from idb library to native IndexedDB APIs          | Reduce dependencies                                                                                                                                                                                                                                                                                                                        |
| Prior      | Chose File System Access API over Google Drive for sync     | Simpler implementation, no OAuth needed, user controls file location                                                                                                                                                                                                                                                                       |
| Prior      | Used AES-GCM + PBKDF2 for encryption                        | Industry standard, no external dependencies (Web Crypto API)                                                                                                                                                                                                                                                                               |
| Prior      | Stored amounts in original currency, convert on display     | No data loss from premature conversion, flexible display                                                                                                                                                                                                                                                                                   |
| Prior      | Recurring items as templates, not transactions              | Clean separation, catch-up processing, easy to preview                                                                                                                                                                                                                                                                                     |
| Prior      | MyMemory API for translations                               | Free, CORS-enabled, no API key required                                                                                                                                                                                                                                                                                                    |
| 2026-02-17 | Per-family databases instead of familyId on all models      | No repository code changes, no schema migration, clean tenant isolation                                                                                                                                                                                                                                                                    |
| 2026-02-17 | Global settings (theme, language, rates) in registry DB     | Device-level preferences survive family switching                                                                                                                                                                                                                                                                                          |
| 2026-02-22 | File-based auth replaces Cognito (ADR-014)                  | PBKDF2 password hashes in data file; true local-first, ~165KB bundle reduction, no cloud auth infrastructure                                                                                                                                                                                                                               |
| 2026-02-18 | File-first architecture: encrypted file as source of truth  | Security value proposition, user data control, IndexedDB is ephemeral                                                                                                                                                                                                                                                                      |
| 2026-02-18 | Encryption enabled by default for new data files            | Secure by default; upgraded to mandatory (no opt-out) on 2026-02-22                                                                                                                                                                                                                                                                        |
| 2026-02-18 | Auto-sync always on (no toggle)                             | Simplifies UX, data file always stays current                                                                                                                                                                                                                                                                                              |
| 2026-02-19 | Rebranded to beanies.family (Issue #22)                     | Heritage Orange + Deep Slate palette, Outfit + Inter fonts, squircles                                                                                                                                                                                                                                                                      |
| 2026-02-20 | Centralized icon system (Issue #44)                         | Single source of truth for ~72 icons, brand-enforced stroke style                                                                                                                                                                                                                                                                          |
| 2026-02-20 | Web Audio API for sound effects (Issue #46)                 | Zero bundle size, no audio files, sub-ms latency, browser-native                                                                                                                                                                                                                                                                           |
| 2026-02-20 | Beanie UI overhaul complete (Issue #40)                     | All 13 sections done: icons, animations, sounds, empty states, 404, etc                                                                                                                                                                                                                                                                    |
| 2026-02-20 | Beanie character avatars (Issue #39)                        | Inline SVG avatars by gender/age, children wear beanie hats, replaces initial circles                                                                                                                                                                                                                                                      |
| 2026-02-20 | Collapsible completed goals section (Issue #55)             | Disclosure pattern over tabs — completed goals are secondary archive                                                                                                                                                                                                                                                                       |
| 2026-02-20 | Financial institution dropdown (Issue #42)                  | Searchable combobox with custom entry persistence, deferred save                                                                                                                                                                                                                                                                           |
| 2026-02-21 | Sidebar redesign — Deep Slate + emoji nav (Issue #59)       | Permanent dark sidebar, emoji icons, nav extracted to shared constant for mobile reuse                                                                                                                                                                                                                                                     |
| 2026-02-21 | v4 UI framework proposal uploaded                           | New screens: Budget (#68), Login UI (#69), Landing (#72). Redesigns: Accounts (#70), Transactions (#71), Family Hub (#73)                                                                                                                                                                                                                  |
| 2026-02-22 | v5 UI framework proposal uploaded, v3 removed               | v5 adds split login flow (Welcome Gate, Sign In, Create Pod, Join Pod) + updated onboarding. v3 deleted as obsolete                                                                                                                                                                                                                        |
| 2026-02-22 | v6 UI framework proposal uploaded                           | v6 adds detailed login screens (Load Pod, Unlock Pod, Pick Bean) for file-based auth. Encryption mandatory, no skip                                                                                                                                                                                                                        |
| 2026-02-22 | Encryption made mandatory for all data files                | No option to skip encryption during setup or disable it in settings. All `.beanpod` files are always AES-256 encrypted                                                                                                                                                                                                                     |
| 2026-02-21 | Header redesign — seamless icon-only controls (#67)         | Page titles in header (not in views), no border/bg, squircle icon-only controls, notification bell, avatar-only profile                                                                                                                                                                                                                    |
| 2026-02-21 | Net worth chart via transaction replay (#66)                | Option A (replay backwards from current balances) chosen over snapshot approach for MVP simplicity                                                                                                                                                                                                                                         |
| 2026-02-21 | PNG brand avatars replace inline SVGs (#65)                 | Hand-crafted PNGs are more expressive; member differentiation via colored ring + pastel background                                                                                                                                                                                                                                         |
| 2026-02-22 | Configurable currency chips in header (#36)                 | Inline chips for instant switching; max 4 preferred currencies persisted in settings                                                                                                                                                                                                                                                       |
| 2026-02-22 | SVG flag images instead of emoji flags (#38)                | Emoji flags don't render on Windows; SVGs ensure cross-platform visibility                                                                                                                                                                                                                                                                 |
| 2026-02-22 | Full i18n string extraction                                 | All ~200 hardcoded UI strings moved to uiStrings.ts; project rule: no hardcoded text in templates                                                                                                                                                                                                                                          |
| 2026-02-22 | Plans archive in docs/plans/                                | Accepted plans saved before implementation for historical reference and future context                                                                                                                                                                                                                                                     |
| 2026-02-22 | Performance reference document                              | Client-side resource boundaries, growth projections, and mitigation strategies documented                                                                                                                                                                                                                                                  |
| 2026-02-22 | Mobile responsive layout (#63)                              | Hamburger menu + 4-tab bottom nav + breakpoint composable; sidebar hidden on mobile; responsive page grids                                                                                                                                                                                                                                 |
| 2026-02-22 | AWS infrastructure via Terraform (#8-#11)                   | S3/CloudFront/ACM/Route53 for hosting, modular IaC with remote state                                                                                                                                                                                                                                                                       |
| 2026-02-22 | CI/CD pipeline with E2E gating (#11)                        | GitHub Actions: lint + type-check + unit tests + Playwright E2E must pass before deploy to production                                                                                                                                                                                                                                      |
| 2026-02-22 | Site deployed to beanies.family                             | Production build, S3 sync, CloudFront CDN, HTTPS via ACM                                                                                                                                                                                                                                                                                   |
| 2026-02-22 | Trusted device mode (#74)                                   | Persistent IndexedDB cache across sign-outs for instant returning user access; explicit "Sign out & clear data" option                                                                                                                                                                                                                     |
| 2026-02-22 | Post-sign-in redirect checks onboarding status              | New users redirected to /setup instead of /dashboard; direct DB read after sign-in for reliability                                                                                                                                                                                                                                         |
| 2026-02-22 | Login page UI redesign per v6 wireframes (#69)              | 5-view flow (welcome/load-pod/pick-bean/create/join), legacy SetupPage removed, /welcome dedicated route                                                                                                                                                                                                                                   |
| 2026-02-23 | Encryption pipeline security hardening (#84)                | 7 bugs fixed: defense-in-depth guards prevent plaintext writes when encryption is enabled                                                                                                                                                                                                                                                  |
| 2026-02-24 | PWA functionality complete (#6)                             | Offline banner, install prompt (30s delay, 7-day dismiss), SW update prompt, manifest completion, meta tags                                                                                                                                                                                                                                |
| 2026-02-24 | SW registerType changed to `prompt`                         | User-controlled updates instead of silent auto-update; hourly background check for new versions                                                                                                                                                                                                                                            |
| 2026-02-24 | Automated translation pipeline                              | Fixed broken translation script (STRING_DEFS parser), added --all multi-lang support, stale key cleanup, daily GitHub Actions workflow with auto-deploy                                                                                                                                                                                    |
| 2026-02-24 | Playwright browser caching in CI                            | Cache `~/.cache/ms-playwright` keyed on browser + version; saves ~8 min per E2E job (chromium download)                                                                                                                                                                                                                                    |
| 2026-02-24 | Mobile privacy toggle in header                             | Show/hide figures icon always visible on mobile/tablet (not buried in hamburger menu) for better UX                                                                                                                                                                                                                                        |
| 2026-02-24 | Issue #16 updated: unified passkey login + data unlock      | Single biometric gesture replaces both member password and encryption password; password fallback preserved                                                                                                                                                                                                                                |
| 2026-02-24 | Issue #16 implemented: passkey/biometric login              | PRF + cached password dual-path, BiometricLoginView, PasskeyPromptModal, PasskeySettings rewrite, registry DB v3 with passkeys store (ADR-015)                                                                                                                                                                                             |
| 2026-02-26 | Cross-device sync via file polling (#103)                   | 10s file polling + visibility-change reload + force save on hidden; near-instant relay planned as #104                                                                                                                                                                                                                                     |
| 2026-02-26 | Cloud relay plan created (#104)                             | AWS API Gateway WebSocket + Lambda + DynamoDB for near-instant cross-device notifications; plan at `docs/plans/2026-02-26-cloud-relay-sync.md`                                                                                                                                                                                             |
| 2026-02-27 | Fix cross-device passkey authentication                     | Synced passkeys (iCloud/Google/Windows) auto-register locally using cached password; no more "registered on another device" error (ADR-015 updated)                                                                                                                                                                                        |
| 2026-02-28 | Reverted Prettier reformatting of brand HTML files          | Commit 46e33c0 accidentally reformatted 6 docs/brand HTML files (60k+ lines). Reverted and added `docs/brand` to `.prettierignore`                                                                                                                                                                                                         |
| 2026-02-28 | Fixed beanie-avatars E2E test for redesigned modal          | Test referenced old test IDs from pre-modal-redesign; updated to use role chips, "More Details" toggle, placeholder input                                                                                                                                                                                                                  |
| 2026-02-28 | Merged rollup security bump (4.57.1 → 4.59.0)               | Dependabot PR #102; minor version bump with security label, no breaking changes                                                                                                                                                                                                                                                            |
| 2026-02-28 | Strengthened DRY principle in CLAUDE.md                     | Expanded code conventions with explicit rules for shared components, helper functions, constants, and duplicate elimination                                                                                                                                                                                                                |
| 2026-03-01 | Text casing standardization                                 | All non-sentence UI text lowercase in uiStrings.ts; AppHeader fixed to use titleKey; duplicate page h1s removed; casing rules documented                                                                                                                                                                                                   |
| 2026-03-01 | Mobile bottom tab bar: 5-tab layout (#101)                  | 5 tabs (Nook/Planner/Piggy Bank/Budget/Pod), Heritage Orange 8% pill active state, v7 hamburger button (3-div design), nested route matching, 3 new i18n keys                                                                                                                                                                              |
| 2026-03-03 | Projected recurring transactions with deferred side effects | Future recurring items shown as projections; scope modal defers DB writes until save; prevents orphaned records on cancel                                                                                                                                                                                                                  |
| 2026-03-03 | Immutable store updates across all 9 entity stores          | Replaced 19 in-place mutations with spread/.map() to fix Vue 3.4+ computed reference-equality reactivity issues                                                                                                                                                                                                                            |
| 2026-03-04 | Google Drive OAuth: cross-account folder fix + scope check  | Clear folder cache in createNew() to prevent stale folder ID from previous account; force fresh consent; validate drive.file scope after token exchange                                                                                                                                                                                    |
| 2026-03-04 | Branch protection: removed required status check            | Pre-push hook already runs tests locally; required CI status check was redundant for 1-person team and blocked direct pushes to main                                                                                                                                                                                                       |
| 2026-03-04 | Fix CRDT merge data loss (`decryptBeanpodPayload`)          | `decryptBeanpodPayload()` called `loadDoc()` which replaced the singleton doc before `mergeDoc()` ran, losing local changes. Fixed to use `Automerge.load()` directly                                                                                                                                                                      |
| 2026-03-04 | Plan: CRDT merge safety unit tests                          | Test plan saved at `docs/plans/2026-03-04-crdt-merge-safety-tests.md` — regression guard for the singleton side-effect bug, V4 round-trip, and merge preservation                                                                                                                                                                          |
| 2026-03-04 | CRDT merge safety unit tests implemented                    | 11 tests in `fileSync.test.ts`: singleton isolation guard, standalone doc validity, full merge simulation, V4 encrypt/decrypt round-trip, input validation, version detection (636 total tests)                                                                                                                                            |
| 2026-03-05 | Income-to-goal linking                                      | Income transactions allocate percentage or fixed amount to a goal; guardrail caps allocation at remaining goal amount; flat fields on Transaction/RecurringItem (mirrors activityId pattern)                                                                                                                                               |
| 2026-03-05 | EntityLinkDropdown generalization                           | Extracted ActivityLinkDropdown mechanism into generic EntityLinkDropdown; same UI, prop-driven data source; ActivityLinkDropdown becomes thin wrapper                                                                                                                                                                                      |
| 2026-03-05 | CurrencyAmountInput reusable component                      | Inline currency dropdown + AmountInput extracted from 4 modals into single component; net -64 lines; added currency selector to ActivityModal                                                                                                                                                                                              |
| 2026-03-05 | Nook card click-to-edit modals                              | Schedule cards merge planner activities with todos; all Nook cards (Schedule, Recent Activity, Todo Widget) open inline edit modals — no page navigation. NookTodoWidget reactivity bug fixed                                                                                                                                              |
| 2026-03-06 | View-first modals for activities and transactions           | Shared `useInlineEdit` composable + `InlineEditField` component; ActivityViewEditModal (7 inline fields), TransactionViewEditModal (4 inline fields); TodoViewEditModal refactored to use shared code; reactivity fix (store-lookup computed); toggle complete from todo view modal                                                        |
| 2026-03-06 | Activity endTime auto-sync                                  | End time defaults to startTime + 1hr; reactive sync when start time changes; endTime clamped to not precede startTime; applies to ActivityModal and ActivityViewEditModal. `addHourToTime()` utility in date.ts                                                                                                                            |
| 2026-03-08 | Family Hub v7 redesign (#73) — closed                       | Redesigned as "The Bean Pod" with activity-focused member cards, quick-info panel, role tags. Calendar removed (→ Family Planner). Deployed to prod                                                                                                                                                                                        |
| 2026-03-08 | Header redesign: profile dropdown + sign-out modal          | Notification bell removed, profile avatar dropdown on mobile (matching desktop), Deep Slate gradient header, sign-out confirmation modal with "Sign Out & Clear Data" option using InfoHintBadge                                                                                                                                           |
| 2026-03-08 | PWA update speed improvements                               | 5-min polling (down from 60min), check on tab visibility change, auto-update on next navigation after 1-min grace period                                                                                                                                                                                                                   |
| 2026-03-08 | Google OAuth race condition fix                             | `performSilentRefresh()` recovers refresh token from IndexedDB when in-memory token is lost (page reload/SW update), preventing unnecessary consent popup                                                                                                                                                                                  |
| 2026-03-08 | Currency conversion staleness fix (critical)                | App init rate refresh now reloads Vue store after completion; `exchangeRates` computed picks most recent rates between per-family (synced) and device-local by comparing timestamps                                                                                                                                                        |
| 2026-03-12 | Passkey progressive platform fallback                       | Restored `authenticatorAttachment: 'platform'` as first attempt (ensures "save on this device" prompt), with progressive fallback: retry without attachment + hints for Android OEMs (Honor/MagicOS), then retry without PRF extension. Fixes issue where removing platform constraint caused phones to only show "save on another device" |
| 2026-03-08 | Passkey Android credential manager compatibility            | Removed `authenticatorAttachment: 'platform'` (fails on Honor/MagicOS OEM credential managers), added `hints: ['client-device']` for Chrome 128+, auto-retry without PRF extension on `NotReadableError`, user-friendly error messages for credential manager failures                                                                     |
| 2026-03-17 | Weekly calendar view as default planner view                | Week view provides more at-a-glance utility than month view on desktop/tablet. Month view retained for overview. Day/agenda views removed as redundant (sidebar + weekly cover the use cases). DRY extraction of shared components before building new views                                                                               |
| 2026-03-17 | All-day multi-day activities with spanning display          | `isAllDay` + `endDate` fields on FamilyActivity; expandRecurring generates per-day occurrences; WeeklyCalendarView renders as single spanning bar using CSS grid column placement instead of per-day pills                                                                                                                                 |
| 2026-03-08 | Join/load flow loading spinners                             | Added BeanieSpinner to all async gaps: file picker, invite token decryption, password creation step. Replaced CSS border spinners with branded BeanieSpinner. Buttons use `:loading` prop for spinner display. Fixed both JoinPodView and LoadPodView                                                                                      |
| 2026-03-25 | Link field on all travel segments                           | Optional URL field added to all travel segment types (flights, cruise, train, car, accommodations, transportation). Previously only activities and ideas had links. Space-efficient layout: shares row with booking ref or contact phone                                                                                                   |
| 2026-03-25 | Transaction view schedule summary box                       | Grey summary box in transaction view modal showing recurrence pattern + start/end dates for recurring, or date for one-time. Matches the activity view convention. Replaces standalone recurrence pill                                                                                                                                     |
| 2026-03-25 | E2E test suite overhaul (ADR-007 revised)                   | 87 → 21 tests (76% reduction), 15 → 7 files, Chromium-only CI. Three-Gate Filter, 25-test budget cap, 8 conventions. CI time reduced from 10+ min to 4.5 min. Health tracking in `docs/E2E_HEALTH.md`                                                                                                                                      |
| 2026-03-25 | Project changelog introduced                                | `CHANGELOG.md` with Keep a Changelog format, backfilled 2 weeks. CLAUDE.md updated to require changelog update on every push                                                                                                                                                                                                               |
