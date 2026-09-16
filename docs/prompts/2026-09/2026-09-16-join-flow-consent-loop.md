---
date: 2026-09-16
category: bug
issue: None — direct implementation
plan: docs/plans/2026-09-16-join-flow-consent-loop-and-picker-retirement.md
tags: [join-flow, oauth, google-picker, drive-file, recovery-kit, unclaim, ios]
---

# The join-flow consent loop, and the four bugs behind it

## Prompts

### 2026-09-16 — initial

> ok - once the commit is done, let's now address some user feedback regarding the family member
> joining process [user feedback pasted: a joiner on iPhone bounced between Google consent and the
> join card indefinitely; no beanpod visible in their Drive].
>
> please perform a full, thorough, comprehensive analysis of this issue, use as much time / agents
> as you need to ensure you have the full picture, and prepare a detailed report and plan to
> definitively fix the issue. once the plan is built, proceed to implement the fix via
> /beanies-build-auto and validate, test, check in browser, etc as needed to ensure the fix works
> reliably across all surfaces, browsers, etc to the fullest extent possible. work autonomously,
> and if you need anything from my please ask questions now.

### 2026-09-16 — clarification

> note that i've already informed the user that you would not expect to see a beanpod file in their
> google drive, but you should see it in the 'shared with me' section, so that is expected behavior

### 2026-09-16 — decisions (AskUserQuestion)

> **Picker scope**: "Let's do (1) retire it everywhere - i prefer not to use the picker if we can
> avoid it … which seems legacy and buggy, and a huge inducer of friction to both joining and
> inviting family members to the app."
>
> Revised after being shown that under the `drive.file` scope the Picker selection IS the access
> grant, so `files.list` is blind precisely where the three "retire me" sites sit: **keep the
> Picker for join only, retire the other three**, and detect + explain the dev-build missing-key
> case.
>
> **Kit PDF**: in scope, fix here. **Validation**: greg tests on device / second account.

### 2026-09-16 — go

> once done go direct to implement and validation with /beanies-build-auto

### 2026-09-16 — two more bugs, reported mid-implementation

> keep going autonomously and continue until implementation and validation is complete — i've also
> noticed that with the sharing family i just implemented, the family member was marked as joined
> even though the process never succeeded, and i can no longer crewate a joining link for that
> person. also, when logging in now as the pod owner with the recovery kit, and after creating a
> new PIN, the owner had no permissions in the new pod. only after signing out and signing in again
> did the family owner now have permissions to edit existing dfamily members

### 2026-09-16 — the unclaim path

> should we also fix the case where a member join does not fully complete marking the member as
> joined? a member join may fail for any reason - the google picker drive failing is one scenario,
> but a join process may fail for other reasons. has this also been addressed - why are we marking
> a member as joined immediately, rather than waiting for the process to be confirmed successful?
> also i agree to add an unclaim path so i can re-invite a person who was marked as joined - this
> could be useful not only if they were mistakenly marked as joined but if they lost their link
> without finishing the joining process, etc

### 2026-09-16 — finish it

> keep going, add the unclaim UI then finish validation

### 2026-09-16 — the review gate

> has the code review cycle been run as per /beanies-build-auto ?
>
> as per the skill fix whatever it finds then commit

### 2026-09-16 — dev-environment question (answered inline, no code change)

> also note - i've added the lines VITE_GOOGLE_API_KEY and VITE_GOOGLE_PROJECT_NUMBER to .env.local
> but i'm still getting the invalid developer API key error. can yo uconfirm what values should go
> here, and do i need to do something so these values are re-read?

## Outcome

Five user-visible bugs fixed, plus fifteen defects closed from a `/code-review max` round.

**The root cause of the reported loop** was a single inverted flag. `requestAccessToken`'s
`forceConsent` mapped to `prompt=consent`, which re-asks permission on the account already signed
in and _suppresses_ Google's account chooser — the exact opposite of what its name and every call
site assumed. `useJoinFlow` set it on a first-join 404, which skips the silent-token fast path,
which on any redirect-auth platform (iOS, iPadOS, installed PWA, native) fires a full-page
redirect instead of opening the Picker. The joiner came back, hit the same 404, and looped.

The fix is structural rather than per-call-site: the flag is now `chooseAccount`, it means what it
says, and it bypasses _every_ silent path (cached token, refresh token, silent auth-code) because
anyone reaching "sign in with a different account" is by definition already signed in and each of
those would otherwise hand back the account they are escaping. Both redirect paths (web and
native) now thread the prompt through instead of hardcoding `consent`.

**The claim bug** was fixed by ordering, not compensation. A first attempt kept the claim first and
rolled it back in the catch; that has two holes (the rollback can fail, and it left the session
authenticated with the credentials gone). `joinFamily` now does every fallible step before writing
`pinHash`, so a failure below leaves the member unclaimed and simply retryable, and there is
nothing to roll back. `unclaimMember` is the manual remedy, manager-gated with no bypass, and it
retires the envelope's `wrappedKeys` / `passkeyWrappedKeys` as well as the hashes — clearing the
hashes alone would undo the label and none of the access.

**Not done here**: the same `forceConsent` inversion still sits under `GoogleDriveProvider.createNew`
and `syncStore.listGoogleDriveFiles({ forceNewAccount })`, whose own doc comments claimed an
account chooser they never showed. Behaviour there is unchanged and the comments now say so;
switching them changes the create-a-pod and Settings-restore flows, which is outside this work.

**Owed by greg** (cannot be done programmatically): a real two-account join on an iPhone, the kit
PDF in his own Firefox, and clearing the stuck member with the new unclaim button.

### 2026-09-16/17 — the Picker diagnosis (a live back-and-forth, paraphrased)

> also note - i've added the lines VITE_GOOGLE_API_KEY and VITE_GOOGLE_PROJECT_NUMBER to
> .env.local but i'm still getting the invalid developer API key error.

> the string "localhost:*" is already under the websites list, do i also need to add
> localhost:5173? i'm pretty sure this used to work from my local

> i've made the change and restarted the dev server but still getting the same error ... note
> that i'm running edge in private mode, not sure if that matters

> i've tested with a new account. i cannot see the file OR the folder in the file picker, even
> if i clear the search filter, however when i look on google drive on the web, I now CAN see
> the shared beanpod file in the shared with me section

> [after signing out of all accounts] that was the issue - after signing out from all accounts
> and then trying the joining link again, the beanpod file was listed in the file picker and i
> could set a pin.

> ratehr than forcing a user to sign out of their existing accounts, which is extremely annoying
> and troublesome, isn't there any way we can force the picker to open the drive of the google
> account that JUST granted consent?

### 2026-09-17 — the review rounds

> once done run another /code-review max against all changes and commits made in this session
> and fix any issues found to ensure that everyting implemented today is robust, once done
> commit and push all changes and run /end-session - capture all context and anything pending to
> start in the next session ina fresh context.

> Commit all the picker work and everything just implemented and old ensure that is all included
> in the code review

> Go ahead and work autonomously as I'll be stepping away now. Ensure all issues are fixed and
> you are satisfied with that implementation or go ahead to run another review and end session
> when done

## Outcome addendum

The Picker diagnosis took five wrong hypotheses before the right one, and greg's clean-account
test is what settled it. Recorded in `docs/STATUS.md` (2026-09-17) and in the session memory,
because the same symptom has now produced three `fix(picker)` commits in this repo's history.

Wrong hypotheses, in order: a missing env value (it was already in `.env`); an invalid API key
(valid); a blocked HTTP referrer (real, and fixed, but not the cause of the empty list); Edge
InPrivate blocking third-party cookies (plausible, not it); `setQuery('*.beanpod')` being an
unsupported glob (it works, and I nearly "fixed" a working line). The cause was the Picker iframe
listing the browser's default Google session.

Five commits: `ee47d778`, `0a064b2a`, `46320057`, `255e831a`, `9b6f6158`. Two `/code-review max`
rounds, 30 findings, all triaged; three left open as greg's decisions and recorded in STATUS.
