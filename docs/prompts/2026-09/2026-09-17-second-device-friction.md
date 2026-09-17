---
date: 2026-09-17
category: design
issue:
plan:
tags: [auth, onboarding, join-flow, recovery-kit, device-link, passphrase, adr-034]
---

# Second-device sign-in friction after the password to PIN migration

## Prompt 1 — 2026-09-17 (morning session)

> In the previous session we worked heavily on the fixing the joining process for new family
> members.
>
> while we're working on the creation and joining process, I think we need to address a friction
> issue with joining that has impacted us since we migrated from passwords to PINs.
>
> Previously, a password was created that could decrypt/unwrap the family file. Now, with each
> family member only having a PIN, families get a recovery kit rather than a password, and to
> create a passphrase, they need to go to the settings menu and explictly create a passphrase. So
> to login on another device, they either need to create a link (which is not clear), use a
> passphrase (if it exists) or use the recovery kit (which resets the existing PIN).
>
> In practice, this means that this scenario is possible:
>
> - user creates a family pod on desktop and creates a PIN
> - user installs app and tries to login, and is asked for recovery kit as no passphrase exists
> - User types in recovery kit (assuming they have it) - which is a long and slow process, and the
>   PIN just created a moment ago has now been reset
>
> This process makes no sense to me at all - it's confusing and a huge source of friction. new
> joiners would regularly join on one surface and then open another (i.e. browser site to app,
> browser to pwa, etc).
>
> Joiners to the family are generally OK as they are given a link to join, but would hit exactly
> the same issue if they join on one surface (i.e. the app) and then try to login to the desktop
> site. and in this case it could be even worse as they are not the one who saved the recovery kit.
>
> We need a clear, seamless, frictionless process for pod creation and family invites - right now
> that is one of our biggest areas of leaking for new families. I wouldn't be surprised if a large
> percentage give up on beanies once they hit these barriers.
>
> I'm open to any ideas - what would be your suggestions to address these issues and make the pod
> creation and joining process simple, seamless, and intuitive?
>
> To me, two huge gaps are that after a typical family creation process, the user would not have
> created a passphrase yet (and would also not know to create a joining link) and the recovery kit,
> which is the only otion they have does not have any option other than to reset the PIN they just
> created.
>
> What about if we (1) make creating a family passley / passphrase a prominent, non-skippable part
> of the pod creation process, and (2) make resetting the PIN optional when using the recovery kit?
> and / or - provide a link or QR code (valid for 24h / 48h etc) that the new joiner can use to
> login to any other device easily (which takes them straight to PIN entry for their own family
> member). As part of this option, rather than forcing hte user to reset the PIN anytime the
> recovery kit is used, it simply surfaces an option/affordance that allows the users to reset
> their PIN if desired.
>
> another option might be to give them the ability to generate a magic link anytime simply by
> verifying their email and/or phone (i.e. send a magic link to my email or phone/whatsapp/etc) -
> although this would probabl4y involve setting up some AWS SES email infra, or something to that
> effect.
>
> Open to any other thoughts and suggestions as well.

## Investigation (2026-09-17)

Three Explore sweeps mapped the credential model, the cold-device sign-in UX, and the
creation/invite flows. Findings, all cited to code at HEAD `1f07acfb`:

**Root cause.** A kit-born family has exactly one envelope wrap and it is the recovery kit
(`syncStore.ts:2856-2867`, `wrappedKeys: {}`). The PIN is device-local by construction
(`deviceUnlock.ts`), so it cannot travel. For every family created since Phase 4 the kit is
therefore not the last-resort path to a second device, it is the only path. A disaster-recovery
instrument became the front door.

**Premise corrected.** The kit does NOT reset the PIN. It lands the user on a reset-PIN pane
(`ProveView.vue:99-108`) which they generally fill in. After a kit unlock the pod is open, so
`proveMethods.ts:210` offers `{kind:'pin', hasDeviceWrap:false}` and "Sign In with PIN" is present
in `switchTargets`, just quiet. The reset is a default landing, not a crypto requirement. The one
genuinely forced case is a member with no PIN at all, where `switchTargets` is empty.

**Worse than reported: joiners have no envelope credential at all.** `useJoinFlow.ts:1035-1042`
("NO envelope wrap is created any more"). No kit, no passphrase. They are doubly excluded from the
kit prompt: `authPrompts.ts:88` gates on `canManagePod` (defaults false for members created by
`CreateMembersStep`, `familyMemberRepository.ts:43`) and `:89` suppresses on the family-wide
`recoveryKitConfirmedAt` the creator already stamped. A joiner on a second device needs another
person to resolve it.

**The copy at the moment of friction is wrong.** `LoadPodView.vue:1577` renders the "Can't unlock
this beanpod?" card on `v-if="syncStore.hasPendingEncryptedFile"` with no capability gate, so a
returning member reads `loginV6.unlockNoPasswordHint`: "This file contains another family's
encrypted data. To join, ask the family owner to send you an invite link." Deliberately
credential-neutral per the code comment, but written for the stranger case.

**The kit confirm is unverified.** `RecoveryKitDisplay.vue:143` is an unclosable modal, but the
exit is "I've stored my kit somewhere safe" with no check that Save-as-PDF or Share was pressed; a
PDF failure explicitly never blocks it. An unknown fraction of families hold no kit.

**New families never see the device-link release note.** `useNotifications.ts:119-125` marks every
release note read on family creation; `deploys.ts:423` carries "Link a new device in seconds".

**Device linking already exists**, `DeviceLinkCard.vue`, 15-minute TTL, QR + link, `lk=1` serves
the full person picker for already-claimed members. It is the third card inside Settings →
Security & Recovery, whose description does not mention devices.

**On the proposed 24-48h TTL.** `isInviteExpired` (`useJoinFlow.ts:810-813`) is a client-side
policy check; the AES-KW wrap has no time binding, and `envelopeMerge.mergeKeyDict` is a union so
the entry can never be deleted. A minted link is permanently valid key material gated by an honest
client checking a date.

**Side finding.** Invite tokens are not single-use, nothing prunes `inviteKeys`, and
`useInviteFlow.ts:104-108` deliberately reuses one token across recipients with only `hint`
differing.

**Supporting metrics** (same-day `/beanies-metrics` run): 84 real families, 26 registered and never
truly engaged, create-family flow converts 53% of starters.

## Recommendation made (not yet approved)

1. Fix the unlock-screen copy.
2. Give every member their own recovery kit at join time (`recoveryKeys` is a dict,
   `recoveryKit.ts:140-158` tries every entry; 160-bit each so the file's floor does not drop) and
   ungate the kit prompt from `canManagePod`. The passphrase cannot do this job: single family-wide
   field, newest `createdAt` wins, so a joiner would clobber the owner's.
3. Stop landing kit users on "Set a New PIN".
4. Make the kit confirm mean something; surface device linking at the end of creation.
5. Add a passphrase rung to the `authPrompts.ts` ladder rather than lengthening a wizard that
   already loses 47% of starters (also preserves the 2026-08-28 decision to keep the ~32-bit
   passphrase opt-in).

Argued against: mandatory passphrase at creation, a 24-48h link TTL, and the SES magic link.
Raised but not recommended: a Drive `appDataFolder` bootstrap wrap (opt-in, changes the threat
model from "Google compromise yields an encrypted file" to "yields the key", needs the
`drive.appdata` scope).

## Prompt 2 — 2026-09-17 (design direction, after the investigation)

> yes, take it to /beanies-pre-plan - let's issue the individualilzed link that takes the user
> direct to their PIN entry for all users, both owners and joiners, and make it very clear to save
> that link as it is their way to unlock the family file and sign in with their PIN, and also let
> them know the link can be revoked and created again in settings if needed, but if you lose it
> you'll need the family owner to help you sign in on a new device (or if you clear cache on your
> old device) - or something to that effect. do not make the copy to long or technical - very
> clear, concise, brief, accurate to the point, no beanies cutesy language for this.
>
> as part of this work let's also fix the recovery kit interface to make PIN reset optional -
> rather than forcing a PIN reset just expose the usual PIN entry interface, but surface an
> affordance that allows a user to reset their PIN if desired, not mandatory, that only appears
> when recovery kit is used.
>
> as a follow-up to this change we'll add the ability to send the magic link to your email (or
> perhaps sms/whatsapp) as well, so build this change with that ultimate capability in mind.
>
> work autonomously and go ahead to /beanies-pre-plan then /beanies-plan directly, then
> /beanies-build-auto - any questions you have ask my now as i will be away. do not pause during
> the build unless necessary.

## Prompt 3 — 2026-09-17 (naming)

> let's call it 'your beanies magic link' in all copy - to make it clear the link is for beanies,
> and it's their personal link, and they should save or bookmark it on a trusted device only
>
> because it unlocks their family file

## Decisions taken 2026-09-17

Four asked and answered before greg went away:

1. **Creation flow** — the mandatory unclosable recovery-kit step stays exactly as ADR-034 has it;
   the magic link is presented on the SAME screen as one combined "save these" step with a single
   confirm. Rejected: demoting the kit to a nag (would leave a new family with no PIN-reset path),
   and two separate mandatory steps (worst for the 53% completion rate).
2. **Unlock-screen copy defect is IN SCOPE** (`LoadPodView.vue:1577`).
3. **Naming: "your beanies magic link", verbatim, in all copy.** This is a DELIBERATE EXCEPTION to
   CLAUDE.md's terminology table, which lists standalone "beanies" as incorrect. greg chose it
   twice with reasons: it marks the link as beanies', as personal, and as the thing that unlocks
   the family file. Do not normalise it to "magic link".
4. **If `/beanies-build-auto`'s browser verification surfaces a judgement call, STOP and wait.**
   This overrides the general "do not pause during the build" instruction.

Additional copy requirement from prompt 3: tell the user to **save or bookmark it on a trusted
device only**, and say why (it unlocks the family file).

## Verified this session (so the plan need not re-derive)

- `reEncryptEnvelope` is a `{...envelope}` spread (`fileSync.ts`), so an additive-optional dict
  SURVIVES an old client re-writing the file. The real drop risk is `envelopeMerge.mergeEnvelopes`,
  which names each dict explicitly and silently discards any it does not name (Pass-4 note).
- `mergeKeyDict` is `{...remote, ...local}`: a deletion cannot propagate, but an OVERWRITE AT THE
  SAME KEY does. Hence keying the new dict by `memberId` rather than token hash is what makes
  revocation possible at all.
- `DeviceLinkCard` has NO `canManagePod` gate, only `syncStore.familyKey`. Any signed-in member,
  joiner included, can already mint a device link. An earlier claim in this session that joiners
  were structurally stranded was too strong and is corrected here: the common case is
  discoverability, and the genuine dead end is narrower (a joiner whose only device is lost or
  signed out).

## Outcome

Pending. Greg to choose between pulling `login-flow` CloudWatch telemetry first
(`prove_outcome` by method on cold devices, `device_link_minted`; note device links have no
success denominator per `useJoinFlow.ts:871-884`) or going straight to `/beanies-plan`.

In progress 2026-09-17: ran `/beanies-pre-plan` (PASTE mode, no tracker row), mockups at
`docs/mockups/beanies-magic-link-2026-09-17.html`, then `/beanies-plan` and `/beanies-build-auto`.
No deploy: `/beanies-build-auto` stops at reviewed, verified code.

---

## APPROVED COPY (greg, 2026-09-17: "The copy looks good. It's approved for now.")

Surface-by-surface, final. Non-playful throughout; `beanie` values keep the real nouns and only drop
case, per CLAUDE.md's beanie-mode floor (auth + data-loss surface).

### A. Creation, combined save step

- Title: **Save these two things**
- Subtitle: **{familyName} is ready.**

Recovery kit card:

- **Your recovery kit**
- Opens your family file if you lose your PIN or your devices. **It does not expire.**
- _Shown once. You can create a new kit in Settings._

Magic link card:

- **Your beanies magic link**
- This link unlocks your family file. Open it on a new device and sign in with your PIN.
- **Use it within 7 days. Anyone with this link can open your family's information, so keep it on a
  trusted device.**
- _Creating a new link cancels this one._

- Confirm: **I've saved both**

### B. Join screen

- **Your beanies magic link**
- This link unlocks your family file. Open it on a new device and sign in with your PIN.
- Use it within 7 days. Anyone with this link can open your family's information, so keep it on a
  trusted device.
- Need a new one? Create it in Settings on a device where you're already signed in.
- If you can't get in at all, ask the family owner to help.
- Confirm: **I've saved my link**

### C. Settings card

Idle:

- **Your beanies magic link**
- A link that unlocks your family file so you can sign in on a new device with your PIN. Lasts 7 days.
- Status: _No active link._ / _One link active, expires {date}._ / _Your last link expired {date}._
- Button: **Create a magic link**
- Creating a new link cancels your current one.

Just created:

- This link unlocks your family file. Open it on a new device and sign in with your PIN.
- Use it within 7 days. Anyone with this link can open your family's information, so keep it on a
  trusted device.
- **This is the only time it will be shown.**

### D. Recovery kit arrival (Phase 2)

- Unchanged: "Welcome back, {name}", "Enter Your PIN", "Sign In with PIN"
- New, visually subordinate: **Forgot your PIN? Reset it**
- Reset pane body (replaces the forced-arrival wording): **Set a new 6-digit PIN. Your old PIN will
  stop working.**

### E. Unlock screen defect (Phase 3) — replaces `loginV6.unlockNoPasswordHint`

- **Can't unlock this beanpod?**
- You'll need one of these: a magic link, a recovery kit, or an invite link from someone in the
  family.

### F. Failure messages

| Situation                                 | Message                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Link expired (`token-expired`)            | This link has expired. Create a new one in Settings on a device where you're already signed in.             |
| Link cancelled (`link-revoked`)           | This link has been cancelled. A newer one was created. Ask a signed-in device in your family for a new one. |
| Family key rotated (`key-rotated`)        | This link is out of date. Ask a signed-in device in your family to create a new one.                        |
| Not found (`no-entry`)                    | We couldn't find this link. Ask a signed-in device in your family to create a new one.                      |
| Incomplete (`no-member-param`)            | This link is incomplete. Ask for a new one.                                                                 |
| Wrong Google account (`file-unreachable`) | Can't open your family file with this Google account. Try a different account.                              |
| Mint failed (`publish_failed`)            | Your link wasn't saved. Check your connection and try again, or create one later in Settings.               |
| Copy failed                               | Couldn't copy. Select the link and copy it manually.                                                        |

**Standing rule**: every failure names the way out, and none of them says only "create a new one in
Settings" — a person holding a dead link is on a device that cannot self-serve, so the route is
always "a device where you're already signed in" or "ask someone in your family".
