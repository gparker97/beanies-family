---
date: 2026-09-23
category: security
issue: none (direct implementation)
plan: docs/plans/2026-09-23-trust-on-create-and-kit-signout-guard.md
tags: [auth, trusted-device, recovery-kit, sign-out, login-flow]
---

# Trust the creating device, sign-out trust tick, and the recovery-kit sign-out guard

greg locked himself out of a fresh prod family ("Test new flow 4") by ticking past the
recovery kit and signing out keeping data. Plan → build-auto.

## Prompts

### Initial prompt (2026-09-23)

> I've just created a family called "test new flow 4" in production to test the new login
> flow and magic link / qr code changes. I didn't save the recovery kit, and logged out once
> (without clearing data) but was not able to login again as i hit the decrypt data step on
> login. [...] should we give one final confirmation to ask the user if they have saved the
> recovery kit [...] how would you propose we address this? [...] remove all traces of the new
> family test new flow 4 [...] check if other test families [...] and remove them.

### Follow-up 1 (2026-09-23)

> Go ahead to remove all the test families [...] Fully agree to trust the creating service by
> default and let's do that without fail and create tests to pin that so it never changes.
> Also agree to add the guard and fix this copy, but for the guard do not over explain [...]
> Go ahead to take this through beanies plan

### Follow-up 2 (2026-09-23)

> for any new device (aside from the pod creation device), at the first sign-in, pls make
> sure we _always_ ask the user if the device is trusted. q1) yes let's have joined devices be
> trusted also q2) ok 3) that is ok to reuse -> [...] add a tick to the logout modal [...]
> which clearly reflects the trusted device status

### Follow-up 3 (2026-09-23)

> agree with both, go ahead

### Follow-up 4 (2026-09-23)

> review the plan once more with fable and ensure everything is correct and accurate [...]

### Follow-up 5 (2026-09-23)

> go ahead an dimplement with /beanies-build-auto

## Outcome

Built via /beanies-build-auto (not committed, not deployed). Creating or joining a family now
trusts the device (pinned by tests), every other new device is always asked on first sign-in,
desktop and mobile share one sign-out confirm with a trust tick and live hint, and a manager
whose recovery kit was never saved is guarded before a key-dropping sign-out. Two `high`
code-review rounds; all substantiated findings fixed. `npm run validate` green (8596 tests);
browser-verified at desktop and 400px, light and dark. See the plan's Implementation Notes.
