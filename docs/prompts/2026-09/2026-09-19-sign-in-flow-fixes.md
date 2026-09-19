---
date: 2026-09-19
category: bugfix
issue: none
plan: docs/plans/2026-09-19-sign-in-flow-fixes-and-unlock-redesign.md
tags: [login-flow, join-link, device-approval, google-reconnect, magic-link, qr, layout]
---

# Sign-in flow fixes, scanner removal, and the unlock-screen redesign

greg tested 0.21.5 on a production iPhone (TestFlight) and on the web, confirmed the device
approval work and the new Drive file picker both work on iOS, and reported a further cluster
of UI-flow defects plus a copy and layout pass.

## Prompts

### The Google reconnect double-tap, the post-approval password prompt, the wall of text

> there seems to be a small issue still with the google drive authentication now, which is
> that i am asked to tap the reconnect button twice, but the second time seems unnecessary.
> at least on iphone
>
> after i scanned the qr code with another device the approval confirmation on the scanning
> device took about 5 seconds, but on the device being scanned it took about 30 seconds, and
> then i was sent to the 'unlock my beanpod' screen and asked to enter a password (as if the
> pod was not decrypted). however if i hit back and then go back to the welcome back screen
> and choose my family file, i am taken directly to my list of family members... this feels
> more like a UI flow issue than a structural issue with decryption
>
> on the unlock your beanpod screen - i feel there is way too much text, it's like a wall of
> text that is intimidating for a sign-in screen, and also the layout looks buggy - there is
> no margin between the line "this decrypts XXX family data file.." and the scan a beanies
> qr code box
>
> i confirmed it works well with the native camera app, but still is not working with the
> in-app open camera function. i'm wondering if we should just give up on the "in-app" scan
> function... what do you think?
>
> the first time i tried creating a magic link on the browser after updating, the spinner
> went for about 45 seconds before i gave up and refreshed the page

Plus an exact copy list (subtitle, steps, button labels, the approval modal title and its
provenance line) and a request to review the welcome-gate layout.

### On the camera question, after being told iOS has no public API to launch the Camera app

> is it possible to have the app just open the native camera app though? it doesn't matter if
> it's in QR scanning mode since almost all the native camera apps automatically detect a QR

Answered with the platform split: Android has `android.media.action.STILL_IMAGE_CAMERA`, iOS
has nothing, and a button that silently does nothing on every iPhone is worse than no button.
greg: "sure let's do that for now" → the instruction line on both platforms.

### Terminology, and the wrong-pod bug

> a 'magic link' or 'beanies magic link' is the link used to sign in, and a 'joining link'
> would be the one used to join beanies
>
> after generating the magic link / qr the first time and scanning the join family qr with my
> iphone, i was first brought to the list of family members on my currently signed-in pod, not
> the new one, which should never happen
>
> the new file picker UI is good as we've filtered directly for the file, but the CTA at the
> bottom is something like "insert" which could be confusing

### On the mockup

> On the unlock my beanpod screen, there seems to still be a grey box, is this expected?

(That was the "today" board. Answered with the responsive-card reasoning and a desktop board
showing why the card earns its keep at 540px but not at 390px.) Then: "the proposed mockup
looks good, approved."

### The welcome page

> on the welcome page, we have the 'have a magic link? paste it here' affordance, but should
> we also have brief copy that says you can also scan a magic link directly with your camera?

## Outcome

Shipped as 0.21.6. Seven defects fixed, all root-caused to a line first. The three that were
more than they looked:

- **The wrong-pod bug was a hijack, not a missing redirect.** `/join` is deliberately excluded
  from `ALREADY_AUTH_REDIRECT_FROM` — and `LoginPage.onMounted` ran the whole boot path anyway
  with no `initialView` check, so both branches read the ACTIVE family and `switchFamily(A)`
  re-committed to it.
- **The post-approval password prompt was a component destroyed by its own success.**
  `emit()` early-returns on an unmounted instance; the fix is a function prop, which is a
  closure and does not care.
- **The 45s mint was the one credential publish in the app with no timeout**, and nothing
  emitted on start, so a hang produced no telemetry at all.

Two `/code-review max` rounds. The first found the initial approval fix was a REGRESSION (a
watcher with no `{immediate:true}` that also swallowed the emit it replaced). See
`docs/lessons.md`.
