# Plan: Invite + Join clarity (Google-email red herring + join destination)

> Date: 2026-06-14
> Related issues: None — direct implementation (greg, in-session, from 2 user reports)
> Mockup: `docs/mockups/invite-join-clarity-2026-06-14.html`
> Status: **IMPLEMENTED 2026-06-14** (committed to `main`, not deployed). All four open decisions approved by greg: CTA "Share & Get Invite Link"; step-2 retitled "Invite Link Ready"; family-name welcome (with name-less fallback); raw mono `.beanpod` filename.

## Context

Two user reports about the family-member invite/join flow:

1. **Owner side — the Google Drive email red herring.** Clicking **"Share with {email}"** on invite-wizard **step 1** makes the Drive permissions API grant access, which causes **Google Drive itself** to auto-send a "shared a file with you" email (not sent by us). That email links to Google Drive, not beanies. The real way in is the **custom invite link + QR on step 2** ("Magic Link Ready"). A user's partner opened the Google email, landed in Drive, and was stuck — she'd skipped/missed step 2. Nothing on step 1 or 2 tells the owner: _the real invite is the next screen's link; the Google email is ignorable._

2. **Invitee side — the join destination (`JoinPodView.vue`).**
   - The verify subtitle **"You need a magic joining link from a family member"** (`join.verifySubtitle`, `uiStrings.ts`) renders **unconditionally** on the verify screen — including right after the invitee opened a valid link (URL already has `?fam=…&t=…`). It's stale/contradictory there; it only makes sense with **no** link.
   - The **"Select File from Drive"** button (`join.pickerPrompt.button`) doesn't read as "the required next step to join."
   - The **`.beanpod` filename is already known** here (invite link carries it via the `ref=` param → `flow.expectedFileName`). The _local_ drop-zone shows it ("Look for a file named: …"); the **Drive branch doesn't** — so we can tell the invitee exactly which file to pick.

## Reused facts (verified in code)

- Drive auto-email is a side effect of `shareFileWithEmail(... 'writer')` (`src/services/google/driveService.ts:392`) called from `useInviteFlow.shareDriveAccess` — we don't and can't suppress it; we just explain it.
- Wizard step transition: `InviteWizardModal.handleSubmit` sets `currentStep.value = 2` on share success (`src/components/family/InviteWizardModal.vue`).
- `flow.expectedFileName` (`useJoinFlow.ts`) = registry display path OR the URL `fileName` — already used on the local drop-zone (`JoinPodView.vue`), guard with `v-if` (may be empty if the link omitted it).
- Invite-link params (`targetFamilyId`, `inviteToken`, `targetProvider`, `targetFileName`) are parsed in `useJoinFlow.parseUrl()` — so "did they arrive via a link?" is knowable (`inviteToken`/`targetFamilyId` present).

## Changes (copy-led; small template conditionals)

### 1. `InviteWizardModal.vue` — set expectations + label the Google email

- **Step 1:** add a concise info callout (Sky-Silk tint) above/below the CTA — **new key** `inviteWizard.step1.nextHint`: _"Next, you'll get a link + QR to send them — that's how they join. Google will also email them a 'file shared' notice; they can ignore it."_
- **Step 1 CTA** (`inviteWizard.step1.cta.share`): reword "Share with {email}" → **"Share & get invite link"** (drops the email, which is already shown in the chip/checkbox above; signals a next step). _Decision for greg — see Open Questions._ Local-provider CTA (`cta.confirm`) unchanged.
- **Step 2 (the key fix):** add a prominent callout at the top of "Magic Link Ready" (Heritage-Orange tint) — **new key** `inviteWizard.step2.useThisLink`: _"Send them THIS link or QR — it's the only way in. Google also emailed them a 'file shared' notice; that one can be ignored."_ Optionally retitle `inviteWizard.step2.title` "Magic Link Ready" → **"Invite link ready"** (clearer than "magic").

### 2. `JoinPodView.vue` — fix the stale subtitle + clarify the Drive step + name the file

- **Verify subtitle:** make it conditional on having arrived via a link. When `inviteToken`/`targetFamilyId` is present → **new key** `join.verifyInvited` (family-name-aware if available, else generic): _"You've been invited to join {family} 🎉"_. When NO link params → keep the existing "you need a magic joining link" wording (the "How to join" steps already cover that path). _Verify family-name availability on this screen; fall back to a name-less variant if not._
- **Drive branch (`awaiting-auth`, `google_drive`):**
  - Add a "one last step" framing line — **new key** `join.pickerPrompt.lead`: _"One last step to join — open your family's data file so you have access."_
  - Reword the button `join.pickerPrompt.button` "Select File from Drive" → **"Open your family file"**.
  - Reword the description `join.pickerPrompt.description` to say _why_ + name the file: _"This unlocks your family's data so you can join. It opens Google Drive to pick the file below."_
  - **Surface `flow.expectedFileName`** on the Drive branch (mirror the local drop-zone block) with a label — **new key** `join.pickerPrompt.fileHint`: _"After you tap, pick this file:"_ + the mono filename. `v-if="flow.expectedFileName.value"` so it's hidden when unknown.

### 3. i18n + tests

- All new/reworded keys in `uiStrings.ts` (en + beanie), then `npm run translate` (zh). No hardcoded strings (ADR-008). Avoid em-dashes in the copy (use ASCII hyphens) per house style.
- Tests: extend `JoinPodView`/`useJoinFlow` tests (if present) to assert the verify subtitle switches on invite-link presence and the Drive branch shows the filename; add/adjust `InviteWizardModal` test for the new callouts. (Check for existing test files first; many of these are copy assertions through the mocked `t` = key.)

## Files affected

- `src/components/family/InviteWizardModal.vue` (modify)
- `src/components/login/JoinPodView.vue` (modify)
- `src/services/translation/uiStrings.ts` + `public/translations/zh.json` (modify)
- Relevant `__tests__` under `family/` and `login/` (modify/add)
- `CHANGELOG.md` (modify)

## Acceptance criteria

- [ ] Step 1 tells the owner a link + QR is coming next and the Google "file shared" email is ignorable.
- [ ] Step 2 leads with a clear "send THIS link, ignore the Google email" callout.
- [ ] After opening a valid invite link, the join screen no longer says "you need a magic joining link"; it welcomes them to {family}.
- [ ] The Drive-join CTA reads as the required next step, names the exact `.beanpod` file to pick (when known), and explains it unlocks family data.
- [ ] All copy via i18n (en + beanie + zh); `npm run validate` green.

## Open questions (for greg)

1. **Step 1 CTA wording** — "Share & get invite link" (proposed) vs keep "Share with {email}". The former signals the next step better.
2. **Retitle step 2** "Magic Link Ready" → "Invite link ready"? ("magic" is cute but a bit vague.)
3. **Family name on the join subtitle** — confirm the family display name is available there; if not, I'll use a name-less welcome ("You've been invited to join your family 🎉").
4. **Filename display** — show the raw `.beanpod` name (e.g. `the-parkers.beanpod`) as-is, or prettify? Raw is most literally matchable in the Drive picker, so I lean raw/mono.

## Process

- Run through `/beanies-plan` (4-pass) before implementation, or greg approves as-is and I implement directly. Develop on `main`. **No deploy** until greg asks.

## Prompt Log

<details><summary>Initial prompt (via /frontend-design)</summary>

> A couple users raised issues about the family member invite process … (1) partner opened the Google Drive invite email and got stuck in Drive, missed the step-2 link/QR screen — make it clear the next screen has the real invite link and the Google email can be ignored, simply/concisely. (2) Another user unclear what to do after scanning the QR / opening the invite link ("pick from drive" CTA); the "you need a magic joining link from a family member" message looks like a stale leftover on the destination screen; make "pick from drive" clearly the required next step to access the family data file. Also: we know the beanpod filename here — should we instruct the user to select "xxxxx.beanpod" after clicking? Let me know your thoughts.

</details>
