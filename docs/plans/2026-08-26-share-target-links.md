# Plan: Share a link to beanies — the share target learns to read URLs

> Date: 2026-08-26
> Related issues: extends #64 (mobile share target), builds on #72 (recipe link reader). None on GitHub — direct implementation.
> Plan file: `docs/plans/2026-08-26-share-target-links.md`

## User Story

As a mobile user, I want to share a **link** — a YouTube video, a recipe page, an event page — from any app into beanies, so it reads the page and prefills the right item, exactly as sharing a photo already does.

## Context

#64 shipped the share target for `image/*` and `application/pdf`. On-device testing on 2026-08-26 found the obvious gap: sharing a YouTube video does not offer beanies at all, while a WhatsApp image and an Acrobat PDF both do. That is correct behaviour for what was built — YouTube shares a **URL as `text/plain`**, not a file, and our `ACTION_SEND` filter declares only the two file types.

The frustrating part is that beanies already knows how to read a YouTube link. #72 built the whole ladder: `recipeSourceUrl` classifies a URL, `recipeSourceResolver` drives the fetch, and the `content-fetch` Lambda has dedicated `youtube` / `page` / `image` modes behind an SSRF guard — including the description-and-follow-the-recipe-link path adopted when YouTube captions turned out to be dead everywhere. It is reachable in-app via "Read a Recipe" and nowhere else.

So this is plumbing an existing capability into an existing door, plus one genuine design decision: **what a bare URL should be read as.**

## Requirements

1. Register beanies as a share target for **links** on Android (native + installed PWA) and iOS.
2. A shared link is read and routed to the same three review surfaces as a shared file — activity, travel, or recipe — with nothing saved until the user confirms.
3. Classification of a link is decided by evidence, not by guessing at the URL string (see Approach § "The routing decision").
4. Reuse the existing fetch path (`content-fetch` Lambda + its SSRF guard) — no second fetcher, no second URL parser, **and no second resolver**.
5. The ADR-030 consent gate runs before the link leaves the device, identically to the file path.
6. A blocked, unreachable or unreadable link is reported with the existing classified error codes and their existing toasts — never a silent no-op. The copy shown must not name "recipe" when the thing being read is an event page.
7. Cost is bounded: a link share must not exceed the existing per-capture fetch budget plus at most one AI call, and must cost **zero** AI calls when the page already carries structured recipe data.
8. Text arriving through the share boundary is treated as untrusted third-party input, exactly as page text already is — including being **length-capped in one place** before anything parses it.

## Important Notes & Caveats

> Pass 2 rewrote this section: the pass-1 claims about `resolveRecipeSource` and about `ResultEnvelope` did not survive reading the code. Pass 3 tightened three structures that would have become maintenance traps.

- **`resolveRecipeSource` is reusable AS IS. Do not extract a "generic ladder", do not add `src/services/ai/sourceResolver.ts`.** Pass 1 asserted that pointing the share path at it "would refuse an Eventbrite link before anything was read". That is false, and the whole `sourceResolver.ts` work item rested on it. Reading `resolveRecipeSource` + `routeUrl`:
  - `routeUrl` is already policy-free — `invalid` (not https / no dot / a YouTube URL with no video id), `youtube`, or `page`. An Eventbrite URL routes to `page` and is fetched.
  - The `NEVER_A_RECIPE_*` blocklists live in `pickRecipeLinks`, which is called **only** on rung 2 of the YouTube ladder (which link inside a description is worth following). It never sees the shared URL.
  - The `jsonld` short-circuit being schema.org **Recipe only** is a _feature_ for the share path, not a limitation: a `@type: Recipe` hit is simultaneously the classification and the extraction, at zero AI cost.
  - The only genuinely recipe-shaped thing left is the _name_ of the refusal reason `not_a_recipe_url`. That is a label on an outcome the share path also wants ("that is not a link we can read"), and renaming it would edit `useRecipeCapture` plus its tests for no user-visible gain. Left alone, with a header comment recording the second caller.
- **Do NOT widen the `content-fetch` JSON-LD parser to schema.org `Event`.** Pass 1 proposed it for deterministic classification of event pages. Costed against what exists, it is a new normalizer in `recipeJsonLd.mjs`, a new client mapper (`jsonLdEventToPrefill`) with its own date/time/location rules, a widened `PageFetchData` union, a new branch in `useRecipeCapture`'s existing `jsonld` case, plus a deploy — all to save **one** AI call on a path where the page-text route already produces a prefilled activity and satisfies requirement 7's "at most one AI call". **Zero changes anywhere under `infrastructure/lambda/content-fetch/`.** Revisit only if telemetry shows event-page classification failing.
- **The `content-fetch` page-mode TEXT branch is already generic** — `{ kind:'text', title, text, finalUrl, imageUrl }`, capped at 24k chars. That is the reusable seam and it needs nothing done to it.
- **The free-text fence is already open.** `EXTRACTION_TASKS.recipe` has `sources: ['images','text']`. The concern that a text-accepting task turns the proxy into a general LLM endpoint (the API key ships in the public bundle) is real but **already true today** — an abuser would use `task: 'recipe'`. Extending `share` to text does not materially widen it. The mitigations that matter are the existing per-request caps (`MAX_TEXT_CHARS`), reserved concurrency, and the fact that nothing persists without confirmation.
- **Deploy order is currently load-bearing, and Pass 3 removes that instead of documenting around it.** `ai-extract/index.mjs` rejects a text source for a task whose registry entry does not declare `sources: ['text']`, and that rejection is `response(400, { error })` with **no `code`** — so the client falls through to the generic error toast. Twenty lines above it, the _unknown-task_ rejection already carries `code: 'unknown_task'` with a comment explaining this exact hazard, and `managedProvider.ts` already maps that code to `not_available` → the friendly "not set up yet" toast. **Give the `sources` fence the same `code`.** One line, existing precedent, no new error code and no new string — and it retires the whole hazard class for every future task/source pair, not just this one. The deploy-order rule stays in the testing plan as belt-and-braces, but it is no longer the only thing standing between a mis-ordered deploy and a confusing toast.
- **A shared "link" is often not just a link.** Android apps commonly send `text/plain` containing prose _around_ a URL ("Check this out! https://…"). `extractUrls` already handles exactly this (including bare domains, with a file-extension false-positive list) — reuse it. It can return `http://` URLs and dotless hosts, so the share must pick, not just take the first.
- **The picker's predicate is `routeUrl`, not `safeHttpsUrl`.** Pass 3 said "the first extracted URL that `safeHttpsUrl` accepts". That is a _second, weaker_ notion of "usable" than the one the resolver applies moments later: `routeUrl` already calls `safeHttpsUrl` **and** rejects a dotless host **and** rejects a YouTube channel/playlist URL with no video id. Under the weaker predicate, prose containing `youtube.com/@somechannel https://goodrecipe.com/x` picks the channel link, and the whole share dies on `not_a_recipe_url` while a perfectly readable URL sat two words away. **The rule is: the first extracted URL for which `routeUrl(u).kind !== 'invalid'`.** One predicate, shared with the resolver, no second definition to drift — and it makes `no_url` the single honest "nothing here we can read" outcome instead of two overlapping ones.
- **A `text/plain` share may contain no URL at all** (someone sharing selected text). That is a real case and needs its own honest message, not the unsupported-type one. It is the one new pair of UI strings in this change.
- **A share can carry BOTH a file and text** (a captioned photo; iOS handing over a URL _and_ a title). One rule, in one place, decides: **if any usable file is present, the files win and the text is ignored.** That is what stops one share producing two items, and it lives in the orchestrator, not in three adapters.
- **The shared toast mapper's copy is recipe-flavoured and this change makes that visible.** `useExtractionErrorToast` documents a COPY RULE ("every string here is surface-neutral") and then maps `no_content` to _"couldn't find a recipe in it"_, `source_unreachable` to _"paste the recipe text"_, `video_blocked` and `no_text_no_link` likewise. Today only the cookbook can reach those codes. After this change a shared Eventbrite page that 404s tells the user to paste the recipe text. The wording is neutralised **in place** (same keys — renaming five keys across every call site is churn with no user benefit), and `uiStrings` hashes each English string to trigger re-translation automatically, so rewording costs no locale work. Pass 3 adds one thing: the neutrality warning goes **on the key definitions in `uiStrings.ts`**, not only on the mapper — the next person to "fix the cookbook wording" will be standing in `uiStrings.ts`, not in `useExtractionErrorToast.ts`.
- Do NOT add a fourth review modal, a second toast mapper, a second consent gate, a second URL classifier, a second fetch budget, a second dispatch channel or a second orchestrator entry point. Each exists.

## Assumptions

> **Review these before implementation.** Every one below was verified against the code on 2026-08-26 unless marked otherwise.

1. ✔ `content-fetch`'s `page` and `youtube` modes, their SSRF guard and their error codes are unchanged by this plan — nothing in `infrastructure/lambda/content-fetch/` is touched.
2. ✔ `EXTRACTION_TASKS.recipe` declares `sources: ['images','text']` in all three copies, so the text path through `runExtraction` → `runWithSource` is exercised in production today.
3. ✔ `parseShareExtractionResult` delegates by `kind` to the three existing parsers; no new parser is needed for a text-sourced share.
4. ✔ `extractUrls` / `safeHttpsUrl` in `@/utils/url` remain the single URL-finding implementation (`routeUrl` and `pickRecipeLinks` both already build on them).
5. ✔ The Android app uses the first-party `ShareIntentPlugin`, not `send-intent`.
6. ✔ The iOS Share Extension target exists and builds (added 2026-08-26; CI-verified), and `ShareIntentPlugin.swift` drains an app-group inbox by file, mapping extension → MIME.
7. ✔ `action`, `detail`, `kind`, `error_code` and `extraction_path` are already on **both** allowlists — `src/utils/diagnosticContext.ts` and `infrastructure/lambda/telemetry/index.mjs`. No allowlist edit, no store-declaration update.
8. ✔ `managedProvider.ts` maps `code: 'unknown_task'` → `not_available` → the friendly "not set up yet" toast, so reusing that code on the `sources` fence needs no client change.
9. ⚠ Unverified: that `gemma4-31b` classifies reduced page text into `event|travel|recipe|none` as reliably as it does images. Mitigated by the `none` branch being an honest, already-built outcome, and by step 1 of the testing plan being a live spike before the UI work.

## Approach

### The routing decision — evidence first, model second

Greg's instinct was to let the AI classify. That is right for the general case, but there is cheaper and more reliable evidence available _before_ the model is asked:

1. **schema.org Recipe JSON-LD on the page (no AI call).** `content-fetch`'s page mode already extracts it and returns exact ingredients and times with the model never invoked. A page that says `@type: Recipe` **is** a recipe — asking a model to guess is strictly worse, and this is the single most common link share (a recipe blog from the browser). Recipe is the only type we parse and, per the caveat above, the only type we will parse.
2. **Everything else → the `share` task, on the fetched TEXT.** Greg's proposal, applied to evidence the model can actually read. The bare URL is never sent for classification: the model cannot fetch, and `youtu.be/dQw4w9` tells it nothing.

Note what pass 1 got wrong here too: it made **YouTube → recipe** a routing rule. It should not be. `resolveRecipeSource` resolves a video to _text_ (a followed blog link, or title+channel+description); that text then goes to the **share** task like any other text. A shared video of a school concert then classifies as `event` or honestly as `none`, instead of being force-fed to the recipe extractor and coming back "that isn't a recipe". One rule — _resolve to evidence, then classify the evidence_ — instead of two, and it deletes a special case rather than adding one.

Accepted, documented consequence: for a non-cooking video, the YouTube ladder's rung 2 may follow a link in the description (the blocklist only excludes socials/shops/shorteners) and classify _that_ page. Worst case the model says `none` and the user is told so. Not worth a second blocklist.

### The generic fetch ladder — there isn't one to build

`resolveRecipeSource(url)` is called verbatim by the share path. Its four outcomes map one-to-one onto what the orchestrator needs:

| outcome                                            | share path                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jsonld`                                           | recipe, **zero AI calls**, exact quantities                                                                                                                                                                                                                                                     |
| `text`                                             | one `share`-task call on the fetched text                                                                                                                                                                                                                                                       |
| `refusal` (`no_text_no_link` / `not_a_recipe_url`) | the existing toasts, chosen exactly as `processUrl` chooses them. `not_a_recipe_url` is **unreachable** from the share path once the picker uses `routeUrl` — it stays wired (the switch is exhaustive and the pasted-link path still reaches it), it is simply never the message a sharer sees |
| `failed`                                           | `reportExtractionFailure(errorCode)` — the existing mapper                                                                                                                                                                                                                                      |

The only edit to `recipeSourceResolver.ts` is a header line recording its second caller, so the next person to touch the blocklist knows two paths depend on it. The fetch budget (`MAX_FETCHES_PER_CAPTURE = 2`) is inherited unchanged, which is what bounds requirement 7.

### One orchestrator entry point, not two — and a spine you can still read

Pass 1 proposed "a sibling entry point for links… the shared middle is factored so the two cannot drift". Two entry points that must not drift is the problem, not the solution. Instead, the **adapter contract** widens by one field and the orchestrator keeps exactly one door:

```ts
// src/services/share/types.ts
export interface SharedContent {
  files: File[];
  /** Raw text the sender attached (a link, prose around a link, or plain text). */
  text?: string;
}
start(onShare: (content: SharedContent, meta: ShareMeta) => void): () => void;

/**
 * The share-boundary cap on sender-supplied text. Enforced HERE, in the orchestrator, so
 * every platform is bounded identically. `ShareIntentPlugin.java` mirrors it as
 * defence-in-depth; that native cap is a second line, never the only one.
 */
export const MAX_SHARE_TEXT_CHARS = 4000;
```

`ingestSharedDocuments(files, meta)` becomes `ingestSharedContent(content, meta)`. `ingestSharedContent` today is a single ~200-line function; adding a second source doubles its branch count, so Pass 3 makes the split structural rather than cosmetic. The exported function keeps only the **spine** (~70 lines), and each phase is a **module-level named function** in the same file — not a nested closure. There is precedent in this file already: `notReady` and `toPayload` are module-level and call `useToast()` / `useTranslation()` directly, so no dependency threading is needed.

```
ingestSharedContent(content, meta)
  received log (detail: 'file' | 'link')
  busy guard
  awaitReadiness()                 -> false = already logged + toasted
                                      (auth_timeout / signed_out / family_loading /
                                       ai_unconfigured — all four `notReady` calls, unchanged
                                       and shared by both paths, since a link needs the same
                                       family, the same tier and the same BYOK config)
  const source = await prepare(content, meta)   // no network
  offline guard
  consent (ADR-030)
  const payload = await read(source, grant)     // network
  classified log → none? → reader gate → dispatchSharePayload → ready log
  catch → reportError + generic toast
  finally → isIngesting = false
```

The four readiness guards move into a `awaitReadiness()` helper **only** because the spine has to stay readable; their order, their `detail` values and their toasts are copied verbatim. The two _documents-only_ notices — the `meta.unreadable` partial toast and the multi-file `firstAttached` toast — move into `prepare`'s documents branch **in their current relative order** (partial before the empty-batch return, `firstAttached` after the usable filter). They are named here because a refactor that silently drops either one is invisible until a user shares four photos and quietly gets one.

- `prepare(content, meta)` → `ShareSource | null`, where `ShareSource = {kind:'documents'; files: File[]} | {kind:'link'; url: string}`.
- `read(source, grant)` → `{ data: ShareExtractionResult; env: ResultEnvelope } | null`.
- **`null` from either means "the user has already been told and the event already logged".** That sentinel is documented once, at both signatures, because a silent `null` is exactly the failure mode this feature is most prone to.

Both `prepare` branches are network-free, which is why the single `offline` guard can sit between prepare and consent and preserve today's ordering (triage → offline → consent → extract) for the file path byte-for-byte.

`prepare` owns three normalisations, in this order:

1. **`text/plain` files become text.** iOS hands a shared URL over as a `.txt` file in the app-group inbox. Pass 2 put the "split `text/plain` out of `files`" step inside `iosShareAdapter`. Pass 3 moves it here: `share/types.ts`'s own doctrine is _"If an adapter needs a second decision, that is the signal the decision belongs in the orchestrator"_, and doing it centrally means a `.txt` shared from Android or the PWA works for free instead of hitting "beanies can't read that kind of file". Adapters stay dumb; there is one rule, in one place, for all three platforms.
   - Runs **after** `withSniffedType`, which returns the original file untouched when the bytes are unrecognised — so a `.txt` keeps `type: 'text/plain'` and the rule is "sniffed to nothing **and** declared `text/plain`".
   - **Bound the decode, not just the result**: `await file.slice(0, MAX_SHARE_TEXT_CHARS * 4).text()` (4 = the UTF-8 worst case), never `await file.text()`. Another app can hand us a 100 MB file declaring itself `text/plain`; decoding it whole and _then_ slicing is an OOM the cap was supposed to prevent. One `slice`, and the cap becomes real at the boundary instead of after it.
2. **The cap.** `text.slice(0, MAX_SHARE_TEXT_CHARS)` before anything parses it — `extractUrls` does `text.split(/\s+/)` over whatever it is given, and a shared article body is otherwise unbounded. Accepted consequence, recorded so it is not rediscovered as a bug: truncation can sever a URL that sat past 4 000 characters, and the honest outcome is then the `no_url` toast. At 4 000 characters that requires an unusual sender; bounding untrusted input at the boundary is worth more than that tail.
3. **Files win.** If any file survives sniffing + `isAiPickerAcceptedFile`, the text is ignored. Otherwise `extractUrls` → the first result `routeUrl` calls usable → `{kind:'link'}`; none → `action:'no_url'` + the new toast.
   - **Why a text share with no URL is a toast and not a classification.** It is tempting to send the bare text to the `share` task — `read` already has that call, so it looks like _less_ code than a new string pair. It is not the same feature: it turns any app's share sheet into a general text→model endpoint on a soft-keyed proxy, and it raises UX questions this change has no answer for (someone sharing a paragraph of a news article expects what, exactly?). One new string pair is the cheaper honest answer, and the extension point is one `case` in `prepare` if it is ever wanted.

The spine — classified log, `none`, reader gate, dispatch, `ready` log, the outer catch, `finally` — is written once and cannot drift because there is only one of it.

### Getting a JSON-LD recipe to the cookbook without a second AI call

This is the one real type change, and it pays for itself by deleting duplication that already exists.

`SharePayload`'s recipe variant carries a `RecipeExtractionResult`; a JSON-LD hit is a `JsonLdRecipe`. Rather than fabricating a fake extraction result (which would have to invent confidence and `inferred` flags — a lie on the one path that cannot hallucinate), the payload names the two sources honestly:

```ts
// src/types/magicPayload.ts
export interface ShareLink {
  /** The page actually read — bounds any page-supplied image (same registrable domain). */
  pageUrl: string;
  /** What to STORE as provenance: the video the user shared, not the blog we followed. */
  provenanceUrl: string;
  /** The page's own og:image / JSON-LD image. Untrusted; screened before use. */
  imageUrl: string;
  path: ExtractionPath;
  kind: 'page' | 'youtube';
}

/** Which of the two shapes a recipe arrived in. The link is NOT repeated here — see below. */
export type RecipeShareSource =
  { via: 'extraction'; data: RecipeExtractionResult } | { via: 'jsonld'; recipe: JsonLdRecipe };

export interface ResultEnvelope {
  /**
   * The source document, or `null` for a link (there is no file). Required-but-nullable,
   * NOT optional: a new construction site must state its answer rather than omit the field
   * and silently lose the attachment.
   */
  sourceFile: File | null;
  compressedBlob?: Blob;
  truncated?: boolean;
  /** Present iff the share was a link. The ONE home for link provenance. */
  link?: ShareLink;
}
```

**Pass 3 removed the duplicated `link`.** Pass 2 put `link` on the `jsonld` arm of `RecipeShareSource` _and_ on `ResultEnvelope`, giving the same value two homes and an invariant ("these must agree") that nothing enforces. It cannot live only on the union either: a link that resolves to `text` arrives as `via: 'extraction'` and needs the link just as much, and the activity path needs it too. So the envelope is the single home, for all three readers, and the union carries only what actually differs — the payload shape. The "jsonld implies a link" invariant is upheld at the one place both are constructed (`read`), and `deliverRecipe`'s `jsonld` branch throws a clear impossible-state error if `env.link` is missing, which the existing `deliverRecipe` try/catch turns into a reported error and a toast rather than an unprovenanced recipe.

`useRecipeCapture.deliverRecipe(source: RecipeShareSource, env)` switches over `via` with `assertNever`, and **`processUrl`'s `jsonld` and `text` branches collapse into calls to it.** Those two branches today duplicate ~15 lines each of provenance relabelling, dish-image screening, `pendingDishImageUrl` and `handOver`; after this there is one copy, used by the pasted-link path and the shared-link path alike. `handOver`'s arguments fall out of the envelope (`kind = env.link?.kind ?? 'document'`, `path = env.link?.path ?? 'document'`), so no caller passes them separately. The `not_recipe` log takes the same `kind` and includes `extraction_path` only when `env.link` is set.

**Pin, because getting it wrong is silent:** the URL handed to the _mappers_ (`jsonLdToPrefill(recipe, url)` / `recipeExtractionToPrefill(data, url)`) is **`env.link.pageUrl`**, never `provenanceUrl`. That argument is not decoration — it is the same-registrable-domain bound on the dish image. Passing `provenanceUrl` compares a blog's photo against `youtube.com` and silently drops every dish photo from a video capture; the reverse mistake would widen the bound. `prefill.fields.sourceUrl = env.link.provenanceUrl` is then applied **after** the mapping, exactly as the SAFETY comment in `processUrl` requires today. Two lines, opposite fields, one order — so both get an acceptance criterion and a unit test rather than a comment. `discardPendingSource()` is idempotent, so `processUrl` calling it before the await and `deliverRecipe` calling it after is safe; `truncated` is undefined on the link path, so no spurious toast.

### The two link rules become pure functions

`processUrl` is 175 lines and holds `provenanceUrl` and `boundedImage` as **closures over `route` and `kind`** — which is precisely why the share path could not reuse them and pass 1 assumed they had to be rewritten. Once `ShareLink` exists, both are pure and move to a small tested module:

```ts
// src/utils/shareLink.ts
export function boundedDishImage(link: ShareLink, mapperImage: string | null): string | null;
```

`boundedDishImage` keeps today's exact behaviour — prefer the mapper's already-bounded value, else screen the page's `imageUrl` against `link.pageUrl` with `isSameRegistrableDomain` + `safeHttpsUrl`, logging a rejection rather than swallowing it. Provenance stops needing a function at all: `link.provenanceUrl` is computed once, where the route is known. Net effect: two closures and one 175-line function become one 12-line pure function with direct unit tests, and the security control (the same-domain image bound) has exactly one implementation that both callers reach.

### `ResultEnvelope.sourceFile` becoming nullable — the ripple is real

Pass 1 claimed "the three `deliverX` steps [are] already tolerant of a missing attachment". Two of the three are not:

- `useDocumentToActivity` dereferences `env.sourceFile.name`. Guarded by `env.compressedBlob` at runtime (a link has neither), but it will not type-check. Fix: `sanitiseAttachmentBase(env.sourceFile?.name ?? 'shared')`.
- `useDocumentToTravel` passes `sourceFile: env.sourceFile` into `TravelReady.sourceFile: File`, which `TravelPlansPage.vue` hands straight to `photoStore.addPhoto`. Fix: `TravelReady.sourceFile: File | null`, and the attach block becomes `if (segIds.length && ready.sourceFile)`. Deliberately _not_ an early return — the trip must still save.
- `useRecipeCapture` sets `pendingSource.value = env.sourceFile` (the field is already `File | null` — no change).

Three edits, each named here so none is discovered at compile time and patched carelessly.

Provenance for the non-recipe kinds: a recipe has a `sourceUrl` field, an activity and a trip do not. Rather than invent one, `deliverEventInner` appends `env.link.provenanceUrl` on its own line to the prefill's `notes` when `env.link` is present (a URL needs no translation, so this adds no string). Travel keeps no link in v1 — its notes are per segment and there is no single place for it; recorded here as a known, deliberate gap rather than a silent one.

### The share task learns text

Four changes, all in the mirrored region of `extractionPrompt.ts` and both copies (`infrastructure/lambda/ai-extract/extractionPrompt.mjs`, `scripts/spikes/extractionPrompt.mjs`), with `PROMPT_VERSION` bumped so the drift guard stays meaningful:

1. `EXTRACTION_TASKS.share.sources` → `['images', 'text']` (and its comment, which currently says "the share path never sends free text", updated to say what now guards it).
2. **`buildShareExtractionMessages`'s system prompt must stop saying "images".** It opens "You are given one or more images…" and later "Never output any value that is not actually supported by the images." Fed text, that is a contradiction the model has to resolve.
3. **Do NOT factor the two prompts onto a shared `SOURCE_DESCRIPTION` constant.** Pass 3 proposed exporting `buildRecipeExtractionMessages`'s sentence and using it from both. Reading them side by side kills the idea: the recipe prompt's phrasing is _task-tuned_ ("images of a cookbook page, a screenshot, a photographed recipe card, or the text of a web page or video transcript"), the share prompt's is _classification-tuned_ ("the pages of a SINGLE document that someone shared from another app. It may be an invitation or school notice, a travel booking, or a recipe"). A constant general enough to serve both is less specific than either, which means **editing the shipped, working recipe path's system prompt to serve a DRY urge** — a behaviour change on a live feature that no test in this repo can catch, because prompt quality is not assertable. DRY governs logic and data, not per-task prompt copy that is tuned independently. So: rewrite the **share** prompt's two source-naming lines in its own words ("the shared item — one or more images of a document, or the text of a web page or video" and "…not actually supported by the source"), and leave `buildRecipeExtractionMessages` **byte-identical**. If a third task ever learns text, revisit with three examples in hand rather than two.
4. Nothing else. `buildUserMessage` already fences untrusted text with the injection preamble; `parseShareExtractionResult` is source-agnostic.

### The Lambda's `sources` fence gains a code

One line in `infrastructure/lambda/ai-extract/index.mjs`:

```js
return response(
  400,
  { error: `Task "${task}" does not accept text input`, code: 'unknown_task' },
  event
);
```

Same code, same client branch, same friendly toast as the unknown-task rejection twenty lines above — and a comment pointing at it so the two stay together. This is the only change outside `extractionPrompt.mjs` in that Lambda, and `infrastructure/lambda/content-fetch/` is still untouched.

### Platforms

- **Android**: add `<data android:mimeType="text/plain"/>` to the `ACTION_SEND` filter **only** (not `SEND_MULTIPLE` — a multi-item text share is not a thing anyone does, and every declared type is exported attack surface). `ShareIntentPlugin.java` buffers `intent.getCharSequenceExtra(EXTRA_TEXT)` alongside the URIs, capped at 4000 chars (mirroring `MAX_SHARE_TEXT_CHARS`, with a comment naming it as the mirror), returns it as `text` from `consume()`, and clears it with the rest. `androidShareAdapter`'s early return — today `if (files.length === 0 && !(offered ?? 0)) return;` — becomes `if (files.length === 0 && !text && !(offered ?? 0)) return;`, so a text-only share is not mistaken for the (very common) "nothing pending" launch it runs on every cold start.
- **PWA**: `share_target.params` gains `text` and `url`. **Both fields must be read and joined**: Chrome routes a shared link into `url` when the sender marks it as one and into `text` when it does not, and a Safari-style "title + URL" share fills _both_. The SW takes `[formData.get('url'), formData.get('text')].filter(Boolean).join('\n')` — `extractUrls` then finds the link wherever it landed, and no branch has to guess which field the sender used. The SW stashes that string as **one more Cache entry** under `/__share/{id}/text` (with an explicit `content-type: text/plain`, read back with `res.text()`) rather than putting it in the redirect URL (a URL would leak into history and hit length limits) — which means `readAndClearShareStash` keeps its read-once/delete-everything semantics for free and simply returns `SharedContent`. **Partition the keys before sorting**: `stashIndex` parses the last path segment as a number, so a `text` key yields `NaN → 0` and would sort in among the files and be read back as a `File` named `shared` at index 0. The text key is matched exactly (`/__share/{id}/text`), removed from the file list, and only the numeric keys go through the existing sort — while the unconditional delete in the `finally` still covers _every_ key including text. The `?error=empty` redirect fires only when there is neither a file nor text. `deliverPwaShare(content)`; `ShareTargetPage` fails only when both are empty.
- **iOS**: add `NSExtensionActivationSupportsWebURLWithMaxCount: 1` to the activation rule. `ShareViewController.write` gains `UTType.url` to its ordered type list and, on a URL, writes `<uuid>.txt` containing the absolute string — the existing `return` after a successful write already guarantees one file per attachment, which is what stops a URL+title share producing two items. `ShareIntentPlugin.swift` gains `case "txt": return "text/plain"` (one line). **`iosShareAdapter` gains no branch at all** — the `text/plain`-file → text normalisation happens once in the orchestrator's `prepare`. No new native channel, no change to the app-group drain or its read-then-delete discipline.

### Errors — where each one surfaces

Every failure below already has a code, a toast and a log. Nothing new is invented; the work is making sure each is _reachable_ from the link path.

| condition                                              | outcome                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text share with no URL                                 | `action: 'no_url'` + new `shareTarget.noLink.*` toast                                                                                                               |
| not https / no dot / YouTube channel URL               | filtered by the picker → falls through to the next URL; if none survives, `action: 'no_url'` (the `not_a_recipe_url` refusal stays handled but is unreachable here) |
| SSRF guard / bad URL                                   | `fetch_blocked` → existing toast                                                                                                                                    |
| dead link, paywall, bot-blocked                        | `source_unreachable` → existing toast (**reworded**)                                                                                                                |
| page reached, nothing readable                         | `no_content` → existing toast (**reworded**)                                                                                                                        |
| YouTube refuses the video                              | `video_blocked` → existing toast (**reworded**)                                                                                                                     |
| video with no description and no link                  | `refusal: no_text_no_link` → `recipeExtract.noTranscript.*` (**reworded**)                                                                                          |
| proxy deployed behind the bundle                       | `code: 'unknown_task'` → `not_available` → "not set up yet"                                                                                                         |
| model says `none`                                      | `shareTarget.unrecognised.*`                                                                                                                                        |
| destination reader off                                 | `shareTarget.readerOff.*`                                                                                                                                           |
| `jsonld` payload with no `env.link` (impossible state) | throws → `deliverRecipe`'s catch → `reportError` + generic toast                                                                                                    |
| anything throws                                        | outer catch → `reportError` + generic toast                                                                                                                         |

Consent (requirement 5) is enforced by **ordering plus the type system's reach**: `ExtractOptions.grant` makes an ungated _extraction_ a compile error, while the _fetch_ is gated by running after `requestConsent()` — exactly as the in-app pasted-link path is today. Adding a witness parameter to `resolveRecipeSource` would ripple through `useRecipeCapture` and its tests to enforce what the single call site already does; noted as understood, not fixed.

## Files Affected

**Resolver** — one comment. No new module.

- `src/services/ai/recipeSourceResolver.ts` — header note recording the second caller

**AI task**

- `src/services/ai/extractionPrompt.ts` + `infrastructure/lambda/ai-extract/extractionPrompt.mjs` + `scripts/spikes/extractionPrompt.mjs` — `share` gains `text`, the **share** system prompt becomes source-neutral (the recipe prompt is untouched), `PROMPT_VERSION` bump
- `infrastructure/lambda/ai-extract/index.mjs` — `code: 'unknown_task'` on the `sources` fence (one line)
- `src/services/ai/documentExtractionService.ts` — `extractShareFromText(text, opts)` (a one-line sibling of `extractRecipeFromText`)

**Ingest + payload**

- `src/composables/useSharedDocumentIngest.ts` — `ingestSharedContent` spine + module-level `prepare` / `read`
- `src/composables/useShareTargets.ts` — pass `content` through
- `src/types/magicPayload.ts` — `ShareLink`, `RecipeShareSource`, `sourceFile: File | null`, `env.link`
- `src/utils/shareLink.ts` — **new**: `boundedDishImage`, pure and directly tested
- `src/composables/useRecipeCapture.ts` — `deliverRecipe(source, env)`; `processUrl`'s two branches collapse into it; the two closures move to `shareLink.ts`
- `src/composables/useDocumentToActivity.ts` — nullable source file; append the link to notes
- `src/composables/useDocumentToTravel.ts` + `src/pages/TravelPlansPage.vue` — `sourceFile: File | null`, guarded attach
- `src/pages/FamilyCookbookPage.vue` — `capture.deliverRecipe(payload.source, payload.env)`
- `src/composables/useExtractionErrorToast.ts` — no logic change; see uiStrings
- `src/services/translation/uiStrings.ts` — new `shareTarget.noLink.*`; neutralise `recipeExtract.noContent/unreachable/videoBlocked/noTranscript` message copy **and mark those keys as shared-surface at the definition**

**Platform**

- `src/services/share/types.ts` (`SharedContent`, `MAX_SHARE_TEXT_CHARS`), `androidShareAdapter.ts`, `pwaShareAdapter.ts`, `iosShareAdapter.ts` (pass-through only), `shareIntentPlugin.ts`
- `android/app/src/main/AndroidManifest.xml`, `ShareIntentPlugin.java`
- `ios/App/ShareExtension/Info.plist`, `ShareViewController.swift`, `ios/App/App/ShareIntentPlugin.swift`
- `vite.config.ts`, `public/share-target-sw.js`, `src/utils/shareStash.ts`, `src/pages/ShareTargetPage.vue`

**Docs**

- `src/content/help/features.ts` — the share article

**Not touched, deliberately**: everything under `infrastructure/lambda/content-fetch/`.

**Explicitly not in v1** (so scope does not creep during implementation): schema.org `Event` JSON-LD, a link on travel segments, multi-URL shares (the first usable URL wins), non-HTTPS links, and any second blocklist for non-cooking videos.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: `share-to-beanies`
- **Title**: Share Something Straight to beanies
- **Scope**: Add links to what can be shared, and say what happens: beanies opens the page, works out whether it is an activity, a trip or a recipe, and shows it to check. Correct the current sentence that says beanies only appears for photos and PDFs.
- **Notes**: must say the page is fetched and read (a privacy-relevant step distinct from sending a photo), that a link behind a login or a paywall will not read, that YouTube videos are read from the description (and the recipe link in it) rather than the video, and that sharing a photo _with_ a caption reads the photo — the caption is ignored.

## Observability Coverage

Surface stays **`share-target-ingest`**, so one filter still isolates the whole feature.

- `action: 'received'` — gains `detail: 'link' | 'file'` so the two funnels are separable against one denominator. `file_count` keeps its existing meaning (files handed over; **0** on a link share) — it is deliberately not reused as a URL count, which would make the existing dashboards lie.
- `action: 'no_url'` — a text share carrying no link.
- `action: 'resolved'` — `context: { extraction_path }`, reusing #72's key so the JSON-LD / page-text / video rungs are directly comparable with the in-app recipe path.
- `action: 'classified'` — `context: { kind }`, unchanged.
- `action: 'failed'` — `context: { error_code }`, all existing codes.
- Success signal is the existing `ready`, so a link failure RATE is computable against the same denominator.

**Verified, not assumed**: `action`, `detail`, `kind`, `error_code` and `extraction_path` are all present in `src/utils/diagnosticContext.ts` **and** in `infrastructure/lambda/telemetry/index.mjs`'s mirror. No allowlist change, no store-declaration update. If a new key does become necessary it must be mirrored in both and declared to Apple/Google. Never log the URL, the page text, or any page content.

## Acceptance Criteria

- [ ] Sharing a YouTube video from the Android YouTube app lists beanies and produces a prefilled item (recipe for a cooking video; `none` handled honestly for anything else).
- [ ] Sharing a recipe-page link produces a recipe; a page with schema.org Recipe JSON-LD does so with **zero** AI calls, with exact quantities and no "inferred" flags (verified in the network log).
- [ ] Sharing an event-page link produces a prefilled activity, with the link on its notes.
- [ ] Sharing text containing a URL amid prose works; sharing text with no URL says so with its own message; prose whose first URL is `http://`, a dotless host, **or a YouTube channel/playlist URL** still finds a later usable one (the picker's predicate is `routeUrl`).
- [ ] A JSON-LD share from a followed YouTube description link keeps its dish photo: the image is bounded against `pageUrl` while `sourceUrl` records `provenanceUrl`. A unit test asserts both fields explicitly.
- [ ] A `text/plain` file of 50 MB is never decoded whole — the slice cap is applied before `.text()`.
- [ ] A PWA share that delivers the link in `url` (not `text`) is ingested identically to one that delivers it in `text`, and a share filling both produces exactly one item.
- [ ] `buildRecipeExtractionMessages` is byte-identical to `main`; only the `share` builder's source-naming lines change.
- [ ] Sharing a photo **with a caption containing a URL** reads the photo, not the caption, and produces exactly one item.
- [ ] A shared `.txt` file behaves identically on all three platforms (read as text, not "unsupported").
- [ ] Text over `MAX_SHARE_TEXT_CHARS` is truncated by the orchestrator regardless of platform, verified with the native cap disabled.
- [ ] A link behind a paywall/login, a dead link, and a blocked host each produce their existing classified toast — never silence — and none of those toasts mentions recipes when the page was not one.
- [ ] With the bundle deployed **ahead** of the Lambda, a link share shows the friendly "not set up yet" toast, not the generic error.
- [ ] At most **two** fetches (the existing `MAX_FETCHES_PER_CAPTURE` budget — a video may follow one description link) and at most one AI call per link share (network log). _Pass 1 said "exactly one fetch", which the shipped YouTube ladder cannot satisfy._
- [ ] The in-app "Read a Recipe" link path is behaviourally unchanged: `useRecipeCapture` test **assertions** pass unmodified (the `deliverRecipe` call sites in those tests change shape; no expectation does).
- [ ] Consent is requested for a link exactly as for a file, before any fetch, and an ungated extraction still fails to compile.
- [ ] `ingestSharedContent`'s exported body stays under ~80 lines; `prepare` and `read` are module-level and independently unit-testable.
- [ ] `npm run lint`, `typecheck`, `test`, and the prompt drift guard pass; `security:full` passes.
- [ ] Help Center article updated.
- [ ] Diagnostic events fire as specified, read from the real CloudWatch stream for one device share.

## Testing Plan

1. **Live spike first** (before any UI work): send reduced page text from a recipe blog, an Eventbrite page and a hotel confirmation page to `task: 'share'` against the deployed model, and confirm the classification. This retires assumption 9 for the price of ten minutes; discovering it after the platform work is done is the expensive order.
2. Unit — URL extraction from prose, bare domains, an `http://` first URL followed by an `https://` one, a YouTube **channel** URL followed by a real recipe URL, a dotless host, the no-URL case, the over-cap truncation, the bounded `.txt` decode, the `text/plain`-file normalisation, and the file-wins-over-caption rule. All against `prepare` directly.
3. Unit — `read` / orchestrator link path: `jsonld` → recipe with no AI call; `text` → each of the four classifications; each `refusal` reason; each `failed` code; consent declined; reader disabled; offline.
4. Unit — `boundedDishImage` as a pure function: same-domain accept, cross-domain reject (logged), non-https reject, mapper value preferred.
5. Unit — `deliverRecipe` across both `RecipeShareSource` shapes plus the document case, including that a `jsonld` share sets `sourceUrl` to the _provenance_ URL, screens the dish image against the _page_ URL, and reports rather than crashes when `env.link` is absent on the `jsonld` arm.
6. Regression — `useRecipeCapture` pasted-link tests: assertions unchanged, including that a blocklisted description host is still skipped (proving no policy moved).
7. Unit — the `share` task accepts text; the recipe system prompt is unchanged (diff-asserted against `main`); the drift guard passes across all three copies with the bumped version; the Lambda's `sources` fence still rejects text for `event`/`travel` **and now returns `code: 'unknown_task'`**; `managedProvider` maps it to `not_available`.
8. Unit — `shareStash` round-trips text alongside files, keeps file ordering with a `text` key present, never surfaces the text entry as a `File`, and deletes both; the SW's `url`+`text` join covers url-only, text-only and both; `ShareTargetPage` fails only when both are empty.
9. Manual, Android — YouTube, a recipe blog, an Eventbrite page, a bare domain, prose-with-link, text-with-no-link, a paywalled article, a captioned photo, a `.txt` file.
10. Manual, iOS — the same via TestFlight, plus a Safari share (URL + title) confirming one item.
11. Manual, PWA — share a link from Chrome with the PWA installed.
12. Deploy check — `ai-extract` shipped and confirmed serving the new `PROMPT_VERSION` **before** the bundle that sends text for `share` (still the correct order; the new `code` is the safety net, not the plan).

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the on-device finding; chose evidence-ordered hybrid routing over pure-AI classification, and identified that `resolveRecipeSource` is recipe-shaped and must be split rather than reused.
- **Pass 2 (DRY / error-handling, code-verified)**: read every file the draft named. Four of its load-bearing claims were wrong and are corrected here.
  - **Deleted the `sourceResolver.ts` extraction.** `routeUrl` carries no recipe policy and the blocklist only runs inside the YouTube description rung, so `resolveRecipeSource` is reusable verbatim. The draft would have created a second resolver to avoid a policy that was never in the way — the exact duplication the plan's own §4 forbids.
  - **Deleted the `content-fetch` `Event` JSON-LD widening.** Costed: a new normalizer, a new client mapper, a widened union, a new branch and a deploy, to save one AI call on a path that already meets the requirement.
  - **Deleted the "sibling entry point".** Widened `SharedContent` at the adapter contract instead, so there is one orchestrator door and no shared middle that can drift. Also fixed the guard ordering so the file path's existing toast sequence is preserved exactly.
  - **Corrected "the deliverX steps are already tolerant of a missing file"** — two of three are not; the three ripple sites are named individually.
  - Found and fixed three things the draft would have shipped silently: the share system prompt hard-codes "images", the shared toast mapper's copy names recipes, and the `ai-extract` `sources` fence rejects with no `code`.
  - Turned "YouTube → recipe" into "resolve to evidence, then classify the evidence", deleting a special case instead of adding one.
  - Turned the JSON-LD short-circuit into a **DRY win**: `processUrl`'s two duplicated branches collapse into the same `deliverRecipe` the share path uses.
  - Verified the telemetry claim against both allowlists rather than asserting it, and corrected the "exactly one fetch" acceptance criterion.
- **Pass 3 (Sustainability)**: nine changes, all aimed at leaving fewer invariants for future maintainers to hold in their heads.
  - **Removed a duplicated field.** Pass 2 put `link` on both the `jsonld` arm of `RecipeShareSource` and on `ResultEnvelope` — the same value in two places with an unenforced "must agree" rule, and the `text`-sourced link share needed it from the envelope anyway. `ResultEnvelope.link` is now the single home; the union carries only the payload shape; the impossible state throws into the existing catch instead of producing an unprovenanced recipe.
  - **`sourceFile: File | null` rather than `sourceFile?: File`.** Optional means a future construction site can omit it and silently lose the attachment; required-but-nullable makes the compiler demand an answer. No churn — all three existing sites already pass a file.
  - **Turned deploy order from a documented hazard into a fixed one.** The `ai-extract` `sources` fence returns `code: 'unknown_task'`, matching the precedent already sitting twenty lines above it, which `managedProvider` already maps to the friendly toast. One line; retires the hazard class for every future task/source pair, not just this one.
  - **Made the orchestrator split structural, not cosmetic.** `prepare` and `read` become module-level named functions (precedent: `notReady`, `toPayload`), the exported spine stays ~70 lines with an acceptance criterion pinning it, and the `null`-means-already-reported sentinel is documented at both signatures instead of being folk knowledge.
  - **One text cap, at the trust boundary.** Pass 2 capped only in `ShareIntentPlugin.java`, leaving the PWA path unbounded into `extractUrls`'s whole-string `split`. `MAX_SHARE_TEXT_CHARS` now lives in `share/types.ts` and is enforced in `prepare`; the native cap is explicitly the second line, not the only one.
  - **Moved the `text/plain`-file rule out of `iosShareAdapter` and into the orchestrator**, per `share/types.ts`'s own doctrine. Deletes a platform-specific branch and makes a shared `.txt` work on all three platforms instead of one.
  - **Lifted `provenanceUrl` / `boundedImage` out of `processUrl`'s closures** into `src/utils/shareLink.ts`. They were closures over `route`/`kind`, which is the specific reason pass 1 assumed the share path needed its own copy; as pure functions they are directly testable and the same-domain image bound has exactly one implementation both callers reach.
  - **Corrected a concrete PWA bug the pass-2 design would have shipped**: `readAndClearShareStash` sorts by `Number(lastPathSegment)`, so a `/__share/{id}/text` key yields `NaN → 0`, sorts in among the files, and comes back as a `File` named `shared`. The key is now partitioned out before the sort while the unconditional delete still covers it.
  - **Put the copy-neutrality warning where the next editor will be standing** (the key definitions in `uiStrings.ts`, not only the mapper), noted that hash-based re-translation makes the rewording free, tightened the first-usable-URL rule, and added an explicit "not in v1" list so scope cannot drift during implementation.

- **Pass 4 (Fresh-eyes sweep)**: seven changes, each verified against the code rather than reasoned about. Nothing structural was overturned — passes 2 and 3 hold — but three of these would have shipped as real defects.
  - **The URL picker's predicate becomes `routeUrl`, not `safeHttpsUrl`.** Pass 3 left the share path with a _weaker_ notion of "usable" than the resolver applies moments later, so prose containing a YouTube channel link ahead of a good recipe URL would pick the channel and die on `not_a_recipe_url` with a readable link two words away. One predicate now, shared with the resolver, and `no_url` becomes the single honest "nothing here we can read" outcome instead of two overlapping ones.
  - **Killed the shared `SOURCE_DESCRIPTION` prompt constant.** Read side by side, the recipe and share prompts are tuned for different jobs and a constant serving both is weaker than either — so pass 3's DRY move amounted to editing a live, working feature's system prompt with no test able to catch the regression. DRY governs logic and data, not independently-tuned prompt copy. The recipe prompt stays byte-identical; only the share prompt's two source-naming lines change, and that is diff-asserted in CI.
  - **Bounded the `.txt` decode, not just its result.** `await file.text()` on a hostile 100 MB file declaring `text/plain` is an OOM the cap was meant to prevent. `file.slice(0, MAX_SHARE_TEXT_CHARS * 4).text()` makes the cap real at the boundary rather than after it.
  - **The PWA must read `url` AND `text` and join them.** Chrome puts a shared link in whichever field the sender marked, and a title+URL share fills both; pass 3 spoke only of "the text". Joining removes the branch that would otherwise have to guess, and adds a test per delivery shape.
  - **Pinned the two opposite URL fields at the mapper boundary.** `jsonLdToPrefill` / `recipeExtractionToPrefill` take `pageUrl` (it is the same-registrable-domain image bound); `sourceUrl` is relabelled to `provenanceUrl` _after_ mapping. Swapping them silently drops every dish photo from a video capture — the failure `processUrl`'s SAFETY comment already exists to prevent — so both now carry an acceptance criterion and a unit test instead of a comment.
  - **Named the three guards and two toasts the orchestrator split could quietly drop** — the four `notReady` branches (including `ai_unconfigured`, which the link path needs identically for `tier`/`byok`), the `meta.unreadable` partial notice and the multi-file `firstAttached` notice, with their current relative order. A refactor that loses either notice is invisible until a user shares four photos and gets one.
  - **Recorded two decisions that were being made implicitly**: why a text share with no URL is a toast rather than a `share`-task classification (it would turn any share sheet into a general text→model endpoint, and the "less code" argument is an illusion), and that truncation can sever a URL past 4 000 characters with `no_url` as the honest outcome. Also fixed the Android adapter's early-return expression against the line actually in the file, and pinned `file_count: 0` on a link share so existing dashboards keep meaning what they mean.

## Prompt Log

> **No GitHub issue created.** This plan extends #64 and was prepared for direct implementation.

<details><summary>Full prompt history</summary>

1. "Another issue I'm seeing now is that when i try to share a video from youtube on android i don't see beanies as a share target, although i can confirm i see beanies as a share target from whatsapp (sharing an image) and when sharing a pdf from adobe acrobat"

2. "no need to file just go ahead to prepare the plan for adding link sharing - my inclination would just be to send the link to the AI endpoint to determine the classification, unless you feel that is risky or a security problem and you can propose a better alternative"

3. "continue with the remaining passes and save the plan"

</details>
