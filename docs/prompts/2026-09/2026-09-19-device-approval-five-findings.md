---
date: 2026-09-19
category: bugfix
issue: none
plan: docs/plans/2026-09-19-device-approval-five-findings.md
tags: [device-approval, deep-link, qr-decode, sync, telemetry, login-flow]
---

# Device approval — five findings from 0.21.4 device testing

greg tested the 0.21.4 device-approval rework on real devices (web, iOS TestFlight,
Android open testing) and reported five defects in one message.

## Prompts

### 2026-09-19 — the five findings (verbatim)

> Ok i've tested this now in prod with the apps on testing tracks and have the below
> findings:
>
> 1. When scanning a code with the "use camera" feature within the app, almost every time i
>    get the error message that a qr code could not be found in the photo... about 90% of
>    the time... reading the qr code with the native camera app directly is much more
>    reliable
> 2. however, when reading a 'pull' qr code with the native camera app, if the app is
>    closed/killed it will open the app, but nothing happens. it just open to the nook
>    screen and there is no approval modal
> 3. IF the app is already open when i read the pull qr code with the camera, i did see the
>    approval modal, but it seems that it was not placed at the top layer, it was behind an
>    existing 'sign in on another device' modal
> 4. the amount of approvals on the pull approval modal seems excessive... i think one
>    approve + pin is all we need here - can you check this again?
> 5. After approving from the approval modal, i received an error message that the approval
>    could NOT be saved to the family file... but about 10s later the device requesting
>    approval appeared to have decrypted the file... there is some issues with
>    delays/validations here, and also it is not clear what is happening on the device
>    requesting the approval
>
> can you please review the above issues and propose how we can address and fix these?

### 2026-09-19 — the live-scanner question, before approving the build

> i'd like to fix all five through /beanies-build-auto . before we start though one question
>
> - currently with the in-app scan you need to take a photo and then approve the photo and
>   send it. can the in-app scan function similar to the native device camera scan where it
>   indicated when it finds an appropriate QR code so we can be sure it has worked before we
>   take the photo and send it, similar to how whatsapp etc works with scanning a qr code? i
>   recall you mentioned this is a different approach, so if this is worth of a separate issue
>   and plan that is fine - just would like to know if this is possible as a fairly quick tweak
>   or would require separate planning and build

Answered: possible, but not a quick tweak. `AndroidManifest.xml` deliberately does not declare
`android.permission.CAMERA`, and declaring it would require it to be GRANTED before
`ACTION_IMAGE_CAPTURE` fires — adding a runtime prompt in front of the existing AI-document
and photo-attachment capture flows. Filed as a separate issue; not built here.

### 2026-09-19 — approval

> approved, go ahead

### 2026-09-19 — deploy instruction

> once implementation and code review and all validations are compelte, run one more
> /deploy-prod-auto no release note, increment minor revision only, push apps to testflight
> and open testing

## Outcome

Landed as sequential commits on `main` (`179300f8`, `9ed45be8`, `f5672dce`, `cdc8433e`, plus
the review-fix commit). All five findings addressed:

- **F2** was a regression introduced earlier in the same session: the session key became a
  never-null composite string, so every hydration step read as a session change and the held
  key was discarded at the moment the pod opened. The contract moved into the composable.
- **F5**'s root cause turned out to be a 5s publish budget on a multi-MB envelope upload, not
  the boolean flattening — though both were real and both were fixed. `CREDENTIAL_PUBLISH_TIMEOUT_MS`
  (20s) already existed for exactly this, documented against the identical bug on the
  magic-link path.
- **F1**'s root cause was contrast, not resolution: every beanies QR is minted Heritage
  Orange, which jsQR's luma sees at 120 against white's 255. Reading the blue channel (34)
  nearly triples the separation.

See the plan for the full record and the four review passes.
