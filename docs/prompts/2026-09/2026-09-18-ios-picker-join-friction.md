---
date: 2026-09-18
category: bug
issue: Notion tracker #98
plan: docs/plans/2026-09-18-ios-picker-system-browser-spike.md
tags: [auth, join-flow, drive-picker, ios, pwa, capacitor, telemetry, oauth]
---

# The Drive Picker on iPhone — the join-flow blocker

Split out of the same session that shipped tracker #97 (scan to sign in). #97 removes the Picker
from every sign-in **after** the first grant; it does not remove the joiner's one-time grant, which
is what this issue is about.

## Prompt 1 — raising it, with four externally-sourced options

> I've looked deeper into the picker issue [...] I asked gemini [...] it produced 4 options:
>
> 1. Backend Service Proxying, 2. Drive SDK Deep-Link Authorization Flow, 3. Shared App-Folder
>    Strategy, 4. Upgrading to drive.readonly Scope [...] however, (2) looks very interesting to me
>    [...] also - is the code review and everything else complete here?

Assessed all four against Google's own documentation rather than against the proposal. Options 1, 3
and 4 were ruled out on verifiable grounds (1 breaks the privacy claim the product rests on; 3
contradicts ADR-021, which records that folder sharing does not grant app API access; 4 is a
RESTRICTED scope needing an annual CASA assessment). Option 2's specific mechanism,
`drive.google.com/open?id=FILE_ID`, was verified **false** as a grant: it is a first-party viewer
redirect carrying no `client_id` and no scope. The genuinely promising path turned out to be
something none of the four named: Google's documented **system-browser Picker**.

## Prompt 2 — correcting a stale claim about registration

> note that all of the registration work on the google side is done already. 'open with..' on a
> beanpod file in googel drive has already been confirmed working, it's just never been a path we
> promoted heavily. but it should be working today.

I had read unticked checkboxes in an old plan as unfinished work. Corrected: Marketplace
registration is live and desktop web "Open with" works today.

## Prompt 3 — authorising the spike, and a decisive on-device observation

> go ahead to commit the #97 implementation. i can confirm that the QR code is generated on my local
> dev laptop [...] for the iphone (and android/firefox/etc) file picker - go ahead with the spike and
> testing [...] regardin the drive ios app, i confimed that if i select a beanpod file from the
> google drive ios app and choose 'open with..' and select beanies, it behaves as though i'm sharing
> that file to beanies

That last observation settled a question documentation could not: on iOS, "Open with" is the
**share sheet**. It hands over file bytes with no Drive grant, so it is not a join route at all
(a local copy forks the pod per ADR-033). It remains worth fixing as honest messaging, and that is
all it is scoped to.

## Prompt 4 — filing it

> go ahead with the tracker issue and the picker spike /beanies-new-issue at high priority

Created tracker #98 (Bug, High, feature-gated, no GitHub issue, no mockup).

## Prompt 5 — straight through to a plan

> first commit and push all fixes just now to the repo. then go ahead with /beanies-pre-plan and move
> straivht to /beanies-plan and let me know if you need anyting from me

The tree was already clean at `59d9f5b2` and identical to `origin/main` (the #97 review fixes went in
**before** that commit, not after), so there was nothing to commit; reported that rather than making
an empty commit.

## What greg is owed

The load-bearing unknown (does the system-browser Picker work on iOS?) cannot be answered from
Google's documentation, which details Android's `AuthorizationRequest` explicitly and never names
iOS or Capacitor. It needs a real iPhone. Emulation cannot substitute: ITP and the
`capacitor://app.beanies.family` origin **are** the failing conditions, and Playwright WebKit
reproduces neither.

## Prompt 6 — probe or build?

> is there anything we do to test the capability first, or should we just go direct to building with
> /beanies-build-auto (knowing that in the worst case we can't get it to work, we can revert changes)?

There was, and it cost nothing: the system-browser Picker **is** a URL. A hand-built
`accounts.google.com/o/oauth2/v2/auth` with `trigger_onepick=true` and `scope=drive.file` only,
opened in Safari, answers the load-bearing question with no code, no branch and nothing to revert.
Recommended running it on desktop Chrome first so that a failure could be attributed correctly: a
Cloud-config problem and an iOS limitation would have looked identical from a build.

## Prompt 7 — the probe came back green

> it works!! after finishing google consent, confirmed i can see a (more modern looking) google drive
> file picker on BOTH chrome and ios/safari!

**Open Question 1 is resolved.** The system-browser Picker renders on iOS Safari, the surface that
has been failing. This also closes the config branch: the Picker API is enabled on the project and
our existing **Web**-type OAuth client accepts `trigger_onepick`. That mattered because Google's page
documents only the desktop-app and Android client types and states a separate client id is needed per
platform, so a Web client being rejected was a live risk. No new OAuth client, no new redirect URI,
no scope change.

**Still not proven, and not to be claimed as proven:**

1. **The native arm.** Safari rendering does not prove the installed app can reach the picker and get
   back. `Browser.open()` opens `SFSafariViewController`, which renders Safari content, so the picker
   itself should carry over; the risk is the **return hop**, which rides the universal-link /
   custom-scheme bridge already working for calendar sync. Needs a TestFlight build, because
   `DevFeatureFlagsCard` is tree-shaken out of production builds and there is no in-app toggle there.
2. **That `picked_file_ids` actually arrives at the redirect URI.** Documented by Google, not yet
   observed.
3. **Assumption 3** — whether the app's existing `DRIVE_SCOPES` token can read the picked file
   _without_ exchanging the picker's auth code, the grant being server-side per (app, account, file).
   This decides how much code Phase 2 needs.

**Design detail from the probe:** consent comes first, then the picker, as one continuous Google
flow.

## Prompt 8 — build it

> ok sounds good. once the plan is fully complete, proceed directly with /beanies-build-auto to
> build, test, and validate to the greatest extend possible, then let me know what testing is needed
> on my side

## Prompt 9 — the callback parameters

greg pasted the captured callback URL, which settled Assumption 4. It carried `iss`,
`picked_file_ids` (a single bare id, no comma), `code`, and `scope` of exactly
`https://www.googleapis.com/auth/drive.file` — first-hand confirmation of Google's
"cannot be combined with any other scope" rule, and the hard evidence behind the plan's scope
caveat. No `state`, because the probe URL omitted one.

## Prompt 10 — greg reproduces it in a browser, and picks a direction

greg ran the flag-on join on his own machine and hit three things:

1. the Google account chooser had **no pre-selection**, so he had to find his own address in a list;
2. the picker was **not filtered**, so he had to hunt across tabs and folders for a `.beanpod` he
   had never seen;
3. selecting the file threw him **back to the start of the join** - the failure the second review
   had just predicted.

On the four ways forward he leaned toward preserving the token, with one reservation:

> my main concern is just the supportability/maintainability of that code and whether it adds too
> much complexity, but if that is the only option i woudl still choose it over the previous picker
> UI which hardly worked at all.

**All three are fixed, and his instinct turned out to be cheaper than the option he was choosing
between.** The token is ALREADY persisted: a joiner's refresh token is written under
`PENDING_FAMILY_KEY` and cleared on sign-out, and the only reader of that key was
`migratePendingRefreshToken`, which runs from `initializeAuth(familyId)` and so never during a
join. So the fix is a fallback LOOKUP, not a second token lifecycle: no access token at rest, no
new storage, no new credential to maintain. That answers the maintainability reservation directly.

(1) is `login_hint`, which `buildAuthUrl` already supported but which was only ever fed the
token-verified email - usually absent on a join. It now falls back to the invite's own hint, which
is what CLAUDE.md's cloud-auth rule asks for. (2) is Google's documented `file_ids` filter, and on
a join the id is known exactly because it rides the invite link as `fid=`.

## Outcome

Built per `docs/plans/2026-09-18-ios-picker-system-browser-spike.md`. `npm run validate` green
(8285 tests, build OK).

All four phases landed. The two on-device probes closed Assumptions 1 and 4 before a line was
written, which is the reason Phase 2 was built at all rather than spiked behind a question mark.

**One declared deviation:** the plan gates Phase 2's return handler on Assumption 3 (that the app's
existing `DRIVE_SCOPES` token can read a picker-granted file without exchanging the code), which is
still unverified. The handler was built on the assumption-3-true path only; the side-token fallback
the gate exists to prevent was deliberately NOT built. If the on-device read returns 403/404, that
part is re-planned rather than patched.
