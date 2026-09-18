---
date: 2026-09-18
category: feature
issue: Notion tracker #97
plan: docs/plans/2026-09-18-scan-to-sign-in.md
tags: [auth, onboarding, device-link, magic-link, recovery-kit, qr, telemetry, ui]
---

# Scan to sign in — device-to-device as the first-class way into a cold device

Continues `2026-09-17-second-device-friction.md`, which raised the problem and produced the
four-rung recovery research. This session reshaped that into one product decision, designed
it, planned it through the four review passes, and built it.

## Prompt 1 — reshaping the issue

> ok let's look at #97 device sign in again and perhaps alter the shape of this issue - after thinking about it some more, here are my thoughts:
>
> - Right now the magic link / QR code is buried a bit in the app. After thinking more, I feel like this should really be the #1 option, and the best way to get past that first level of friction (first user signing in on the first new device - i.e. moving from browser to app, or vice versa). I think we should make the BEANIES MAGIC LINK / QR CODE feature FIRST CLASS in the app. For example, create a QR code as part of the profile dropdown (next to beanie wall,etc) or in some other clear place in the UI, rather than being buried in settings. Write (but brief and concise) message at every cold login screen (anytime you are being asked to decrupt the app) to say - scan (or copy) a magic link from a logged-in device. In my opinion, this becomes the first class login method - have another logged in device nearby and simply scan or copy/paste the magic link it generates. We would need to improve the UI to make this option prominent for cold logins, and the recovery kit only as a fallback. It must work seamlessly both on mobile/app and desktop (mobile / app - scan another person's device. desktop - either scan with webcam, or copy/paste the magic link which can be easily shred as a first class feature a logged-in app or mobile device)
>
> - what was written as RUNG 1 in the plan - can you explain how this would work exactly? the cold device shows a QR code and the logged-in device scans it, and that decrypts the file? or something to that effect?
>
> The recovery kit becomes the fall back here, and given scanning QR is now a first class feature, when the user goes to the recovery kit fallback, scanning or loading the recovery kit becomes the first class option, clear and prominent, while manually typing in the recorvery kit code by hand becomes the fallback option
>
> what are yuot rhought on this proposal? does it make sense or how could we make it better and more seamless?

## Prompt 2 — approving the shape

> Agree - go ahead to upadte the tracker item and run /beanies-pre-plan on this item with the proposed shape as per your recommendation
>
> - scan (whether it's push or pull) becomes the top line, first class action in the app for login on cold device. all copy is brief and concise and directs users to scan the qr code on a logged in device.
>
> - yes, agree to input PIN before the logged in device creates a magic link/qr
>
> - yes the fallback is the recovery kit if only one member and one device, but making it first class to scan the qr code ratehr than manually typing in the recovery key
>
> - review the UI approach (which is now probably the key piece of this whole issue) with /frontend-design:frontend-design and ensure that the UI is polished, clear, intuitive and semlessly allows users to understand and login, and magic link options are clearly visible and labelled (profile dropdown works)
>
> let me know if any questions or pending concerns

## Prompt 3 — mockup direction and the creation screen

> go with C.
>
> regarding surfce 6 (the moment the family is created) this looks very good, although i feel showing 2 QR codes side by side could be confusing (and also may be hard to do at mobile width). my suggestion would be to show and surface the magic link (sign-in link) since that is the first option to sign-in with a new device, but also ensure the message to download the recovery kit is clear and non-skippable.
>
> let me know your thoughts or questions.
>
> if everything is clear, proceed to /beanies-plan then direct to /beanies-build-auto and build autonomously, only stop if required for a blocking question or showstopper.

## Prompt 4 — copy corrections

> on the mockup update the copy 'i've written it down somewhere safe' -> 'i've saved my recovery kit somewhere safe'
>
> and 'keep it somewhere you'd keep a passport' -> 'print it out and/or save it somewhere safe'

## Prompt 5 — which link kind

> go with the 15-minute device link

## Prompt 6 — the creation-screen gate

> i prefer to keep the checkbox, i don't think anybody can get stuck there right? it's just a checkbox, and just provides a small extra layer of verification that they saved the file.

## Prompt 7 — scope and delivery

> i'm fine to build everything now and flip the flag to true - no need to keep anything behind a false flag. prepare the plan to build everything and run it through beanies-build-auto. perform full testing and validation, using browser where possible as per the skill. expectation is we deliver as per the mockup just approved.

## Prompt 8 — where the QR belongs (after checking locally)

> i've checked now on my local and noticed that you've added the sign-in QR code to teh welcome gate below the welcome back and join your family buttons. do we want to add that screen here, or put it under the welcome back view? I noticed it's on both now, but i'm wondering if we should keep it only to welcome back so the welcome gate stays clean and clear for new users to go to create a new pod?
>
> also, when multiple beanpods are detected on your drive, the welcome back buttons brings up the list first, but should we change that? now that we have QR sign in, i think we shuld always bring up the QR code / google drive connect page first, and then give an affordance at the bottom to select another family? what do you think?

## Prompt 9 — the QR must always print on screen

> that's fine, as long as the magic link QR always shows on screen. that is the first class login surface now, so scanning a QR (whether its push or pull) means it always prints on screen for the other device to scan

## Prompt 10 — collapsing the mint flow

> ok looking better. one more thought on the 'sign in anoterh device' in the menu - there are 3 clicks before you actually get to the PIN screen - i think the first two modals (sign in another deivce and vrify identify) can both be removed - do we really need them? my thinking is this is the flow:
>
> - user clicks sign in another device
> - PIN entry input comes up (pin pad on mobile devices, horizontal pin keyboard enty on desktop)
> - QR code / link is shown
>
> on the PIN input modal itself, we could add some simple and brief explanatory text, which would remove the need for the 2 extra modals. what do you tihnk?

## Prompt 11 — the redundant method chooser

> is there any reason the user even needs to tap an orange button "sign in with pin"? why not just show the explanation and the PIN input on the same modal?

## Prompt 12 — finish the review findings

> keep going on those five

## Outcome

Built per `docs/plans/2026-09-18-scan-to-sign-in.md`. `npm run validate` green.

Three decisions taken during the session and recorded on the plan: the profile-menu action
uses the existing **15-minute device link** (additive, so no "this replaces your last code"
warning to explain); the creation screen **keeps the save/print/tick gate** with the tick
unconditional; and everything shipped in **one ungated release** rather than behind a flag.

Three placement corrections came from greg checking it locally, and the third was a defect
rather than a preference: the pull-mode QR polls the staged `.beanpod`, so on the welcome
gate and the storage-picker step — where nothing is staged — it would have rendered a code
and waited forever. It now lives only on the decrypt surface, where a pod is in hand.

A `/code-review max` pass returned 15 findings, of which the most serious was that the
feature **could not work at all**: `loadFromFile()` only refreshes `syncStore.envelope`
inside its `if (liveKey)` branch, and a cold device has no family key by definition.

---

## Session 2 — 2026-09-18 evening: the approval deep link was broken in 0.21.3

**Category:** bug
**Plan:** `docs/plans/2026-09-18-device-approval-deeplink-notification.md`

### greg, on testing the shipped feature

> regarding this method - i've just updated the app on my android and iphone to 0.21.3
> (latest) and tried scanning a QR code on my chrome browser with the camera app on both
> phoens. in both cases, the beanies app opens and nothing happens. i don't get any prompt
> to "approve this login" or anything to that effect. It appears there may be a bug here -
> can you check?

Clarified: Chrome was **signed out, showing its own code** (the pull direction), phones
signed in.

### greg, on sequencing

> let's investigate these bugs and questions before we start implementation

### greg, on process

> go, and fold 3 into 2 if that is your recommendation. should we implement directly, or go
> through beanies-plan and beanies-build-auto? ... though either way, we should run it
> through beanies-build-auto, ensure the impelemtnation is reviewed, and the proper tests
> and created to pin the functionality that was broken

### greg, on verification

> for run A please go ahead to test yourself if possible using a link you build - given this
> bug was cross device, as long as it works in a local browser we can take this as
> validation for now

Answered with a correction: the web path was never broken (`main.ts` captures at module
scope before the router can eat the fragment), so a hand-built link in a desktop browser
passes against the UNFIXED code and validates nothing. The local repro drives the native
path with a stubbed Capacitor instead; final proof is on-device.

### Outcome

Root cause: delivery was inferred from a route change that cannot happen. The bridge
captured the key and navigated to `/welcome`, but a signed-in scanner is redirected to the
Nook by name, and a phone already on `/nook` sees an identical path on both sides, so the
`route.fullPath` watcher never fired. Cold launch failed separately, because `getLaunchUrl`
resolves after the one-shot read.

Fixed by giving `installInboundLinkListener` a second injected callback that delivers the
key directly, which removes the cold-launch race rather than repairing it. `/code-review
max` then found that the first version of the init gate fixed only half the hazard, and
that an approval marker was being honoured on `/join`; both are addressed.
