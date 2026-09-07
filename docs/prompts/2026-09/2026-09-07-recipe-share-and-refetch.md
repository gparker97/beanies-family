---
date: 2026-09-07
category: feature
issue: Notion #92, Notion #93
plan: docs/plans/2026-09-07-recipe-social-share.md, docs/plans/2026-09-07-recipe-refetch-and-times.md
tags:
  [
    cookbook,
    recipes,
    sharing,
    acquisition,
    ai-extraction,
    telemetry,
    privacy,
    ios,
    concurrent-session,
  ]
---

# Recipe social share, and reading a recipe's source again

Second task of the session, after the Beanie List copy work
(`2026-09-07-beanie-list-copy.md`). Ran alongside a second session working on pod
compaction in the same checkout, so every commit was staged by explicit path and
nothing was pushed.

Greg went to sleep partway through and handed over an autonomous mandate covering
planning, implementation, code review and the fixes.

## Prompts

### 1 — the request

> Let's make some improvements to the recipe and cookbook features:
>
> Add social share for recipes. This feature should allow you to share your recipe in
> beanies to any friend across whatsapp, discord, etc like a typical social share
> capability. the sharing should be fun and include a link to beanies to show where the
> share came from, as a way to encourage users to either start their own beanpod or
> login and add the recipe to their own beanpod. For the share content, let's also make
> it very easy for a user receiving a recipe from beanies to add it to their own cookbook.
>
> Also, provide a "refresh / re-fetch" type affordance for each recipe to search the link
> again to review and reload the recipe detail and/or populate a new or changed photo.
>
> Another thing i noticed is that the prep time / cook time / servings fields are usually
> not populated from the AI response even though, for the most part, these details are
> either in the recipe or could probably be reasonably inferred.
>
> Please review this and let me know if any questions. If all clear then create a new
> issue with /beanies-new-issue then move straight to /beanies-pre-plan and once done
> move to /beanies-plan

### 2 — clarifying answers

Asked about the share payload, the receiving flow, and issue splitting.

> what is the difference between payloud in the URL and text only with plain beanies link?

Then, after the explanation: **payload in the URL fragment + readable text**, a **review
step before applying** a re-fetch, **two issues** rather than one, and **no photo** in the
share.

### 3 — the autonomous mandate

> yes. work autonomous as i will be going to sleep now. once done creating this issue,
> move to /beanies-plan and create the full plan for both issues. then move to
> implementation for both, starting with social share, the then moving to issue #92. for
> both issues, perform the full implementation. once done, run /code-review max against
> the changes to ensure they were implemented accurately and faithful to the design and
> do not introduce any new bugs, side effects, or security concerns. fix all issues found,
> and once all issues are fixes, if there was a significant amount of new code or risky
> code, as per your judgement run additoonal code reviews as needed until you are
> confident that all issues have been implemented properly and as per the plan without
> any bugs or side effects. once complete, capture all context and run /end-session and
> we will test in the next session. if any quesitons let me know now

### 4 — order and mockups

> correct, social share first, and then capture-quality issue is fine. for both issues, i
> am fine with your proposal to view and choose the best mockup as necessary and
> appropriate for the design. you can go straight to implementation once done

## Outcome

Both issues implemented, reviewed over three rounds, and committed to `main` (not pushed —
greg pushes from the concurrent session). Notion #92 and #93 are `Ready for Testing` with
their plan URLs written back.

### What shipped

**#92 — share a recipe.** One message carries the recipe as readable text AND a link whose
URL fragment holds the whole recipe, so it is a gift to someone who never taps through and
an offer to someone who does. A public `/recipe` page renders it for a visitor with no
account: the recipe first, the invitation in a sticky bar underneath, never a wall in front
of the content. "Keep" stashes it and routes to the cookbook or to onboarding, and the
cookbook opens the normal review form with it — the same rule the inbound share boundary
already follows.

**#93 — capture quality.** The model may now infer prep/cook/servings _and must declare it_,
via a new `inferredTimes` array across all three prompt copies; an inferred value renders
with the same Heritage Orange hint an inferred ingredient already gets. And "Read again"
re-fetches a recipe's source, shows a diff old-beside-new, and writes nothing until taken.

### The two defects that would have shipped

Both were invisible from a desktop browser, and neither was found by the first review pass
that looked directly at the code.

1. **The iOS share link was dead.** `window.location.origin` inside the iOS shell is
   `capacitor://app.beanies.family` — deliberate, and stated in `capacitor.config.ts`. Every
   share sent from the iPhone carried a link that opens nothing on the recipient's phone. The
   browser and Android both answer correctly, and the one person who cannot open it is not
   the sender, so nothing surfaces it. Now behind a named `shareableOrigin()`.
   ⚠️ **`buildInviteLink` has the same flaw and is NOT fixed** — see the pending block.

2. **The shared recipe was being written to CloudWatch.** Three `reportError` calls passed
   `route_path: route.fullPath`, and `fullPath` is path + query + hash — on `/recipe#<payload>`
   that field _is_ the recipe. Redaction truncates to 200 characters from the START, so the
   surviving prefix decodes cleanly, and one of the three pages Slack. That directly
   contradicts the guarantee the feature is built on.

### What the second review round found — including in the first round's fixes

Four of the ten findings in round two were inside fixes made in round one, which is the
pattern `docs/lessons.md` warns about. Each was answered structurally rather than patched: the
route lists became one derived list with two named parts, and the origin became one named
helper used at every fixable site.

**Grepping for the helper's siblings turned up the most consequential finding of the session,
and it is not in this feature at all.** Two other links built for someone else to open came
from `location.origin`:

- **the recovery-kit QR** — printed, and scanned by a different device's camera by definition.
  A kit printed from the iOS app encoded `capacitor://…`, so pointing a phone at it did
  nothing. Typing the code by hand always worked, which is why nobody hit it.
- **every calendar event beanies syncs to Google**, which carries an app deep link in its
  description body — persisted in Google's copy and read by anyone the calendar is shared with.

Both already fell back to exactly the canonical origin, so the swap is a provable no-op on web
and Android and only changes iOS, where the value was already broken. `buildInviteLink` is the
third instance and is deliberately still unfixed — its fallback is the marketing apex rather
than the app subdomain, which is a second question, and invite → join needs device
verification of its own.

**A credential was reaching telemetry.** `LoginPage`'s podless-rescue reports passed
`route.fullPath`, and the recovery kit builds `/welcome#beanies-kit=<code>` — `/welcome` IS
LoginPage, and the fragment strip runs later than the rescue. Found only because the recipe
leak prompted the question of what else rides a fragment.

### Lessons worth keeping

- **A lint autofixer rewrote a security test into its opposite.** A fixture asserting that
  `http://` links are dropped was silently changed to `https://` by the pre-commit
  `eslint --fix` (`@microsoft/sdl/no-insecure-url`), turning the assertion inside out. It then
  failed, which is the only reason it was noticed. Hostile-input fixtures must be built so a
  fixer cannot reach them.
- **"Suppress the alert" is not the same as "skip the redirect."** The first fix for the
  podless boot path silenced the Slack report but left the `router.replace` that destroyed the
  fragment — and removed the signal that would have told us. The predicate is now derived from
  two named parts, and the redirect consults the stricter one.
- **A TTL and a single-consume bound duration and repetition, not identity.** The keep-stash
  was cleared on the clear-data tier only, on that argument; on a shared device one person's
  recipe could pre-fill another's form in a different pod.
- **Trimming is load-bearing.** `asString` did not trim where its two siblings did, so `"   "`
  passed every downstream emptiness check — they all test for `''` — and could blank a
  recipe's name on the re-fetch path.
- **A bare `hover:` background beats a bare `dark:` background.** `dark` is
  `&:where(.dark, .dark *)`, and `:where()` contributes zero specificity — so `hover:bg-*`
  (0,2,0) wins over `dark:bg-*` (0,1,0) whatever the source order. Three buttons went
  white-on-white under the cursor. The dark-mode sweep four days earlier checked that every
  _non-hover_ background had a partner; a hover background is a painted background too.
