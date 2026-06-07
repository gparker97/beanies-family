# Plan: Discord community growth — onboarding CTA, weekly nudge, always-on doors

> Date: 2026-06-07
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-07-discord-community-cta.md`
> **No GitHub issue created.** Approved for direct implementation; full prompt history in the Prompt Log.

## User Story

As the beanies.family founder building an early-adopter community, I want the app to invite users into our Discord at the right moments so that more families join, give feedback, and hear announcements — without feeling nagged.

## Context

We're building an early-adopter community on Discord. Today the only in-app pointer is a single one-time announcement (`discord-community-2026-05`) with a raw, expiring `discord.gg` invite. We want a durable, layered funnel: a CTA at the onboarding finale (peak goodwill, seen by 100% of new families), a gentle recurring "community nudge" in the notification bell, and always-on doors (Settings, Help nav, marketing footer). An approved mockup (`docs/mockups/discord-community-cta-2026-06-07.html` + `.png`) defines the look and tone; the beanies theme skill + CIG win on any conflict.

## Requirements

1. **Stable invite URL.** Introduce `DISCORD_URL` (built from `MARKETING_URL`, so dev resolves to the local Astro origin) as the single source of truth, used by every **new** in-app CTA. Add a `/discord` redirect page on the Astro marketing site that forwards to the current invite, so the invite can change with a **small web (Astro) deploy rather than a full app/PWA release**, and a dead link can never ship. **Do NOT touch the existing `discord-community-2026-05` announcement** — it's a frozen, date-stamped launch artifact whose own copy advertises a deliberately _expiring_ invite (a scarcity hook); editing a shipped announcement also violates the registry's id-immutability rule. No announcement-test edits.
2. **Onboarding finale CTA.** A Discord card on `OnboardingComplete.vue` with the approved copy; primary action "Join us on Discord" (opens Discord + completes onboarding), plus a "Maybe later" that just completes onboarding.
3. **Recurring community nudge.** A tip-style card in the notification bell, auto-opening the drawer when a fresh one is due, **no more often than once every 7–10 days**, capped (~5 shows), with 8 rotating fun messages. Three actions: "Join us on Discord", "Not now" (re-appears next interval), "I'm already there!" (stop for good). Respects onboarding-completed gate.
4. **Always-on doors.** A Settings row, a Help/nav entry, and a marketing-site footer link — all → `DISCORD_URL`.
5. **Measurement.** Fire a Plausible event on every Discord CTA click, tagged by surface (`onboarding` / `nudge` / `settings` / `nav` / `footer`), plus nudge shown/dismissed events.
6. **Copy** exactly as approved (below), `en` + `beanie` for every string, run `npm run translate`.
7. **Design fidelity vs CIG:** reproduce the mockup's tone/layout, but the theme skill + CIG win. Concretely: Discord **blurple (#5865F2) is permitted on the Discord logo glyph/badge ONLY** (a single, documented third-party-recognition exception); everything else uses the 5-colour palette, with Heritage Orange for all primary CTAs.

## Approved Copy

House style: en = sentence case, beanie = all lowercase, **no em-dashes** (use commas/periods).

**Onboarding card** (`discord.onboarding.*`):

- eyebrow: `You're an early bean 🫘` / `you're an early bean 🫘`
- title: `Help us grow beanies` / `help us grow beanies`
- body: `We're still new, and you're one of our first families. Join the other beanies on Discord to swap tips, hear what's next, tell us what to build, and just have a chat.` / lowercased
- primary: `Join us on Discord` / `join us on discord`
- skip: `Maybe later` / `maybe later`

**Nudge label** (`discord.nudge.label`): `From the beanstalk` / `from the beanstalk`

**Nudge rotating messages** (`content/communityNudges.ts`, 8, en shown; beanie = lowercased):

1. `The beanies get lonely between visits. Come say hi in our Discord, other families are already there. 🫘`
2. `Psst… we spill the beans about what's coming next in Discord before anywhere else.`
3. `Got a wish for beanies.family? The team (well.. I) read every message in our Discord. Early beans get a real say.`
4. `You're not the only family growing beans. Come meet a few of the others in our Discord.`
5. `Stuck on something? Real humans (and other families) lend a hand in our Discord.`
6. `New features, fixes, and the occasional beanie joke are all dropped first in our Discord.`
7. `You're an early bean. Help shape what we build. The conversation's happening in Discord.`
8. `Two minutes in our Discord = first dibs on new features and a say in what's next.`

**Nudge actions** (`discord.nudge.*`): join `Join us on Discord` · snooze `Not now` · joined `I'm already there!` (beanie lowercased).

**Always-on doors:** Settings title `Community` / subtitle `Join other families on our Discord`; Help/nav `Community on Discord`; footer `Discord`.

## Approach

### A. Shared primitives (DRY core)

- `src/utils/discord.ts` (NEW): `export const DISCORD_URL = `${MARKETING_URL}/discord``+`openDiscord(surface: string)`— the single click path for every app surface. Order matters: **call`openExternal(DISCORD_URL)`FIRST** (it must run synchronously inside the user gesture per its own doc), wrapped in try/catch →`console.error` + error toast (`t('discord.openFailedTitle')`/`Body`) on throw; **then** fire `window.plausible?.('discord_join_click', { props: { surface } })`with **bare optional chaining, no try/catch** — matching the repo-wide convention (authStore/vacationStore/transactionsStore all call`window.plausible?.(...)`unguarded; the stub no-ops). Reuses the PWA-safe`src/utils/openExternal.ts`.
- `src/components/ui/DiscordGlyph.vue` (NEW): the inline Discord logo SVG (blurple `#5865F2` fill — the ONLY blurple in the app). Reused by the onboarding card, the nudge body, and the Settings card.
- **Leave the existing `discord-community-2026-05` announcement untouched** (Pass-4 decision): its body intentionally describes an expiring invite, and shipped announcement ids are immutable. New surfaces use `DISCORD_URL`; the legacy announcement keeps its literal. (If that invite ever truly dies, the correct fix is a _new_ announcement id, never an edit.)

### B. Stable redirect (Astro)

- `web/src/pages/discord.astro` (NEW): a minimal redirect page (meta-refresh + canonical + a visible "click here" fallback link) to the live invite. The invite string lives **only** here on the web side — update it without an app deploy.
- `web/src/components/Footer.astro` (EDIT): add a "Discord" link → `/discord`.

### C. Onboarding finale card (`OnboardingComplete.vue`, EDIT)

- Insert a Discord card after `OnboardingInvitePanel` and before the finish CTA, matching the mockup (rounded card, Sky-Silk/orange-tinted surface per CIG, blurple `DiscordGlyph` badge, eyebrow/title/body).
- Make the primary `ob-cta` "Join us on Discord" → `openDiscord('onboarding')` **and** `emit('finish')`; add a "Maybe later" text button → `emit('finish')`. Both complete onboarding; Join also opens Discord in a new tab.

### D. Recurring community nudge — new `'communityNudge'` notification kind

Reuses the entire notification pipeline (bell, drawer, sorting, auto-open, read-state). Modeled as a first-class kind (cleanest seam per exploration), NOT a faked announcement.

- `src/content/communityNudges.ts` (NEW): the 8 messages as a flat `{en,beanie}[]` + label key. No `condition`/`category` machinery (unlike tips — the nudge doesn't need it).
- `src/composables/useCommunityNudge.ts` (NEW): per-member, per-device `localStorage` (key `bean-community-nudge-${memberId}`) mirroring `useBeanTips`'s failure **handling** but NOT its `dismissedTips` downgrade-mirror (that exists only because tips shipped a v1 in the wild; the nudge is greenfield — unknown/missing `schemaVersion` or any shape-gate failure → reset to a fresh seeded state). Exposes reactive `activeNudge`, `ensureNudgeIssued()`, and actions (`join`, `snooze`, `markJoined`).
  - **State — 4 non-contradicting fields** (+ schemaVersion): `{ schemaVersion: 1, activeNudge: { messageIndex, issuedAt } | null, nextDueAt: number, shownCount: number, joined: boolean }`. The interval is rolled ONCE (at issue/snooze) into the absolute `nextDueAt`, so the gate is a single comparison and no two fields can disagree (drops the prior `snoozedUntil`/`lastShownAt`/unnamed-interval that could contradict each other).
  - **Pure decision function = the key test seam.** Extract `decideIssue(state, now): { state, shown }` — plain inputs, no `Date.now()`/`localStorage` (mirrors the existing `deriveNotifications(input, now)` seam). The composable does only I/O around it (load → `decideIssue` → save). Gate inside it: issue when `!joined` && `now >= nextDueAt` && `shownCount < CAP(5)`; on issue → `shownCount++`, `nextDueAt = now + roll(7..10d)`, `activeNudge = { messageIndex: (prevIndex+1)%8, issuedAt }`. First state creation seeds `nextDueAt = now + roll()` so a new user isn't nudged right after the onboarding card. (`ready` + `onboardingCompleted` are checked by the caller via the shared `ready()` gate, like tips.)
  - `ensureNudgeIssued()` (the I/O wrapper) is wrapped in try/catch + `reportError({severity:'error'})` so a bad gate can never break the notifications daemon (same guarantee as `ensureTodayTipIssued`).
- Wire issuance into the existing daemon `src/composables/useNotifications.ts` (EDIT): call `communityNudge.ensureNudgeIssued()` in the same `ready()` and `today` watchers that call `beanTips.ensureTodayTipIssued()`.
- Deriver: add a `'communityNudge'` branch in `src/utils/notifications.ts` (EDIT) that emits one notification when `activeNudge != null` (read `activeNudge` into the store snapshot in `src/stores/notificationsStore.ts`, mirroring how `beanTips.issuedTips` is read). Add `'communityNudge'` to the `NotificationKind` union (`src/types/notifications.ts`). **The notification id MUST encode `messageIndex`** (via `communityNudgeId(messageIndex)`) so the _next_ interval's rotated nudge is a distinct id → re-derives as unread even after a prior one was read (this is what makes "Not now → reappears next interval" work without read-state surgery). Set the notification's `sourceId` to that id so the auto-open guard (below) doesn't reject it. NaN-guard `issuedAt`; `read: isRead(id)`.
- Auto-open: add a `communityNudge` branch to `latestUnseenAutoOpen` in `notificationsStore.ts` → `if (n.kind === 'communityNudge') return true;`. **Mind the existing `n.read || !n.sourceId` early-return** in that `.find` — since the derived nudge sets `sourceId` (above), it passes the guard. Reuse the once-per-session `openToLatestAutoOpen()` latch (which calls `openTo`→`markRead`, so it fires at most once per session and immediately marks the nudge read — no double-open). Document why this branch skips a content-registry lookup: the auto-open decision is already made at issuance in `decideIssue` and the deriver projects `activeNudge` 1:1, so presence = "fresh + intended." Keeps policy out of the store. **`community_nudge_shown` fires ONCE at issuance inside the composable — never in the deriver or auto-open path** (which run every tick).
- Presentation/body: register `communityNudge` in `src/components/notifications/notificationKinds.ts` (`accent: 'community-nudge'` + Heritage-Orange tint in `ACCENT_TINT_CLASS` + `icon: '💬'` + `detailBody: CommunityNudgeBody`; add the `kindLabelKey`/`notificationTitle` cases → `communityNudge.label`). **Do NOT extract a `TipCardShell`** — `TipBody` is category-coupled (`cat-${category}` root, category-gradient `::before`/`::after`, `getCategoryImage`, 💡 bulb, tip-specific actions); extracting it for one differently-shaped consumer is a heavier refactor than the value justifies (Pass-2 decision). Instead `CommunityNudgeBody.vue` renders **inside the already-shared `CelebrationDetail` shell** (verified API: slots `#kick` / default / `#footer`; props `dateLabel` (required), `medallionSrc?`, `signature?` — `AnnouncementBody` is the exact precedent): `DiscordGlyph` + `txt(COMMUNITY_NUDGE_LABEL)` in `#kick`, the rotating message (`useBeanieText().txt(COMMUNITY_NUDGES[messageIndex])`, index resolved from the notification id/sourceId) in the default slot, and the three action buttons (Heritage-Orange primary, identical to `.ann-cta`) wired to the composable + `store.back()`. **`dateLabel` is required but the nudge has no date — pass `''` and confirm the empty pill collapses gracefully in the manual pass.** Reuses an existing shell; no duplicate "tip card" abstraction.

### E. Always-on doors

- `src/pages/SettingsPage.vue` (EDIT): add a `SettingsCard` (the existing clickable tile — `icon`/`title`/`description`/`iconBg`/`@click`, used by the other ~10 cards) into the existing `grid grid-cols-1 sm:grid-cols-2` block → `@click="openDiscord('settings')"`. No new row component.
- `src/constants/navigation.ts` (EDIT): add a pinned external nav item `{ labelKey: 'nav.community', path: '/discord', emoji: '💬', section: 'pinned', external: true, externalUrl: DISCORD_URL }` (mirrors the existing `nav.help` external item; pinned = desktop/hamburger only, no `mobileCategory`).

### Analytics (Plausible) — explicit

All Discord interactions are tracked (guarded `window.plausible?.(...)`, the codebase's direct-call pattern; no centralized helper exists):

- `discord_join_click` with `props.surface` ∈ {`onboarding`, `nudge`, `settings`, `nav`, `announcement`} — fired inside `openDiscord(surface)`, so EVERY button that opens Discord is captured in one place.
- `community_nudge_shown` (on nudge issuance), `community_nudge_dismissed` with `props.action` ∈ {`snooze`, `already_there`}.
- Footer (Astro) link is a plain `<a>`; Plausible's outbound-link tracking on the marketing site captures it (no inline event needed).

### F. i18n

- All static labels/actions/onboarding copy → `src/services/translation/uiStrings.ts` (en+beanie); nudge messages → `content/communityNudges.ts` (matching `tips.ts`). Run `npm run translate` to regenerate zh.

## Files Affected

- NEW: `src/utils/discord.ts`, `src/components/ui/DiscordGlyph.vue`, `src/content/communityNudges.ts`, `src/composables/useCommunityNudge.ts`, `src/components/notifications/CommunityNudgeBody.vue`, `web/src/pages/discord.astro`
- EDIT: `src/components/onboarding/OnboardingComplete.vue`, `src/components/notifications/notificationKinds.ts`, `src/types/notifications.ts`, `src/utils/notifications.ts`, `src/stores/notificationsStore.ts`, `src/composables/useNotifications.ts`, `src/pages/SettingsPage.vue`, `src/constants/navigation.ts`, `src/services/translation/uiStrings.ts`, `web/src/components/Footer.astro`
- UNTOUCHED (Pass 4): `src/content/announcements/announcements.ts` + its tests (legacy announcement is frozen)
- GENERATED: `public/translations/zh.json`
- (No `TipBody.vue`/`TipCardShell` change — Pass 2 dropped the extraction; `CommunityNudgeBody` reuses the existing `AnnouncementBody`/`CelebrationDetail` idiom instead.)

## New i18n keys (uiStrings.ts, en+beanie)

`onboarding.discordEyebrow/Title/Body/Primary/Skip`, `communityNudge.label/join/snooze/joined`, `settings.card.community` + `settings.card.communityDesc`, `nav.community`, `discord.openFailedTitle` + `discord.openFailedBody`. The 8 rotating nudge messages live in `content/communityNudges.ts` as `{en,beanie}` (rendered via `useBeanieText`), NOT in uiStrings — matching `tips.ts`.

## Important Notes & Caveats

- **Blurple is allowed on the Discord glyph only.** All other surfaces use the CIG 5-colour palette; primary CTAs are Heritage Orange.
- **`joined` (and all nudge cadence state) is per-member but per-device** (localStorage, mirroring bean-tips). A user who taps "I'm already there!" on one device may see one nudge on a brand-new device. Documented trade-off for simplicity; can be promoted to synced per-member state later if it matters.
- **Changing the live invite is a web (Astro) deploy** of `discord.astro` (not an app/PWA release) — that's the real, smaller win (corrected from an earlier "no deploy").
- **Failure handling:** `useCommunityNudge` mirrors `useBeanTips`'s failure _handling_ (try/catch reads, JSON-parse guard with corrupt-blob reset, hard shape gate, `console.warn` on read/parse, `console.warn` + `reportError({severity:'warning'})` on write) but NOT its `dismissedTips` downgrade-mirror (greenfield → corrupt/unknown-schema resets to fresh); `ensureNudgeIssued()` is wrapped so a bad gate can never break the notifications daemon; user-initiated action persistence failures surface a toast. `openDiscord` surfaces a toast if `openExternal` throws; the `plausible?.()` call is bare per repo convention (the stub never throws). Nothing fails silently.
- Nudge first-show is deferred ~7–10 days after first run so it never doubles up with the onboarding card.
- The marketing footer + `/discord` page are a **web (Astro)** deploy; the app surfaces are a Vue deploy. They ship independently.
- Do NOT save any launch/growth strategy doc to the repo (per CLAUDE.md) — only this product plan + in-app copy.

## Assumptions

1. The current Discord invite is `https://discord.gg/NE4grWzjxV` (from the existing announcement); it seeds the `/discord` redirect target.
2. Astro static build supports a meta-refresh redirect page (no SSR needed).
3. `window.plausible` is the analytics entry point (no centralized helper exists; direct calls are the pattern).
4. The notification pipeline (kinds → deriver → presentation → auto-open) is the right host for the nudge (validated by exploration).

## Acceptance Criteria

- [ ] `DISCORD_URL` constant is the single place every NEW app surface references the Discord destination (the legacy announcement is intentionally left on its own expiring literal).
- [ ] `beanies.family/discord` redirects to the live invite (verified 200 → invite).
- [ ] Onboarding finale shows the Discord card; "Join us on Discord" opens Discord and completes onboarding; "Maybe later" completes onboarding only.
- [ ] A community nudge appears in the bell and auto-opens the drawer once when fresh; not more often than every 7–10 days; stops after the cap or after "I'm already there!"; "Not now" re-appears next interval; "Join us on Discord" opens Discord and stops nudging.
- [ ] Settings row, Help/nav item, and marketing footer all open the Discord destination.
- [ ] Plausible events fire per surface; nothing fails silently (all localStorage/Plausible/open paths guarded + logged).
- [ ] Blurple appears only on the Discord glyph; all else on-brand; `npm run validate` green; `npm run translate` clean.

## Testing Plan

1. `npm run validate` (type-check, lint, stylelint, format, unit tests, build) green; `npm run build:web` green.
2. Unit: **`decideIssue(state, now)` pure tests** (plain inputs, no fake timers) — first-run defer, `nextDueAt` cadence gate, cap, snooze reroll, joined stop, message rotation; `useCommunityNudge` I/O wrapper — corrupt/unknown-schema → fresh reset, write-failure (warn + report, toast on user action); `openDiscord` — `openExternal` called before analytics, open-throw → toast; deriver — emits one when `activeNudge` set, none when null, skips malformed, prune-exempt, and the id encodes `messageIndex` (two indices → two ids). No announcement-test changes (legacy announcement untouched).
3. `npm run dev` manual: complete onboarding → Discord card behaves; force a due nudge (seed `lastShownAt`) → drawer auto-opens once, actions behave; Settings/nav/footer links open `/discord`.
4. Web: `npm run dev:web` → `/discord` redirects; footer link present.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the layered funnel — shared `discord.ts`/`DiscordGlyph`, Astro `/discord` redirect, onboarding card, a new `communityNudge` notification kind reusing the bell/auto-open, always-on doors, Plausible tracking.
- **Pass 2 (DRY + error handling)**: Reuse the real `SettingsCard.vue` (not an invented row); dropped the `TipCardShell` extraction in favour of a self-contained `CommunityNudgeBody` reusing the `AnnouncementBody`/`CelebrationDetail` idiom (TipBody too category-coupled); kept "mirror useBeanTips" (no shared helper — states diverge) with the failure contract made explicit; built `DISCORD_URL` from `MARKETING_URL`; specified all analytics/open/storage paths as guarded (no silent failures, toast on open failure); confirmed deriver/snapshot/auto-open APIs and added the missing `latestUnseenAutoOpen` `communityNudge` branch; corrected "no deploy" → "web (Astro) deploy" to change the invite.
- **Pass 3 (Sustainability)**: Collapsed nudge state to 4 non-contradicting fields (persisted `nextDueAt`; dropped `snoozedUntil`/`lastShownAt`/unnamed-interval); extracted a pure `decideIssue(state, now)` as the primary test seam; aligned `openDiscord` with the repo's bare `plausible?.()` convention (call `openExternal` first, guard only it); dropped the cargo-culted `dismissedTips` mirror (greenfield → corrupt/unknown-schema resets fresh); mandated the shared `CelebrationDetail` shell for the nudge body and documented why the auto-open branch skips a registry lookup.
- **Pass 4 (Fresh-eyes sweep)**: Dropped the self-contradictory legacy-announcement migration (its copy advertises an expiring invite; shipped ids are immutable) and its phantom test edit; hard-pinned `community_nudge_shown` to issuance-time only (no deriver/auto-open double-fire); required the nudge notification id to encode `messageIndex` (so "Not now" reappears next interval) and to set `sourceId` (so the `latestUnseenAutoOpen` `!sourceId` guard doesn't reject it); verified `CelebrationDetail`'s slot/prop API and flagged its required-but-empty `dateLabel` for the manual pass.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (Discord adoption strategy)

"as you may remember I am trying to build an early adopter commit on discord. I'd like to suggest as much as possible for users to join us on discord… at the very least I wanted to provide a CTA to join discord at some point during the onboarding process as well as various special tips (like tips of the day) that trigger every so often (i.e. once a week) and show at login encouraging users to join discord, with fun messages. what would you recommend to get the best adoption? this is important to build our early adopter community"

### Follow-up (mockup + copy)

"this sounds good, go ahead to build the mockup and can you also generate all the proposed copy for review"

### Follow-up (copy edits + plan invocation)

Copy edits: onboarding title → "help us grow beanies"; onboarding body → "We're still new, and you're one of our first families. join the other beanies on discord to swap tips, hear what's next, tell us what to build, and just have a chat."; nudge sneak-peeks → "Psst… we spill the beans about what's coming next in Discord before anywhere else."; nudge have-a-say → "Got a wish for beanies.family? The team (well.. I) read every message in our Discord. Early beans get a real say."; nudge announcements → "New features, fixes, and the occasional beanie joke are all dropped first in our Discord."
"/beanies-plan … build a plan to implement the above. strive for simplicity and elegance … follow all DRY conventions. Review the mockup carefully … faithfully representing … while strictly following the beanies theme/UI skill … If there is a discrepancy between the mockup and the beanies UI theme/CIG, the CIG always wins. Ask any clarifying questions as needed before preparing the plan."

### Clarifying answers

- Colour: allow Discord blurple as one accent (logo/badge only).
- Nudge visibility: auto-open the drawer, but once every 7–10 days (not weekly).
- Stable URL: yes, build the `beanies.family/discord` redirect.
- Nudge actions: three, with the third being "I'm already there!" (indicates already joined → stop).

</details>
