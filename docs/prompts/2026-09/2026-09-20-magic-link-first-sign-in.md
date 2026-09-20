---
date: 2026-09-20
category: feature
issue: none
plan: docs/plans/2026-09-20-magic-link-first-sign-in.md
tags: [login-flow, magic-link, login-hint, google-drive, terminology, member-picker, reauth, i18n]
---

# Magic-link-first sign-in, and one name for every sign-in link

greg questioned why signing in on a new device starts by asking for Google Drive
authentication, and proposed promoting magic-link scanning to a first-class login route. The
investigation corrected part of the premise, settled a permanent terminology decision, and
turned into a six-workstream change.

## Prompts

### The opening question: why is Drive auth the first ask?

> one thing regarding the welcome gate / sign in (welcome back) screen - after logging out
> (and clearing data) - and presumably for the very first sign in on a fresh device as well -
> the first thing we are asking for is google drive authentication from a newly logging in user.
>
> rather than that, wouldn't it be easier to ask them to scan a code of a logged-in device?
> wouldn't that take them to the relevant google drive sign in (with the email hint enabled)
> and also provide the decryption key so that the file could be decrypted as soon as google
> drive access is enabled? just trying to think what would be the easiest/fasted way for new
> family members to login or to login for the first time on a new device.
>
> given that we now have magic link QR codes, should tihs be the promoted, first-class login
> option at all times provided there is not already a decrypted file on the device?
>
> Does the below make sense?
>
> - if no decrypted file on device, propose to open camera and scan a magic qr code, as an
>   alternative (lower option) open google drive and consent, once consent is done, then offer
>   QR code or password/passphrase for sign-in (this is where the consent and then
>   password/passphrase flow works)
>
> - if decrypted file exists on device, simply choose it and then choose your family member
>
> what do you tihnk of the above?

**Answer given.** The premise holds only for the clear-data case: a genuinely fresh device
leads with "plant a new pod" and shows no Drive consent at all. A magic link also carries a
token and pointers, not key material, so scanning does not bypass Drive, it precedes it. The
real win is that consent arrives pre-filled and no credential challenge follows.

### The terminology decision, the picker, and the push-back on scope

> Ok - first off we had already decided that EVERY sign-in link/qr generated should be called
> a magic link - it doesn't matter the duration (15 min, 7 days, whatever). if its a link or qr
> code that facilitates sign in, it's a magic link, to avoid any confusion in the future. pls
> take note.
>
> agree with (3) above completely - when generating a magic link for yourself or another member
> from the UI, let's ask 'which beanie is signing in?' or something to that effect - we can
> re-use the same 'fold-down' (accordion open) type effect that we use on the FAB when a family
> member needs to be selected for a particular function. if a user has not joined yet, it created
> a joining link rather than a magic link (although if i'm not wrong, i believe these are already
> equivalent, or are treated the same by the app). this should work and also make magic link
> creation more intuitive, i think, rather than less.
>
> regarding (2) i would push back - i think ALL magic links, regardless of duration, should come
> with the googleAccountEmail hint - this should be a hard constraint across the app. always
> include the hint no amtter what, if it exists.
>
> In additoon, we should also include the welcome gate / welcome back login surface changes (i.e.
> putting the camera option as first class (even though we are asking the user to close beanies
> and open the camera to scan a qr code) - combined with the changes above, this is the genuinely
> less confusing approach to signing in, in my opinion. let me know if you feel differently. sweep
> across the app to ensure this is fully consistent across all login, re-login, etc surfaces.
>
> does this make sense? if so please go ahead to plan and build directly with /beanies-build-auto

**Note.** The push-back on the hint was correct for a reason the first answer had missed: the
objection was that a family-scoped link has no member to derive a hint from, and the picker
decision removes that objection, so "always attach it" becomes a clean invariant.

### Narrowing the surface: the home screen does not change

> yes agree with your caveat above and to be clear, i am NOT proposing to change the layout of
> the welcome gate HOME screen. We should only apply this to the "welcome back" view which comes
> agter you tap the welcome back button. The home screen should not change.
>
> only once a user has explictly chosen the login path (not the create pod path) should they be
> presented with the magic link scan option as the first class approach to login or re-login

### The mockup as an artifact

> place the mockup as a claude artifact ps

### Approval and autonomy

> looks good, artifact approved. please go ahead with /beanies-build-auto

> work autonomously and only stop for a genuine showstopper or blocker

## Outcome

Implemented, reviewed and verified in a browser; **not deployed**. Plan
`docs/plans/2026-09-20-magic-link-first-sign-in.md` (four passes). Mockup approved as a
published artifact and synced into `docs/mockups/`.

The terminology decision is permanent and now lives in the `CLAUDE.md` Terminology Guide with
its data-format carve-out: user-facing copy says "magic link" whatever the duration, but the
persisted envelope dicts (`memberLinkKeys`, `inviteKeys`) are not renamed, because that is a
migration rather than a rename.

**Two defects the review discipline caught that would otherwise have shipped:**

1. Minting for another member would have shown the minter's own link status and replace
   warning, and `memberLinkKeys` newest-wins would then have silently destroyed that member's
   working link. No error, nothing in the firehose; they would find out on a new phone.
2. Moving the step-up gate onto `mintMagicLink` would have fired a PIN prompt inside pod
   creation and inside joining, stacked over a modal the user cannot close, failing closed and
   withholding the link from the only screen that ever shows it.

**Still owed, greg's hands:** a real Google consent screen showing the hinted account; a second
physical device scanning with its native camera; minting for a spouse then signing in as their
Google account; inviting an unjoined member through the routed wizard.
