# Plan: Invite Gate — Discord-first "request an invite" (+ Plausible tracking)

> Date: 2026-06-14
> Related issues: None — direct implementation (greg, in-session)
> Plan file: `docs/plans/2026-06-14-invite-gate-discord-first.md`
> Mockup: `docs/mockups/invite-gate-discord-first-2026-06-14.html`
> Status: **Proposed — awaiting greg's review. Not yet implemented.**

## User Story

As someone who lands on beanies without an invite, I want to ask for one in the Discord community (no email required) so I can get in without disclosing personal details — and only fall back to leaving my email if I don't use Discord.

## Context

The **Invite Gate** is `src/components/login/InviteGateOverlay.vue` — an overlay shown on the login/create screen (mounted in `LoginPage.vue:603`) for people without a pod/invite. It has three modes:

- **`token`** (default): paste an invite token → `validateInviteToken` → `unlocked`. A footer link "Don't have one? **Request an invite**" switches to `request` mode (gated behind `features.slackInvite`).
- **`request`**: name + email + optional message → `POST` to the Slack webhook `VITE_INVITE_WEBHOOK_URL` (`handleRequest`, lines 66-102) → `confirmed`. **This is the path that makes the user disclose their email**, and it's currently the only "no token" affordance.
- **`confirmed`**: "Request Sent!" + Back to Home.

greg is steering early adopters toward **Discord** (there's a standing Discord-CTA rule, a shared `openDiscord()` util, and a `DiscordGlyph`). The Slack email form should become the **secondary** option, with **"ask for an invite on Discord"** promoted to the primary CTA on the no-token path.

### Existing infrastructure we reuse (no new patterns)

- `src/utils/discord.ts` — `openDiscord(surface)`: opens `${MARKETING_URL}/discord` synchronously inside the gesture, then fires `plausible('discord_join_click', { props: { surface } })`, toast-on-failure. We extend the `DiscordSurface` union with `'invite-gate'`.
- `src/components/ui/DiscordGlyph.vue` — the blurple mark (the one sanctioned third-party colour).
- The community-nudge CTA visual pattern (orange gradient button + blurple glyph on a white ring) — reused for the Discord CTA so it stays on-brand (Heritage Orange primary; blurple only on the glyph).
- `features.marketingUrl` / `features.slackInvite` (`src/config/features.ts`) — env-derived capability flags.
- Plausible convention: `window.plausible?.('event', { props: {...} })` (bare optional-chaining, never throws).

## Requirements

1. **Promote Discord to the primary "request an invite" CTA** on the `token` mode (the no-token area): a prominent button **"Ask for an invite on Discord"** (orange gradient + DiscordGlyph on a white ring) that calls `openDiscord('invite-gate')`.
2. **Demote the Slack message form to secondary**: a quiet text link "Don't use Discord? **Send us a message**" that switches to `request` mode (unchanged Slack flow). The `request` mode gets a short reframing line ("Not on Discord? Leave your details and we'll send you a token…") and a privacy reassurance line ("Your email goes only to the beanies team — nothing public, nothing stored in the app.").
3. **Fire a dedicated Plausible event when the "request invite" CTA is clicked** — `invite_request_click` with `props: { method: 'discord' }` on the Discord CTA. (Secondary, for funnel completeness: also fire `{ method: 'message' }` when the Slack request is successfully sent — see Open Questions.)
4. **Confirmed mode** gains a "Join the Discord" CTA (the user already requested via email; nudge them to the community too).
5. **Capability decoupling**: the Discord CTA shows whenever `features.marketingUrl` is available (it doesn't need the Slack webhook). The Slack "send a message" link shows only when `features.slackInvite`. If `slackInvite` is off, only Discord shows (the preferred state). If `marketingUrl` is somehow off, fall back to today's Slack-link-only behaviour so the gate is never a dead end.
6. **i18n**: all new copy via `uiStrings.ts` (en + beanie), then `npm run translate` for zh. No hardcoded strings.

## Approach (files affected)

### `src/utils/discord.ts`

- Add `'invite-gate'` to the `DiscordSurface` union. (One-line, keeps `openDiscord`'s existing `discord_join_click` segmentation working for this surface too.)

### `src/components/login/InviteGateOverlay.vue`

- Import `openDiscord` + `DiscordGlyph` + `features`.
- **`token` mode footer** — replace the single "Request an invite" link (lines 153-164) with:
  - a `<div class="divide">` "not invited yet?" separator,
  - the **Discord primary CTA** (`v-if="features.marketingUrl"`) → `handleRequestOnDiscord()`,
  - a short hint line,
  - a **secondary link** (`v-if="features.slackInvite"`) "Don't use Discord? Send us a message" → `mode = 'request'`.
  - Fallback: if `!features.marketingUrl && features.slackInvite`, render the old text link to `request` (so behaviour degrades gracefully).
- **New method** `handleRequestOnDiscord()`:
  ```ts
  function handleRequestOnDiscord() {
    openDiscord('invite-gate'); // sync nav inside the gesture (fires discord_join_click)
    window.plausible?.('invite_request_click', { props: { method: 'discord' } });
  }
  ```
- **`request` mode** — keep the Slack form; update the description copy + add the privacy line; add a quiet "Ask on Discord instead" link back. On successful `handleRequest` (after `mode.value = 'confirmed'`), fire `window.plausible?.('invite_request_click', { props: { method: 'message' } })`.
- **`confirmed` mode** — add a "Join the Discord" button (`openDiscord('invite-gate')`, no extra invite_request event — they've already requested) above "Back to Home".
- No change to `validateInviteToken`, the token flow, the close/cancel behaviour, or the Slack payload.

### `src/services/translation/uiStrings.ts`

New keys (en + beanie). Reword two existing ones:

- `inviteGate.notInvitedYet` — "Not invited yet?" (divider)
- `inviteGate.requestOnDiscord` — "Ask for an invite on Discord"
- `inviteGate.discordHint` — "Join the community and ask — no email needed."
- `inviteGate.noDiscord` — "Don't use Discord?"
- `inviteGate.sendMessage` — "Send us a message"
- `inviteGate.askOnDiscordInstead` — "Ask on Discord instead"
- `inviteGate.privacyNote` — "Your email goes only to the beanies team to send your invite — nothing public, nothing stored in the app."
- `inviteGate.confirmedJoinDiscord` — "Join the Discord"
- Reword `inviteGate.requestDescription` → "Not on Discord? Leave your details and we'll send you a token when a spot opens."
- (Keep `inviteGate.noToken` / `inviteGate.requestOne` if still referenced by the graceful-fallback path; otherwise remove.)
  Then `npm run translate` (zh) and confirm the parser still reads `uiStrings.ts`.

### Plausible (external, manual — flagged for greg)

Firing `window.plausible('invite_request_click', …)` starts collecting immediately. To see it as a conversion in the dashboard, **greg adds `invite_request_click` as a Custom Event goal in the Plausible site settings** (the app can't configure goals). No code registry exists for Plausible events in this repo, so nothing else to wire.

## Files Affected

- `src/utils/discord.ts` — extend `DiscordSurface` (modify)
- `src/components/login/InviteGateOverlay.vue` — redesign no-token path + events (modify)
- `src/services/translation/uiStrings.ts` — new/reworded keys (modify)
- `public/translations/zh.json` — regenerated via `npm run translate` (modify)
- `src/components/login/__tests__/InviteGateOverlay.test.ts` — new test (create)
- `CHANGELOG.md` — user-facing entry (modify)

## Help Center Coverage

Not required — this is a CTA/priority change to an existing gate, not a new feature or a security-model change. (The Slack flow's behaviour is unchanged; only its prominence drops.)

## Acceptance Criteria

- [ ] On the gate's token view, the prominent "Ask for an invite on Discord" CTA opens Discord (`openDiscord('invite-gate')`) and the Slack message form is reachable only via a secondary text link.
- [ ] Clicking the Discord CTA fires `plausible('invite_request_click', { props: { method: 'discord' } })` (and `openDiscord` still fires its own `discord_join_click`).
- [ ] Submitting the Slack request still posts to `VITE_INVITE_WEBHOOK_URL` exactly as before and fires `invite_request_click` with `method: 'message'`.
- [ ] With `slackInvite` off but `marketingUrl` on: only the Discord CTA shows; the gate is not a dead end. With `marketingUrl` off but `slackInvite` on: the old Slack-link path still works.
- [ ] Token entry/unlock, close/cancel, and the confirmed state all still work; the confirmed state offers a "Join the Discord" button.
- [ ] All copy is i18n (en + beanie + generated zh); no hardcoded strings; `npm run validate` green.
- [ ] (Manual) `invite_request_click` added as a Plausible goal by greg.

## Testing Plan

1. **Unit** (`InviteGateOverlay.test.ts`, mocking `@/utils/discord` + `window.plausible`):
   - Discord CTA click → `openDiscord` called with `'invite-gate'` **and** `plausible('invite_request_click', { props: { method: 'discord' } })` fired.
   - Secondary link → switches to `request` mode.
   - Successful Slack send → `plausible('invite_request_click', { props: { method: 'message' } })` fired and mode → `confirmed`.
   - Capability matrix: `marketingUrl` only / `slackInvite` only / both — correct affordances render.
2. **Manual visual QA** against the mockup: light + dark, the Discord CTA's blurple-on-white-ring glyph, hover lift, and that token entry remains the obvious path for invited users. Beanie-mode copy lowercases.
3. `npm run validate` green.

## Open Questions / Decisions (for greg)

1. **Event name** — `invite_request_click` with a `method` prop (`discord` | `message`). Good, or prefer separate event names (`invite_request_discord` / `invite_request_message`)? A single event + prop is cleaner for a Plausible funnel.
2. **Track the Slack send too?** You asked specifically for "(a) every time the request invite link/button is clicked." I've proposed also firing on a successful Slack send (`method: 'message'`) for funnel symmetry. Say the word if you want **only** the Discord click tracked.
3. **Keep the Slack form at all?** This plan keeps it as the secondary fallback (per your note). If you'd rather drop email collection entirely and go Discord-only, that's a smaller change (remove `request`/`confirmed` modes) — flag it.
4. **Plausible goal** must be added in the dashboard by you (external); the code just fires the event.

## Review Passes

> This plan was authored from the live code (the gate, `discord.ts`, `features.ts`, the Plausible convention) but has **not** yet been through the `/beanies-plan` 4-pass discipline, since it's a proposal for review while you're away. Before implementing, I'll run it through `/beanies-plan` (DRY/error-handling, sustainability, fresh-eyes) — or you can approve as-is and I'll implement directly.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /frontend-design)

> let's make a minor update to the invite modal displayed on the family pod creation screen.
>
> At the moment it displays a button to send a message, which triggers a message to slack. Given that we are guiding more people towards discord, i'd rather that the top CTA on this modal is a link to join our discord rather than triggering an message to slack (which requires the user to disclose their email). can you propose an updated design mockup for the invite modal which prioritizes guiding the user to ask for an invite in our discord, and only as a secondary option (if they don't use discord, for example), to send a message through the invite modal, which gets triggered to slack.
>
> In addition to the update above, can we also create a specific event in plausible that tracks (a) every time the "request invite" link/button is clicked?
>
> please take your time mockup and plan the below as i'll be away from my laptop for a while

</details>
