# Plan: Magic beans — one surface, every door, and a countable bean

> Date: 2026-09-14
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-14-magic-beans-one-surface-and-meter.md` (to be saved on approval)
> Mockup: `docs/mockups/magic-beans-one-surface-2026-09-14.html`

## User Story

As a parent holding a forwarded WhatsApp invite, a school PDF, or a recipe link, I want one place in
beanies to hand it over and have beanies work out what it is — so I never have to decide what kind of
thing I'm holding before beanies has looked at it.

And as the person paying the AI bill, I want every read counted per family, so the plans sold on the
pricing page can eventually be enforced.

## Context

Magic beans has six doors, and they do not agree with each other.

Two of them already work the way the feature was designed. The **share target** (into beanies from
another app) and the **quick-add FAB** both run `useSharedDocumentIngest`, which reads whatever it is
given, lets the model classify it as `event | travel | recipe | none`, and dispatches the result to
whichever page owns that kind. Neither ever asks the user what they are holding.

The other four pin the answer before beanies has looked at anything. **Activities** and **Travel**
mount `AiDocumentPicker` directly and pipe the file into a hardcoded extractor; neither accepts text or
a link at all, so a forwarded class-group message has no way in on the page that owns it. The
**cookbook** and the **add-recipe form** accept a link but only a link, each through its own
`useRecipeCapture` instance.

This was already decided once. Direction B of `docs/mockups/magic-beans-one-button-2026-09-03.html`
was approved on 2026-09-03 and shipped as `MagicBeansSheet.vue` — but only behind the FAB. The
rollout stopped halfway. Its design note states the reasoning that still governs: the three chips it
replaced asked _"what IS this?"_, which is the question the AI should be answering and the one a user
can get **wrong** — and picking wrong did not produce a helpful error, it produced a bad extraction of
the wrong shape that the user then had to notice.

The split is not cosmetic. It is two spines with different behaviour, and the thin one is missing
things the fat one has — a shared in-flight lock, size and type validation, `familyId` on the request,
observability, and a consistent story for "not recognised". Six real defects fall out of that, listed
in Requirement 4.

Separately, there is **no number anywhere that could carry entitlement**. `web/src/lib/pricing.ts`
sells 1 read/day on trial, 10/day and 1/month on the paid plans, and nothing in `src/` reads a plan.
The only per-family figure that exists is a `localStorage` budget of 20 text reads an hour — per
_device_, clearable, covering the bare-text arm only, and invisible to the server. Three devices is
three budgets. Enforcement (tracker #95) cannot be built on that, and the meter has to exist and be
trusted well before enforcement is switched on.

## Requirements

### 1. One surface, every door

1.1. `MagicBeansSheet.vue` becomes the entry point for all six doors. The four pinned doors —
`FamilyPlannerPage`, `TravelPlansPage`, `FamilyCookbookPage`, `RecipeFormModal`/`RecipeSourceStrip` —
open it instead of a picker or a link modal.

1.2. Each page keeps its own magic-beans affordance. Discoverability is the reason to have a button on
a page at all; only what the button opens changes.

1.3. The detected kind decides where the result goes — **except where the opening surface can consume
that exact kind itself** (the recipe form; see A6). A mismatched kind always routes by kind. Pasting a
party invite while standing on Travel produces an activity, on the Activities page, via the existing
`dispatchSharePayload` → `readerForShareKind` route.

1.4. Every door accepts what the FAB accepts: pasted text, a pasted link, camera, and file.

1.5. `AiDocumentPicker` is unchanged and stays mounted. It stops being a _surface_ and goes back to
being the file mechanism the sheet calls — it exists because the mixed `image/*,application/pdf` accept
routes to the documents picker with no camera entry on native, and that must not be lost.

1.6. All four pinned doors route through `useSharedDocumentIngest`. The three wedge composables
(`useDocumentToActivity`, `useDocumentToTravel`, `useRecipeCapture`) collapse onto the one spine.

**Explicitly not doing:**

- **No per-surface hint to the extractor.** The same input must produce the same answer regardless of
  which page the user was standing on. A positional bias makes results unreproducible in support and
  quietly reintroduces the "what IS this?" guess that direction B removed. The model already returns
  `none` rather than guessing — `extractionPrompt.ts` states "none is always better than a wrong guess".
- **No fourth reader.** `MAGIC_READERS` and its totality/injectivity test are untouched.

### 2. The UI, per the approved mockup

2.1. Title `✨ Magic beans` — the feature keeps its name and its emoji across card, pills and sheet.

2.2. A Caveat tagline in Heritage Orange: _give us something to read and we'll work out the rest_ —
**lowercase in both `en` and `beanie`**, matching the CIG's existing Caveat precedents (`shhh…`,
`what are we tackling together? 🌱`), so the dual casing standard holds. One Caveat line per screen.

2.3. Title and tagline sit in a **gradient-tinted header zone**: Heritage Orange 10% → Terracotta 6% →
transparent in light; `accent-lift` 16% → `terracotta-lift` 9% on dark.

2.4. **The sheen sweeps the header zone, never the textarea.** A shimmer over an input is the
skeleton-loader idiom — it reads as loading or disabled, and it fights the caret.

2.5. One sheen idiom at three speeds, reusing the 105° gradient `MagicReaderCard` already paints:
slow at rest, quick while reading, one pass on the resolved tile.

2.6. Three destination tiles, **visually unlabelled** — faint at rest, ticking while reading, then two
fade and one lifts into the Heritage Orange → Terracotta gradient. The `ai.capture.dest.*` strings are
their **accessible names** (`aria-label`), not visible text: an icon-only tile with no name is unusable
with a screen reader, and "unlabelled" is a visual decision, not an accessibility one.

The tile set is `Record<ShareKind, { emoji: string }>` in **one** module, so a fourth kind is a compile
error rather than a missing tile, and keys are `ai.capture.dest.event` / `.travel` / `.recipe` so the
label is `t(\`ai.capture.dest.${kind}\`)` — derived, not a parallel map. The sheet and the overlay
render the same module: one list, rendered twice.

The compile-error guarantee on the _strings_ comes from the template-literal type reaching
`t(key: UIStringKey)`, and holds only while `kind` is the `ShareKind` union at the call site. Iterate
with `(Object.keys(TILES) as ShareKind[])`, exactly as `readerForShareKind` does — a bare
`Object.keys` yields `string[]`, widens the key to `` `ai.capture.dest.${string}` ``, and the guarantee
disappears with no error anywhere. Never cast the key with `as UIStringKey`.

A fourth kind is: one `ShareKind` member, one `SharePayload` arm, one `MAGIC_READERS` entry, one
tile-module entry, and two string keys. The first four are compile errors; the fifth is one via the
template-literal key. Nothing server-side changes — `countUsage` and the grant are kind-agnostic.

2.7. A **not right?** affordance lets the user say what the thing actually is when beanies gets the
kind wrong — and **the re-read is free**. `SharePayload` is discriminated per kind, so the model
returns only the branch it chose; correcting it genuinely is a second extraction. We eat that cost,
because it is our error, not the family's. Gated on the user **explicitly naming the correct
category**, which is both what makes the second run higher-quality (a targeted `event`/`travel`/
`recipe` task rather than `share` classification) and what stops it being a free-extraction loophole.
The promise becomes: **one bean per thing you hand over — and if beanies gets the kind wrong, putting
it right is free.** One free correction per paid read, of the same document (C9). "However many tries"
is not what a single-use grant delivers, so do not say it.

2.8. All motion off under `prefers-reduced-motion`; the resolved tile keeps its gradient and lift and
simply does not sweep.

2.9. Every style token from the theme skill + CIG. Both themes authored in the same change.

### 3. The magic-bean meter

3.1. **`familyId` becomes `familyId: string`** in `ExtractOptions` and `ExtractionRequest` — omission
is a build error. **But the type alone is not the fence.** The spine already writes
`activeFamilyId ?? undefined` (`useSharedDocumentIngest.ts:706`) and the recipe wedge does the same
(`useRecipeCapture.ts:487`), so the type catches _omission_ but not the real case: **no active family
id**. Today that degrades to the proxy's IP limit; under the meter it would be an uncounted, silently
free read — an uncounted read produced by **our own client**, which is the loophole this requirement
can actually close. See Assumption 9 for the one it cannot. It becomes a **refusal before the
model**, logged `action: 'not_ready', detail: 'no_family'`, costing nothing. See C8.

⚠️ **Rewrite the `familyId` JSDoc at `types.ts:59-70` in the same edit.** It currently says "OPTIONAL
in both directions, on purpose", with two reasons — one of which survives and one of which does not,
and leaving both standing makes the new type read as an accident: _required on the CLIENT since the
meter (every managed read must be attributable, and `?? undefined` is the shape that made it optional
in practice); still accepted WITHOUT one by the Lambda, because an old cached bundle sends none and
400ing it would break working installs. The asymmetry is deliberate, and the skipped count is logged
and alarmed (C3) so its real rate is visible._

3.2. **The count of record is written server-side** by the `ai-extract` Lambda — the chokepoint every
_managed-tier_ read passes (see Assumption 8; BYOK and on-device reads never reach it, deliberately).
Client-side counts are display only and never authoritative.

3.3. **One atomic increment per read**, `pk=family#<id>`, `sk=usage#<YYYY-MM-DD>`, DynamoDB `ADD`.
Day is the finest grain the pricing page sells; week and month are range queries, not second counters.

3.4. **No idempotency key — and this is a decision, not an open question, because the mechanism is a
meter bypass.**

`TransactWriteItems` is all-or-nothing. The attempt marker's `ConditionExpression:
attribute_not_exists(pk)` is what makes a replay a no-op — but it cancels **the counter increment with
it**. `attemptId` is generated client-side and ships in the public bundle, so a client that sends the
_same_ id on every request receives every extraction and is **never counted**. That is a complete
one-line bypass of the meter, introduced _by_ the idempotency mechanism and absent without it.

It is also designed to be invisible: `countUsage` would have to treat the cancellation as "already
counted, fine", or every legitimate dedupe fires the write-failure alarm. So the bypass is silent by
construction.

Against that, 3.4's own premise: it dedupes nothing that can happen today. `managedProvider.ts` has no
retry, a synchronous API-Gateway invocation is not platform-retried, and a user re-tapping after a
timeout is a genuinely new read. A **server**-minted id (`context.awsRequestId` exists and is free)
would not be attacker-controlled but also dedupes nothing, since a retry carries a new request id.

`countUsage` therefore has exactly **one** write: a plain `UpdateItem ... ADD #n :one` on the counter.
IAM grants `dynamodb:UpdateItem` only, matching the limiter.

**The standing requirement this replaces:** adding retry logic to `managedProvider` — or moving the
extract call behind anything that retries — requires designing idempotency **server-side** in the same
change, with a key the client cannot choose. Never a client-supplied one.

3.5. **Counting is separated from limiting.** The limiter may stay fail-open — a DynamoDB blip should
not lock a family out. A _count_ that cannot be written is a logged, alertable gap, never a silent zero.

3.6. **Reads-per-family surfaces in `/beanies-metrics`** from day one, so the meter is verifiable
rather than write-only.

3.7. **The `localStorage` `SHARE_TEXT_BUDGET` stays — its retirement is cut from this change.** It is
a genuine second source of truth and it should go, but retiring it cleanly requires rendering the
server's reset time in its place, and that is a **four-hop type change**: `ExtractionProviderError` has
no `retryAfterSeconds` field (`types.ts:336-345`), `managedProvider` parses only `code`,
`documentExtractionService`'s failure result carries only `errorCode`, and the spine's `failed()`
passes only that.

Retiring it also **quadruples the worst-case per-family text spend** — the client cap is 20/hour, the
server's `FAMILY_LIMIT` is 80/hour — which is a pricing decision, not a tidy-up, and does not belong
inside the change that builds the meter. And the message often would not render anyway: an
API-Gateway-generated 429 carries no CORS headers and surfaces as a network error classified
`provider_error`.

Recorded as a follow-up with three parts that must land together: thread `retryAfterSeconds`, delete
the budget and its strings, and set `FAMILY_LIMIT` to what the product actually wants to sell.

**`src/utils/attemptBudget.ts` is not touched either way** — `useRecipeRefetch` is a second live
consumer with its own `REFETCH_BUDGET`.

### 4. Defects to close on the way

Each is a consequence of the two divergent spines, so unification should close it. **Confirm each
actually closes rather than assuming it does** — any that does not gets its own fix.

4.1. **Two capture locks that cannot see each other.** `isIngesting` is module-global but the wedges
never consult it, so a page capture can run concurrently with a share/FAB ingest and bill two
extractions at once.

4.2. **Size and type checks on two doors of six.** The 25 MB cap and the byte-sniff live only in the
ingest; on the wedges an oversized or mislabelled file reaches canvas compression and surfaces as
`photos.invalidType`, which names the wrong problem.

4.3. **A refused reader is billed first.** With `aiTravelExtract` off, a travel paste is read and
charged, then refused with `shareTarget.readerOff`. The gate must move ahead of the model call.

4.4. **`useDocumentToActivity` emits no `logEvent` at all** — only `reportError`. The busiest reader is
the one that cannot be triaged from CloudWatch, against the observability rule in `CLAUDE.md`.

4.5. **Consent order is inverted between doors.** Pages ask before the picker; the FAB asks after, so
declining there discards a photo already taken.

4.6. **"Not recognised" behaves four ways**, and recipe-flavoured strings (`badLink`, `noTranscript`,
`titleOnly`) reach non-recipe captures — a shared school newsletter can be told it has no transcript.

## Important Notes & Caveats

- **Do not lose the native camera.** `AiDocumentPicker` exists because the mixed image+PDF accept has
  no camera entry on native. Any refactor that folds it away silently breaks camera capture on phones.
- **Do not put the paste field where the keyboard covers it.** Direction C was rejected for exactly
  this; the drawer layout is the approved answer.
- **`MagicBeansSheet` closes before ingest starts, deliberately.** Three things break otherwise:
  `AiProcessingOverlay` and the panel are both `z-[60]`, `useFullscreenOverlay` holds a body-scroll
  lock, and `openQuickAdd()` refuses while any overlay is open, which would make the FAB dead until
  reload. Preserve this ordering at every new door.
- **`infrastructure/modules/registry/main.tf:80` grants `dynamodb:DeleteItem`** and has been an open
  STATUS item for a while. If the terraform work touches that module, **flag it — do not silently fix
  it.** It is a separate decision.
- **E2E budget: re-verify the number before relying on it.** The cap is 25 (ADR-007), but two counts
  disagree — 23 by one method, 21 by `grep -rh '^\s*test(' e2e/specs/*.spec.ts | wc -l`. Establish
  how the number is derived, then treat that as the constraint. Either way a throwaway verification
  script must not land in `e2e/specs/` (no `testIgnore` there — it would join CI).
- **`RecipeFormModal` mounts from five places** and owns its own capture + consent + in-form overlay
  for that reason. Whatever replaces it must survive all five mount points.
- **A saved-source attach only works through the instance that ran the capture.** There are **three**
  `useRecipeCapture()` instances app-wide: `FamilyCookbookPage.vue:81`, `RecipeFormModal.vue:309` (two
  live simultaneously in the cookbook tree, with `attachAfterSave` call sites at
  `FamilyCookbookPage.vue:293` and `RecipeFormModal.vue:484`) and `useRecipeRefetch.ts:66`.
  `pendingSource`/`pendingCompressed` are composable-local. All three couplings must survive.
- **The sheet over `RecipeFormModal` has one real stacking defect, at one mount point.** See A6: only
  `MealEditModal.vue:306` passes `layer="overlay"`, which leaves the form un-dimmed behind the sheet.
  The body-scroll-lock worry is **not** real — `overlayStack` is ref-counted and designed for nesting.
- **`useRecipeLinkInput.ts` becomes orphaned** when `RecipeLinkModal` is deleted and
  `RecipeSourceStrip` loses its URL field — those are its only two consumers. Delete it with its
  `recipeExtract.link.*` / `.strip.*` strings, and prove nothing else reads them.

## Assumptions

> **Review these before implementation.** Valid at planning time; verify if time has passed.

1. **An unrecognised `none` result counts as one bean.** greg's decision: we paid for the read, and
   counting it stops "keep pasting until something sticks" being free.
2. **The recipe video ladder counts as one bean**, even though it can make several upstream calls for
   one user action. greg's decision; a known cost asymmetry, accepted for a predictable promise.
3. Refusals _before_ the model — offline, consent declined, too large, wrong type, reader off — cost
   nothing and are not counted. This is what makes fixing 4.3 a prerequisite rather than a nicety.
4. Infrastructure failures (5xx, timeout, malformed response) are not billed to the family and are
   counted separately as an error rate.
5. Enforcement is out of scope (tracker #95). This change builds the meter and proves it; it does not
   refuse anyone.
6. The meter starts at zero on deploy. There is no history to backfill and none will be fabricated.
7. `family_id` is already an allowlisted telemetry context key (`perfTiming` correlates on it), so no
   new store declaration is needed for it. **Any other new context key does need one.**
8. **Only managed-tier reads are counted, and that is deliberate.** `AiTier` is
   `'managed' | 'byok' | 'on-device'` (`models.ts:1908`) and only the managed tier posts to the proxy
   (`managedProvider.ts:60-92`). BYOK and on-device reads cost us nothing, so they are not billed to
   the family's allowance. The consequence must be written down or it reads as a bug later: "reads per
   family" is a count of **reads we paid for**, not of AI uses. `/beanies-metrics` labels it that way,
   and a future entitlement layer gates on **tier before count**, or it will refuse a BYOK family who
   has spent nothing of ours.

   A second consequence for #95: the daily row is `{ n, c }`, and **an allowance is spent against `n`
   only**. `c` is our cost, not theirs — that is the entire point of 2.7. An enforcement layer that
   sums the row rather than reading `n` would charge families for our miscategorisations, the opposite
   of the promise this change ships. Say it here, because the row will be read months from now by code
   written against a schema nobody remembers designing.

   This corrects Pass 1's claim that the Lambda is "the only chokepoint
   every read passes" — it is not.

9. **The meter is honest-client accounting, not authenticated accounting.** `familyId` is read off the
   request body (`index.mjs:111`) under a soft `x-api-key` that ships in the public bundle;
   `rateLimit.mjs:20-22` already states it is _"client-supplied and therefore forgeable"_. C8 is a
   fence around **our own client** — it stops an honest bug producing uncounted reads, which is worth
   having. It is not a fence against someone rotating the id, who is bounded only by the IP limit and
   the route throttle, neither of which covers the image path (`modules/ai-extract/main.tf:243`).

   The consequence must be recorded now, because tracker #95 will be designed against this table:
   **enforcement cannot gate on this count until `familyId` is bound to an authenticated principal.**
   Building a paywall on a forgeable key is the same class of mistake 3.4 rejected `attemptId` for,
   one layer up.

## Approach

### Part C — the meter (server side)

Phase-1 exploration changed this design in three ways. Recording the findings because each one
invalidates an obvious-looking implementation.

**C1. The meter is its own write, not a widening of the limiter.**
`checkLimits` is called at `index.mjs:202-208` **gated on `hasText`**, deliberately — the comment
records that widening it to images is "a strictly larger blast radius". So the image path (`event`,
`travel`, and image-sourced `share`/`recipe`) touches the rate table _not at all_ today. Counting
therefore cannot ride on the limiter. A separate `countUsage()` module fires on every path, which is
also exactly the counting/limiting separation Requirement 3.5 asks for.

**C2. The usage table stores `sha256(familyId)`, never the id.**
`rateLimit.mjs:180-186` states the doctrine for the family id — "never logged, never stored".
(`index.mjs:16-18` is the separate Gate-3 rule about document **bytes**; do not cite it for this.) `rateLimit.mjs` already honours it by keying on `hash(familyId)` (`:110-112`). The usage
table uses **the same hash function**, so the privacy posture is unchanged. `/beanies-metrics` joins
by hashing the registry's raw `familyId` locally — the registry table is the only place the raw id
lives, and it already does.

**C2a. Extract the shared primitives BEFORE writing `countUsage.mjs`.**
`hash()` (`rateLimit.mjs:110-112`) and `defaultClient()` (`:85-92`) are both module-private. Copying
them gives two `createHash('sha256')` helpers that can silently diverge — at which point the metrics
join returns zero rows and nobody finds out — and two module-scope SDK import promises, i.e. two
cold-start initialisations on a path that now runs on _every_ request including the image path
`rateLimit.mjs` deliberately never touches.

New `infrastructure/lambda/ai-extract/ddb.mjs` exports `hash(value)`, `defaultClient()` and **the one**
`__setDdbClientForTests(client)` seam, which both modules resolve through. `rateLimit.mjs` re-exports
it under its existing name (`export { __setDdbClientForTests as __setRateLimitClientForTests }`) so
`handler.test.mjs` is a one-line import change and no test can stub one module's client while the
other quietly reaches AWS. `ddb.mjs` exports **four** things, not two. Beyond `hash()` and `defaultClient()`:

- **`countOne(send, commands, table, key, { max?, ttl, attr = 'n' })`** — lifted verbatim from
  `rateLimit.mjs:151-180`, generalised on three axes only: a full `Key` object (so a sort key works),
  an optional `max` (omitted ⇒ no condition ⇒ the unconditional increment the meter needs), and the
  attribute name (so a correction increments `c`, per C9). The `#n` alias and its six-line comment —
  explaining that a bare attribute name throws a `ValidationException` failing _every_ request, which
  the outer catch cannot distinguish from a transient error — travel with it.
- **`safeWrite(label, remediation, fn)`** — the never-throws wrapper: unset table ⇒ silent no-op;
  success ⇒ `true`; failure ⇒ `console.error` with the fixed prefix and remediation, return `false`.
  Used by **`countUsage` and the grant writer only** — the two writes whose whole contract is "did it
  land", and where C9's "grant only if the count succeeded" is exactly the boolean it returns.

  ⚠️ **`checkLimits` is deliberately NOT refactored onto it.** Its contract is three-valued
  (`allowed` / `allowed+degraded` / `refused+limit+retryAfter`), it must treat
  `ConditionalCheckFailedException` as a **refusal** rather than a failure (`rateLimit.mjs:218-227`),
  and its fail-open direction is the opposite of the meter's fail-loud one. Sharing a wrapper would
  mean either widening `safeWrite` until it stops being a contract, or changing the limiter — and the
  gate above says which: `rateLimit.test.mjs` must pass unchanged. It shares `hash()`, `countOne()`
  and `defaultClient()`, and keeps its own catch.

- **`defaultClient()` configures the SDK explicitly** rather than taking defaults:
  `new DynamoDBClient({ maxAttempts: 2, requestHandler: { requestTimeout: 800 } })`. Not tuning — a
  deadline. The post-model window is **4 seconds** (25s upstream timeout inside a 29s function), and
  the SDK default of `maxAttempts: 3` with exponential backoff can spend all of it. A failed count is
  a logged, alertable gap (3.5); a Lambda that _times out_ after the model was paid for loses the user
  their extraction, which is what C3 exists to prevent. Bounding the client is what makes "awaited"
  safe. `checkLimits` inherits the same bound, correctly — a slow limiter write is latency the user
  pays before the model even starts.

`countUsage()` additionally accepts an injected `ddb: { send, commands }` **field on its options
object**, exactly as `checkLimits({ …, ddb })` does, so `countUsage.test.mjs` needs no seam at all.
**`rateLimit.test.mjs` must stay green unchanged** — if it needs edits, the extraction changed
behaviour and is wrong. `archive_file` uses `source_dir`, so a new sibling module ships with no
packaging change.

**C3. The count must not be able to fail the extraction.**
`index.mjs:225-318` is one top-level `try`, so a throwing counter write would surface as a raw 500 and
lose the user their extraction. `countUsage()` is **awaited** immediately before `return response(200, …)`. Not `void`: Lambda freezes
the execution environment the moment the handler returns, so a fire-and-forget write frequently never
reaches DynamoDB _and never logs its own failure_ — a silent, unalertable undercount, which is exactly
what 3.5 forbids. The cost is one DynamoDB write on a path that has just spent seconds in the model.

It never throws — same contract as `rateLimit.mjs:177`. On failure it logs a fixed-prefix line
carrying **remediation**, not just a fault, borrowing the shape of `rateLimit.mjs:245-249`:

```
[ai-extract] usage-count write failed — the read succeeded and was NOT counted.
Check the <USAGE_TABLE> table, the Lambda dynamodb:UpdateItem permission,
and the USAGE_TABLE env var in modules/ai-extract/main.tf.
```

⚠️ That exact prefix is what the metric filter matches — changing the string means changing
`modules/ai-extract/main.tf` **in the same commit**, the same warning `main.tf:190-192` already
carries for `RateStoreUnavailable`.

**A request with no `familyId` is skipped, loudly and countably.** The Lambda must keep accepting one
(`index.mjs:111` treats it as optional deliberately — every cached old bundle sends none), so
`countUsage` cannot 400 and cannot invent an id. It returns early and logs its own **separate**
fixed-prefix line:

```
[ai-extract] usage-count skipped — no family id on the request. The read succeeded
and was NOT counted. Expected only from an old cached bundle; a rising rate means
the client-side no_family fence (C8) has been breached.
```

This gets **its own metric filter and alarm**, distinct from the write-failure one: they mean
different things and need different responses. It is the _only_ signal that catches a breach of C8,
because a skipped count writes no row and is therefore invisible to C7's unattributed bucket, which
can only see hashes that fail to join.

**C4. Where the increment fires: the 200 success point only** (`index.mjs:312-314`).
This makes the promise defensible and matches the Assumptions exactly:

- A `kind: 'none'` result is a **200** server-side (the shape check is only `SHARE_REQUIRED_KEYS =
['kind']`, `extractionPrompt.mjs:324`), so counting every 200 counts `none` with no special-casing —
  Assumption 1 falls out for free.
- Everything refused before the model (401, 413, 400, 429) returns earlier and is never counted —
  Assumption 3.
- `upstream_timeout` / `upstream_network` / `upstream_unavailable` / `upstream_badjson` /
  `model_unparseable` / `model_shape` all return before `:313`, so a family is never billed for a
  read that produced nothing usable — Assumption 4. We pay for some of those; that is our cost, not
  theirs.

The rule states in one sentence: **a bean is spent exactly when beanies answered you** — and, per C9,
**once per thing you hand over**, since correcting our miscategorisation is free.

**C6. Table shape**, modelled on `modules/ai-extract`'s rate table (which is the module that has a
TTL; the registry module has neither TTL nor PITR):

- `pk = f#<sha256(familyId)>`, `sk = d#<YYYY-MM-DD>`. A sort key (unlike the rate table) because week
  and month must be range queries, not second counters (3.3). One item shape only — no attempt
  markers, per 3.4.
- `PAY_PER_REQUEST`. The item carries exactly three attributes — `n` (reads charged), `c` (free
  corrections, C9) and `expires_at` — declared once as data in `USAGE_ATTRS` (C7). **A fourth counter
  is a new attribute on this item, never a second item shape**: the sort key is the day, and a second
  shape under the same `pk` would break `pull_ai_usage.mjs`'s scan-and-sum.
- **TTL ~400 days** — billing evidence has to outlive an hourly window because a monthly plan is
  billed on it. One horizon, because there is only one item shape.
- New env var `USAGE_TABLE`, wired by resource reference. **Unset must be a supported no-op**, exactly
  as `RATE_TABLE` is (`main.tf:138-143`) — that is what keeps the 527-line handler test suite from
  attempting a real DynamoDB call per test.
- IAM adds `dynamodb:UpdateItem` on the new table ARN only (no `PutItem` — there are no markers). No read grant: the Lambda writes and never reads back, same as the limiter.
  `/beanies-metrics` reads with greg's own credentials.
- **`point_in_time_recovery { enabled = true }` unconditionally, and
  `deletion_protection_enabled = var.environment == "prod"`.** The module is applied per environment
  from `main.tf:156`, so an unconditional `true` makes `terraform destroy` fail in any non-prod
  workspace with a console-only unblock. The rate table has neither, correctly — an hour-old rate bucket is worthless. This is billing evidence with
  no backfill path (Assumption 6), so the two tables diverge here **deliberately**; say so in the
  resource comment or someone will "reconcile" them.
- The metric filter and alarm mirror the existing pair exactly: `default_value = "0"` on the metric
  transformation (`main.tf:197-199` — without it the alarm sits in INSUFFICIENT_DATA rather than OK)
  and `count = var.alerts_topic_arn == "" ? 0 : 1` on the alarm, so a self-hoster without a topic
  still gets a clean apply.

**C7. Metrics reads the table, not the logs.**
The ai-extract log group carries no `family_id` at all (the success line is `task` + `enclave` only),
and the telemetry firehose has no surface covering event/travel/share extraction — only
`'recipe-extract'`. So a CloudWatch-derived number is not available without new client logging. A new
collector `scripts/pull_ai_usage.mjs` scans the usage table the way `pull_registry.mjs` scans the
registry and writes JSON **to stdout** (`pull_registry.mjs` writes nothing itself; `SKILL.md:72`
redirects it). The `load()` line alone would ship a no-op — all four of these are required:

1. `SKILL.md` gains `node $SKILL/pull_ai_usage.mjs > "$OUT/ai_usage.json"` beside `:72`, and
   `ai_usage.json` joins the exact-filenames list at `:100-101`.
2. `build_dashboard.mjs` gains `const usage = load('ai_usage.json', true);` **and a render block**.
3. `assets/dashboard-template.html` gains the reads-per-family section that block fills.
4. The join runs on `--raw` registry output only; the collector fails **loudly** rather than emitting
   zeros if `registry.json` was produced without it.

Every hash in `ai_usage.json` that does not join to a registry row is reported as an explicit
**unattributed** bucket rather than dropped — a growing unattributed count is the signal that C8's
`no_family` fence has been breached.

**There is no third implementation.** `ddb.mjs` is the ONE declaration of the usage-table grammar, and
exports it as data rather than prose:

```js
// The table NAME is terraform's, not ours — the Lambda receives it as USAGE_TABLE. This is a
// convenience default for `pull_ai_usage.mjs` only, overridable so it is never the fact that breaks.
export const usageTableName = (env, appName = 'beanies-family') =>
  process.env.AI_USAGE_TABLE || `${appName}-ai-usage-${env}`;
export const usageKey = (familyId, dayIso) => ({ pk: `f#${hash(familyId)}`, sk: `d#${dayIso}` });
export const USAGE_ATTRS = Object.freeze({ charged: 'n', corrected: 'c' });
export const grantKey = (familyId, id) => ({ pk: `c#${hash(familyId)}#${id}` });
```

**Key helpers return PLAIN strings; `countOne` marshals.** `ddb.mjs` has two consumers with opposite
needs — the Lambda speaks raw `AttributeValue` (`{ pk: { S: … } }`; there is no `DocumentClient` in
this runtime) and `pull_ai_usage.mjs` compares plain strings from a `Scan`. Plain wins at the
boundary, and `countOne` marshals in one place:

```js
const marshalKey = (key) => Object.fromEntries(Object.entries(key).map(([k, v]) => [k, { S: v }]));
```

⚠️ Getting this wrong throws `ValidationException` on **every** write, which the outer catch reports as
a transient store error — the identical mis-classification the `#n` aliasing comment exists to prevent,
one level up. Assert one marshalled key literal in `countUsage.test.mjs`. `rateLimit.mjs`'s existing
single-`pk` sites pass through the same helper, so `rateLimit.test.mjs` stays green unchanged.

`pull_ai_usage.mjs` imports `hash`, `usageKey` and `USAGE_ATTRS` **directly** — the skill is a
directory in this repo, `SKILL.md:64` already runs it from the repo root, and `ddb.mjs` imports only
`node:crypto` at module scope so this pulls in no SDK. That collapses **five** facts that would
otherwise have to stay in step by hand — hash function, pk prefix, sk prefix, attribute names, table
name — into one module with one test.

The fixed-vector assertion (`sha256('family-fixture-0000') === '<hex>'`) stays in `countUsage.test.mjs`
as a belt-and-braces check, but it is no longer the only thing standing between us and a silent
zero-row join.

⚠️ The unattributed-bucket warning stays, but say what it does **not** catch: a wrong pk prefix returns
_no rows at all_, so the bucket is empty and the warning never fires. `SKILL.md` must state that "zero
usage rows" is a **failure**, not "no reads yet" — `pull_ai_usage.mjs` exits non-zero when the scan
returns nothing while the registry has families.

**C9. The free correction, without reopening the bypass.**

A client that can say "this one is free" is the meter bypass 3.4 exists to prevent. So the grant is
**server-issued, server-verified, single-use, family-scoped, bound to the document, and fails toward
charging.**

**The grant row lives in the existing rate table** (`RATE_TABLE`), not the usage table:

```
pk = c#<sha256(familyId)>#<randomUUID>
attrs: kind (what the model answered), src (sha256 of the canonical source —
       the `text` string, or the `imageDataUrls` joined by
), expires_at (~1h TTL)
```

Three reasons it belongs there: the usage table is _billing evidence_ carrying PITR and prod deletion
protection (C6) and must not be backfilled with hourly junk; the rate table's hourly TTL horizon is
already exactly a grant's lifetime; and its IAM already grants `dynamodb:UpdateItem` and nothing else.
**No new table and no new IAM action** — an `UpdateItem` with `SET` creates a missing item, which is
already how every rate bucket is created, so 3.4's "`UpdateItem` only" stays true as written.

There is **one** new env var, and it is a kill switch rather than configuration: `CORRECTION_GRANTS`.
Unset ⇒ `openRead` never consumes and `closeRead` never issues, silently — the supported-no-op posture
`RATE_TABLE` already defines. That is what lets the Lambda half ship dormant (Sequencing) and lets a
production problem be switched off with a terraform variable rather than a rollback.

⚠️ **Update the rate table's own header comment in the same change.** It says the table has "no GSI and
no sort key ON PURPOSE" and describes every `pk` as a fixed hourly bucket. It now holds a second item
shape. Say so there, or the next reader treats a `c#` row as corruption. The `c#` prefix cannot collide with the
limiter's `f#`/`i#`. If `RATE_TABLE` is unset the grant is a silent no-op and corrections simply cost a
bean — the supported-no-op posture `rateLimit.mjs:196-200` already defines.

**ADR-030 posture, stated once.** `src` is a stored _document fingerprint_: a party holding both this
table and a candidate document can confirm the family read it. Accepted for the same reason and in the
same terms `rateLimit.mjs:29-37` accepts an enumerable IP hash — the only reader is whoever holds the
AWS account, who can already read far more — and bounded far tighter: one-hour TTL, no PITR on that
table, never logged. The document **bytes** never reach DynamoDB. Recorded here so it is a decision
rather than a discovery, and **do not raise the grant TTL**: the hour is the privacy bound, not just a
convenience.

The grant is written **after** the count, separately and best-effort — deliberately _not_ in a
transaction with it. A failed grant then just means no free correction; a transaction would let it
cancel the count, which is the all-or-nothing trap 3.4 rejected.

**The handler learns two verbs, not five touch points.** `index.mjs` is one linear
validate-then-call function and its own comment says why that matters (_"keeping this validation
section flat is why it stays readable"_). All meter state — which table, which attribute, `n` vs `c`,
the `c#` prefix, the count-before-grant ordering — lives behind
`infrastructure/lambda/ai-extract/meter.mjs`, exposing exactly two functions:

```js
// Once, immediately before the upstream fetch, after every pre-model refusal has returned.
const read = await openRead({ familyId, task, source, correction });
//   → { free: boolean, kindHint: ShareKind | undefined }

// Once, awaited, immediately before `return response(200, …)`.
const correction = await closeRead(read, { familyId, task, source, result });
//   → { token } | undefined, spread into the 200 body
```

`countUsage.mjs` and `correctionGrant.mjs` stay as the implementation modules; `meter.mjs` is the seam
that keeps their ordering invariant in one place and keeps `index.mjs` at two new lines. Both
invariants below become assertions inside `closeRead`, unit-testable without a handler fixture.

A correction request carries `correctionToken`, the corrected kind, **and the same source**. Inside
those two verbs, the Lambda:

0. **Validates the correction's shape before anything else, and 400s on a bad one.** Both fields are
   client-supplied, and one of them reaches the model's _instruction_, not its fenced source:

   ```js
   const SHARE_KINDS = new Set(['event', 'travel', 'recipe']);
   const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
   // 400 `bad_correction` if `to` is not in SHARE_KINDS or `token` is not a UUID.
   ```

   ⚠️ **`to` is a closed set checked server-side, and this is a security fence, not a formality.**
   `kindHint` is interpolated into the classification **instruction** — outside the
   `<<<BEANIES_UNTRUSTED_SOURCE>>>` fence that bounds the document. An attacker holding one
   legitimate grant (cost: one paid read) could send
   `to: "recipe. Ignore all prior instructions and …"` straight into the system prompt, on a call
   the family is not even paying for. The `ShareKind` union is TypeScript and does not exist at
   runtime in the Lambda; re-state the set in `meter.mjs` and assert it equals `Object.keys(TILES)`
   in a test, so a fourth kind is a test failure rather than a silent refusal of the new kind.

   The UUID check bounds the grant `pk` below DynamoDB's 2048-byte key limit — an oversized token
   otherwise throws `ValidationException`, is caught by the refusal arm, and is **charged**.

   A 400 here returns **before** the grant is consumed, so a malformed correction costs nothing and
   leaves the grant spendable.

1. **Consumes the grant atomically, immediately before the upstream call** (`index.mjs:221`) — after
   every pre-model refusal (401/413/400/429) has already returned. Before the model is what stops two
   concurrent replays both getting a free read; after the refusals is what stops a rate-limited or
   malformed correction silently spending the grant on a request that never reached a model.

   ```
   UpdateExpression:    SET #consumed = :t
   ConditionExpression: attribute_exists(pk)
                    AND attribute_not_exists(#consumed)
                    AND #kind <> :correctedKind
                    AND #src  = :srcHash
   ExpressionAttributeNames: { '#consumed': 'consumed', '#kind': 'kind', '#src': 'src' }
   ReturnValuesOnConditionCheckFailure: 'ALL_OLD'
   ```

   **Every** attribute name is aliased, for the reason `rateLimit.mjs:157-162` gives at length — except
   that here being wrong is worse: a `ValidationException` is caught by the same arm as a real
   refusal, logged as `correction refused`, and the family is charged for **every** correction forever
   while the banner keeps promising free. Do not audit the reserved-word list; alias.

   ⚠️ Verify two mechanics against the bundled `nodejs20.x` SDK _before_ relying on them:
   `ReturnValuesOnConditionCheckFailure` must be supported on `UpdateItemCommand` (an unsupported
   parameter is a `ValidationException` on every correction), and on failure the old item arrives on
   the **thrown error**, not a response. If unsupported, drop it and log without the sub-reason —
   refusal behaviour is unchanged, only triage detail is lost.

   All four guards — exists, unspent, not-a-no-op, **same document** — in one condition on one write,
   with no read grant and no second round trip. `ALL_OLD` returns the item on failure so
   `correction refused` logs the precise reason (`missing` / `spent` / `same_kind` /
   `different_source`) without needing `GetItem`. Any refusal → charge normally.

   ⚠️ **`src` is the load-bearing guard, and an earlier draft omitted it.** Without it: pay for a
   40-character text read, then "correct" it with an 8-page PDF (`MAX_IMAGES = 8`,
   `MAX_BODY_BYTES = 5 MB`) for free. The expensive half of every pair would be free, and the ceiling
   would be "one trivial text call per full vision call", not 2×.

2. **Re-runs the `share` task with a `kindHint`** — _not_ a per-kind task. `event` and `travel` are
   `sources: ['images']` (`extractionPrompt.mjs:379,385`) and `index.mjs:134-145` returns
   `400 unknown_task` for text on such a task, which `managedProvider` maps to `not_available` → the
   _"not set up yet"_ toast. So the headline case in 2.7 — a pasted invite corrected to `event` —
   would burn the grant and show copy naming the wrong problem. `share` already accepts images **and**
   text, so one task covers all six from/to pairs.

   `kindHint` is accepted **only on `share`, and only when a grant was just consumed** — one `if`.
   Without that clause any client could bias every extraction, which is the "what IS this?" guess
   Requirement 1 exists to remove. A _user-stated_ kind after seeing the result is categorically
   different from a _positional_ hint before the model has looked; say so in the prompt-builder
   comment so nobody reconciles the two.

   `buildShareExtractionMessages` gains a third parameter and one branch: with `kindHint` the
   classification instruction becomes _"this IS a `<kind>`; extract it as one"_, and the shape check
   tightens to `result.kind === kindHint` (else 502 `model_shape`). It keeps the response a
   `SharePayload`, so the banner re-enters `dispatchSharePayload` unchanged — a per-kind task would
   return a bare result needing three new hand-delivery paths.

   ⚠️ **Five call sites, not one, and the drift guard is one of them.** `buildMessages` is a
   **two-argument registry contract** today, called generically at `index.mjs:233` and _typed and
   called with two arguments_ by `extractionPromptDrift.test.ts:46,74-80`:

   1. `buildShareExtractionMessages(source, todayIso, kindHint)` in all **three** synchronised copies.
   2. `index.mjs:233` → `taskConfig.buildMessages(source, todayDate, kindHint)`. The other three tasks
      ignore the extra argument; do **not** add a per-task branch at the call site.
   3. `extractionPromptDrift.test.ts:46` — widen `TaskEntry.buildMessages` to three args **and add a
      hinted fixture** to the per-task loop (`kindHint: 'recipe'` on `share`, both source kinds).
      Without the fixture the hinted branch is the one piece of prompt text with **no drift guard at
      all** — the exact gap that file's own comment says let a fence bypass reach three copies
      unnoticed.

   The spike copy takes the branch too, even though nothing runs a hinted spike: the guard compares
   all three against the spike, so a two-copy edit fails CI by design.

3. **Is free of the client budget too.** `read()`'s text arm consumes `SHARE_TEXT_BUDGET`
   unconditionally before the model call (`:752-760`); skip it for a correction. Without this, "free"
   means "free of the server count but not of the client cap" — a distinction no user will make — and
   it fails loudest at 20 reads/hour, precisely when someone is correcting a lot: the correction is
   refused with a quota toast while the server grant sits unspent and expires. Assert that a
   correction succeeds at budget exhaustion.

4. **Skips the charge, but not the record.** `countUsage(familyId, { attr })` writes `ADD #n :one` for
   a charged read and `ADD #c :one` for a correction — one function, one write, one code path. The
   daily row becomes `{ n, c, expires_at }`, and `/beanies-metrics` reports **reads charged** beside
   **free corrections**. A rising `c/n` ratio is the only direct signal that the `src` binding or the
   no-chain rule has been breached, and it costs one attribute rather than a third metric filter.

**A grant is issued only when it is spendable: `task === 'share' && result.kind !== 'none'`.** One
condition, stated once, inside `closeRead`. A `none` result opens no review modal — there is no surface
a banner could mount on, so a grant for it is a row nobody can spend; and 2.7's promise is scoped to
_"beanies got the kind wrong"_, which is not _"beanies said it didn't know"_. **Say that in the Help
Center copy too:** an unrecognised read costs a bean and has no free retry (Assumption 1). The `recipe`
task (refetch) returns no kind at all. Without this condition C9 adds a second write to **every**
managed 200 — roughly doubling the function's DynamoDB traffic and writing hourly junk into the
limiter's table — for a grant most reads can never use.

**Two invariants, both asserted in `correctionGrant.test.mjs`:**

1. **A correction response never carries a token.** A grant is issued only on a request that arrived
   _without_ a `correctionToken`. Otherwise the kind rotates (`event → travel → recipe → event`),
   `kind <> :correctedKind` never fires, and one paid read buys an unlimited free chain.
2. **A grant is issued only when the count write succeeded.** `countUsage()` returns a boolean; the
   grant is written only on `true`. An uncounted read must not also buy a free one.

A request with no `familyId` is neither counted nor granted — there is no partition key for either row.

**Accepted, stated trade:** a correction consumed and then lost to an upstream failure (502/503/504)
loses its grant. The family is not charged (no 200 ⇒ no count) but must spend a bean to retry.
Re-issuing on the error path would thread a re-issue through six non-2xx returns inside one try block
for a rare case. Asserted in tests, so it is a decision rather than a discovery.

**Abuse ceiling, stated honestly.** With the source binding and the no-chain invariant, a family
claiming miscategorisation every time gets **at most one free re-read of each document it already paid
for** — bounded at 2× model cost, never more expensive than the read that paid for it.

That bound is doing real work, because the fences behind it are weaker than they look: `FAMILY_LIMIT`
(80/hour) is gated on `hasText` (`index.mjs:199`) and **does not cover the image path at all** — the
module's own alarm description says so (`modules/ai-extract/main.tf:243`) — and the API-Gateway route
throttle (burst 5 / rate 2) is per-_route_ across all callers, a shared-capacity fence rather than a
per-family cost fence. For a photo correction, the source binding **is** the fence. Do not weaken it
assuming something behind it will catch the overflow.

**The token rides two channels that already exist. No new plumbing.**

1. **Inbound** (missing from the first draft — `managedProvider` had no way to _learn_ the token),
   three hops matching the `familyId` precedent exactly: `ExtractOptions.correction?:
{ token: string; to: ShareKind }` → `ExtractionRequest.correction?` → `postToProxy` spreads
   `...(request.correction ? { correction: request.correction } : {})` beside `familyId`, under the
   same frozen-wire rule (_"a text source adds a field, never renames"_).

   **Outbound**, one hop: `ProxyBody.correction?: { token: string }`, and `managedProvider.run` gains
   one line beside the attestation assignment. BYOK and on-device omit both.

   ⚠️ The result field lands on `AttestedResult` because that is the interface every task result
   already extends and where the managed-tier-only precedent lives. **Update its doc comment and the
   purity invariant at `types.ts:1-10` in the same edit** — that block says the contract carries no
   transport concerns and names `attestation` as the _single_ documented exception. A billing grant is
   a second one. Name it, or the next reader concludes the invariant is already violated and stops
   treating it as a fence.

2. `ResultEnvelope` (`magicPayload.ts:142-176`) gains
   `correction?: { token: string; source: ExtractionSource }` — **`ExtractionSource`, not
   `ShareSource`.** They are different types and only one works: `ShareSource` is the spine's
   _pre-read_ union (and is module-private, so `magicPayload.ts` cannot even name it), while
   `ExtractionSource` is the _post-compression wire payload_ the server actually hashes. All three `deliverX` steps and all three
   review modals already receive `env`, so the banner reads `payload.env.correction` and three mounts
   really do cost three lines.

`env.correction.source` is the **prepared `ExtractionSource`** — the compressed `imageDataUrls`
actually posted, or the already-fetched `text` for a link. Never the `ShareSource`, never `files[]`. Retaining it is what makes the re-read the _same_ document
(the `src` binding refuses anything else) and what stops a link correction re-running
`resolveRecipeSource` and spending a second content-fetch slot. Three consequences that become bugs if
unwritten:

- **`jsonld` and `titleOnly` link resolutions never reach the model**, so they are never counted, never
  granted, and correctly show no banner. Say so, or someone will "fix" the missing banner.
- Document bytes live from the ingest to the review modal. Bounded by ADR-030's posture: cleared with
  `pendingMagic` and on the review modal's close, whichever is first. Never persisted.
- `sourceFile` on the envelope stays the original first `File` for the attachment contracts;
  `correction.source` is the prepared payload. Two fields, two jobs — do not reconcile them.

**Deliberately not** a fourth module ref or a field on `ingestState`: the ingest is over by the time
the review modal opens, and `ingestState` resets in `withIngestLock`'s `finally`.

**The correction is a third arm of `InAppInput`, not a third entry point.** The spine's header is
explicit (`useSharedDocumentIngest.ts:1103-1105`): _"Two entry points is the maximum this shape
supports; a third means the split above."_ A correction needs the whole tail (lock → offline → consent
→ `read` → `classify` → reader gate → resolve hold → dispatch) and **none** of the head — the source is
already resolved.

```ts
export type InAppInput =
  | { kind: 'file'; file: File }
  | { kind: 'paste'; text: string }
  /** A re-read of a document the spine has ALREADY resolved and paid for. Carries the
   *  ORIGINAL envelope verbatim, so the prepared source, the source File, the compressed
   *  thumbnail and the link provenance all survive — a corrected dish photo must still
   *  attach on save. Skips triage (it already ran) and the text budget (it is free). */
  | { kind: 'correction'; env: ResultEnvelope; to: ShareKind };
```

**The arm carries the whole envelope, not a `source` + `token` pair.** The token and prepared source
already live on `env.correction`, and carrying the envelope is what makes `sourceFile`,
`compressedBlob`, `truncated`, `link` and `origin` survive **by construction** rather than by four
hand-copied fields. `read()` builds a _fresh_ envelope per arm, so without this a dish photo
misread as travel and corrected to recipe would open the recipe form with **no photo to attach** —
silently, on a path the acceptance criteria claim to cover. `read()`'s correction arm therefore calls
`classify(result.data, { ...input.env, correction: undefined })`.

⚠️ `correction: undefined` is load-bearing, not tidiness: carrying the spent grant forward would
re-render the banner with a token the server will refuse — the free chain invariant 1 forbids,
produced client-side instead of server-side.

`inAppSource()` gains one arm returning the carried source unchanged; everything below
`withIngestLock` is the existing tail byte-for-byte. **The two-entry-point invariant stays true as
written**, and a correction is structurally incapable of drifting from a first read.

The banner calls `ingestInAppSource` like every other door. It mints its own consent (B4) and
deliberately does **not** fire `logCaptureOpened()` — a correction is not a new capture and must not
inflate the funnel denominator.

**No HMAC token.** The real reason is stronger than "it would need a new `TF_VAR`": single-use requires
server state regardless, so a stateless signed token could not be single-use at all.

**The bean rule becomes:** _a bean is spent once per thing you hand over — and if beanies gets the kind
wrong, putting it right is free, once._

**C8. No family id is a refusal, not a degrade.**
`familyId: string` catches omission but not absence (R11): the spine writes
`activeFamilyId ?? undefined` today. An unattributable read cannot be counted, and an uncounted read is
the loophole. Resolve once, in the spine:

Resolve once, in **one helper** — `src/composables/useMagicBeanScope.ts`. Two call sites need it (the
spine's `read()`, and `useRecipeRefetch`, which bypasses the spine entirely), and a fence written twice
is a fence with one live half:

```ts
/** The ONE answer to "which family is this read billed to". Returns null having ALREADY
 *  logged and toasted, so a caller simply returns. A read with no family is refused
 *  BEFORE the model — it costs nothing (Assumption 3) and is never uncounted. */
export function resolveBillableFamilyId(env: IngestEnv): string | null {
  const familyId = useFamilyContextStore().activeFamilyId;
  if (!familyId) {
    notReady(env, 'no_family', 'shareTarget.notReady.title', 'shareTarget.notReady.message');
    return null;
  }
  return familyId;
}
```

⚠️ `notReady` is currently module-private in the spine. Export it, or move it with the helper — do
**not** write a second toast-and-log pair, which is the divergence that function's own comment warns
about.

`awaitReadiness` already establishes `currentMember` on the share path, so this is a should-not-happen
on both doors — which is precisely why it must be loud rather than `?? undefined`. Log
`action: 'not_ready', detail: 'no_family'` so its real frequency is measurable before enforcement
ships, and ban the `familyId: … ?? undefined` shape at review so the fence cannot be reopened by a
one-character edit.

### Part A — one surface, every door

**A0. One door component, mounted six times.**
The plan's own shorthand was "the same pattern four times". That pattern is ~40 lines with **four
invariants that must all be right at every copy**: the picker must be mounted _outside_ the sheet or
the native camera loses its `change` handler (`MagicReaderCard.vue:14-19`); every handler must close
the sheet _before_ the ingest starts (`MagicBeansSheet.vue:27-31`); `logCaptureOpened()` must fire at
the tap, not at the ingest; and the consent mint must sit between the commit and the picker (D5). Six
hand-maintained copies of a four-invariant protocol is the largest maintenance liability this plan
could create, and a seventh door would repeat it again.

Extract `src/components/ai/MagicBeansDoor.vue` — the wiring lifted verbatim from
`MagicReaderCard.vue:32-73,99-106`. It renders a `#trigger` slot (each page keeps its own affordance,
per 1.2), owns the sheet and the picker, and exposes `open()` for `VacationStep1`'s payload-less path.
`MagicReaderCard` is refactored onto it in the same change and keeps only its gradient card + button.

Each page door then reads, in full:

```vue
<MagicBeansDoor>
  <template #trigger="{ open }">…the page's existing button…</template>
</MagicBeansDoor>
```

**The gate moves with the door.** `MagicBeansDoor` self-gates on `canReadAny` and renders nothing
otherwise — the gate `MagicReaderCard.vue:76` already uses, now applied uniformly. The per-kind gates
on the pinned doors (`canReadPhoto` on the planner, `canReadDocument` on travel) are **removed**:
after unification each door can produce any kind, so a per-kind gate would hide a working affordance.
`VacationStep1`'s banner goes **inside** the `#trigger` slot like every other door, so the gate removes
the affordance and its trigger together. If a call site genuinely cannot use the slot, `open()` must
log `action: 'not_ready', detail: 'no_reader'` and toast rather than return silently — a `?.open()`
that no-ops is a dead button with no trace, and A0 exists to stop exactly that class of per-copy
mistake.

This is a deliberate, visible behaviour change — with `aiTravelExtract` off and `aiPhotoExtract` on,
Travel now shows a magic-beans button that can still make an activity. Both flags are on in prod, so
it is a dev-gating difference today. It is also what makes D3's degenerate pre-check exactly
equivalent to `canReadAny === false`, which D3 relies on.

That is what makes 1.2 sustainable: "each page keeps its own affordance" costs one slot, not one copy
of the capture protocol. The four invariants live in one file with one comment block, and a fifth door
becomes a mount rather than a review.

**A1. The wedges lose their capture half and keep their delivery half.**
A naive "delete the three wedges" breaks recipes. `useRecipeCapture` holds composable-local
`pendingSource` / `pendingCompressed` (:117, :128) and `useRecipePhotoPending()`, and
`attachAfterSave` only works on **the same instance that ran the capture** (:136-139,
`FamilyCookbookPage.vue:185-195`). So the split is:

| Half                                                                                                                        | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture guards + the raw extract call**                                                                                   | **Deleted from the four page doors.** The spine already does all of it, better.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **`processFile`**                                                                                                           | **Deleted** — no surviving caller once the doors move to the sheet. Verify with `grep -rn "capture.processFile\|processPhoto\|processTravelDoc" src/` before removing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **`processUrl`**                                                                                                            | ⚠️ **KEPT.** `useRecipeRefetch.ts:169` calls it with a known recipe's `sourceUrl`, needs the **`recipe`** task (classifying a known recipe as `event` is wrong by construction), delivers into its own `onRecipeReady` so it can `diffRecipe` against `target`, and has its own `REFETCH_BUDGET`. Refetch is not a magic-beans door and is out of scope for unification.                                                                                                                                                                                                                                                                                   |
| **Delivery** — `deliverEvent` / `deliverTravel` / `deliverRecipe`, plus recipe's `attachAfterSave` / `discardPendingSource` | **Kept, unchanged.** Already the `useMagicReaderConsumer` targets, already sharing `ResultEnvelope`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **The three per-kind service entry points**                                                                                 | **Deleted.** `extractEventFromDocument`, `extractTravelFromDocument` and `extractRecipeFromDocument` lose their last non-test callers with the capture halves. Not merely dead code: they are three typed, exported ways to reach the model **bypassing the spine** — and so bypassing C8's family fence, the shared lock and the size checks. The meter's premise is that the client has one path to the model; closing the door behind us makes that true by construction rather than by review. `extractShareFromDocuments`, `extractShareFromText`, `extractRecipeFromText` (refetch) survive, and `extractShareFromPreparedSource` is **added** (C9). |

⚠️ **Pass 2 caught this as a blocker.** The first draft said "`processFile` / `processUrl` — deleted",
which would have silently removed recipe refetch. There are **three** `useRecipeCapture()` instances,
not two: `FamilyCookbookPage.vue:81`, `RecipeFormModal.vue:309` and `useRecipeRefetch.ts:66`.

This is why the change is smaller than it looks: the dispatch channel
(`dispatchSharePayload` → `readerForShareKind` → `useMagicReaderConsumer` → `deliverX`) already
exists and already works — the FAB and the share target use it every day. The four pinned doors are
simply not plugged into it.

**A2. It also removes a real duplication.** `useRecipeCapture.processUrl`'s four-way
`resolveRecipeSource` switch (:474-552) is duplicated near-verbatim by the spine's `read` link arm
(:800-891). Collapsing deletes one of the two.

**A3. Each page's trigger becomes: open the sheet.** `handleAddFromPhoto` /
`handleAddFromDocument` stop calling `picker.pick()` and instead open `MagicBeansSheet`. The sheet's
`submit` / `camera` / `file` emits route into `ingestInAppSource`, exactly as `MagicReaderCard` does
today. `AiDocumentPicker` stays mounted per page (it must stay outside the sheet — native camera
intent backgrounds the app, `MagicReaderCard.vue:14-19`).

**A4. `MagicBeansSheet` must keep closing before ingest starts.** Its header documents three things
that break otherwise (`z-[60]` collision with `AiProcessingOverlay`, the body-scroll lock, and
`openQuickAdd()` refusing while an overlay is open). Every new door inherits this ordering.

**A5. `RecipeLinkModal` and `RecipeSourceStrip` lose their URL fields to the sheet.** The sheet
accepts a link as text and `sourceFromText` routes it — the same code path the share target uses for
a shared link today. **This does lose `routeUrl` validation at the input**, which is a real
difference: today the modal disables Save until the URL routes. The mitigation is that
`sourceFromText`'s link arm reports `recipeExtract.badLink.*` on an unroutable link — **but only when
`prose < MIN_SHARE_TEXT_CHARS`** (`:480`). Paste a mistyped recipe URL with a sentence around it and it
falls through to the **text arm**, spends a bean, and returns `kind: 'none'` with no link message at
all.

**Decision (not an open question):** `MagicBeansSheet` keeps a **non-blocking inline hint**. When the
trimmed input is a single token that parses as URL-ish but fails `routeUrl`, render
`t('ai.capture.badLinkHint')` in the hint slot `ai.capture.hint` vacates — no layout change, no net
new element. Save is **never** disabled by it: the sheet's "empty is the only thing refused" contract
(`MagicBeansSheet.vue:72-73`) is load-bearing, because deciding what the content is _is_ the feature.
`routeUrl` survives `useRecipeLinkInput`'s deletion via direct import.

**A6. Local delivery, for the one door that fills itself in.**
`RecipeFormModal` cannot dispatch by kind. It runs its own capture and delivers into **itself**
(`:308-310`), and its header records why: emitting upward "worked on the cookbook and silently did
nothing everywhere else… visible and dead in four places out of five." Dispatch would
`router.push('/pod/cookbook')` — **unmounting the form the user is filling in** at five of its six
**five** mount points (`MealEditModal`, `RecipeRail`, `FavoriteFormModal`, `RecipeDetailPage`,
`FamilyCookbookPage`). That is a hard regression, not a caveat.

`ingestInAppSource` gains one optional argument — **not** a flag on `IngestEnv`, whose header
(`:60-68`) forbids it carrying behaviour:

```ts
/**
 * A door that fills ITSELF in rather than dispatching by kind. Exactly one exists.
 * An object, not a bare callback, so a second concern is a FIELD here rather than a
 * fourth parameter — and so `ingestInAppSource` never grows a third optional argument.
 */
export interface InAppDestination {
  /** Offered the payload FIRST. `true` keeps it here; `false` falls through to
   *  `dispatchSharePayload`, so requirement 1.3 still holds for a mismatched kind. */
  claim(payload: SharePayload): boolean;
}

/**
 * Everything a door hands the spine, as ONE object. Positional parameters are how this
 * function grew three arms in a single change; a fifth concern is a FIELD here.
 * `IngestEnv` stays a LABEL (see its header) — behaviour lives in this object, not there.
 */
export interface InAppCapture {
  input: InAppInput;
  /** Minted by the door when the user COMMITS a source (D5). Required — an unthreaded
   *  call site is a compile error. */
  grant: ConsentGrant;
  destination?: InAppDestination;
}

export async function ingestInAppSource(capture: InAppCapture): Promise<void>;
```

`runIngest(source, env, ctx)` takes the same object minus `input`. One argument crosses the lock, so a
future concern is a documented field with a named call site rather than a fourth positional every
existing site skips with `undefined`.

`runIngest` calls `destination.claim(payload)` immediately before `dispatchSharePayload` and skips the
dispatch when it returns true. The recipe form accepts `kind === 'recipe'` and returns false otherwise
— so a school invite pasted into the recipe form still becomes an activity on the Activities page, and
a recipe still fills in the form the user is looking at, from all five mount points.

**A throw from `claim` falls through to `dispatchSharePayload` and is reported** with the same message
and severity `consumePendingMagic` already uses for a vanished billed capture
(`useMagicReader.ts:216-236`). That is the one error path meaning "we charged a bean and lost the
answer", and it must have one report, not two.

`destination` has exactly **one** call site: `MagicBeansDoor` (A0) forwards a `claim` prop. Five doors
pass none; the recipe form passes one. That is what stops an optional parameter becoming a convention.

The form **keeps its own in-form overlay** (`:569-581`, scoped to the fields because every field is
about to be overwritten) — **not** for a z-index reason. `RecipeFormModal`'s `layer` prop union is
`'base' | 'overlay'` (`:57`), so no mount can reach `BaseSidePanel`'s `'top'`/`z-[250]`; Pass 1's
justification was factually wrong. The real reason is better: the overlay is **scoped to the fields**,
and a full-screen global one would hide the very thing the feedback is about.

⚠️ **One mount point has a genuine stacking defect that must be fixed here.** `MealEditModal.vue:306`
is the only site passing `layer="overlay"`, putting the form's panel at `z-[60]` — above
`MagicBeansSheet`'s backdrop at `z-[55]`. Opening the sheet there leaves the form **un-dimmed and
interactive** behind it.

Fix in **one place**: change `MagicBeansSheet`'s own hardcoded `layer="overlay"` to `layer="top"`
(`:76`; `'top'` is already in `BeanieFormModal`'s union → `z-[245]/z-[250]`). Safe at every mount **by
construction**, not by inspection: the sheet's own invariant is that it closes before any ingest
starts, so it is never co-resident with `AiProcessingOverlay` (`z-[60]`) or with the consent prompt,
which now opens after the sheet closes (D5). A per-door `layer` prop would hand a stacking decision to
every future door. Screenshot the `MealEditModal` mount specifically.

**Rewrite the sheet's header in the same edit.** Reason 1 of the three at `MagicBeansSheet.vue:27-30`
— _"`AiProcessingOverlay` is `z-[60]` and so is this panel"_ — stops being true at `layer="top"`, and a
load-bearing invariant with a visibly false justification is one a future reader decides is stale:

> ⚠️ Every action closes this sheet BEFORE starting the ingest, and that must not be relaxed. Two of
> the three original reasons still hold: `useFullscreenOverlay` holds a body-scroll lock, and
> `openQuickAdd()` refuses outright while any overlay is open, which would leave the FAB dead until a
> reload. The third — a z-index collision with `AiProcessingOverlay` — went away when this moved to
> `layer="top"` (z-[250]); that move is SAFE BECAUSE of this ordering, not a replacement for it. Do
> not reason backwards from the z-index.

Body-scroll and Escape need no work: `useBodyScrollLock` delegates to the ref-counted `overlayStack`
primitives and `useEscapeClose` keeps a module-level stack closing only the top-most. Both handle
nesting by design.

**Overlay ownership is derived from the claim, not configured separately.** A door that keeps the
payload is by definition the door the user is looking at, so the two facts are one: the destination
argument sets `presentation: 'local'` on `ingestState` (B3), and `isReadingSharedDocument` becomes:

```ts
export const isReadingSharedDocument = computed(() => {
  const s = ingestState.value; // read ONCE — narrowing a `.value` getter
  return s.phase !== 'idle' && !consentOpen.value && s.presentation === 'global';
});
```

One local `const` is what makes the union narrow; re-reading `ingestState.value` in each operand does
not, and an `as` at that call site would defeat the whole point of the discriminated state.
`App.vue:1969` is unchanged. The global overlay then cannot double
up **by construction** rather than by a check somebody has to remember to re-run. Deliberately no
separate `showGlobalOverlay` flag: two flags for one fact is how they drift.

**A3a. `pendingTripTarget` must be cleared on every non-travel outcome.**
`TravelPlansPage.vue:109` sets it at the tap and clears it only on a consent decline. Once the sheet
can produce an activity or a recipe, a capture opened from a trip's detail page can dispatch to
`/activities` leaving the target set — and the **next** travel capture silently attaches to the wrong
trip. Clear it on the consumer's entry and on the sheet's `@close`, so only a travel payload can
preserve it. Assert it in a test; silent mis-attachment is the failure mode.

**A2a. Close the prompt gap before collapsing the recipe link path.**
Collapsing `processUrl` onto the spine swaps the **`recipe`** task for the **`share`** task, and they
are not equivalent. `buildRecipeExtractionMessages` carries four recipe policies — the `inferred=true`
rule on quantities and timings, "write the recipe in your own words", the `isRecipe=false` rule, and
"notes one per line". `buildShareExtractionMessages` carries only the `inferredTimes` exception. The
`inferred` flag drives the form's "we guessed this" highlighting, which would silently stop being
accurate. Shape validation weakens too: `RECIPE_REQUIRED_KEYS` is five keys, `SHARE_REQUIRED_KEYS` is
`['kind']`, so a malformed recipe returns 200 — and under C4 **spends a bean** — instead of a 502.

Extract the four policy lines into `const RECIPE_POLICY_LINES` and splice them into
`buildShareExtractionMessages`' recipe block **in all three synchronised copies** —
`src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` and
`scripts/spikes/extractionPrompt.mjs` — and **bump `PROMPT_VERSION`** (currently `'2026-09-07.1'`) in
all three. `extractionPromptDrift.test.ts:30,51,71` asserts version, required keys, shape, sources and
built messages across all three; **a two-copy edit fails CI**. Real DRY win too: the `inferredTimes`
sentence is written verbatim twice per copy, six times across the tree.

⚠️ **Deploy order is load-bearing.** The Lambda carries the splice; the bundle carries the doors that
depend on it. Apply and verify the Lambda deploy in production **before** shipping the bundle that
moves recipe capture onto the `share` task — otherwise every cookbook recipe silently loses its
`inferred` flags and its five-key shape validation, and a malformed recipe returns 200 (spending a
bean) instead of 502.

### Part B — the UI, and three places the codebase overrules the mockup

**B1. The sheen is not new CSS.** `.magic-shimmer` already exists as a shared global class
(`src/style.css:720-753`): `@keyframes magic-sheen`, the same 105° gradient, `overflow:hidden` +
`position:relative`, and it is already listed in the `prefers-reduced-motion` kill-switch (`:448-453`).
Four components use it. Writing a second sheen would be the duplication Pass 2 exists to catch.

The one real gap: its gradient is **white at 32%**, designed for use _on_ the orange gradient. The
tinted header band is orange-on-light, where a white sheen is invisible. Extend rather than fork:

- Add `--magic-sheen-color` (default `rgb(255 255 255 / 32%)`) to `.magic-shimmer::after`, so all four
  existing call sites are byte-identical in behaviour.
- Add two speed modifiers, `.magic-shimmer--slow` and `.magic-shimmer--busy`, overriding only
  `animation-duration`.
- The tagline band sets `--magic-sheen-color` to a Heritage Orange tint.

One class, one keyframe, one reduced-motion entry — which already covers every variant because it
targets `.magic-shimmer::after`. Three mechanics that are silently wrong if guessed:

- Use the **inline fallback** form so no new declaration block touches `.magic-shimmer`, making the
  four existing call sites unchanged _by construction_:
  `background: linear-gradient(105deg, transparent 32%, var(--magic-sheen-color, rgb(255 255 255 / 32%)) 50%, transparent 68%);`
- **Three** modifiers, all targeting the pseudo-element: `.magic-shimmer--slow::after` and
  `--busy::after` override `animation-duration` only; `--once::after` overrides
  `animation-iteration-count: 1` plus `animation-fill-mode: forwards`. The base rule is
  `4.4s … infinite`, so a duration-only modifier on the resolved tile would sweep **forever** behind
  the review modal. Written on the element rather than `::after` they compile, pass lint, and do
  nothing — and they must be declared **after** the base rule in `style.css`: identical specificity
  (0,1,1) means source order alone decides, and above it the longhand overrides are wiped by the base
  `animation:` shorthand. Same failure, quieter symptom.
- `.magic-shimmer::after` has no `z-index`; `MagicReaderCard.vue:88` works around it with
  `relative z-[1]` on its content. The tagline band's text needs the same or it sits under the sheen.

**B2. The title is already correct, and the ✨ belongs in the icon box.**
`ai.capture.title` is already `'Magic beans'` / `'magic beans'`, and the sheet already passes
`icon="✨"` with `icon-bg="var(--tint-orange-8)"`. `BeanieFormModal` renders that as a 44px
`rounded-[14px]` icon box — the house pattern every other modal uses. The mockup drew the ✨ inline
beside the title; **the CIG's modal header wins.** The design intent (the feature's name and its emoji
at the top) is delivered by the existing header, and no change is needed there at all.

Consequence: `customHeader` is **modal-only** (`BeanieFormModal.vue:108`, gated on
`variant === 'modal'`), and this sheet is a drawer. So the tinted band cannot be the modal header. It
becomes the **first element of the body** — a tagline band carrying the Caveat line, tinted and
shimmering, directly under the standard header. This is a better fit anyway: the header stays
consistent with every other drawer in the app, and the band reads as the feature's own flourish.

**B3. The resolve moment cannot live in the sheet — and its real home is better.**
`MagicBeansSheet.vue:27-31` states that every action closes the sheet **before** ingest starts, for
three concrete reasons: `AiProcessingOverlay` is `z-[60]` and so is the panel, `useFullscreenOverlay`
holds a body-scroll lock, and `openQuickAdd()` refuses while any overlay is open — which would make
the FAB dead until a reload. The mockup's reading and resolved states are drawn inside the sheet, and
they cannot be.

They belong in **`AiProcessingOverlay`**, which is already "deliberately the same z-layer and
treatment everywhere, so the reader looks identical whichever door the document came through"
(`:11-12`). That is exactly the right home, and unification collapses its **four** mount points
(`App.vue:1969`, `FamilyCookbookPage.vue:517`, `TravelPlansPage.vue:1472`, `FamilyPlannerPage.vue:966`)
to one — plus `RecipeFormModal`'s deliberately-scoped in-form overlay, which stays (A6).

So the design splits across the transition, which actually strengthens it:

| Where                             | What the three tiles do                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **In the sheet**, at rest         | A capability statement: _I can make an activity, a trip, or a recipe._ Faint, unlabelled, no motion beyond the tagline band's slow sheen. |
| **In the overlay**, while reading | The same three tiles, ticking.                                                                                                            |
| **In the overlay**, on resolve    | Two fade, one lifts into the Heritage Orange → Terracotta gradient with a single sheen pass, then the review modal opens.                 |

Carrying the same three tiles across the sheet→overlay transition is what makes the resolve read as an
answer to a question the surface already posed.

⚠️ **The resolve needs an explicit hold or it renders for zero frames.** `App.vue:1969` binds
`:open="isReadingSharedDocument"` = `isIngesting && !consentOpen`. `runIngest` calls
`dispatchSharePayload` and returns; `withIngestLock`'s `finally` clears `isIngesting` in the same tick.
So "two fade, one lifts, then the review modal opens" would never be seen. Add, between the classify
log and the dispatch:

```ts
/** Everything the reading UI needs, as ONE value — so a reset is one assignment and
 *  cannot half-clear. Add a field here, never a sibling ref. */
type IngestState =
  | { phase: 'idle' }
  | { phase: 'reading'; presentation: 'global' | 'local' }
  | { phase: 'resolved'; presentation: 'global' | 'local'; kind: ShareKind };

const ingestState = ref<IngestState>({ phase: 'idle' });
```

`isIngesting` is replaced by `ingestState.value.phase !== 'idle'`, `withIngestLock`'s `finally`
becomes a single `ingestState.value = { phase: 'idle' }`, and `isReadingSharedDocument` becomes a
derived computed so `App.vue:1969` is unchanged. Between the classify log and the dispatch:

```ts
ingestState.value = { ...reading, phase: 'resolved', kind: outcome.kind };
await holdForResolve(); // RESOLVE_HOLD_MS, or 0 under reduced motion
```

Three refs that must be reset together, in a `finally` in a different function from where two of them
are set, is the shape a future change half-updates — the draft had already needed a warning sentence
about it, which was the smell.

- `RESOLVE_HOLD_MS` is one named constant (~700ms) commented as **the only deliberate latency in the
  pipeline**, and why it is there.
- `0` under reduced motion. The repo has exactly one JS reduced-motion check
  (`SmoothHeight.vue:21-23`), and it is evaluated **once at module load**. Extract
  `src/utils/prefersReducedMotion.ts` exporting a **function** that queries `matchMedia` at call time,
  and move `SmoothHeight` onto it (calling it inside the watch, not at module scope). A module-level
  const would freeze the answer at import — wrong after an OS setting change, and untestable without
  module-cache games, on a value that now gates a deliberate 700ms latency and an acceptance criterion.
- The hold runs **only** on a dispatched outcome — never on `none`, never on a refusal.

**B4. "not right?" — free, and where it lives.**
An earlier draft cut this, on the grounds that a re-route costs a second model call. It does; greg's
answer is that we should not bill the family for our own miscategorisation. That is the right call and
it makes the pricing promise stronger, not weaker.

The mechanics are in **C9** (a server-issued, single-use correction grant — a client simply asserting
"don't charge me" is exactly the bypass Pass 4 killed). The UI:

- **It does not live in the overlay's resolve beat.** That hold is ~700ms — far too short to read an
  answer and click. Putting it there would either stretch the only deliberate latency in the pipeline
  into something users wait through, or ship an affordance nobody can hit.
- **It lives in the review modal**, which is where the user has evidence. That was the original
  argument for the feature: a question they can now answer correctly _because they can see what
  beanies made of it_.
- **One shared component, three mounts.** `MagicMiscategorisedBanner.vue` — a quiet line under the
  review modal's header: _"Not an activity? Tell beanies what it is."_ Mounted by `ActivityModal`,
  `TravelExtractReviewModal` and `RecipeFormModal`, three lines each.
- **The banner closes its host review modal BEFORE starting the correction** — the same invariant
  the sheet has, for the same reasons plus one. The host _is_ a review modal, and the correction's
  whole purpose is that it is the wrong one; leaving it mounted stacks two review modals, routes under
  an open modal, and at the `MealEditModal` mount puts a `z-[60]` form panel level with the global
  `z-[60]` overlay. Order, in the banner's own handler: `refuseIfBusy(env)` → `requestConsent()` →
  emit `close` to the host → `await nextTick()` → `void ingestInAppSource({ … })`.
- **A correction uses the GLOBAL overlay** (`presentation: 'global'`) — its host has just closed and
  there is no local surface to scope to. So it gets the full reading → resolve → dispatch sequence,
  which is the right feedback: the resolved tile _is_ the answer to the question just asked.
- **`pendingTripTarget` is cleared on the banner's tap too**, not only on the sheet's `@close` (A3a).
  A correction away from `travel` is exactly the silent mis-attachment A3a describes.
- Closing `RecipeFormModal` to run a correction discards its in-progress fields. Correct — the user
  has just said the form is the wrong shape — but visible, so it is in the acceptance criteria.
- **The picker is the existing `ChoiceModal`**, fed from the same module 2.6 declares, filtered to
  `kind !== current`. That module is `Record<ShareKind, { emoji: string; icon: string }>` — **two**
  renderings of one vocabulary: `emoji` for the destination tiles, `icon` (a BeanieIcon name) for
  `ChoiceModal`, which renders `<BeanieIcon :name="opt.icon">` and **cannot show an emoji**
  (`ChoiceModal.vue:12-18,42-44`). One module, two consumers, a fourth kind a compile error at both.
- **`ChoiceModal` gains an optional `layer` prop**, defaulted to `'overlay'` so all four existing call
  sites are unchanged, forwarded to `BaseModal`. The banner passes `layer="top"`. Without it the picker
  sits at `z-[60]` — the same layer as `RecipeFormModal` at its `MealEditModal` mount — so source order
  alone decides whether it is visible. Same class of defect A6 fixes for the sheet; fix it the same way
  in the same change rather than leaving it a "verify".
- **It renders when the correction is _available_, and that predicate lives in ONE place** — the
  banner itself, reading `useAiCapability().tier` internally. The three mounts pass only
  `:env="payload.env"` and their own `from` kind; none reasons about tiers. The rule is
  `tier !== 'managed' || env.correction != null`. A grant is a managed-tier **billing artefact**
  (Assumption 8) — BYOK and on-device reads never reach
  the Lambda, cost us nothing, and need no exemption to be free. Gating on the token alone would
  silently remove the feature from exactly the families we are not paying for.
- **The correction mints a fresh consent grant.** Same document, but a **new user action on a
  different surface**, and `useDocumentConsent.ts:44-52` is explicit that one prompt answers for
  exactly one document — a grant stashed on the envelope and replayed later is the precise failure
  that header describes. `skipDocumentConsentPrompt` families see nothing. A decline logs
  `consent_declined`, leaves the grant unspent (it is only consumed server-side), and the banner stays
  offered.
- The banner reads its state from the same module the tiles do, so the kind vocabulary stays
  `ShareKind` throughout (2.6) and a fourth kind remains a compile error.

**B5. Copy changes**, all needing `en` + `beanie`:

- **New** `ai.capture.tagline` — `en`: `give us something to read and we'll work out the rest`,
  `beanie`: identical. Lowercase in both, matching the CIG's Caveat precedents.
- **New** `ai.correct.prompt` / `.action` / `.picked` — the banner's line, its affordance, and the
  confirmation. `en` + `beanie`. Per the beanie-mode floor these keep the real nouns: a correction is
  about data being wrong, so "activity", "trip" and "recipe" stay as themselves in both registers.
- **New** `ai.capture.badLinkHint` — the non-blocking URL hint (A5), `en` + `beanie`.
- **New** `ai.capture.dest.event` / `.travel` / `.recipe` — the tiles' accessible names, keyed by
  `ShareKind` so `t()` templates on the kind (2.6). Named after the kind, not the product noun,
  because the kind is what the rest of the system is keyed on.
- **Changed, not added:** `ai.processing`. It reads _"Reading your photo…"_ and is shown for link and
  text captures too, across **three** call sites (`AiProcessingOverlay.vue:32`,
  `RecipeFormModal.vue:576`, `ShareTargetPage.vue:76`). `en` becomes `Counting beans…`; `beanie` is
  already `counting beans…`. One key, three call sites, the copy bug closed everywhere.
  **Do not add `ai.capture.reading`** — a second key for the same sentence is the duplication this
  pass exists to remove.
- **Remove** `ai.capture.hint` (_"An invite, a booking, a recipe — beanies works out which it is."_) —
  the three tiles now say exactly this, and greg's instruction to drop the destination header applies
  to the sentence too.
- **Keep** `ai.capture.title`, `.action`, `.label`, `.placeholder` unchanged.

**B6. `RecipeSourceStrip` keeps its warm kraft treatment.** It is deliberately the one magic surface
that is not the orange gradient (`bg-[#fbf3e3]` + an orange hairline), because it "reads as an offer
rather than a required step". Its link field routes to the sheet, but the band itself is not restyled.

### Part D — the six defects, honestly assessed

Three close as a consequence of unification. Two need their own fix. **One cannot be fully closed and
the plan says so rather than pretending.**

**D1 (two locks) — closes for the six doors, with ONE stated exception.** Every door routes through
`ingestInAppSource`, which wraps `withIngestLock` on the module-global `isIngesting`; the per-wedge
`isProcessing` refs die with the capture halves, and the audible `shareTarget.busy.*` replaces four
silent `return`s.

⚠️ The exception is `useRecipeCapture.processUrl`, kept for refetch (A1), whose `isProcessing` guard at
`:445` is composable-local. **A kept path is not an unchanged path**: refetch is brought under the same
same family fence (C8) — **but the fix is a guard, not the lock.** Wrapping `processUrl` in
`withIngestLock` would refuse _after_ `requestConsent()` and _after_
`consumeAttempt(key, REFETCH_BUDGET)` (`useRecipeRefetch.ts:159-167`), spending a budget slot and a
prompt on a refusal; and `withIngestLock` needs an `IngestEnv`, which refetch — explicitly not a
magic-beans door — has no honest value for.

So `refetch()` calls `refuseIfBusy` **first**, before `isOnline`, before `peekAttempt`, before consent.
That gives mutual exclusion in the direction that matters (refetch will not start on top of a capture)
and not the other (a capture can start on top of a refetch; `isProcessing` still guards refetch against
itself). **Say that trade in the code comment** rather than claiming 4.1 is six-sixths closed.

**D2 (size/type) — closes for free.** `inAppSource` (:1138-1176) already does the 25 MB check and the
byte-sniff, with the two-message split the spine's comment justifies. Every door inherits it.

**D3 (billed then refused) — PARTIALLY closable, and this is a correction to the brief.**
The gate at :1035-1047 sits after `read()` because **the kind is unknown until the model answers** —
it cannot simply be moved earlier. What _can_ move earlier is the degenerate case: if the member has
**no** reader enabled at all, refuse before the model, which is cheap and honest. The partial case (a
travel result for a member with travel off) still costs a bean, and the only way to close it would be
to tell the model which kinds are acceptable — i.e. bias extraction by capability, which is the thing
Requirement 1 exists to avoid. **Proposal: fix the degenerate case on the SHARE PATH, where there is no UI gate to catch it.** The
five in-app doors are already gated — `isReaderEnabled('recipe')` reduces to `canEditActivities`
(recipe declares no flag), so "no reader at all" ≡ `canReadAny` false, and `MagicReaderCard.vue:78`
already refuses to render for such a member. The pre-check therefore changes nothing in-app; it closes
the share target, which has no UI gate. Log the partial case with `action: 'reader_disabled'` (already
emitted, `:1039-1044`) and leave it documented. Both flags are on in prod, so the partial case is a
dev-gating edge, not a user-facing cost.

**D4 (no observability on activities) — needs its own fix, and it is the largest telemetry gap.**
`useDocumentToActivity` emits exactly two lines of telemetry in the whole file: one `reportError` in
`deliverEvent`. It has no `start`, no `ready`, no `failed`, so there is **no denominator** — the
activity reader's failure _rate_ is unmeasurable. Unification fixes most of it for free (the spine
emits `capture opened` / `classified` / `ready` / `failed` under `magic-beans-capture`), but the
`deliverEvent` half that survives still needs a `ready` event to match travel's and recipe's.

**D5 (consent order) — fixed, and neither current order is the answer.**
Today the pages ask _before_ the picker; the FAB asks _after_ a file exists, which
`AiDocumentPicker.vue:8-14` defends as deliberate ("the type is unknown until the content exists") —
but it means declining discards a photo already taken. Unifying naively on the FAB's order would
spread that regression to four more doors.

The better rule, available only now that there is one surface: **request consent when the user
commits a source — submitting the paste, or tapping camera/file — and before the picker opens.**
Consent is about "may beanies send this to the AI", which has nothing to do with the content's type,
so the FAB's original justification does not actually require asking late. This is consent-first
everywhere, uniform across six doors, and no work is ever discarded. `requestConsent()` is already a
singleton with the `skipDocumentConsentPrompt` short-circuit, so most families see it once ever. Two consequences it must carry:

- **Refuse-if-busy comes FIRST, then consent, then the picker, then the lock.** `withIngestLock` is
  taken inside `ingestInAppSource` — _after_ the door has prompted for consent and opened the camera.
  So a second door tapped during an in-flight capture would prompt, shoot a photo, and only then be
  refused, **discarding a photo already taken** — the exact regression D5 exists to remove,
  reintroduced one layer down. The spine exports `refuseIfBusy(env): boolean` (emitting the existing
  `action: 'busy'` event and toast); `MagicBeansDoor` calls it at the **commit** — the `submit`/`camera`/`file` handler, as its first
  statement, immediately before `requestConsent()`. **Not** at sheet-open: the sheet can sit open for a
  minute, and a busy check made then is answered before the question exists.
  The window between check and lock is one gesture on a single-threaded UI, and the lock inside the
  spine remains the authority.
- **The grant is threaded, and `runIngest` never mints one.** `runIngest(source, env, grant)` takes a
  **required** `ConsentGrant`; the `requestConsent()` call at `:1009` moves out to _both_ entry
  points. In-app, `MagicBeansDoor` mints it when the user commits a source, before the picker; on the
  share path `ingestSharedContent` mints it immediately after `prepare()` returns a usable
  `ShareSource`. Both orderings become the same rule — _consent before any bytes leave the device,
  offline check after_ — with no optional parameter and no "which door am I on" branch inside the
  spine. An unthreaded call site is a compile error, the same discipline `IngestEnv`'s header asks for.
  Leaving the share path to "keep minting internally" would re-create, one layer down, exactly the
  divergence D5 exists to remove.
- **It inverts consent and the offline check.** Today `runIngest` tests `isOnline` at `:1001` before
  consent at `:1009`; consent-first means an offline user answers a prompt and is _then_ told they are
  offline. `FamilyPlannerPage.vue:329-331` already accepts exactly this trade in writing
  ("consent-first is the privacy-correct order") — cite that precedent so the reorder is a decision
  rather than an accident.

`useDocumentConsent.ts:44-52` reads as if it forbids holding a grant across a picker. It does not,
**for the path that completes**: a grant minted before the picker and consumed by the file that picker
returns is still one grant for one document.

⚠️ **It does forbid holding one across a picker that does NOT complete — and `AiDocumentPicker` has no
cancel signal.** There is no `@cancel` emit, and a cancelled native camera never fires `change` at all
(`:34,40-42`). So a user who taps camera, consents, and backs out leaves a live grant that the _next_
pick — a different document, possibly minutes later — silently reuses. That is exactly the case
`useDocumentConsent.ts:41-52` describes, reintroduced by the reorder meant to improve consent.

`MagicBeansDoor` therefore owns `pendingGrant` with **three** clearing rules, all in one component:

1. consumed by `@file` (the happy path);
2. cleared on the sheet's `@close` and on unmount;
3. cleared by a `PICKER_GRANT_TTL_MS` timer (~2 min) armed at the mint — **the only rule that covers a
   silent cancel**, and it must exist because the picker cannot tell us.

`AiDocumentPicker` is unchanged (1.5). Assert all three: silent consent reuse is an ADR-030 violation,
not a bug.

**D6 (four "not recognised" behaviours + recipe-flavoured copy) — closes mostly, one part needs work.**
The four behaviours collapse to the spine's one: `kind: 'none'` → `shareTarget.unrecognised.*`. Note
this **changes activities' behaviour deliberately**: today `!isEvent` still opens the form with a
prefill (`useDocumentToActivity.ts:89-92`), which will no longer happen for an unrecognised capture.
That is the correct trade — it is also what travel and recipe already do — but it is a visible change
and belongs in the acceptance criteria.

The recipe-flavoured copy is **separate and does not close for free**.
`useExtractionErrorToast.ts` maps four codes — `fetch_blocked`, `video_blocked`,
`source_unreachable`, `no_content` — to `recipeExtract.*` strings, in a file whose own header (:16-21)
states the copy must stay surface-neutral. A shared school newsletter that fails to fetch is told it
has no transcript. Fix in **two** places, not one — the mapper is not where §4.6's actual case lives:

1. `useExtractionErrorToast.ts` — move `fetch_blocked`, `video_blocked`, `source_unreachable` and
   `no_content` onto new neutral `ai.error.link.*` keys.
2. `useSharedDocumentIngest.ts` — **the spine emits three of these toasts directly**, and these are
   the ones §4.6 describes: `recipeExtract.badLink.*` at `:487`, `recipeExtract.titleOnly.*` at
   `:842`, and `recipeExtract.noTranscript.*` / `.badLink.*` at `:875-876`. A shared school newsletter
   whose link resolves title-only hits `:842` and is told about a recipe. The mapper never sees these.

**The neutral family is the ONLY family.** `recipeExtract.badLink.*`, `.noTranscript.*`,
`.titleOnly.*`, `.unreachable.*`, `.videoBlocked.*` and `.noContent.*` are **deleted**, not kept in
parallel: after this change the one surviving recipe-flavoured caller is refetch, where "we couldn't
read that link" is still true and still the whole message. Two registers of the same four sentences
across `en` **and** `beanie` is eight strings to edit for one copy change, and the one nobody edits is
the one the user sees.

`recipeExtract.notRecipe.*` stays — it says something only a recipe surface can say. Acceptance tests:
`grep -n "recipeExtract\." src/composables/useSharedDocumentIngest.ts` returns nothing, **and**
`grep -rn "recipeExtract.badLink\|recipeExtract.noTranscript\|recipeExtract.titleOnly" src/` returns
only the `uiStrings.ts` deletions.

## Sequencing

⚠️ **This is three separate changes, shipped and observed independently — not one branch.** Pass 4's
explicit verdict: ~24 client files, 5 Lambda/infra files, 4 metrics files, 3 prompt copies and a
terraform apply creating a new table. Parts A/B and Part C share **zero** files and zero runtime
coupling. Do not open them as one PR.

**Change 1 — the meter (Part C).** Server + infra + `/beanies-metrics` only. No client file. Ship it,
apply the terraform, and **let it run against real traffic for a few days before Change 2 begins** —
the whole point is that the meter is trusted before enforcement, and one verified only against
synthetic traffic is not.

**Change 2 — prompt + spine prep.** `RECIPE_POLICY_LINES` across all three copies + `PROMPT_VERSION`
bump (Lambda deploy), then `resolveBillableFamilyId`, required `familyId`, grant threading,
`ingestState`, `refuseIfBusy`. Behaviour-preserving for the two doors that already work. ⚠️ **This
Lambda deploy must be live before Change 3's bundle ships** (A2a).

**Change 3 — the doors and the surface (Parts A, B, D).** `MagicBeansDoor`, the four pinned doors, the
tagline band and tiles, the string cleanup. Ships the `miscategorised` event.

**Change 4 — the free correction (2.7, B4, C9).** Split out of Change 3 deliberately, for three
concrete reasons:

- **Change 3 is already the big one** — a new component, four doors migrated, two components deleted,
  the tagline band, the tiles, the resolve hold, the string retirement. Adding a new Lambda verb pair,
  a new client ingest arm, a new component with three mounts and a prompt-signature change would make
  the riskiest deploy also the largest.
- **It is the only part that is unsafe to revert.** Everything else in Change 3 is client code: revert
  the bundle and you are done. C9 leaves `c#` rows in the rate table, a live `CORRECTION_GRANTS`, a
  bumped `PROMPT_VERSION` and a widened `buildMessages` contract.
- **Change 3 produces the evidence for whether C9 is worth building.** The `miscategorised` event is a
  Change 3 deliverable. If the misread rate turns out to be ~1%, C9 is a lot of security-sensitive
  surface for a rare case, and the better answer may be to improve the prompt instead. Shipping them
  together forecloses that question.

C9's Lambda half still ships **dormant** with Change 1, behind `CORRECTION_GRANTS` — unset being a
supported silent no-op, the posture `RATE_TABLE` already defines. Change 1 therefore writes no grant
rows and keeps its observation window clean; Change 4's terraform flips the variable in the same apply
that ships the banner. "Gated off" has to be a variable, not an intention.

Within each change the commits below still apply; across changes the deploy order is load-bearing.

1. **Server meter.** `ddb.mjs` extraction + `countUsage.mjs` + terraform + `/beanies-metrics`. No
   client change at all; counts every managed read from the doors that exist today. Verifiable alone
   (manual test 1). **= Change 1.**
2. **Spine prep.** `resolveBillableFamilyId` + required `familyId`/grant threading + `ingestState` +
   `refuseIfBusy` **in front of** refetch (D1 — a guard, **not** `withIngestLock`) + the
   `RECIPE_POLICY_LINES` splice. Behaviour-preserving for the two
   doors that already work; closes C8 and 4.1 before any door moves.
3. **`MagicBeansDoor` + the four pinned doors.** The functional change users see. The
   `RecipeLinkModal` / `useRecipeLinkInput` deletions land here.
4. **The surface.** Tagline band, tiles, sheen modifiers, resolve hold, `prefersReducedMotion`.
5. **String cleanup.** The `recipeExtract.*` retirement and `ai.capture.hint` removal.
6. **The correction (= Change 4).** `MagicMiscategorisedBanner` and its three mounts, `meter.mjs`,
   `correctionGrant.mjs`, the `kindHint` prompt branch, and the `CORRECTION_GRANTS` flip.

Phase 1 is Change 1. Phase 2 is Change 2. Phases 3, 4 and 5 are Change 3 — the user-visible half,
which shares files, so splitting them across deploys would ship half-moved doors. The correction is
Change 4. Phase 1 shares no file with any of them.

## Files Affected

**Client — the surface**

- `src/components/ai/MagicBeansSheet.vue` — tagline band, destination tiles at rest; drop `ai.capture.hint`
- `src/components/ai/AiProcessingOverlay.vue` — the reading/resolve sequence. It has exactly ONE mount
  after unification (`App.vue`), so it reads `ingestState` directly rather than taking `:open` + a new
  `kind` prop; the three page mounts and their `isReading*` bindings are deleted
- `src/components/ai/MagicReaderCard.vue` — unchanged except that its picker pattern is now the model
- `src/style.css` — `--magic-sheen-color` + two speed modifiers on the existing `.magic-shimmer`
- `src/services/translation/uiStrings.ts` — new `ai.capture.*` keys, remove `.hint`, neutral `ai.error.link.*`

**Client — the doors** (the same pattern four times: stop calling `picker.pick()`, open the sheet)

- `src/pages/FamilyPlannerPage.vue`, `src/pages/TravelPlansPage.vue`, `src/pages/FamilyCookbookPage.vue`
- `src/components/pod/RecipeFormModal.vue` (its own instance, five mount points)
- `src/components/vacation/VacationStep1.vue` — the payload-less `openDocumentReader` banner
- `src/components/pod/RecipeLinkModal.vue` — **deleted**, superseded by the sheet
- `src/components/pod/RecipeSourceStrip.vue` — link field routes to the sheet; styling untouched
- `src/composables/useRecipeLinkInput.ts` — **deleted** with its last two consumers

**Client — the spine**

- `src/composables/useSharedDocumentIngest.ts` — consent threaded as a required param; `ingestState`;
  `InAppDestination`; `refuseIfBusy`; degenerate reader pre-check; `familyId` now required. While the file
  is open, `SHARE_ENV`/`IN_APP_ENV` take their `surface` from `INGEST_SURFACES`
  (`magicPayload.ts:187-190`) instead of repeating the two literals — a CloudWatch filter that
  silently splits in two is the failure that removes
- `src/components/ai/MagicBeansDoor.vue` — **new** (A0); `MagicReaderCard` refactored onto it
- `src/components/ai/MagicMiscategorisedBanner.vue` — **new** (B4); mounted by the three review modals
- `src/components/planner/ActivityModal.vue`, `src/components/travel/TravelExtractReviewModal.vue`,
  `src/components/pod/RecipeFormModal.vue` — one banner mount each
- `src/composables/useMagicBeanScope.ts` — **new**; `resolveBillableFamilyId()`, the one answer to
  "which family is this read billed to"
- `src/composables/useRecipeRefetch.ts` — `refuseIfBusy()` as the first statement of `refetch()`
  (**not** `withIngestLock` — see D1) + `resolveBillableFamilyId()`
- `src/composables/useDocumentToActivity.ts` / `useDocumentToTravel.ts` / `useRecipeCapture.ts` —
  capture halves deleted, delivery halves kept (see A1)
- `src/composables/useExtractionErrorToast.ts` — four codes off `recipeExtract.*` onto neutral keys
- `src/services/ai/documentExtractionService.ts` — `familyId` required; **new**
  `extractShareFromPreparedSource` (C9)
- `src/services/ai/providers/managedProvider.ts` — `ProxyBody.correction`, and `postToProxy` spreads
  `correction` beside `familyId` under the frozen-wire rule
- `src/services/ai/types.ts` — `ExtractOptions.correction`, `ExtractionRequest.correction`,
  `AttestedResult.correction`, **`familyId` made required**, and the purity-invariant block at `:1-10`
  plus the `familyId` JSDoc at `:59-70` rewritten (both currently argue the opposite)
- `src/components/ui/ChoiceModal.vue` — optional `layer` prop, defaulted `'overlay'` (B4)
- `src/services/ai/__tests__/extractionPromptDrift.test.ts` — three-arg `buildMessages` + a hinted
  fixture, or the new branch ships with zero cross-copy coverage
- `src/utils/prefersReducedMotion.ts` — **new**; `src/components/ui/SmoothHeight.vue` moved onto it
- `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`,
  `scripts/spikes/extractionPrompt.mjs` — shared `RECIPE_POLICY_LINES` + `PROMPT_VERSION` bump, all
  three copies or CI fails (A2a)

**Server + infra**

- `infrastructure/lambda/ai-extract/index.mjs` — count at the 200 point
- `infrastructure/lambda/ai-extract/countUsage.mjs` — **new**, awaited, never throws
- `infrastructure/lambda/ai-extract/correctionGrant.mjs` — **new** (C9); issue, consume-or-refuse,
  behind `CORRECTION_GRANTS`
- `infrastructure/lambda/ai-extract/meter.mjs` — **new**; the two verbs `openRead`/`closeRead`, the
  count-before-grant ordering, the `ShareKind` closed set, and `ALARMING_PREFIXES`
- `infrastructure/lambda/ai-extract/__tests__/meter.test.mjs` — **new**; both C9 invariants + the
  terraform prefix assertion
- `src/types/magicPayload.ts` — `ResultEnvelope.correction` carrying the prepared `ExtractionSource`
- `infrastructure/lambda/ai-extract/ddb.mjs` — **new**; shared `hash()` + client, `rateLimit.mjs`
  refactored onto it with `rateLimit.test.mjs` green _unchanged_
- `infrastructure/lambda/ai-extract/__tests__/countUsage.test.mjs` — **new**
- `infrastructure/lambda/ai-extract/__tests__/correctionGrant.test.mjs` — **new**
- `infrastructure/modules/ai-extract/main.tf` — usage table (PITR, env-gated deletion protection),
  IAM (`UpdateItem` **only**, on both table ARNs), `USAGE_TABLE`, `CORRECTION_GRANTS`, **two** metric
  filters + alarms — **three**: count write-failed, count-skipped, correction `different_source`

**Metrics**

- `.claude/skills/beanies-metrics/scripts/pull_ai_usage.mjs` — **new**
- `.claude/skills/beanies-metrics/scripts/build_dashboard.mjs` — `load()` line **and a render block**
- `.claude/skills/beanies-metrics/assets/dashboard-template.html` — the reads-per-family section
- `.claude/skills/beanies-metrics/SKILL.md` + `references/data-sources.md`

**Docs**

- `docs/mockups/magic-beans-one-surface-2026-09-14.html` (already committed, `98622ceb`)
- `docs/plans/2026-09-14-magic-beans-one-surface-and-meter.md`
- `CHANGELOG.md`

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: the existing magic-beans / AI article (locate during implementation; if none exists this
  becomes `new article`, type `how-to`)
- **Title**: Using magic beans
- **Scope**: Magic beans now works the same way everywhere in beanies — one place to hand over a
  photo, a file, a link, or some pasted text, and beanies works out whether it is an activity, a trip,
  or a recipe and takes you to the right place. The article should stop describing per-page
  differences, since there are none left.
- **Notes**: Say plainly that **one thing you hand over costs one magic bean** — including when
  beanies cannot work out what it is, and _excluding_ the case where beanies guesses the wrong kind
  and you put it right, which is free. That is the promise the meter enforces later, and families
  should meet it in the help centre before they meet it in a paywall.

## Observability Coverage

**Events this work adds or changes**

| Surface               | Event                                                               | Level         | Key context                                                                                             |
| --------------------- | ------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `magic-beans-capture` | `capture opened`                                                    | info          | `action: 'opened'` — the funnel denominator, already emitted at sheet open; now fires for all six doors |
| `magic-beans-capture` | `share classified`                                                  | info          | `action: 'classified'`, `kind`                                                                          |
| `magic-beans-capture` | `share ready for review`                                            | info          | `action: 'ready'`, `kind`, `detail`                                                                     |
| `magic-beans-capture` | `target reader unavailable`                                         | warn          | `action: 'reader_disabled'`, `kind` — the D3 partial case                                               |
| `ai-activity-capture` | `activity ready for review`                                         | info          | `action: 'ready'` — **new**, closes D4's missing denominator                                            |
| `ai-extract` (Lambda) | `usage counted`                                                     | console.log   | fixed prefix + `task`; never the family id                                                              |
| `ai-extract` (Lambda) | `correction granted` / `correction consumed` / `correction refused` | console.log   | `task`, and for refused the reason (`missing`/`spent`/`same_kind`/`different_source`)                   |
| `magic-beans-capture` | `miscategorised`                                                    | info          | `action: 'corrected'`, `from` kind, `to` kind — the model-quality signal                                |
| `ai-extract` (Lambda) | `usage-count write failed`                                          | console.error | fixed prefix — the alertable gap                                                                        |

**Failure modes and how each is triaged blind**

- _"It read it but nothing opened"_ → `classified` present, `ready` absent, `reader_disabled` present.
- _"It says it can't read my file"_ → `rejected_type` with `detail: 'too_large' | 'unsupported'`.
- _"I was charged but got nothing"_ → compare `usage counted` against `ready` rates by task.
- _"The count is wrong"_ → `usage-count write failed` frequency is the answer, and it alarms.
- _"Nothing happens when I tap"_ → `capture opened` without a following `classified` is abandonment,
  now measurable at every door rather than only the FAB.
- _"It keeps guessing wrong"_ → the `miscategorised` rate by `from`/`to` pair is a direct measure of
  classification quality, and the first thing to look at before touching the prompt.
- _"I was charged for a correction"_ → `correction refused` with its reason says which of the three
  guards fired.

**Success-path signal**: `usage counted` fires on every successful read, so the meter's own write rate
is measurable and a silent stall is visible as its absence. `capture opened` is the denominator for
every door.

**Critical vs firehose**: nothing here warrants `severity: 'critical'`. A failed count is data loss on
our side, not the user's — it alarms via CloudWatch, it does not page Slack, and it must never fail
the user's extraction.

**The alarming prefixes are declared as data and asserted against terraform.** `meter.mjs` exports
`ALARMING_PREFIXES` — the **three** log lines that have a CloudWatch metric filter:

```js
export const ALARMING_PREFIXES = Object.freeze({
  countFailed: '[ai-extract] usage-count write failed',
  countSkipped: '[ai-extract] usage-count skipped',
  grantMismatch: '[ai-extract] correction refused reason=different_source',
});
```

`meter.test.mjs` reads `infrastructure/modules/ai-extract/main.tf` (resolved from `import.meta.url`,
**not** `process.cwd()` — `npm run test:lambda` does not guarantee a cwd) and asserts each value
appears verbatim in a `aws_cloudwatch_log_metric_filter` `pattern`. It asserts over **this map only**,
not every string the Lambda logs: `ok task=`, `usage counted`, `correction granted`/`consumed` and the
limiter's `rate_limited limit=…` are triage lines with no filter, and an "every prefix" assertion would
fail on all of them and then be weakened to nothing.

⚠️ The reason is part of the **prefix**, not a trailing field, so a filter can match it without a JSON
pattern. `different_source` is the one refusal meaning _the feature is broken_ rather than _someone is
probing it_.

**Privacy / store gate**: no new client `ALLOWED_CONTEXT_KEYS` entry is needed — `kind`, `action`,
`detail`, `error_code` and `family_id` are all already allowlisted. **The Lambda must not log the
family id**, per the zero-retention doctrine; the usage table stores only `sha256(familyId)`. No store
data-collection declaration changes.

## Acceptance Criteria

- [ ] All six doors open `MagicBeansSheet`; no door opens `AiDocumentPicker.pick()` or a link modal directly
- [ ] Every door accepts paste, link, camera and file
- [ ] A party invite pasted on the Travel page creates an **activity**, on the Activities page
- [ ] Native camera still reachable from every door (the `AiDocumentPicker` mount survives)
- [ ] `RecipeLinkModal` is deleted and `RecipeSourceStrip`'s link routes to the sheet
- [ ] A recipe captured from the cookbook still attaches its dish photo on save (the `pendingSource` coupling)
- [ ] The sheet still closes before ingest; the FAB is not dead after a capture
- [ ] Consent is requested when a source is committed, before the picker opens, at every door
- [ ] A second capture during an in-flight one is refused **audibly** at every door
- [ ] A >25 MB file is refused with `ai.picker.tooLarge.*` at every door, not `photos.invalidType`
- [ ] Tagline band renders in Caveat, Heritage Orange, with a slow sheen; light and dark
- [ ] Three tiles at rest in the sheet; ticking then resolving in the overlay
- [ ] All motion stops under `prefers-reduced-motion`; the resolved tile keeps gradient and lift
- [ ] `ExtractOptions.familyId` is **required** — omitting it is a build error
- [ ] Every successful 200 increments exactly one count
- [ ] A refusal before the model increments nothing
- [ ] A usage-table outage does not fail the extraction, and logs the alertable prefix
- [ ] `/beanies-metrics` reports reads per family
- [ ] `npm run validate` and `npm run test:lambda` green
- [ ] **No net new E2E spec**: `git diff --stat main -- e2e/specs/` shows no added file
- [ ] `grep -rn "familyId:.*?? undefined" src/` returns nothing
- [ ] Recipe refetch still works end to end and still runs the `recipe` task, not `share`
- [ ] A recipe captured from `RecipeFormModal` opened on `/pod/mealplan` fills **that** form — no
      navigation to `/pod/cookbook`, no lost user input
- [ ] A non-travel capture opened from a trip detail page clears `pendingTripTarget`
- [ ] Captured recipes still carry per-ingredient `inferred` flags (the form's InferredHint is accurate)
- [ ] A read with no active family id is refused before the model, logged, and costs nothing
- [ ] `closeRead` is awaited before the 200 returns, and counts **before** it grants (asserted in
      `handler.test.mjs` and `meter.test.mjs`)
- [ ] `grep -n "recipeExtract\." src/composables/useSharedDocumentIngest.ts` returns nothing
- [ ] A miscategorised capture can be corrected from the review modal, and the correction **does not**
      increment the count
- [ ] A replayed `correctionToken` is charged normally (the grant is single-use)
- [ ] A correction to the same kind the model already returned is refused
- [ ] A correction token from family A is useless to family B
- [ ] A correction carrying a **different document** than the one granted is charged normally
- [ ] A correction response issues **no** new token (no free chain)
- [ ] A correction increments `c` and leaves `n` unchanged on that family's daily row
- [ ] A text capture corrected to `event` or `travel` succeeds (not `unknown_task` / "not set up yet")
- [ ] `/beanies-metrics` reports free corrections beside reads charged, labelled as reads we paid for
      but did not charge
- [ ] A BYOK family can correct a miscategorisation (the banner renders without a grant)
- [ ] A correction succeeds while the family is at its `SHARE_TEXT_BUDGET` cap
- [ ] Tapping camera, consenting, cancelling the picker, then picking a **file** prompts for consent again
- [ ] A `kind: 'none'` read issues no grant (and the Help Center says an unrecognised read has no free retry)
- [ ] A **photo** miscategorised as travel and corrected to `recipe` still attaches its dish photo on
      save (the corrected envelope carries `sourceFile` and `compressedBlob` forward)
- [ ] A correction with a `to` outside `event`/`travel`/`recipe` is rejected 400 **before** the grant is
      consumed, and the grant is still spendable afterwards
- [ ] A grant minted at the picker expires after `PICKER_GRANT_TTL_MS` and is not reused by a later pick
- [ ] `grep -rn "extractEventFromDocument\|extractTravelFromDocument\|extractRecipeFromDocument" src/` returns nothing
- [ ] With one reader flag off, every door still renders and produces the kinds that remain enabled
- [ ] Opening the sheet from `MealEditModal`'s recipe form dims the form behind it
- [ ] `/beanies-metrics` renders reads-per-family in the **HTML dashboard**, not just in JSON
- [ ] `rateLimit.test.mjs` passes unchanged after the `ddb.mjs` extraction
- [ ] Help Center article updated per the section above
- [ ] Diagnostic logging above implemented and verified

## Testing Plan

**Unit**: `countUsage.mjs` (increments; a throwing DynamoDB returns without throwing and logs the
prefix; unset `USAGE_TABLE` is a silent no-op; a request with no family id logs the skip line).
`correctionGrant.mjs` (a fresh grant consumes once; a second consume fails and the read is charged; an
expired or unknown token is charged; a same-kind correction is refused; a grant scoped to family A
does not consume under family B). Handler tests extended
for the count firing at 200 and not on each refusal path. Existing `useSharedDocumentIngest` and
wedge tests updated for the collapsed capture halves.

**Type-level**: a call to any extract function omitting `familyId` must fail `vue-tsc`. Assert it with
a `@ts-expect-error` fixture so the guarantee is tested, not assumed.

**Browser** (per `references/browser-verification.md`, scratch script in
`scripts/design-screenshots/`, never `e2e/specs/`):

1. Each of the six doors opens the same sheet — screenshot all six, light and dark, 400px and desktop
2. Paste an invite on Travel → activity review opens on Activities
3. Tagline band sheen; tiles at rest; reduced-motion off state
4. Reading → resolve sequence in the overlay
5. Oversized file refused with the right message
6. Second capture during one in flight → audible refusal
7. Force a miscategorisation (paste an invite that reads as travel), correct it from the review modal,
   and confirm the count did not move

**Terraform**: `scripts/infra/tf-plan.sh -target=module.ai_extract`, read every change, apply only if
it is exactly the usage table + IAM + env var + metric filter + alarm.

**Manual — greg only** (cannot be driven programmatically):

1. A real extraction end-to-end on a real family with a live Drive token. Pass: the review modal opens
   with sensible prefill, and `/beanies-metrics` shows that family's count up by exactly one.
2. The same family on a **second device**, one read each. Pass: the count is 2. This is the whole point
   of moving the meter server-side and cannot be verified from one browser.
3. Native camera from a page door on a real iOS and Android build. Pass: the camera opens (not the
   documents picker) and the photo reaches the review modal.
4. Share into beanies from WhatsApp/Gmail on both platforms. Pass: routes to the right page, counts one.
5. Consent decline on a fresh install. Pass: no picker opens, nothing leaves the device, no bean spent.

## Review Passes

**Round 2** (2026-09-14) — greg reinstated the "not right?" affordance with the free-correction rule,
which adds Requirement 2.7, Approach C9, a new Lambda module and a new component. A substantial edit,
so Passes 2-4 re-ran against fresh subagents. Round 1 findings below remain the record of how the plan
got here.

- **Pass 2 (DRY + error handling)**: 21 revisions, **three blockers in the new C9**. The grant was not
  bound to the document, so a 40-character text read could buy a free 8-page PDF — the expensive half
  of every pair free, not 2×. The targeted `event`/`travel` tasks are images-only, so the headline
  case (a pasted invite corrected to an activity) would have returned `unknown_task` and shown "not
  set up yet". And nothing forbade a correction issuing its own grant, giving an unbounded free chain
  as the kind rotated. Also: grants belong in the rate table (the usage table is billing evidence with
  PITR); the source bytes are gone by the time the banner renders; the correction needs a fresh
  consent grant; BYOK families could not correct at all; and my "abuse ceiling" paragraph cited two
  fences that do not cover the image path. Added Assumption 9 — `familyId` is forgeable, so
  enforcement cannot gate on this count until it is bound to an authenticated principal.
- **Pass 3 (Sustainability)**: 20 revisions, **three more blockers**. The plan never named the function
  the banner calls, and the spine's header forbids a third entry point — a correction is now a third
  arm of `InAppInput`, so the two-entry-point invariant survives. The `src` binding bet on canvas JPEG
  encoding being bit-identical across two passes, because the server hashes post-compression bytes;
  retaining the _prepared_ source instead makes it exact by construction, and is cheaper and faster.
  And the consent grant would strand across a cancelled picker — `AiDocumentPicker` has no cancel
  signal at all — letting the next, different document silently reuse it, an ADR-030 violation.
  Also: the inbound token channel was missing entirely; a "free" correction still spent the client text
  budget; grants were issued on reads that could never spend them (doubling DynamoDB traffic); two
  awaited writes inside a 4-second post-model window needed the SDK bounded; `safeWrite` would have
  damaged the three-valued limiter; the metrics skill _can_ import `ddb.mjs`, collapsing five drift
  facts to one; and three per-kind extraction entry points would have survived as doors bypassing the
  meter.
- **Pass 4 (Fresh-eyes sweep)**: 20 revisions, and a verdict of **not yet implementable on C9's
  account** — with a diagnosis worth keeping: every remaining gap sat at the **seam between C9 and
  code that already existed**. Passes 2 and 3 had reviewed the correction against itself; this was the
  first pass to review it against the repo it lands in. It found a **prompt-injection channel** (the
  corrected kind is interpolated into the model's _instruction_, outside the untrusted-source fence,
  and nothing constrained it to the three valid kinds); a type contradiction I introduced two passes
  earlier (`ShareSource` where only `ExtractionSource` works, and it is module-private besides); a
  function the plan listed as "surviving" that does not exist; a silent data-loss path where a
  corrected dish photo arrives with no photo to attach; an undeclared break of a CI-enforced
  three-copy prompt contract; and a missing modal-ordering rule the plan enforces rigorously three
  sections earlier for the identical situation. Scope verdict applied: **C9 split out as Change 4**,
  because it is the only part unsafe to revert and because Change 3 produces the evidence for whether
  it is worth building.

### Round 1

- **Pass 1 (Initial draft)**: Drafted from the approved mockup + three codebase explorations; corrected
  three mockup assumptions (sheen already exists, resolve cannot live in the sheet, "not right?" needs
  a second model call) and designed the meter around the hasText gate and the zero-retention doctrine.
- **Pass 2 (DRY + error handling)**: 22 revisions, **two blockers** — deleting `processUrl` would have
  silently killed recipe refetch, and dispatch-by-kind would have unmounted `RecipeFormModal` at five
  of six mount points. Also: the resolve had zero frames to render, `countUsage` must be awaited or
  Lambda freezes it away, the attempt-id string set would permanently break counting past 400 KB,
  `familyId: string` does not stop `?? undefined`, `attemptBudget.ts` must not be touched, and the
  three recipe-flavoured toasts are in the spine rather than the mapper.
- **Pass 3 (Sustainability)**: 16 revisions. Corrected a **factual error** — BYOK and on-device reads
  never reach the Lambda, so it is not "the only chokepoint every read passes" (Assumption 8). Also:
  extract one `MagicBeansDoor` rather than six copies of a four-invariant protocol; `useRecipeRefetch`
  bypasses the spine so D1 and C8 needed explicit coverage; the table shape still described the
  string-set design C5 had rejected; three parallel module refs became one `IngestState`; two overlays
  would have fired at once (and the global one sits _behind_ a `z-[250]` panel); tiles keyed by
  `ShareKind` so a fourth kind is a compile error; one neutral string family rather than two registers;
  and a five-commit sequencing so a revert cannot take the meter out with the tiles.
- **Pass 4 (Fresh-eyes sweep)**: 12 revisions, one of them a **security hole**: the `attemptId`
  idempotency mechanism was a client-controlled meter bypass — `TransactWriteItems` is all-or-nothing,
  so replaying an id cancels the counter increment with the marker write, silently. Dropped entirely.
  Also: the plan is **three changes, not one branch**, with a load-bearing deploy order; the prompt
  splice missed a third CI-enforced copy and the `PROMPT_VERSION` bump; consent-before-lock
  re-created the discarded-photo regression D5 exists to remove; a no-`familyId` read writes no row
  and so is invisible to the unattributed bucket (needs its own alarm); `RecipeFormModal` has five
  mount points not six and my z-index justification was wrong (though it surfaced a real stacking bug
  at `MealEditModal`); the `SHARE_TEXT_BUDGET` retirement is cut as out of scope; and the resolved
  tile needed an iteration-count modifier or it sweeps forever behind the review modal.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (2026-09-14)

> A minor change I'd like to make is to align all of the "magic beans" surfaces across the app. at the
> moment, there are a few places we can input data for ai - activities, travel plans, recipe, quick add
> FAB, and through sharing. as an example, at the moment (at least on desktop) if you click the magic
> beans button while in activities it just brings up a file picker, even though we could technically
> read the text of an invite (perhaps shared via whatsapp) and also infer it's an invite and create an
> activity.
>
> the quick add FAB is the most flexible of all of them and should allow any type of document or text
> and then it is inferred what it is - should we replicate this model to be the one we use across ALL
> magic bean surfaces? this would mean one entry to magic beans, regardless of the surface and
> regardless of how many features we add in the future? what are your thoughts
>
> /frontend-design:frontend-design in addition, if we simplify and move everything to one surface, what
> is the most fun, engaging, interesting and beautiful design for that surface to highlight the
> functionality and convenience and reduction of mental load we get from magic beans, wihle ensure it
> still remains functional and clear as the first priority? can you propose something?
>
> let me know your thoughts

### Follow-up 1 — scope confirmed, metering added

> i'm ok with your suggestions.
>
> actually i would not consider 'give us something to read and we'll work out the rest' as help text, it
> is ok on my side to use caveat for this as it's more of a tag/decorative element. it's already clear
> for the user that they tapped this button because they want to use ai.
>
> i'm ok to make the caveat change and to add another decorative element to the page as per your
> suggestion

### Follow-up 2 — the UI copy and the meter

> Ok this looks good - one comment regarding the UI title and subtitle, let's keep the same 'magic
> beans' title at the top with the emoji since that's the name of the feature. for the subtitle, it can
> be 'give us something to read and we'll work out the rest'
>
> i would also suggest to remove the copy 'beanies can make' as i think it's inferred based on the UI
> layout and design / animatioon, and we already have 'working out what this is' at the bottom. just
> ensure everything looks clean and polished and follows all theme and CIG conventions. i'm ok if you
> wanted to add even more decorative (while not overpowering) elements, perhaps a shimmering somewhere,
> or something like that, to highlight the 'magic beans' / magical/automatic element here.
>
> Together with this change, can we also ensure that every 'ai read' (i.e. every magic bean as we define
> it on the pricing page) is properly counted on a per family basis, so that going forward, once pricing
> is enabled, we can always count the number of ai uses per family per day, week, month, etc?
> consolidating everything to one surface (including sharing) should also deliver the goal of removing
> any loophole to use ai / magic beans without being counted. in the future we'll use this to retrieve a
> family's ai usage to determine if they are entitled to use more.
>
> let me know if this makes sense or if you would propose anything else to go into this plan.

### Follow-up 3 — the watermark rejected

> the caveart looks bette rbut the large bean emoji doesn't look right, it's pushing the title halfway
> down the page for little benefit - perhaps we just remove this and stick with the caveat

### Follow-up 4 — the shimmer moves

> one thought on the shimmer, rather than having it shimmer across the editable text (which seems a bit
> unconventional) should we put the shimmer across the title/subtitle instead? perhaps we could also add
> some subtle background color/flavor to the caveat row, or perhaps a subtle gradient across the overall
> drawer to provide just a little more subtle highlight / pop for this?

### Follow-up 5 — build it

> ok looks great, please commit the skill and let's test it - run /beanies-build-auto on the magic beans
> feature

</details>
