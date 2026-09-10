---
date: 2026-09-10
category: bug-fix, ux, i18n, testing
issue: none
plan: docs/plans/2026-09-10-unlock-step-framing-and-family-passphrase.md
tags: [login, credentials, passphrase, recovery-kit, i18n, code-review, testing]
---

# Credential verification, unlock-step framing, and the family passphrase

Follows `docs/plans/2026-09-09-credential-vocabulary-and-offer-correctness.md`, whose work
was pushed but never browser-verified.

## Prompts

### 1 — Session start

> /good-morning

### 2 — Verify yesterday's work (the session's real starting point)

> yesterday we built the password/passkey credentials fix and you created a full test plan
> (tho unfortunately i lost the test plan in the previous session's window).
>
> Can you propose and re-create the test plan, and how much of that test plan can you
> perform yourself autonomously, with playwright, browser testing, scripts, etc? can you
> please test as much as you can to validate the implementation from yesterday, and if you
> need me to do anything manually please let me know

The test plan was not lost: it survived as § Testing Plan in the plan doc. Recovered all 13
items rather than re-inventing them.

### 3 — Fix what the verification found

> yes, fix all three defects and write the missing staging tests

### 4 — Terraform (mid-turn)

> also go ahead to perform a terraform deploy if needed, don't forget to source
> ~/.tfvars.env first for the env vars

The file is `~/.beanies-tf.env`, not `~/.tfvars.env`. `terraform plan` reported "No changes"
— everything today is client-side, so no infrastructure deploy was needed.

### 5 — A question about the combined case

> one question - on my local dev family, it is a legacy family so i have a password but i
> also set a passphrase in settings. what is the expected login UI? askfor password, pass
> phrase, or both?

### 6 — Act on the answer

> make the label say "Password or recovery passphrase" when both exist

### 7 — The framing and the terminology decision

> one thing i think we should make clear - on the first screen when logging in, if you need
> to decrupt the file, we should make it clear to the user that this step is to decrypt the
> file (i.e. now let's decrypt your family beanpod file) - then it becomes clear, once it is
> decrypted, the next step is to login with the right family member. can we update the
> messaging, and consult /frontend-design:frontend-design if needed for the best UI, to make
> it clear that when the user sees a password/recovery passphrase screen, the goal is to
> decrypt the family data file (which also reinforces the messages that the file is your and
> encrypted) and only then they login as a family member.
>
> Also, let's settle on a single terminology for "passphrase" across the entire app so it is
> always consistent and clear. I'm thinking something like "recovery passphrase" or
> "decryption passphrase", as long as it is clear that the purpose of the recovery passphrase
> is to decrypt the family beanpod file, and this is clear for users whenever a relevant
> screen appears. what do you think?

Decisions taken via AskUserQuestion: term = **family passphrase** (over "recovery
passphrase", which collides with recovery kit / recovery code, and "decryption passphrase",
which is cold against the brand voice); scope = **copy plus light structure**, no new
components.

### 8 — Confirm before implementing

> let me confirm the copy changes once before you implement

### 9 — Amend the copy

> change "Unlock Beans's data" and "unlock my family's data" to "unlock my beanpod" and keep
> this consistent across the site for headings / titles, whereas in the subtitle/description
> we are clear about that being your family's data

### 10 — Ship it

> push it

### 11 — The reported bug that reopened everything

> i just checked now and after signing in with a passphrase and selecting my family member,
> I'm still directly given the option to set a new PIN - is this expected? i thoguht we
> should consider signing in with a passphrase the normal BAU activity - the user should just
> directly sign in with PIN after that. I would argue that the ONLY way they can reset their
> PIN at login is by using the recovery kit. what do you think?

### 12 — Take the stricter rule

> do both

### 13 — Review (mid-turn)

> once done, run a /code-review against the changes just made at the level you deem necessary
> to ensure everything implemented works as per the intended design and no new bugs, side
> effects, or security concerns were introduced, and to confirm all surfaces exhibit
> consistent behavior, copy, UI, etc. Fix any issues found.
>
> once done, run /end-session

### 14 — Sequencing

> ok halt the code review now then, make the change, and then re-start the code review as per
> my prompt above

## Outcome

Seven commits, `e8aaa4dd` → `be84c8db`, all pushed to `main`, none deployed.

Verification found three defects in the shipped-but-unverified 2026-09-09 work, and greg's
own testing then found a fourth that the fix for the third had missed. A `/code-review max`
found that fourth defect independently, via six of its finders, plus a test-validity gap
that had been hiding an English-only copy bug.

See `docs/lessons.md` (2026-09-10) for the two generalizable patterns.
