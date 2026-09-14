---
date: 2026-09-14
category: feature
issue: none (direct implementation)
plan: docs/plans/2026-09-14-magic-beans-one-surface-and-meter.md
tags: [magic-beans, ai, metering, pricing, dark-mode, lambda, terraform]
---

# Magic beans: one surface behind every door, and a countable bean

## Prompts

### 1 — Should every magic-beans surface work the way the FAB does?

> A minor change I'd like to make is to align all of the "magic beans" surfaces across the app.
> at the moment, there are a few places we can input data for ai - activities, travel plans,
> recipe, quick add FAB, and through sharing. as an example, at the moment (at least on desktop)
> if you click the magic beans button while in activities it just brings up a file picker, even
> though we could technically read the text of an invite (perhaps shared via whatsapp) and also
> infer it's an invite and create an activity.
>
> the quick add FAB is the most flexible of all of them and should allow any type of document or
> text and then it is inferred what it is - should we replicate this model to be the one we use
> across ALL magic bean surfaces? this would mean one entry to magic beans, regardless of the
> surface and regardless of how many features we add in the future? what are your thoughts
>
> /frontend-design:frontend-design in addition, if we simplify and move everything to one
> surface, what is the most fun, engaging, interesting and beautiful design for that surface to
> highlight the functionality and convenience and reduction of mental load we get from magic
> beans, wihle ensure it still remains functional and clear as the first priority? can you
> propose something?

Answer: six doors, two spines. The share target and the FAB already ran the flexible
`useSharedDocumentIngest` path; four pages pinned the extractor before the model had looked —
the question the AI exists to answer, and one a user can get wrong. Six real defects fell out
of the split (two capture locks that could not see each other, size checks on two doors of six,
a reader refused only after being billed, an activity reader with no telemetry at all, inverted
consent ordering, and four different "not recognised" behaviours).

### 2 — Caveat is fine for the tagline

> i'm ok with your suggestions. actually i would not consider 'give us something to read and
> we'll work out the rest' as help text, it is ok on my side to use caveat for this as it's more
> of a tag/decorative element. it's already clear for the user that they tapped this button
> because they want to use ai.
>
> i'm ok to make the caveat change and to add another decorative element to the page as per your
> suggestion

### 3 — Keep the title, and count every read

> Ok this looks good - one comment regarding the UI title and subtitle, let's keep the same
> 'magic beans' title at the top with the emoji since that's the name of the feature. for the
> subtitle, it can be 'give us something to read and we'll work out the rest'
>
> i would also suggest to remove the copy 'beanies can make' as i think it's inferred based on
> the UI layout and design / animatioon, and we already have 'working out what this is' at the
> bottom. [...]
>
> Together with this change, can we also ensure that every 'ai read' (i.e. every magic bean as we
> define it on the pricing page) is properly counted on a per family basis, so that going
> forward, once pricing is enabled, we can always count the number of ai uses per family per day,
> week, month, etc? consolidating everything to one surface (including sharing) should also
> deliver the goal of removing any loophole to use ai / magic beans without being counted. in the
> future we'll use this to retrieve a family's ai usage to determine if they are entitled to use
> more.

Answer: the count of record is written server-side by the `ai-extract` Lambda, one atomic
DynamoDB increment per successful 200, keyed on `sha256(familyId)` per the zero-retention
doctrine. Two counting decisions recorded as stated assumptions: an unrecognised `none` result
counts (we paid for the read), and the recipe video ladder counts as ONE bean even though it can
make several upstream calls.

### 4 — The bean watermark is pushing the title down

> the caveart looks bette rbut the large bean emoji doesn't look right, it's pushing the title
> halfway down the page for little benefit - perhaps we just remove this and stick with the caveat

### 5 — Shimmer the header, not the textarea

> one thought on the shimmer, rather than having it shimmer across the editable text (which seems
> a bit unconventional) should we put the shimmer across the title/subtitle instead? perhaps we
> could also add some subtle background color/flavor to the caveat row, or perhaps a subtle
> gradient across the overall drawer to provide just a little more subtle highlight / pop for this?

### 6 — Build it

> ok looks great, please commit the skill and let's test it - run /beanies-build-auto on the magic
> beans feature

### 7 — Reinstate "not right?", and make the correction free

> Let's ensure that the 'not right?' affordance is part of the feature [...] in the case that the
> model infers the wrong type of event, let's write logic to ensure that this is not counted
> against the user quote - if the model infers [wrong], allow another run without charging against
> quota but only after the user has explictly identified the correct category.

> Regarding change 4, i think this is important to build for the cases where we get it wrong, but
> as noted, at most it can only run 1 single additional run after confirming the user selected the
> category, so there should be nothing more than a single additinal run. if you identified a
> security issue or vulnerability would be interested to know the amount of risk it surfaces, and
> if needed propose some mitigating actions we can take

Answer: a client that can say "this one is free" IS the meter bypass. The exemption became a
grant the SERVER issues, stores and can spend only once, with five guards in one atomic
condition (exists, unspent, unexpired, different kind, same document). The source binding is the
load-bearing one: without it a 40-character text read buys a free 8-page PDF. Security summary
given: all four correction-path vulnerabilities were caught at design stage; the standing risk
is that `familyId` is forgeable (pre-existing), which caps what enforcement can be built on this
count until it is bound to an authenticated principal.

### 8 — Prod can't read anything

> just a question - at the moment it seems that i cannot read anything via ai in production - any
> document or text i enter i just get an error returned that says 'couldn't read that / something
> went wrong reading that. please try again.' is this due to the lambda or code changes already
> pushed?

Answer: no. Lambda, CORS, CSP, bundle URL, API Gateway (0 4xx/5xx) and the service worker were
all eliminated, proving the failure was client-local.

### 9 — It was my provider setting; make the error say so, and check the end time

> Ok - apologies, regarding the prod issue, it was my client side problem. for some reason, my ai
> provided had been switched to 'byok' rather than managed [...] one small suggestion iw oudl make
> here is to give a bit more info in the error message if it's available in the error response -
> i.e. instead of just saying 'something went wrong reading that' - could we include the error
> (i.e. invalid api key) and also indicate if the user is on managed or byok?
>
> one ohter thing i've noticed recently is that the response almost always gets the end time
> wrong. the start time is usually correct, but the end time seems to always be set for 1 hour
> after the start time rather than reading the actual end time from the document. can you check if
> this is a bug? while you're checking pls goa head to continue with implementation

Answer: a real bug, and reproduced. Vue's `pre` watchers are QUEUED, not synchronous: assigning
`startTime` from a prefill queued the "end = start + 1h" convenience watcher, `endTime` was then
set from the extraction, and the queue flushed afterwards and overwrote it. A document plainly
reading "2pm to 4:30pm" produced a 3pm end, every time, silently. Review later found two more
faces of the same bug — the `end < start` clamp was unsuppressed, so a prefill with no end time
collapsed to a zero-length activity and an overnight event lost its end entirely.

### 10 — Finish it autonomously

> continue with the client half and work autonomously as per /beanies-build-auto until
> impelmentation, review, and testing are fully complete. only pause if yuo need a manual action
> or answer from me due to a potential risk or unidentified issue

## Outcome

Shipped as four changes, in the deploy order the plan makes load-bearing: the server meter, the
prompt + spine prep, the doors and the surface, and the free correction.

`/code-review max` found 15 blocker-class defects and 24 below the line, none of them visible to
CI — the most serious being a z-index collision that made the consent prompt invisible behind the
magic-beans sheet (killing every in-app capture for any family that had not ticked "don't ask
again"), a deleted in-form reading overlay that left recipe-form captures with no feedback at
all, and a refused correction grant silently downgrading to a charged, unhinted re-read. Fixed
structurally rather than at the call sites: one `isReadingLocally` for both `presentation`
values, a dedicated `gate` stacking layer above `top`, a `finally` that refunds a spent grant on
every non-200 exit, and a 409 refusal in place of the downgrade.

The terraform apply that flips `CORRECTION_GRANTS` on and ships the Lambda was blocked by the
sandbox and is greg's to run.

---

# Session part 2 — the surface, the wall, and the arrows

Same day, after the meter and the correction shipped. greg ran the app locally and sent
findings; each one below is his, verbatim where it shaped the work.

### 11 — six changes to the magic-beans surface

> - let's update the text back to the original proposal, from 'did beanies get this wrong? this
>   one's on us..' -> 'not right? tell us what this is' <- link
> - let's move the 'not right?' nessage to the bottom of the resutls modal rather than the top as
>   i think that is a more natural place a user would look to correct an issue - after scanning
>   the details
> - on the 'what is this' modal - rather than opening a new modal, can we just expand / expose a
>   section with icons for activity/trip/recipe/etc (as required in the future) for hte user to
>   select? [...] this keeps the whole experience living within a single modal [...] ensure that
>   clear docs are written so that anytime an AI functionality is added, this surface is also
>   updated
> - also, the icons in the modal are greyscale rather than color, which feels a bit like they are
>   disabled
> - in the mockup there was an shimering type of animation that ran across the three magic bean
>   type boxes while the message said "working out what this is..."
> - in addition, in the mockup, magic beans and 'give us something to read and we'll...' is all on
>   the same line, within a gradient orange shimmering box

Answer: all six were real. The greyscale icons were `BeanieIcon` at 50% opacity inside a
`ChoiceModal` — genuinely the disabled treatment — and expanding in place removed the modal, the
second vocabulary and a stacking hazard together. The mockup's "shimmer" on the tiles is actually
a staggered opacity `tick`; the 105° sheen runs on the header band. `magicDestinations.ts` became
the add-a-new-AI-kind checklist, and every item on it fails the build.

### 12 — the empty header bar

> for the 'meagic beans' header in the sidebar, it seems strange that it's placed below the
> horizontal rule at the top of the sidebar, with the title space above the horizontal rule empty
> [...] should we place the full orange gradient box above the horizontal line?

Answer: greg caught a flaw in the fix mid-flight — removing the drawer title to get the band on
one line left an empty header bar. His proposal was right and needed `customHeader` to work on
drawers, a `BeanieFormModal` prop that until then was forwarded and silently did nothing there.

### 13 — the member filter

> at the moment i believe this is a single family filter, and hopefully it is a shared component
> so it is not repeated across the views. can we make this a multi-select filter

Answer: it WAS shared and already multi-select everywhere except the beanie wall, whose footer
was deliberately single-select for an unattended screen. Made multi-select with the reasons
answered rather than deleted. It also surfaced a live bug: the filter was never reconciled when
the roster changed under a mounted wall — and the review later found the SHARED store's
`syncWithMembers` had no caller at all, so the same defect was live on every finance page.

### 14 — night mode

> does the 'night mode' function on the beanie wall activate automatically [...] or does it
> always wait for the user to manually activate it?

> let's keep night mode as is for now, but to make it easier to reach, can we perhaps add a night
> mode button to the wall face? perhaps near (or within) the view selector?

Answer: manual only, nothing schedules it. That mattered, because the filter change had been
written up as "waking clears it overnight" — which is false. The comment was corrected rather
than the claim kept.

### 15 — the arrows

> often several steps at once [...] due to the length of the month name, or some other variable,
> the arrows change position, and when tapping in one spot all of a sudden the arrow position
> changes [...] the forward and backward arrow position should not change

> unless i'm wrong, it looks like the issue is already resolved on the mobile/app surface? i
> think the month name belongs as the first thing you see on the top left [...] can you review
> some conventional calendar designs and propose a design that is functional and conventional
> across the industry

Answer: greg was right that mobile was already correct, which reframed the whole thing. A
reserved label width was tried and REJECTED BY MEASUREMENT — no single number serves "April 2026"
and "Wednesday, 25 February 2026". Mockup + industry survey in
`docs/mockups/calendar-nav-stability-2026-09-14.html`; greg picked Option A.

Three separate things held the arrows to the label, each found by measuring rather than
reasoning: the cluster followed the title in the DOM; `sm:flex-none` is `flex-shrink: 0` so a
long title overflowed the row; and the left group had no `min-w-0`, whose default
`min-width: auto` is the content's min-content — the whole string, for a `truncate` title.

Prev-arrow x across six presses:

| view  | before                  | after   |
| ----- | ----------------------- | ------- |
| month | 473 438 438 438 438 438 | 615 × 6 |
| day   | 525 596 566 599 623 587 | 615 × 6 |
| week  | —                       | 615 × 4 |

## Outcome (part 2)

Shipped as `538b9ff6`, `6b0e2073`, `5ef2d395`, `c489a62d`, `8fa17fcb`. Two `/code-review max`
rounds; the second found thirteen, including a `length === 1` left in `WallLanesView` that made
multi-select lie to screen readers, a chip row that could clip a lit chip inside an
`overflow-hidden` root, `aria-hidden` set on a focused element, and the dead `syncWithMembers`.

---

## 2026-09-15 — the wait, and the meter check

**Prompt** (via `/frontend-design:frontend-design`):

> make one small change to the copy used on the 'counting beans' spinner used for magic beanes - for
> this one only (as an exception) rather counting beans, change the copy to 'counting magic beans' and
> add some kind of effect on the text to make it look special (i.e. a glimmering, shimmer, etc). i
> think it might look nice to also add ai emoji star flashes in the background, etc - making it look
> special. let me know your thoughts
>
> also - note that this morning i've used ai on my local dev family account exactly 2 times, on 2
> separate browsers. go ahead to confirm if it is working as planned. i can't test on native with the
> new code until we deploy. also confirmed the wall looks good on my local.

**Outcome.** `ai.processing` became `Counting magic beans…` / `counting magic beans…`. The key already
had exactly three call sites, all of them magic beans (the global reading overlay, the recipe form's
scoped overlay, the share target), so the exception is precisely scoped by construction — the app-wide
loaders are separate keys (`action.loading`, `common.saving`, `auth.loadingFile`) and are untouched.

The shimmer travels through the letterforms (`background-clip: text`) rather than across a box. The
box sheen is `.magic-shimmer`, and `MagicBeansSheet`'s header already records why it must never sit on
text: a sweep over type is the skeleton-loader convention and reads as "disabled".

The ✨ emoji idea became four drawn `clip-path` sparkles in Heritage Orange / Terracotta. An emoji is a
different picture on every platform, cannot take a brand colour, and scattered reads as clip-art.

**Meter verification.** Confirmed counting end to end, with two things worth knowing: the day key is
**UTC**, so greg's 06:00 SGT reads land on the previous UTC day's row; and CloudWatch shows **three**
successful reads in his morning window, not the two he recalls.
