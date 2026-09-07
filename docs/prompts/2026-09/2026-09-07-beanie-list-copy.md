---
date: 2026-09-07
category: feature
issue: Notion #91
plan: docs/plans/2026-09-07-list-copy-for-beans.md
tags: [lists, chores, crdt, automerge-batch, accessibility, dry, concurrent-session]
---

# Beanie List copy — one bean or several

Ran alongside a second session working on pod compaction and beanpod sync in the same
checkout, which shaped several decisions (see Outcome).

## Prompts

### 1 — 09:xx — session start

> /good-morning — note that i'm running anotehr session now working on data file compaction
> and other beadpod related issues. we'll be working alongside that session

### 2 — the idea

> Let's make some small improvements to beanies lists - for chores, I realized that a lot of
> families duplicate the same list of chores for all kids, but there is no capability as far
> as I can tell to duplicate a list or create a list as a temoplate in beanies. My suggestion
> is to add the ability to copy / duplicate an existing list to new list. I also think it
> would be useful to be able to save a list as as a template in beanies. what are your
> thoughts and how could this work?
>
> Also Since there's another session ongoing building onto main, should we work on a branch
> and merge later or what would you suggest?

### 3 — intake

> sure run the proposal through /beanies-pre-plan

Answers given to the clarify round: scope **duplicate + multi-bean copy only** (the
"your own lists as seeds in NewListSheet" option deferred); priority **Normal**; **no
feature gate**; isolation **worktree**.

### 4 — isolation, re-decided

> how does a worktree work? note that you are on the same machine as the other session

After the 1.5 GB / full `npm install` cost was spelled out, changed to **stay on `main`
with narrow, explicit-path commits**.

### 5 — the UI correction

> rather than having a "copy this list.." "delete this list.." affordance at the bottom of
> the drawer (where there is already a delete icon and close button) should we just have
> copy/delete icons at the top right of the list cards? this also follows the convention for
> the family member listing (which has edit/share/delete icons)

### 6 — go

> sure let's go with this and direction A. go ahead with pre-plan and /beanies-plan once
> ready. once the plan is complete proceed to implementation, and once done run a code review
> against the completed implementation to ensure it was implemented accurately and as per the
> plan and does not introduce any new bugs, side effects, or security issues, and fix all
> issues found.

### 7 — commit

> you can go ahead to commit your changes

### 8 — verification

> note that i checked the list copy changes in local and they look good

### 9 — wrap up

> /end-session — capture all changes made and ensure all changes are committed but do not
> push yet as i will push in the other session

## Outcome

Shipped as `f55921a4` (feature) + `68cae7c1` (code-review fixes) + `0195419b` (status).
**Committed, not pushed** at greg's instruction — he is pushing from the compaction session.
Greg verified the flow locally.

### What greg's correction changed

Prompt 5 was right and it was not cosmetic. Following `BeanCard`'s convention forced
`ListTile`'s root to stop being a `<button>` (no nested interactive content), which in turn
forced the stretched-overlay pattern to keep the tile keyboard-operable — `BeanCard`'s own
`<article @click>` is not, so the convention could only be half-copied. It also exposed that
the scope item about "removing redundant action rows from the bottom of `ListDetailModal`"
described rows that never existed in the code; they had only ever appeared in my first
mockup, and I had carried that fiction into the intake.

### What the four-pass plan discipline actually caught

Each pass found something the previous one had asserted confidently and wrongly:

- **Pass 2** — the draft claimed no batch/transaction API existed and built a whole
  partial-failure design on it. `{ op: 'batch', ops }` is in `worker/protocol.ts:127`, and
  `docOps.ts:676-679` documents the atomicity outright. `listRepository.ts` is 15 lines of
  thin re-exports, so the capability lives one layer below where I looked, and
  `listCycleRepository` had been using it in three places. Also corrected a
  `useConfirm({...})` signature that does not exist.
- **Pass 3** — `wrapAsync` returns `T | undefined`, so the modal's `=== null` check would
  have read a hard failure as success; `createdBy` is required and was never specified; and
  an `lg` size on `ActionButtons` would have rendered a 24px glyph because its size scale is
  not `BeanieIcon`'s.
- **Pass 4** — a focus ring clipped to nothing by the root's `overflow-hidden`; a
  `useFormModal` reset that never fires unless the modal stays mounted (its `watch` is not
  `immediate`); and an unset/unbound `isSubmitting` that let a double-tap create 2N lists.

### What the code review caught after that

Five findings in the shipped code, one serious: `createLists` verifies the projection **after**
the batch commits, yet the store reported and toasted "nothing was created", which invites a
retry that makes a second set of copies. Now a typed `ListsNotVisibleError` → `verify-missing`
with its own message. Also: `wrapAsync` toasts `e.message` verbatim, so a raw member id was
reaching users; and `deleteList` returned `false` both when it refused and when it threw, so a
rejected delete produced two stacked toasts.

### Pre-existing defects fixed in passing

- `listStore.deleteList` returned `false` without throwing when the list was already gone, and
  `ListDetailModal.handleDelete` discarded that boolean and closed the drawer anyway. A live
  silent failure of exactly the class `useMemberRemoval` was written to close.
- `ActionButtons`' buttons carried no `type="button"`, so inside a `<form>` they submitted it.

### Working alongside a second session

Everything was committed by explicit path; `git add -A`, `stash` and `reset` were never used.
The prediction that `uiStrings.ts` would be the one collision point held — and it resolved in
the unexpected direction: the other session's commit `652c7669` swept in my strings before I
reached them. They landed intact, so nothing was lost, but the lesson is that "append-only file,
merges cleanly" is about _content_, not about _who commits it_.

### Deferred deliberately

Persisted user-saved templates. `isTemplate` on `FamilyList` was rejected on evidence rather
than taste: `reconcileRecurringLists()` iterates every list with no exemption, so a recurring
"template" would reset on schedule and write permanent `ListCycle` records for a list nobody
ticks — and cycle history is never truncated.

### Still owed

The push; dark-mode and 360px-mobile visual checks on the new tile cluster and copy modal.
