---
date: 2026-09-04
category: bug
issue: 117 (Notion — recovery kit renovation split out; delivery kept here)
plan: docs/plans/2026-09-04-native-file-delivery.md
tags: [capacitor, native, share-sheet, recovery-kit, pdf, export, delete-family, telemetry]
---

# Native file delivery (downloads and shares in the apps)

## Prompts

**~15:20** — "let's address the more serious issue of not being able to download/share PDFs
in the apps (at least in the android app, but likely impacts both apps) which impacts meal
planner pdfs, recovery kit, and potentially other surfaces. you can check status.md as some
investigation was already done in a previous session so some context may be there. please do
a full investigation into this issue and propose how it can be fixed and work reliably, as
recovery kit downloads are important and should work on any surface, and PDF
generation/download in general is used across the app." Plus a second question: "is it
possible to delete or clear your recovery kits (to invalidate them)? for example, if they
are lost? if not, i think this is an important feature to add while we are working on them."

**~16:10** — "ok let's put the recovery kit renovation work into 117 (but note that recovery
kit and other pdf download and share in the native app should be done here) and go ahead to
plan the rest. go to /beanies-pre-plan then go to /beanies-plan once implement directly and
once implementation is complete run /code-review max against all code to ensure it is
implemented as per the plan and no bugs, side effects, or security issues were introduced."

**Answers given during planning** — delete-family export sequencing: bundle it into the main
plan rather than split it out. GitHub issue: no, Notion row only. Rotation scope: native apps
plus installed PWA.

**~17:05** — "continue straight thru with implementation and code review. I'm fine with your
recommendation for items 1 and 2 above."

## Outcome

Shipped. Six call sites now route through one seam (`shareOrDownloadFile`) and one
policy layer (`deliverFile`); on native everything goes through the OS share sheet,
because neither WebView has any other file-out mechanism and `<a download>` was
silently inert. Plan: `docs/plans/2026-09-04-native-file-delivery.md` (four passes).

`/code-review max` found 20 defects, all fixed in the same change. The five that
mattered most:

1. **Android resolves an abandoned share as success** (`SharePlugin.java:59` — an
   activity result of CANCELED only rejects while `stopped` is false, and
   `handleOnStop()` sets it the moment the chosen app foregrounds). So picking Gmail
   and discarding the draft is indistinguishable from saving to Files, and that
   resolution was gating an irreversible delete. The OS cannot tell us, so the
   delete-family flow now asks the user on native.
2. **The pre-deletion backup held 10 of 29 collections** — now derived from
   `COLLECTION_NAMES`, which is compile-time complete.
3. **An empty blob delivered as success** — `blobToDataUrl` yields
   `"data:<type>;base64,"` for zero bytes, so a 0-byte file wrote and shared happily.
4. **The failure report rode on the toast**, and `useToast` dedupes above its own
   report block. One sticky generic message meant the _next_ delivery failure vanished
   entirely: no toast, no report, nothing in CloudWatch. The report now fires first,
   unconditionally, in one place.
5. **The sweep raced a still-streaming read.** Deleting the previous hand-off file at
   the top of the next delivery relied on "the previous share is over", which is the
   very premise the module's own comment rejects. Now age-based (10 min), plus an
   unconditional sweep on every sign-out tier — nothing else ever deleted the
   plaintext export or the recovery-kit PDF from the cache.

Also fixed: a 403 on save marking a healthy photo missing app-wide, a cancelled kit
share clearing the error banner, desktop exports becoming share sheets, an unbounded
blob cache, a stale-closure filename across an await, fabricated `encode` stages, an
unhandled rejection on the JSON export, and an abort path that unticked the very box
its own copy told the user to keep.

⚠️ **Owed:** on-device verification on both platforms (none of this runs in CI), and a
decision on the iOS `Package.swift` regeneration — see STATUS.
