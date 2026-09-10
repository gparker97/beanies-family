# Plan: Unlock-step framing and one name for the family passphrase

> Date: 2026-09-10
> Related issues: none (follows `docs/plans/2026-09-09-credential-vocabulary-and-offer-correctness.md`)

## Context

Two problems on the cold unlock surface, both raised by greg after the 2026-09-09
credential work shipped.

**1. The screen conflates two steps.** Opening a family has two distinct phases: decrypt
the `.beanpod` (a family-level secret: password, family passphrase, or recovery kit), then
sign in as a member (a person-level secret: PIN or biometric). The app already models this
exactly, and already says so — but only AFTER step 1 succeeds, at
`useLoginFlow.ts:994`: _"Recovery passphrase accepted — your family data is open. Now
confirm who you are to sign in."_ Before that point the screen is titled **"Sign In to
{familyName}"** with a **"Sign In"** button, which describes step 2 while performing step 1.

The same screen already contradicts itself: the secret form's button says "Sign In" while
the kit form's button, four lines below in the same component, says "Open My Family".

**2. "Passphrase" has no settled name.** An audit found 24 keys in `uiStrings.ts` using six
different noun phrases: "Family Recovery Passphrase", "Recovery Passphrase", "recovery
passphrase", "Password or Recovery Passphrase", bare "Passphrase" (Set/Change/Suggested),
and bare "passphrase". Worse, "recovery" is simultaneously the Settings section name, the
kit's adjective, the code's adjective and the passphrase's adjective, so a user holding one
credential cannot tell from its name which one they have.

Neither the CIG (`docs/brand/beanies-cig-v2.html`, Brand Vocabulary at `:720`) nor the theme
skill's enforced terminology table contains any credential term, so nothing governs this.

## Decisions (greg, 2026-09-10)

- **Term: "family passphrase."** Rejected "recovery passphrase" (collides with recovery kit
  and recovery code, and frames as break-glass when it is the normal route onto a new
  device) and "decryption passphrase" (accurate but cold against the brand voice on a
  high-anxiety screen). "Family" contrasts cleanly with the member-level PIN and frees
  "recovery" to mean only the printed kit.
- **Scope: copy plus light structure.** No new components, no step indicator.
- **Headings and CTAs name the object as `beanpod`** ("Unlock My Beanpod"), consistently.
  **Subtitles and descriptions** carry "your family's data" so the reader learns what a
  beanpod is from context.

## Approach

### The heading stops varying, and the family name moves down

`unlockTitleWithFamily` ("Sign In to {familyName}") is retired. The heading is always
"Unlock My Beanpod"; the subtitle carries the family name, which is where the reassurance
belongs anyway:

> **Unlock My Beanpod**
> This decrypts {familyName}'s family data. Next, you'll sign in as a member.

### The subtitle becomes credential-neutral

Yesterday's work added `unlockSubtitlePassphrase` and `unlockSubtitleEither` so the subtitle
could name the right credential. Framing the subtitle around the STEP rather than the
credential removes that need entirely: the field label directly below already names the
credential. Both keys are deleted. This is a strict simplification and removes the drift
class that produced the original bug.

### One verb across both forms

Secret form and kit form both submit with **"Unlock My Beanpod"**. `recovery.unlock`
("Open My Family") and `loginV6.unlockButton` ("Sign In") converge.

### The footer keeps its capability-awareness

It is the one line that names the credential, so it stays derived from `secretField`:

| Envelope   | Footer                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| password   | Your password decrypts this beanpod on this device. We never see it and can't recover it.          |
| passphrase | Your family passphrase decrypts this beanpod on this device. We never see it and can't recover it. |
| both       | Either one decrypts this beanpod on this device. We never see it and can't recover it.             |

### The rename

`Recovery Passphrase` → `Family Passphrase` across `uiStrings.ts` and
`src/content/help/security.ts`. "Recovery kit" and "recovery code" keep their names.

**Not renamed** (deliberately): the `recoveryPassphrase` envelope field
(`syncFileV4.ts:97`, on-disk format), the `'passphrase'` `ProveMethod` kind, the telemetry
`detail:` encoding, `passphraseStrength.ts`, and the `password-recovery` help slug (a live
URL with two internal inbound links).

## Files affected

- `src/services/translation/uiStrings.ts` — rename ~20 values; delete
  `loginV6.unlockTitleWithFamily`, `loginV6.unlockSubtitlePassphrase`,
  `loginV6.unlockSubtitleEither`; add `loginV6.unlockSubtitleWithFamily`
- `src/components/login/LoadPodView.vue` — heading loses its ternary; `secretField` drops
  its `subtitle` member; kit-form button key changes
- `src/content/help/security.ts` — the six sentences that put "recovery kit" and "recovery
  passphrase" side by side
- `public/translations/zh.json` — regenerated, then read
- `src/components/login/__tests__/LoadPodView.credentialSurface.test.ts` — assertions follow
  the new copy
- `.claude/skills/beanies-theme/SKILL.md` — add the settled credential vocabulary to the
  enforced terminology table, so this cannot drift again

## Deliberately out of scope (raised, not actioned)

- **The Chinese is broken well beyond the passphrase** and needs its own pass:
  `recovery.kitTitle` renders 恢复**试剂盒** (a laboratory reagent kit), `resetPinBody` says
  康复工具包 (a _rehabilitation_ kit), the kit code is 救援码 ("rescue code") in one string
  and 行程码 ("itinerary code") in another, `passphraseIsSet` calls the family 系列
  ("series"), and two passphrase strings drop 恢复 entirely, becoming character-identical to
  the password.
- **`web/src/pages/help/glossary.astro:104-112`** uses "passphrase" to mean a per-member
  password, the opposite of the in-app meaning. Four occurrences.

## Acceptance criteria

- [ ] The unlock heading is "Unlock My Beanpod" for every envelope shape and every family
- [ ] The subtitle names the family and the next step, and names no credential
- [ ] Secret form and kit form submit with the same verb
- [ ] The footer still names the credential the envelope actually accepts, all three cases
- [ ] No string anywhere renders "recovery passphrase"
- [ ] "Recovery kit" and "recovery code" are unchanged
- [ ] The `recoveryPassphrase` field, `ProveMethod` kind and help slug are untouched
- [ ] `npm run translate` round-trips and the new zh values are READ, not assumed
- [ ] Full suite, `type-check`, `lint`, `security:lint` green
- [ ] Verified in a real browser at desktop and mobile widths, light and dark

## Testing Plan

1. Extend `LoadPodView.credentialSurface.test.ts`: heading constant across all four shapes;
   subtitle names no credential; footer still capability-correct.
2. Grep acceptance: zero occurrences of "recovery passphrase" in shipped copy.
3. Browser: all four envelope shapes at 1280px and 390px, light and dark.
