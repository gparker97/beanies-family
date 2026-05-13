---
date: 2026-05-13
category: ui
issue: 'None — direct implementation'
plan: 'docs/plans/2026-05-13-onboarding-storage-nudge.md'
tags:
  [
    onboarding,
    create-pod,
    CreatePodView,
    LocalFileSyncWarning,
    google-drive,
    storage,
    frontend-design,
  ]
---

# Steer onboarding toward Google Drive + de-scarify the local-file modal

Make the create-pod "Save & Secure" step lead with Google Drive (a prominent card; local file demoted to a quiet link), and rewrite the local-file warning modal — drop the "local files are great for security" oversell, shrink it to three short lines, replace "Back" with a primary "Use Google Drive instead" + a quiet "Use a local file", keep the × at the top so the user is never trapped.

## Prompt 1 — 2026-05-13 (the proposal, via `/frontend-design`)

> Lately, several families appear to have started a pod using local file sync. I'm not sure if this is due to being fearful of using google drive or just misunderstanding the UI, but I think we should do more to guide all users to use google drive (and other cloud storage providers in the future).
>
> At the moment, if you select local drive in the onboarding wizard, you get a warning message: ["local file" — "local files are great for security but don't sync…" — "🔒 don't worry…" — "💻 multi-device sync via your cloud-storage folder works best on desktop chrome or edge…" — buttons "back" / "continue with local file"]. This message seems long and a bit scary - and the first line "local files are great for security" I think oversells local files, and the truth is, google drive is fine for security too… what would be your proposal to re-work this overall setup sequence to guide users more towards google drive, simplify and make the warning modal when local file is chosen much clearer, and rather than the options "back" and "continue with local file", perhaps we should change back to "use google drive", and also include a close button or element at the top of the modal so the user is not trapped. what are your thoughts?

→ Mapped the flow (the storage step is Step 2 of `CreatePodView`, not the onboarding wizard; `LocalFileSyncWarning.vue` is a `BaseModal` — so the × is already there, it's the buttons that are the problem; `LoadPodView` doesn't actually use the warning despite the stale doc-comment; the create-pod E2E bypasses the storage UI). Proposed: Drive becomes the headline option (a full-width card + "why" line + "Connect" affordance), local file a quiet "Prefer to store your data locally?" link; the modal drops the "great for security" line, shrinks to ~3 short lines, gets a primary "Use Google Drive instead" + a quiet "Use a local file", × stays as the back-out. Built a mockup (`/tmp/beanies-storage-onboarding-mockup.html`). Asked four questions.

## Prompt 2 — 2026-05-13 (answers)

- Step layout: option 1 (Drive hero + local link) — the link copy should be "Prefer to store your data locally on this device?".
- Modal: keep a short caveat line; the trade-off line should read "Your data stays on this device. To share with other family members, you will need to manually share the data file."; keep the reassurance line (encrypted either way / only viewable to those you share the file with).
- Modal title: "Heads up — local files don't sync".
- Existing-local-families nudge: not now — just the onboarding rework.

## Prompt 3 — 2026-05-13 (review pass 1 — DRY / no silent failures / simplicity)

> Review the plan again … most optimal and efficient way … capturing ALL errors and never letting anything fail silently … following all DRY principles … Check existing helpers/components … refactor into a generic item now …

→ Reuse: `<CloudProviderBadge>` (already in the Drive success modal), `<BeanieSpinner>`, the existing handlers (`handleChooseGoogleDriveStorage` / `handleLocalFileClick` / `handleChooseLocalStorage`) untouched, one `uiStrings` key shared between the modal button and elsewhere. Considered extracting a shared `<CloudStorageCard>` for `CreatePodView` + `LoadPodView` — declined (create-and-connect states vs. open-a-file-list states are different enough that it'd be a prop-heavy union; the card styling is already consistent via brand tokens). No new failure surface: the new `handleUseDriveFromWarning` is a one-liner that delegates to the already-fully-error-handled `handleChooseGoogleDriveStorage`; the rewritten modal and step are presentational; new `t()` keys are typed `UIStringKey` (typos = compile errors).

## Prompt 4 — 2026-05-13 (review pass 2 — sustainability / maintainability / reliability)

> Review the plan again with a focus on long term sustainability, maintainability, and reliability … Check for deep nesting, overly coupled structures, or any other complexity …

→ Added a `driveCardState` computed (`'idle' | 'connecting' | 'connected'`) so the Drive card branches with `v-if`/`v-else-if`/`v-else` instead of a nested ternary. Handled `!isGoogleDriveAvailable` (self-host without an OAuth proxy) gracefully — the step keeps the prior 2-card grid in that branch, and the modal hides its "Use Google Drive instead" button (via a `googleDriveAvailable` prop) so there's never a no-op button. Noted that extracting Step 2 into its own component is a worthwhile but separate refactor (the wizard's shared state would need careful threading) — out of scope here.

## Outcome

Implemented as planned. `LocalFileSyncWarning.vue` rewritten (💾-in-orange-squircle icon, "Heads up — local files don't sync" title, three short lines, `googleDriveAvailable` prop, `@use-google-drive` emit, stacked footer, doc-comment fixed). `CreatePodView.vue` Step 2: `driveCardState` computed + a full-width Google Drive hero card (idle/connecting/connected) + a quiet "Prefer to store your data locally on this device?" link → green "Saving to a local file" confirm; `!isGoogleDriveAvailable` keeps the prior 2-card grid; `handleUseDriveFromWarning` + the new prop/emit wiring. `uiStrings.ts`: 6 new + 4 changed `storage.*` keys; `zh.json` regenerated. New `LocalFileSyncWarning.test.ts` (5 cases, all pass). `npm run type-check` clean. CHANGELOG (2026-05-13). Plan: `docs/plans/2026-05-13-onboarding-storage-nudge.md`. (Follow-up parked: a move-to-Drive nudge for families already on a local file, using `migrateStorage`.)
