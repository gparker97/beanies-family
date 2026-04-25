# Plan: Drive UI Integration via Google Workspace Marketplace

> Date: 2026-04-26
> Related issues: [#186](https://github.com/gparker97/beanies-family/issues/186); active hardening track: [#185](https://github.com/gparker97/beanies-family/issues/185)
> Plan file: `docs/plans/2026-04-26-drive-ui-integration.md`
> Status: **Long-term track. Do not start until launch crunch is past.**

## User Story

As any user joining a family pod, I want to click "Open with beanies.family" inside Google Drive's own UI and have my file load automatically, so I never see a Picker iframe, popup, or third-party cookie issue — and I can join smoothly from any browser including iOS Safari.

## Context

`drive.file` OAuth scope grants per-file access only when the file has been (a) created by the app, (b) opened via Google Picker, or (c) opened via Google's Drive UI app integration. The Picker route is fragile on iOS Safari due to ITP partitioning storage between the app's origin and `docs.google.com` (see `docs/plans/2026-04-26-joiner-onboarding-hardening.md` for the detailed analysis). We've ruled out alternative paths:

- `anyone-with-link` reader doesn't grant write access; the joiner can't sync changes back.
- Broader OAuth scope (`drive.readonly`) is a privacy regression.
- Backend proxy is incompatible with the local-first architecture.

**Drive UI integration is the architecturally clean answer.** The inviter shares a Drive UI link; the joiner opens the file in Drive's own UI and clicks "Open with beanies.family"; Google grants `drive.file` scope through its native flow without any iframe or third-party storage. Works identically on every browser including iOS Safari.

The trade-off: requires submitting `beanies.family` to the Google Workspace Marketplace, going through Google's app verification, and maintaining a public listing.

## Requirements

1. Register `beanies.family` as a Drive UI integration app in Google Workspace Marketplace.
2. Implement Drive UI integration callback URL (typically `/drive/open?ids=<fileId>&action=open&userId=<userId>`).
3. Update invite generation to include a Drive UI link as the primary share path (with the existing QR/Picker flow preserved as fallback).
4. Update join flow to handle the Drive UI deep link — when arriving at `/drive/open` with valid params, authenticate the user, load the file by `fileId` (which now has `drive.file` scope automatically), and route into the existing join state machine.
5. Submit app for Marketplace listing review and address Google's verification feedback.
6. Handle the chicken-and-egg case: the joiner clicks "Open with beanies.family" but hasn't installed the app yet — Drive's standard flow shows an "install" prompt first.
7. Keep the existing Picker flow as a fallback during rollout and as a long-term backstop for users who don't install via Marketplace.

## Important Notes & Caveats

- **Google Marketplace approval can take 1-4 weeks.** Allow time. Don't start this if launch is imminent — block it as a follow-up.
- App must meet Google's verification requirements: privacy policy live (already at `/privacy`), branding assets (logo, screenshots — already in place for the brand site), demo video (must be created), terms of service (already at `/terms`).
- Drive UI integration scope-grant behavior must be verified — assume `drive.file`, but confirm in Google's docs before committing to architecture.
- Joiners without the app "installed" via Marketplace will see Google's install/permission prompt. UX needs to handle this gracefully (probably means: tell them what to expect on the inviter side before they share).
- **Cannot be A/B tested easily; rollout is binary.** Once the listing is live, anyone with a Drive UI link can use it; no per-user gating without backend infra.
- Marketplace listing requires ongoing maintenance — Google periodically requires re-verification when scopes change or every N months; we'll be on the hook for that.

## Assumptions

> **Review these before implementation. Some require Google docs verification first.**

1. Drive UI integration grants `drive.file` scope on the opened file (the same scope Picker grants). **Verify with Google docs as Phase 1 task.**
2. Our existing OAuth client can be promoted to a Marketplace listing without major changes; if not, we may need a new client and would need to migrate refresh tokens.
3. `beanies.family` meets Google's verification requirements. Most boxes are already checked: privacy policy live, terms live, branding solid. The demo-video requirement is the main net-new asset to produce.
4. iOS Safari can complete the Drive UI integration flow without ITP issues — the navigation is owned by `drive.google.com`, so the third-party-iframe-storage problem from Picker shouldn't apply. **Verify on a real iOS device with a test integration before committing.**
5. Greg has the time and capacity to handle the Marketplace listing process (text writing, screenshot capture, demo video, review feedback — typically 5-15 hours of work spread over the approval window).
6. The joiner installing the app via Marketplace is acceptable UX. (Worst case: a one-time consent screen they tap through.)

## Approach (4 phases)

### Phase 1 — Research & verify (1-2 days)

- Read Google Drive UI integration docs in detail. Confirm: scope-grant behavior, callback URL format, supported actions (`open`, `new`).
- Verify on a quick Drive UI integration prototype that iOS Safari handles the flow without ITP errors.
- Check whether existing OAuth client can be promoted or if a new Marketplace-enrolled client is needed.
- Estimate timeline for Marketplace approval based on current Google review queues.
- Document findings in an ADR before any implementation work.

### Phase 2 — Implementation (3-5 days)

- Add `/drive/open` route to `src/router/index.ts`.
- New page: `src/pages/DriveOpenPage.vue` — parse Drive UI params (`ids`, `action`, `userId`), validate, authenticate, route into the existing join flow with `fileId` already in scope.
- Update `src/services/crypto/inviteService.ts`: add `buildDriveUiLink(fileId, familyId, inviteToken)` alongside the existing `buildInviteLink`.
- Update `src/pages/MeetTheBeansPage.vue`: surface the Drive UI link as the primary share path (with the QR/Picker invite link as a "or scan a QR code" fallback).
- Reuse `useJoinFlow` composable from the hardening plan — Drive UI integration just bypasses the Picker step; the rest of the flow (decrypt, member-pick, password) is identical.

### Phase 3 — Marketplace listing (1-4 weeks, mostly Google review wait)

- Create Workspace Marketplace listing: text, screenshots, brand assets, demo video.
- Configure OAuth consent screen for Marketplace verification.
- Submit for review.
- Address Google review feedback iteratively.
- New ADR documenting the listing process and decisions.

### Phase 4 — Rollout (1 week)

- Soft-launch: new invites generated by current users include the Drive UI link first; old invites continue using Picker flow.
- Monitor for issues; existing Picker fallback covers any gaps.
- After 30 days of stable Drive UI usage, deprecate Picker as primary in the inviter UI (keep as a "use legacy invite" affordance).
- Update onboarding docs and help center.

## Files Affected

### New files

- `src/pages/DriveOpenPage.vue` — Drive UI integration callback handler.
- `src/services/google/driveUiIntegration.ts` _(maybe)_ — encapsulate Drive UI param parsing + validation if it warrants its own module; otherwise inline in the page component.
- `public/drive-app-manifest.json` _(if Marketplace requires)_ — manifest file for Marketplace submission.
- `docs/adr/<num>-drive-ui-integration.md` — ADR for the architecture decision.
- `docs/adr/<num>-marketplace-listing.md` — ADR / process notes for the Marketplace process (text, brand assets, demo-video link, review timeline).

### Modified files

- `src/router/index.ts` — register `/drive/open` route.
- `src/services/crypto/inviteService.ts` — add `buildDriveUiLink`; `parseInviteLink` may need to handle the Drive UI URL format too.
- `src/pages/MeetTheBeansPage.vue` — surface Drive UI link as primary share option.
- `src/composables/useJoinFlow.ts` — accept Drive UI integration entry point (file already in scope, skip the Picker step).
- `CLAUDE.md` — document the Drive UI integration architecture under Architecture Pattern.

### Documentation

- `docs/E2E_HEALTH.md` — add Drive UI flow to the test matrix.
- `docs/help/` — new help article on the Drive UI integration UX (joiner side: "what 'Open with beanies.family' does").

## Acceptance Criteria

- [ ] Phase 1 ADR committed with verified scope-grant behavior, iOS Safari verification, OAuth client decision
- [ ] `/drive/open` route handles Drive UI parameters correctly with input validation
- [ ] Joiner clicking "Open with beanies.family" in Drive UI lands in `JoinPodView` with file already in scope (no Picker step)
- [ ] iOS Safari completes the Drive UI integration flow without ITP errors (verified on real device)
- [ ] Existing invite QR / Picker flow continues to work as fallback during and after rollout
- [ ] Marketplace listing live and approved
- [ ] All test-matrix items from the hardening plan pass for the Drive UI integration path
- [ ] Help article published explaining the new flow to users

## Testing Plan

- **Unit:** `buildDriveUiLink` URL format; `DriveOpenPage` param parsing (valid, missing, malformed)
- **E2E:** `/drive/open` happy path with mocked params; reject path with invalid params
- **Real-device verification:** complete the Drive UI integration on iOS Safari, Android Chrome, Desktop Chrome at minimum
- **Production rollout monitoring:** track whether new invites generated post-rollout actually use the Drive UI link path; spot-check failure rates

## Out of Scope

- Replacing Picker entirely — Picker stays as fallback indefinitely.
- Migrating existing invites to Drive UI — they continue to work via the existing QR/Picker path.
- Drive UI integration for non-join surfaces (e.g., "Open with beanies.family" on `.beanpod` files browsed in Drive UI by an existing user) — possible future enhancement, not required for this plan.
