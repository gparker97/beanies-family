# Plan: Widen the recipe dish-image ladder so every recipe starts with a picture

> Date: 2026-09-04
> Related issues: Notion tracker #86 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-04-recipe-dish-image-ladder.md`

## User Story

As a parent saving a recipe from a food blog, I want beanies to pick up the dish photo that is plainly on the page, so my cookbook looks like a cookbook instead of a list of empty cards.

## Context

#72 shipped recipe capture and promised "a dish photo". An early adopter reported on Discord that it is "very hit and miss" — he shared URLs full of photos where none were captured.

The pipeline consults exactly two image sources and then discards most of what it finds. Three defects compound:

1. **The same-registrable-domain bound drops nearly every real image.** `recipeExtractionToRecipe.ts:88-90,119-121` and `shareLink.ts:43-52` require the image host to match the page host. Real recipe sites serve images from CDNs — `cdn.sndimg.com`, `res.cloudinary.com`, `i0.wp.com`, `squarespace-cdn.com`, `imgix.net`. This is the single largest killer and it is the one path that _is_ logged (`image_rejected/cross_domain`).
2. **The JSON-LD branch returns before `og:image` is ever read.** `page.mjs:225-230` returns the moment a Recipe node normalises. A Recipe node without an `image` key yields nothing, while the page's `og:image` sits in the same HTML string already in memory.
3. **Only two sources exist at all.** No `twitter:image`, `og:image:secure_url`, `<link rel="image_src">`, or JSON-LD `thumbnailUrl`.

Downstream, format and transport gates reject what survives: `image.mjs:53` allows JPEG/PNG/WEBP only (**AVIF is rejected**, now the default output of Cloudflare Images, the Next.js optimizer and several WordPress plugins), the decoded cap is 1.5 MB, and no `Referer` is sent so hotlink-protected CDNs 403.

And the most common failure is **invisible**: `boundedDishImage` returns `null` silently at `shareLink.ts:27` when the page yielded no candidate at all. We cannot currently measure the thing we are trying to improve.

### Findings from reading the code that change the shape of this work

**Finding 1 — the domain bound is a deliberate security control, not an oversight.** Both call sites carry comments explaining it, and `url.ts:181-194` states it plainly: a fetched page is untrusted, so its self-declared image is only accepted from the same registrable domain, otherwise "a hostile page could name any host as its image and we would fetch it" from AWS egress. Removing it wholesale would discard a real control. The plan resolves this by **provenance** rather than by deleting the check — see Approach §2.

**Finding 2 — the on-brand fallback illustration already exists.** `PolaroidImage.vue` (`src/components/pod/shared/`) already renders, when `src` is null, a terracotta kraft-paper panel with a gingham pattern and a serving-cloche SVG in Terracotta `#E67E22`. Its own docblock says it exists "so photo-less recipes still look intentional rather than empty." Both the cookbook card (`FamilyCookbookPage.vue:277`, `16 / 10`) and the detail hero (`RecipeDetailPage.vue:226`, `4 / 3`) already use it, passing `cookbook.card.noPhoto` ("no photo yet") as the caption.

> ✅ **Resolved with greg 2026-09-04.** #86 says to add a `recipes` variant to `EmptyStateIllustration.vue`. That component is a fixed `h-40 w-40` circular _page-level_ empty state with nine finance/list variants, each a bespoke `<svg viewBox="0 0 160 160">` with the `BeanieCore` mascot. The recipe fallback is a per-item `16 / 10` fill inside a polaroid frame. greg approved using `PolaroidImage` instead: _"agreed, use PolaroidImage - continue with the passes"_. **`EmptyStateIllustration` is not modified.**

**Finding 3 (Pass 2) — the "survives an abandoned save" requirement, implemented naively, re-opens a bug that was already fixed on purpose.** `RecipeFormModal.vue:325-345` clears the capture's held state on close, with a long comment describing the exact incident: _"Paste a link, change your mind, cancel; later open the form to edit an unrelated recipe and save, and the abandoned photo is fetched and attached to THAT recipe… Every failure inside the attach is caught and logged at info, so it happens silently."_ `FamilyCookbookPage.vue:146,179` carries the same guard. Requirement 13 must therefore be met by **binding the candidates to the prefill currently in the form**, never by weakening that discard. See Approach §7.

**Finding 4 (Pass 2) — the dish-image attach already fails silently in two places, and the plan as drafted would have made it worse.** `useRecipeCapture.ts:544` calls `await photos.add([...])` for the dish image and **discards the return value**. When cloud sync is off, `usePhotos.add` toasts `photos.cloudRequired` and returns `[]` — nothing is logged at all. Under the drafted plan, `image_resolved` would have fired for a photo that was never stored, poisoning the very hit-rate metric this work exists to create. See Approach §3 and Observability.

**Finding 5 (Pass 3) — the Pass-2 design for requirement 13 would have attached every dish image TWICE.** There are two live `useRecipeCapture` instances and **both** run an attach for a single save: `RecipeFormModal.handleSave:367` calls `capture.attachAfterSave(result.id)` on its own instance, then emits `saved`, and `FamilyCookbookPage.handleSaved:184` calls `attachAfterSave(id)` on the page's instance. Today that is safe _because the held state is composable-local_ — the instance that did not capture holds nothing and returns at `if (!file && !dishUrl) return`. Pass 2 proposed moving the candidates to a **`RecipeFormModal`-local ref set by `applyPrefill`** — and `applyPrefill` is deliberately wired to fire on **both** routes (`onNew: () => applyPrefill(props.prefill)` at `:151`, and `onRecipeReady` at `:186`; the comment at `:89` says this is the point). So the modal-local candidates would be populated even when the _page_ captured, and both call sites would fetch and store the same photo: two photos on the recipe, two of the four-photo cap consumed, and two `image_resolved` events inflating the hit rate this work exists to measure. **Fixed in §7 by giving the dish attach exactly one owner.**

**Finding 6 (Pass 3) — validating the candidate `source` against a client-side list breaks the plan's own deploy order.** Pass 2 specified that `screenCandidates` matches `source` "against the frozen enum" and drops non-matches, and the deploy order is **Lambda first, client second**. Those two are in direct conflict: any rung the Lambda learns before the client does would have every one of its candidates silently discarded on-device for the whole deploy window — the exact silent-drop class this issue exists to eliminate. `source` is a **telemetry label, not an authorisation**; the authorisation is `safeHttpsUrl` + `screenUrl`. See §2.

**Finding 7 (Pass 4) — a bare candidate array cannot tell "the page offered nothing" from "there was no page", so the single-owner design would have lost the most important event in the plan.** Under Finding 5's fix the dish attach is owned by `RecipeFormModal`, which sees only what the prefill carries. If the prefill carries `dishImageCandidates: ImageCandidate[]`, then a **link capture whose page offered zero images** (`[]`) is byte-identical to a **document or hand-typed save** (`[]`) — and `image_none / count: 0 / no_candidates` is precisely the event the Observability section calls "the whole reason the failure was invisible". The gate the plan specifies (`link != null`) is not reachable from the form. The field must therefore carry the link's _existence and kind_, not just its URLs:

```ts
export interface DishImagePrefill {
  kind: 'page' | 'youtube'; // the telemetry label; also proves a source link existed
  candidates: ImageCandidate[]; // may legitimately be empty
}
// RecipePrefill.dishImage?: DishImagePrefill | null
```

`null`/absent means "no source page — emit nothing"; present-with-`[]` means "a page was read and offered nothing — emit `image_none/no_candidates`". One nullable object replaces one string field, still one field moving, and it supplies the `kind` context key the events need. See §2 and §7.

**Finding 8 (Pass 4) — three of Pass 3's concrete instructions do not survive contact with the signatures they name.**

- `recipeFetchService.fetchImage(url, pageUrl?)` **collides with the existing second parameter**, which is `signal?: AbortSignal` (`recipeFetchService.ts:161`). A positional `pageUrl` there is a bug waiting for the first caller that wants to pass a signal. It becomes `fetchImage(url, opts?: { pageUrl?: string; signal?: AbortSignal })`.
- `base64ToFile(base64, name, type)` (`src/utils/base64ToFile.ts:15`) takes **raw base64, not a data URL**. Passing `img.data.dataUrl` makes `atob` throw — caught by the loop's `try`, logged as a generic failure, and the photo silently never attaches. The `data:…;base64,` prefix must be stripped at the call site.
- JSON-LD `thumbnailUrl` is **not reachable from `extractRecipeFromHtml`**, which returns the _normalised_ recipe and discards the raw node (`recipeJsonLd.mjs:241-286`). Without saying so, an implementer will hand-roll a second JSON-LD scan — the one outcome this plan is most concerned to avoid. See §1.

**Finding 9 (Pass 4) — the `detail` vocabulary promises a value the code cannot produce.** `compress_failed` is not distinguishable from `store_rejected` at the attach layer: `usePhotos.add` returns `[]` for a cloud-off refusal, an at-cap refusal, a rejected type **and** a thrown `CompressionError` alike (`usePhotos.ts:129-262`), and the richer context it does log (`file_mime`, `underlying_error`) is **not on the allowlist**, so it is stripped before it leaves the device. Since `cloud_required` and `at_cap` are checked _before_ the call (§3 step 1), a surviving `store_rejected` already means "decoded or uploaded badly" by elimination. Declaring a fourth value we can never emit would leave a permanently-empty CloudWatch dimension that reads as "this never happens". Dropped — see Observability.

**Finding 10 (Pass 4) — five `asciiLower` copies of a 2 MB page.** `findMeta` calls `asciiLower(html)` on every invocation (`page.mjs:112`), and `asciiLower` is a whole-string regex replace (`asciiLower.mjs:21-23`). Page mode's cap is 2 MB (`page.mjs:15`). Today that cost is paid once for `og:image`; a naive six-rung ladder pays it six times — ~12 MB of transient garbage and six full passes, inside the same function whose header is a treatise on linear-vs-quadratic scanning. `findTagAttr` therefore takes the **already-lowered string as a parameter**, and `collectImageCandidates` computes it once.

## Requirements

1. The Lambda extracts an **ordered list of image candidates** from a fetched page, each tagged with the source that produced it, instead of a single `imageUrl`.
2. The candidate ladder, in order: JSON-LD `image` → `og:image` → `og:image:secure_url` → `twitter:image` → `twitter:image:src` → `<link rel="image_src">` → JSON-LD `thumbnailUrl`. _(Pass 2: `itemprop="image"` and the in-body `<img>` rung are recommended cuts — see the Deferred Scope box.)_
3. The JSON-LD branch **never returns early** — a page with structured data still contributes its meta-tag candidates.
4. Candidates are absolutised, entity-decoded, deduplicated, screened server-side, and capped at 5.
5. The client tries candidates **in order**, at most 3, until one fetches _and stores_ successfully.
6. Author-declared candidates attach with no AI check. _(The scraped tier that required one is deferred — see the box below.)_
   - ⚠️ **Attribution, so the follow-on is prioritised honestly: the AI verification was greg's idea, NOT the early adopter's request.** His feedback asked only that photos be captured more completely ("it seems very hit and miss"). Nobody has asked for AI relevance/safety checking of dish photos. That is a reason the deferral costs less than it first appears — see the Deferred Scope box.
7. The capture never blocks on the image; the recipe is saved first, always.
8. `image` mode accepts **AVIF and GIF** in addition to JPEG/PNG/WEBP, by magic bytes as well as content-type, and `usePhotos` accepts the same widened set.
9. The decoded byte cap is raised to 3 MB, and image requests send a `Referer` matching the page they came from.
10. A YouTube capture uses the video thumbnail — **including the `titleOnly` path, which today is the case with no other possible image**.
11. Every capture **that had a source link** emits telemetry naming which rung supplied the image, or why none did — using **only already-allowlisted context keys**.
12. The no-image placeholder varies deterministically by recipe id — stable per recipe, varied across a grid.
13. A dish image survives an abandoned save within the session, **without** re-opening the cross-contamination bug of Finding 3.
14. **(Pass 3)** A single save attaches the dish image **exactly once**, regardless of which of the two capture instances produced the prefill.
15. **(Pass 4)** "The page offered no images" is distinguishable in telemetry from "there was no page" (Finding 7).

> ### ✅ Deferred scope — DECIDED 2026-09-04: deferred, greg approved
>
> The draft carried an in-body `<img>` scraping rung gated by a **new `image_relevance` AI task**. Pass 2 recommends cutting both from this release:
>
> - **Nobody asked for the AI check.** It was greg's own idea, not the early adopter's — his report asked only for photos to be captured more completely. So deferring it removes a self-imposed cost, not a user-facing promise.
> - **Every failure in the bug report is an author-declared image killed by the domain bound.** The scraped rung fixes none of them.
> - Its cost is disproportionate: a fourth entry in the three mirrored `EXTRACTION_TASKS` copies (pinned by `extractionPromptDrift.test.ts`), consent plumbing through `useDocumentConsent`, per-family budget plumbing, a new `image_rejected` sub-taxonomy, and a new class of "the AI wrongly rejected my photo" support question.
> - Ranking in-body `<img>` by `width`/`height` attributes is itself unreliable — modern responsive markup omits both in favour of `srcset`/CSS.
>
> Also cut: the `itemprop="image"` rung. `findMeta` matches by _quoted substring anywhere in the tag_, so an `itemprop` rung would also match `<meta name="x" content="image">` and emit `image` as a candidate, which `absolutize` happily resolves into a bogus URL. Low value, real false-positive rate.
>
> The full spec for both is preserved in **Appendix A** so nothing is lost. They are a clean follow-on that changes nothing built here. **Revisit when this release's `image_none / no_candidates` rate is known** — that number IS the scraped rung's addressable market.

## Important Notes & Caveats

- **The model must stop supplying image URLs.** `htmlToText` strips every tag before the model sees the page (`page.mjs:153`), so the model has never had a real URL to return — it can only hallucinate one, and `extractionPrompt.ts:383` even warns it not to. With server-extracted candidates the model's `imageUrl` becomes dead weight _and_ the only reason the strict domain bound was needed. **Drop `imageUrl` from the model path entirely** (`extractionPrompt.ts:383,505`, `types.ts:236`, and the two mirrors). A simplification and a security improvement at once.
- **Do not remove the SSRF screen.** `guardedFetch.screenUrl` stays exactly as-is. It, not the domain bound, is the control that matters.
- **(Pass 4) Be precise about what `screenUrl` does.** Read at `guardedFetch.mjs:194-209`: it is **synchronous** and checks _only_ type/length/parse/`https:`/no-credentials/port-443 — no DNS, no private-range test. The private-range and cloud-metadata blocking lives in `resolvePublicAddress`, at fetch time, per redirect hop. Two consequences: (a) server-side pre-screening of five candidates is genuinely free — no DNS amplification, no added latency; (b) "screened server-side" in §1 means _syntactically_ screened, and the real SSRF control still runs on every candidate we actually fetch. Say this in the code comment so nobody later reads the pre-screen as the authorisation and deletes the one that matters.
- **`guardedFetch` must NOT gain an arbitrary `headers` bag.** The module explicitly removed that pattern and documents why (`guardedFetch.mjs:311-335`: a caller-set `host` makes the DNS pin decorative, `cookie`/`authorization` break the stated no-credentials posture, a caller-set `content-length` leaves bytes on the socket). It takes a narrow, validated `referer` string instead; every other header stays derived.
- **The dispatcher only passes `url`.** `index.mjs:120` is `MODES[mode](url)`. Sending a `Referer` needs an _additive_ `pageUrl` body field and validation of that field. **(Pass 3)** Keep the blast radius to one mode: the call becomes `MODES[mode](url, { pageUrl })` and **only `image.mjs` changes signature**. JS ignores extra arguments, so `page`, `youtube` and the rest are untouched.
- **(Pass 4) `fetchImage`'s second parameter is already `signal`.** Options object, not a second positional — see Finding 8. `post` gains an optional extras object spread as `{ ...extra, mode, url }` so a stray key can never shadow `mode` or `url`.
- **The client casts the Lambda body unchecked** (`recipeFetchService.ts:154`, `body as T`). `imageCandidates` must be defensively normalised on arrival, or an old Lambda / a shape drift becomes a TypeError inside a Vue watch callback with no catch above it.
- **(Pass 3) Normalisation must be forward-compatible, not strict.** See Finding 6: an unrecognised `source` is relabelled, never a reason to drop a URL.
- **`Accept` already advertises AVIF** (`guardedFetch.mjs:73`) while `image.mjs` rejects it. Requirement 8 resolves the existing inconsistency.
- **`Referer` and `referrerpolicy` are different layers.** `PolaroidImage` sets `referrerpolicy="no-referrer"` on the `<img>` deliberately so Google's lh3 CDN rate-limits by IP (see `BeanieAvatar.vue:231-247`) — that is about _rendering stored photos_ and must not change.
- **Everything is re-encoded to JPEG anyway.** `photoCompression.compress` decodes with `createImageBitmap` and re-encodes to JPEG for everything except an already-small in-cap JPEG. So AVIF/GIF support is about **decode**, not storage fidelity, and the byte cap buys resolution rather than quality. **(Pass 4)** An animated GIF therefore lands as its first frame — correct and unremarkable for a dish photo, but say so once so it is not later filed as a bug. A codec the engine cannot decode throws `CompressionError` inside `usePhotos.add` → `photos.uploadFailed` toast; see Finding 9 for how that surfaces in telemetry.
- **(Pass 4) `usePhotos`' accept test is an `||`, not an `&&`** (`usePhotos.ts:152`). For _this_ feature the mime-list widening alone is sufficient, because we construct the `File` from the **sniffed** mime. Widening the filename regex as well is a deliberate, separate, small product widening for _user-picked_ files (a `.avif` from a phone gallery), justified because everything is re-encoded to JPEG. Ship both, but with that distinction in the comment — the regex is the looser of the two gates and should never be widened by accident.
- **Prompt drift is pinned across three mirrors.** `src/services/ai/extractionPrompt.ts`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`, `scripts/spikes/extractionPrompt.mjs` — `extractionPromptDrift.test.ts` enforces this, so Step 8 must change all three in one commit.
- **Telemetry adds ZERO new context keys** (Pass 2 change). Verified in both files: `detail` (`diagnosticContext.ts:185`, `telemetry/index.mjs:139`), `count` (`diagnosticContext.ts:318`, `telemetry/index.mjs:77`), plus the long-standing `kind` and `error_code`. See Observability.
- **Deploy order: Lambda first, then client.** `imageCandidates` is purely additive — an old client ignores it and keeps using `imageUrl`, so there is no broken intermediate state. **This order is only safe if the client never rejects a candidate for having an unfamiliar `source` (Finding 6).**
- **(Pass 3) The `imageUrl` compatibility shim is temporary and must be dated.** `page.mjs` keeps populating `imageUrl = imageCandidates[0]?.url` for one release. A dead field that nobody deletes is how a "temporary" dual path becomes permanent. Its removal is Step 9 of the sequencing below, with an explicit follow-up note in `CHANGELOG.md`.
- **The 4-photo cap and cloud-required check still apply.** A family with no cloud photo store still gets no dish photo; that is existing behaviour and out of scope, but this plan makes it _logged_ rather than silent, and makes it short-circuit before we spend three Lambda fetches on bytes we will discard.
- **(Pass 4) The attach is background work and may take up to ~45 s in the worst case.** The client timeout is 15 s (`recipeFetchService.ts:18`) and the server budget 9 s (`guardedFetch.mjs:46`); three failing candidates is three of those. That is acceptable — the recipe is already saved, `clearPending` always runs in a `finally`, and the pending treatment is the same one a slow upload shows — but it is the reason the attempt cap is 3 and not 5.
- **(Pass 3) No TypeScript `enum`.** The codebase uses `as const` arrays plus derived union types for domain vocabularies (`enum` appears only in `google-picker.d.ts`, a vendor ambient declaration). `ImageSource` follows the house style.
- **(Pass 3) The Lambda test suite is a glob, not a single file.** `package.json:20` runs `infrastructure/lambda/content-fetch/__tests__/*.test.mjs`. A sibling `imageCandidates.test.mjs` costs nothing and keeps both files readable.
- **(Pass 4) `useRecipePhotoPending` is module-level, shared state** — verified in its own docblock. So it does not matter _which_ capture instance calls `markPending`; the cookbook card and the detail hero both see it. This is what makes the single-owner design in §7 safe for the spinner. The corollary is in §7: `clearPending` must become conditional.

## Assumptions

> Review before implementation.

1. The content-fetch Lambda can be deployed independently of the client bundle (it has been, for every prior change).
2. AVIF/GIF are decodable by `createImageBitmap` in the engines in scope (Chrome, WebKit 16.4+, Android WebView). Verified as a browser-support question, not a Node one — the Lambda never decodes.
3. 3 MB decoded is the right cap: base64 inflates ~1.33×, so 3 MB ≈ 4.0 MB encoded, leaving ~2 MB of headroom under the 6 MB Lambda response ceiling for the JSON envelope.
4. No page legitimately needs more than 5 candidates collected or 3 tried.
5. ~~Greg approves the two deferrals in the box above.~~ **RESOLVED 2026-09-04 — greg approved the deferral** after a full explanation of the tradeoff: _"ok let's defer, approved"_. The in-body `<img>` rung, its `image_relevance` AI gate, and the `itemprop="image"` rung are OUT of this release (Appendix A). The decisive argument was that this release's own `image_none / count: 0 / no_candidates` telemetry measures the scraped rung's entire addressable market, so the follow-on can be justified with a real number instead of built blind. (The `EmptyStateIllustration` deviation in Finding 2 was approved separately.)
6. **(Pass 3)** `RecipeFormModal` is on every path that saves a _captured_ recipe. Verified: five mount points (`FamilyCookbookPage`, `RecipeDetailPage`, `MealEditModal`, `RecipeRail`, `FavoriteFormModal`), only `FamilyCookbookPage` passes `:prefill`, and every capture save goes through the modal's `handleSave`. The one other `recipesStore.createRecipe` caller is `MealPickerSheet.vue:70`, a name-only quick-create with no capture, no prefill and no image — out of scope by construction. This is what makes the single-owner design in §7 total.
7. **(Pass 4)** `i.ytimg.com` thumbnail URLs are a stable, well-known YouTube surface. They are constructed client-side from the `videoId` `routeUrl` already parses (`recipeSourceUrl.ts:130`), so they are the one candidate whose host we choose rather than a page declaring it.

## Approach

### 1. Server: extract an ordered candidate list (`page.mjs`)

Add `imageCandidates: Array<{ url: string; source: ImageSource }>` to **both** page outcomes.

- **Generalise the existing scanner, do not write a second one.** `findMeta` is a linear `<meta` scan (`page.mjs:105-127`). Extract its body into `findTagAttr(html, lower, tag, quotedNeedle, contentAttr)`; `findMeta(html, key)` becomes a two-line wrapper that computes `asciiLower(html)` itself, keeping its exported signature and existing tests green. `<link rel="image_src">` is then the same scanner with `tag='<link'`, `needle='"image_src"'`, `contentAttr='href='`. One scanner, two callers, and the `dropTag` DoS discipline is inherited rather than re-argued.
- **(Pass 4) `collectImageCandidates` computes `asciiLower(html)` ONCE** and passes it to every `findTagAttr` call (Finding 10). This is the reason `findTagAttr` takes `lower` as a parameter rather than computing it — say so in a one-line comment, or someone will "simplify" it back.
- **The quoted needle is load-bearing.** `findMeta`'s `"og:image"` (with both quotes) is what stops the `og:image` rung matching `property="og:image:secure_url"`. Every row in the ladder table relies on this; a row whose needle is unquoted would silently swallow its own siblings. Asserted in the tests.
- **JSON-LD rungs reuse the normaliser, they do not re-parse** (Finding 8). `extractRecipeFromHtml` already runs `firstImageUrl(node.image)` inside `normalizeRecipeNode` (`recipeJsonLd.mjs:232`), so the `jsonld` rung is simply `jsonld.imageUrl` — no second call, no second parse. For `thumbnailUrl`, add **one line** to `normalizeRecipeNode`: `thumbnailUrl: text(firstImageUrl(node.thumbnailUrl), 2000)`, symmetric with the line above it and reusing the same depth-bounded helper. Do **not** change `extractRecipeFromHtml`'s return shape to expose the raw node — that ripples through its tests for one optional rung. The extra field is inert on the wire; the client's `JsonLdRecipe` type simply does not declare it.
- `collectImageCandidates(html, lower, finalUrl, jsonld)` is one pure function driven by a frozen ordered table of `{ source, read }` entries, not seven copy-pasted blocks. Every meta value goes through the existing `metaContent` (entity-decoding — load-bearing, see its docblock on `&amp;`) and `absolutize`.
- Run it on **both** branches. The JSON-LD branch stops returning early: it computes candidates from the same in-memory HTML and returns them alongside the recipe.
- Deduplicate by the absolutised URL string; drop anything `screenUrl` would reject **server-side** (cheap and synchronous — see the caveat above), so the client is never handed a candidate it must reject; cap at 5.
- Keep `imageUrl` populated with `imageCandidates[0]?.url` for one release so an old client keeps working (see the dated-shim caveat). `recipe.imageUrl` stays on the JSON-LD payload for the same reason; the client stops reading it.
- `MAX_TEXT_CHARS`, `MIN_USEFUL_CHARS` and the `not_readable` behaviour are untouched. (Known, accepted: a JS-shell page that carries an `og:image` still returns `not_readable`, because there is no recipe to attach the image to.)
- **(Pass 4) `<base href>` is NOT honoured and will not be.** `absolutize` resolves against `res.finalUrl` only. Pass 3's test list named a `<base href>` fixture, which would fail. Either the feature or the fixture had to go, and the feature is not worth it: `<base>` is rare, it is attacker-authored on an untrusted page, and honouring it would let a page redirect relative resolution to a host of its choosing — precisely the aim-our-egress concern Finding 1 is about. The test asserts the **documented limitation** instead.

### 2. Client: candidate provenance replaces the domain bound

The domain bound existed because the _model_ could name any host. Once candidates are **server-extracted from the page we fetched and screened by `screenUrl`**, that threat is gone: the URL came out of the page's own markup, and `guardedFetch` screens it — and resolves it against the private-range blocklist — again on the way out.

- `boundedDishImage` is deleted; `screenCandidates(raw): ImageCandidate[]` replaces it in `shareLink.ts` — same file, same pure-function discipline, direct unit tests in the existing `shareLink.test.ts`.
- It is also the **defensive normaliser** for the unchecked cast: `Array.isArray` guard, per-item `typeof url === 'string'`, `safeHttpsUrl` on each, `?? []` default. A malformed or absent field yields `[]`, never a throw.
- **(Pass 3) `source` is a label, not a gate.** An unrecognised `source` value is coerced to `'other'` and the candidate is **kept**. Dropping it would make Lambda-first deploys silently lossy for the duration of every future rung addition (Finding 6). Security is `safeHttpsUrl` client-side plus `screenUrl` + `resolvePublicAddress` server-side; a string used only as a CloudWatch dimension must never be able to reject a URL. `'other'` is a member of the `ImageSource` union so telemetry stays typed and the unknown case is visible in the rung distribution rather than invisible.
- Screening kept: `safeHttpsUrl` (scheme/port/credentials/length). Screening dropped: `isSameRegistrableDomain`, **for server-extracted candidates only**. `isSameRegistrableDomain` itself stays exported and unchanged — other callers and its own tests are untouched.
- `ShareLink.imageUrl: string` → `ShareLink.imageCandidates: ImageCandidate[]`. **(Pass 4) Three construction sites, not four** (Pass 3 miscounted): `toShareLink` (`shareLink.ts:76`) and the two hand-built `titleOnly` literals (`useRecipeCapture.ts:417`, `useSharedDocumentIngest.ts:854`).
  - **(Pass 4) Collapse the two literals onto `toShareLink`.** Once `ResolvedRecipeSource`'s `titleOnly` variant carries `imageCandidates` (requirement 10 below), both literals are exactly `toShareLink(resolved, { kind: 'youtube', url: resolved.sourceUrl })` — identical output, three sites become one, and requirement 10 reaches the `titleOnly` path for free instead of being hardcoded to `[]` in two places. If for any reason the shapes do not line up cleanly in the editor, leave the literals and note it; do not force it.
- **(Pass 4) `RecipePrefill.dishImageUrl: string | null` → `dishImage?: DishImagePrefill | null`** — the `{ kind, candidates }` object of Finding 7, not a bare array. **One field moves; no second mechanism is introduced.**
  - `recipeExtractionToRecipe.ts` **stops carrying an image concern entirely**: both `recipeExtractionToPrefill` and `jsonLdToPrefill` drop their `isSameRegistrableDomain`/`safeHttpsUrl` pair _and_ the field itself, and `recipeExtractionToPrefill`'s `sourceUrl` parameter loses its only purpose — delete the parameter and the argument at `useRecipeCapture.ts:196`. The `titleOnly` literal at `:208` drops the field too.
  - `dishImage` is assigned in exactly **one** place: `deliverRecipeInner`, at the line where `pendingDishImageUrl` is set today (`useRecipeCapture.ts:238`), inside the existing `if (link)` block that already knows both the link and its kind. Three write sites become one, and the "did a page exist" fact is recorded by the only code that knows it.
  - ⚠️ **Consumer the draft missed:** `RecipeFormModal.vue:108` reads `!!prefill?.dishImageUrl` for `willAttachPhoto`. Under §7 this stops being a separate ref entirely. `RecipeFormModal.vue` was not in the draft's Files Affected.
- `ImageSource` lives in `src/types/magicPayload.ts` as `const IMAGE_SOURCES = [...] as const` + `type ImageSource = (typeof IMAGE_SOURCES)[number]` — house style, no TS `enum`.

**Requirement 10 — the YouTube thumbnail, done once.** Add `imageCandidates: ImageCandidate[]` to all three success variants of `ResolvedRecipeSource` (`jsonld`, `text`, `titleOnly`). `fromPage` carries the page's candidates through. On the YouTube routes, append **two** rungs built from `route.videoId`, both labelled `youtube_thumb`: `https://i.ytimg.com/vi/<id>/maxresdefault.jpg` then `.../hqdefault.jpg`. Two, because `maxresdefault` 404s for any video not uploaded at ≥720p while `hqdefault` always exists — and the §3 ladder already falls through a 404 for free, so this costs one array entry and no new logic. On the `youtube_link_followed` route the video thumbnails go **after** the blog page's own candidates: the blog's hero is the dish, the video thumbnail is a face and a caption.

### 3. Client: try candidates in order, bounded, and never claim success we did not get

**(Pass 3) Move the dish-image attach out of `useRecipeCapture` into its own module.** `useRecipeCapture.ts` is already 646 lines and `runAttach` already carries two attach concerns in one body. Adding a bounded loop with a per-candidate `try/catch`, a store-result check and per-branch logging would land at four-to-five levels of nesting inside a function that also handles the source document — the single hardest-to-follow block in the file, and the one whose failure modes we are trying to make legible.

Instead:

- New `src/services/ai/attachDishImage.ts` exporting `attachDishImage(recipeId, candidates, deps): Promise<DishAttachOutcome>`, where `deps` is `{ photos, fetchImage, pageUrl, log }`. It owns the loop and returns a discriminated result (`{ ok: true, source } | { ok: false, reason, errorCode? }`); it does **not** own the telemetry vocabulary decision — it returns the reason and the caller logs it, so the log call sites stay in one place.
- `runAttach` splits into two flat, independently readable steps called in sequence: `attachDishImage(...)` then the existing source-document block (unchanged, moved verbatim into `attachSourceDocument`). Each keeps its own `try/catch`; a throw in one cannot swallow the other.
- **(Pass 4) ONE `usePhotos` instance, created in `attachAfterSave` and passed to both steps.** It is constructed once today (`runAttach`) and must stay that way: two instances would each hold their own `pending` counter and their own read-modify-write of `photoIds`, and `totalCount` — which enforces the 4-photo cap — counts `pending` _per instance_, so two instances can each believe there is room. Passing the one instance in `deps` is also what makes the loop unit-testable with a fake.
- This also makes the loop directly unit-testable with a fake `photos`, rather than reachable only through a 175-line orchestrator.

**No helper is lifted from `recipeSourceResolver`.** The draft proposed exporting `createFetchBudget`; that closure exists because the YouTube ladder's rungs are non-linear and branch. Here the shape is `for (const c of candidates.slice(0, MAX_IMAGE_ATTEMPTS))`, and a mutable-counter object would be strictly more code for strictly less clarity.

Order of operations, each step chosen to avoid a known silent failure:

1. **Short-circuit on `photos.canAdd.value === false` before the loop.** Cloud sync off or the 4-photo cap reached means every byte we fetch is guaranteed to be discarded. Skip the loop, return `{ ok: false, reason: 'cloud_required' | 'at_cap' }` (distinguished by `photos.atCap.value`, both already exposed), and the caller logs once. Saves up to three 15-second round trips per capture.
2. For each candidate: `fetchImage(url, { pageUrl })`. On failure, record the `errorCode` and continue to the next.
3. On a successful fetch, build the `File` with the **existing** `base64ToFile` helper (`src/utils/base64ToFile.ts`), **passing the payload after the comma, not the whole data URL** (Finding 8): `dataUrl.slice(dataUrl.indexOf(',') + 1)`. Same result as `await (await fetch(dataUrl)).blob()`, synchronous, no network-shaped call, and no dependency on `connect-src data:` — the app's CSP is currently commented out in `index.html:58`, so today that would be latent rather than live, but the helper already exists and is used by all three share adapters.
4. Derive the extension from the sniffed mime generically (`mime.split('/')[1]`, with `jpeg → jpg`) instead of the current three-way ternary (`useRecipeCapture.ts:539-540`), which would silently name an AVIF `dish-x.jpg`. (`base64ToFile` sanitises the name; a `dish-<uuid>.<ext>` is unaffected by that.)
5. **Check `photos.add()`'s return value** (Finding 4). `added.length === 0` means stored nothing — record it and keep trying the next candidate rather than reporting success. Only `added.length > 0` yields `{ ok: true }`. **A queued (offline) upload counts as success**: `add` returns `[...completedIds, ...queuedIds]` (`usePhotos.ts:261`), so an offline family gets one queued photo, not three.
6. On exhaustion, return the reason; the caller logs `image_none` and falls through to the placeholder. Never fatal — the recipe is already saved.

The existing outer `try/catch` stays, and its `attach_failed` log gains the same `detail` vocabulary so a thrown attach and an exhausted ladder are distinguishable in CloudWatch. `markPending` / `clearPending` semantics are covered in §7.

**(Pass 3) One vocabulary, one place.** The `detail` values are declared once as a frozen `const` exported alongside `ImageSource` (rung names) and the outcome reasons, and imported by every log site rather than typed as bare string literals in six `logEvent` calls. A typo'd literal is a silently unqueryable dimension.

### 4. Server: widen what counts as an image (`image.mjs`, `guardedFetch.mjs`, `index.mjs`)

- `sniffImageType` gains AVIF (`ftyp` box with an `avif`/`avis`/`mif1` brand at bytes 4–12) and GIF (`GIF87a`/`GIF89a`). SVG stays rejected — the existing comment explains exactly why, and that reasoning is unchanged.
- Content-type test widens to match, keeping the belt-and-braces header **and** byte check. The two lists become one frozen table so they cannot drift.
- `MAX_BYTES` 1.5 MB → **3 MB** (Assumption 3). A `too_large` candidate now simply falls through to the next rung instead of losing the capture's photo, which is a second, free improvement from §3.
- `guardedFetch` gains a narrow **`referer` option**, not a headers bag (see Caveats). It is validated with the module's own `screenUrl` before use; a value that fails validation is dropped and the fetch proceeds without it. When present, `requestPinned` sends `Referer` plus `Sec-Fetch-Dest: image`, `Sec-Fetch-Site: cross-site` and an image-first `Accept`, all **derived internally**. The referer is held constant across redirect hops (documented; matches browser `strict-origin-when-cross-origin` closely enough for hotlink checks).
- `index.mjs`: the request body gains an optional `pageUrl`, validated as a string alongside the existing `mode`/`url` checks; the dispatcher becomes `MODES[mode](url, { pageUrl })`. **Only `image.mjs` reads the second argument and only its signature changes** — extra arguments are ignored in JS, so no other mode is touched. `MAX_BODY_BYTES` (8 KB) already bounds it.
- **(Pass 4)** `recipeFetchService.fetchImage(url, opts?: { pageUrl?, signal? })` passes it through; the shared `post` helper gains an optional extras object, spread as `{ ...extra, mode, url }`.
- Client: `usePhotos.ACCEPTED_MIMES` gains `image/avif`, `image/gif`, **and the sibling filename regex on `usePhotos.ts:152` gains `avif|gif`** — see the `||`-not-`&&` caveat for why these are two decisions, not one. `src/utils/sniffFileType.ts` is deliberately **not** touched: it guards the _share_ boundary, not this path.

### 5. _(removed — see the Deferred Scope box; full spec in Appendix A)_

### 6. The placeholder — vary, don't rebuild

`PolaroidImage` already renders the on-brand placeholder (Finding 2). Add an optional `variantSeed?: string` prop.

- **The hash.** ⚠️ The draft said to lift djb2 from `activityToGoogleEvent.ts:176`. Two corrections: the function is at **:231**, and it is `computePushHash` — its output is **persisted** as `lastPushedHash` on calendar links. Refactoring it risks re-pushing every activity in every family's calendar. Do not touch it. The same applies to `useLocalNotifications.stableNotificationId` (persisted notification ids) and `uiStrings.hashString` (translation-drift detection).
- **The right lift is the one that already does this exact job, twice.** `EveryoneSpread.vue:158-160` (`rotationFor`) and `ScrapbookSpine.vue:43-46` (`inactiveTilt`) are byte-identical `hash = (hash * 31 + c.charCodeAt(0)) | 0` loops used for _stable per-id visual variation_. Add `src/utils/stableVariant.ts` exporting `stableIndex(seed: string, buckets: number): number` and `stableFraction(seed: string): number`, and refactor those two call sites onto it — `rotationFor` becomes `stableFraction(id) * scale - scale / 2`, `inactiveTilt` becomes `stableIndex(id, 2) === 0 ? -2.5 : 2.5`. Net: **five bespoke hashes become four, and the two that are the same use case become one** — a genuine DRY win with zero persisted-value risk.
  - **(Pass 3) Ship the refactor as its own commit** (Step 1 of the sequencing below), ahead of and independent of the image work. It touches the scrapbook, which this issue otherwise does not; isolating it keeps the revert surface honest if a visual regression shows up.
- **The variation.** Frozen `PLACEHOLDER_GLYPHS` array of a handful of `{ paths: string[] }` (cloche, pot, bowl, whisk) and a two-entry tint array (Terracotta `#E67E22` / Heritage Orange). **The existing cloche paths move into the table verbatim as entry zero**, so today's look survives as one of the variants. A single `computed` picks glyph and tint from `stableIndex`. One `<svg>` with `v-for="d in glyph.paths"` — **no new `v-if` branch**. This matters: the template already triplicates the gradient-background-plus-caption block across the loading, empty and figcaption paths, and a fourth branch would compound that.
  - **(Pass 4) The tint must be an inline `:style="{ color: tint }"`, never a computed Tailwind class.** The placeholder svg today is `class="… text-[#E67E22]" stroke="currentColor"`. A dynamic arbitrary class is not visible to Tailwind's build-time scanner, so **no CSS is generated**, `currentColor` silently inherits from the parent, and the failure is a subtly-wrong colour that no test catches. Inline style, and a comment saying why.
  - **(Pass 3) The glyph path data lives in a sibling `polaroidPlaceholder.ts`, not inline in the SFC.** `PolaroidImage.vue` is 198 lines of genuinely intricate logic (the lh3 propagation-retry ladder); four glyphs of raw SVG `d` strings would roughly double it with data that has no reason to be co-located with behaviour. A plain module also gives the table a direct unit test.
  - If the existing template triplication is cheap to collapse into one wrapper while in the file, do it; if not, leave it and note it — it is not this issue's job.
- Callers pass `:variant-seed="r.id"` (`FamilyCookbookPage.vue:277`) and `:variant-seed="recipe.id"` (`RecipeDetailPage.vue:226`). Same recipe always looks the same; a grid looks varied. With no seed the component keeps today's exact appearance, so the other `PolaroidImage` call sites (cook logs, scrapbook) are untouched. Reduced-motion, caption and loading behaviour untouched. **`EmptyStateIllustration.vue` is not modified.**

### 7. Surviving an abandoned save — one owner, no double attach

Finding 3 is the constraint; **Finding 5 is the trap**. The discard-on-close in `RecipeFormModal.vue:325-345` and `FamilyCookbookPage.vue:146,179` **stays**, and the source _file_ keeps exactly today's behaviour and its per-instance, composable-local lifetime.

The rule that makes this safe and keeps it safe:

> **The source document is owned by whichever capture instance produced it. The dish image is owned by `RecipeFormModal`, always, on every route.**

That asymmetry is not arbitrary — it is forced by the two different lifetimes. The file is produced by _one_ capture instance and never leaves it. The candidates are delivered _into the form as a prefill_, by either instance, and the form is the only component present on every capture save path (Assumption 6). Both are documented at the top of `attachAfterSave`.

Concretely:

- `pendingDishImageUrl` in `useRecipeCapture` is **deleted**. `discardPendingSource` shrinks to the file + compressed blob.
- The candidates ride on `RecipePrefill.dishImage` (`{ kind, candidates } | null`, Finding 7), which is the thing the form is actually showing.
- `RecipeFormModal` holds **one** local `dishImage` ref, set by `applyPrefill` — the single funnel both routes already pass through, exactly as `localInferredIngredients`/`localInferredSteps` are (`:96-110`), so this follows an established pattern in the file rather than inventing one.
- **`willAttachPhoto` becomes a `computed(() => (dishImage.value?.candidates.length ?? 0) > 0)`, not a second ref.** Two refs that must be kept in step is two places to forget; one derived value cannot drift. This also removes a write from `applyPrefill` and a write from the close watcher.
- **Cleared in the one place things are already cleared.** The existing `!isOpen` branch of the `props.open` watcher already resets `willAttachPhoto`; it now resets `dishImage` instead. **No new `props.recipe` watcher branch is added** — Pass 2 proposed one, but `onNew` already calls `applyPrefill(props.prefill)` on every open-for-new transition and the close path clears everything, so opening for edit finds a null ref by construction. Fewer branches, same guarantee.
- `attachAfterSave(recipeId, dishImage: DishImagePrefill | null = null)`. **`RecipeFormModal.handleSave` is the only caller that passes it.** `FamilyCookbookPage.handleSaved` keeps calling `attachAfterSave(id)` with no second argument — it attaches only the source file its own instance is holding. This is what makes requirement 14 structural rather than a comment: there is exactly one expression in the codebase that can supply dish candidates to an attach.
- **(Pass 4) `attachAfterSave` must use the ARGUMENT, never re-read the ref.** `handleSave` calls it (unawaited) and then immediately emits `close`, which fires the watcher that nulls `dishImage`. Passing the object by reference is correct and the async body must keep using that parameter; the moment anyone "tidies" it into reading `dishImage.value` inside the promise, every dish image stops attaching, silently. One comment on the parameter.
- **(Pass 4) `clearPending` becomes conditional on this call having marked.** Today `attachAfterSave`'s `finally` clears unconditionally, which is safe only because exactly one instance ever does any work. Under split ownership, an instance that attaches a _source file_ would clear a pending marker set by the _other_ instance's still-running dish fetch, blinking the "photo on its way" treatment off early. Whether the two can currently overlap depends on a capture producing both a file and a link — which no path does today — so this is **latent, not live**; it is two lines (`const marked = candidates.length > 0` … `finally { if (marked) clearPending(recipeId) }`) and it turns an invariant that is true by accident into one that is true by construction. Note that `isPending` also ORs the photo store's own `pendingUploadsFor`, so the user-visible window is partly covered either way — that is a reason it would have been hard to notice, not a reason to skip it.
- `FamilyCookbookPage.handleSaved` therefore needs **no change at all**, which also removes the Pass-2 draft's ordering hazard (it cleared `prefill.value` on its first line, so "pass the candidates before clearing" was a correctness constraint enforced only by statement order).

Net effect: the candidates are always the ones belonging to what is on screen, and they are attached by the one component that is showing them. Attaching them to an unrelated recipe is structurally impossible — a stronger guarantee than the current discard-on-close, not a weaker one — and attaching them twice is equally impossible.

No persistence beyond the session — that would be new storage and is out of scope.

## Sequencing

Nine steps, each independently revertable, each leaving `main` green.

1. `stableVariant.ts` + the `EveryoneSpread`/`ScrapbookSpine` refactor. Behaviour-identical, unrelated to images, own commit.
2. Lambda: `findTagAttr` extraction (with the shared `lower`) + `normalizeRecipeNode`'s `thumbnailUrl` line + `collectImageCandidates` + no early return, with the compatibility `imageUrl` shim. **Deploy.** Old clients unaffected.
3. Lambda: AVIF/GIF sniffing, 3 MB cap, `referer` on `guardedFetch`, optional `pageUrl` on the dispatcher. **Deploy.** Purely additive.
4. Client types: `ImageCandidate`, `DishImagePrefill`, `IMAGE_SOURCES`, the `detail` vocabulary const, `screenCandidates`, `ShareLink`/`RecipePrefill`/`ResolvedRecipeSource` field moves, the YouTube thumbnail rungs. Type-only + pure functions, fully unit-tested before anything renders.
5. Client: `attachDishImage.ts` + the `runAttach` split + `fetchImage` options object + `usePhotos` widening.
6. Client: `RecipeFormModal` single-owner wiring (§7), the conditional `clearPending`, and their regression tests.
7. Client: `PolaroidImage` `variantSeed` + `polaroidPlaceholder.ts` + the two call sites.
8. Drop the model's `imageUrl` across the three prompt mirrors and `types.ts`, in one commit (the drift test pins them together).
9. **Follow-up, next release:** delete the `imageUrl` shim from `page.mjs` and `ShareLink`. Noted in `CHANGELOG.md` at Step 2 so it is not forgotten.

## Files Affected

**Lambda (deploy first)**

- `infrastructure/lambda/content-fetch/modes/page.mjs` — `findTagAttr` generalisation (shared `lower`), `collectImageCandidates`, no early return
- `infrastructure/lambda/content-fetch/recipeJsonLd.mjs` — **one line**: `thumbnailUrl` on `normalizeRecipeNode`, reusing `firstImageUrl`
- `infrastructure/lambda/content-fetch/modes/image.mjs` — AVIF/GIF sniffing, widened content-type, 3 MB cap, `pageUrl` → `referer` (**the only mode whose signature changes**)
- `infrastructure/lambda/content-fetch/guardedFetch.mjs` — narrow validated `referer` option
- `infrastructure/lambda/content-fetch/index.mjs` — optional validated `pageUrl` body field, `MODES[mode](url, opts)`
- `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — drop `imageUrl` from the recipe task
- `infrastructure/lambda/content-fetch/__tests__/imageCandidates.test.mjs` _(new)_ — the ladder/sniffing/referer suite; the runner globs `*.test.mjs`, so this is free
- `infrastructure/lambda/content-fetch/__tests__/handler.test.mjs` — dispatcher + `findMeta` regression only

**Client**

- `src/services/ai/recipeFetchService.ts` — `imageCandidates` on `PageFetchData`, `fetchImage(url, opts)`, `post` extras
- `src/services/ai/recipeSourceResolver.ts` — `imageCandidates` on all three success variants; carry through `fromPage`; the two YouTube thumbnail rungs
- `src/services/ai/attachDishImage.ts` _(new)_ — the bounded ordered attach, returning a discriminated outcome
- `src/services/ai/extractionPrompt.ts`, `src/services/ai/types.ts`, `scripts/spikes/extractionPrompt.mjs` — drop the model's `imageUrl`
- `src/utils/shareLink.ts` — `screenCandidates` replaces `boundedDishImage`; `toShareLink` carries candidates
- `src/utils/recipeExtractionToRecipe.ts` — image concern removed entirely; `recipeExtractionToPrefill` loses its `sourceUrl` parameter
- `src/composables/useRecipeCapture.ts` — `runAttach` splits into `attachDishImage` + `attachSourceDocument`; one shared `usePhotos`; `attachAfterSave` takes `dishImage`; conditional `clearPending`; `pendingDishImageUrl` deleted; `dishImage` assigned once in `deliverRecipeInner`
- `src/composables/useSharedDocumentIngest.ts` — the `titleOnly` `ShareLink` literal (ideally collapsed onto `toShareLink`)
- `src/components/pod/RecipeFormModal.vue` — sole owner of the dish attach: `dishImage` ref, `willAttachPhoto` computed, cleared in the existing close branch
- `src/components/pod/shared/PolaroidImage.vue` — `variantSeed` prop, inline tint style
- `src/components/pod/shared/polaroidPlaceholder.ts` _(new)_ — glyph path + tint tables
- `src/pages/FamilyCookbookPage.vue`, `src/pages/RecipeDetailPage.vue` — pass `variant-seed` only (**`handleSaved` is unchanged**)
- `src/composables/usePhotos.ts` — `ACCEPTED_MIMES` **and** the filename regex accept AVIF/GIF
- `src/types/magicPayload.ts` — `ShareLink.imageCandidates`, `ImageCandidate`, `IMAGE_SOURCES` + `ImageSource`, the `detail` vocabulary const
- `src/utils/stableVariant.ts` _(new)_ — `stableIndex` / `stableFraction`
- `src/components/scrapbook/EveryoneSpread.vue`, `src/components/scrapbook/ScrapbookSpine.vue` — refactor onto `stableVariant` (behaviour-identical, own commit)

**NOT affected (verified — earlier drafts listed these):**

- `src/utils/diagnosticContext.ts` — **no new keys**; only comment updates naming this surface
- `infrastructure/lambda/telemetry/index.mjs` — no mirror change needed _(an earlier draft omitted this file entirely while proposing three new keys, which would have meant three keys allowlisted on-device and **stripped server-side, silently**)_
- `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro`, the store Data-Safety answers — no new declarations
- `src/services/translation/uiStrings.ts` — no new copy; `cookbook.card.noPhoto` and `recipeExtract.attaching` already exist
- `src/utils/sniffFileType.ts`, `src/components/ui/EmptyStateIllustration.vue`, `src/utils/url.ts`, `src/services/photos/photoCompression.ts`
- `src/components/mealplan/MealPickerSheet.vue` — the one non-modal `createRecipe`, name-only, no capture (Assumption 6)
- `src/pages/FamilyCookbookPage.vue:184 handleSaved` — unchanged by design (§7)

**Docs**

- `CHANGELOG.md` (including the dated `imageUrl`-shim removal note), `docs/STATUS.md`

## Observability Coverage

Surface: **`recipe-extract`** (existing, already allowlisted and store-declared).

> **Zero new context keys.** An earlier draft proposed `image_source`, `candidate_count` and `attempt_index`. Verified: `detail` (`diagnosticContext.ts:185`, mirrored at `telemetry/index.mjs:139`) and the generic `count` (`diagnosticContext.ts:318`, mirrored at `:77`) are **already on both allowlists**, alongside the long-standing `kind` and `error_code`. `detail` carries the rung/reason enum; `count` carries the candidate count.
>
> This removes five files from Files Affected (the allowlist, the pinned Lambda mirror, the runbook, `PrivacyInfo.xcprivacy`, `privacy.astro`) and the store Data-Safety re-answer. It also removes the draft's own silent-failure risk: it named the client allowlist but **not** `infrastructure/lambda/telemetry/index.mjs`, and a key present in one and not the other is dropped after leaving the device with no signal at all.

**The `detail` value space is shared across four `action`s, so it is declared once.** Rung names and outcome reasons live in one exported frozen const next to `IMAGE_SOURCES`; no `logEvent` call site writes a bare string literal. A drift test asserts that every `ImageSource` the Lambda can emit has a matching rung name client-side — a _warning_ about telemetry legibility, not a gate on candidate acceptance (Finding 6).

**Events**

- `action: 'image_resolved'` — `level: 'info'`, fired **only after `photos.add` returned an id**. Context: `kind` (from `dishImage.kind`), `detail` = the winning rung (`jsonld` | `og_image` | `og_secure` | `twitter` | `link_rel` | `thumbnail` | `youtube_thumb` | `other`), `count` = candidates offered.
- `action: 'image_none'` — `level: 'info'`, on every **link-origin** capture that produced no stored image. Context: `kind`, `count` (0 = the page offered nothing; >0 = every candidate failed), `detail` = `no_candidates` | `all_failed` | `cloud_required` | `at_cap` | `store_rejected`, plus `error_code` from the last attempt. **This is the event that does not exist today and is the whole reason the failure was invisible.**
  - ⚠️ **Gated on `dishImage != null`, which is exactly "a source page existed".** A manual or document-only recipe save has no source page and must not emit it, or the hit-rate denominator is meaningless. **(Pass 4)** This gate is only expressible because `dishImage` is a nullable object rather than a bare array — see Finding 7; with an array, `no_candidates` and "no page at all" are the same value.
- `action: 'image_rejected'` — retained; `detail` extended with `unsafe_candidate`. (`cross_domain` disappears with the bound.)
- `action: 'attach_failed'`, `kind: 'dish_image'` — retained for the _thrown_ path, now carrying the same `detail` vocabulary.

**(Pass 4) `compress_failed` is deliberately NOT in the vocabulary** — see Finding 9. Because `cloud_required` and `at_cap` are ruled out _before_ the call, a `store_rejected` already means "the engine could not decode it, or the upload failed", and the developer hint says exactly that. A declared-but-unreachable enum value is worse than none: it reads in CloudWatch as evidence the case never happens.

**Failure modes → the event that diagnoses it blind**

| Failure                                   | Signal                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Page offers no images                     | `image_none`, `count: 0`, `detail: 'no_candidates'`                                                          |
| Candidates found, all fail to fetch       | `image_none`, `count > 0`, `detail: 'all_failed'` + `error_code`                                             |
| Hotlink protection still biting           | `error_code: 'site_refused'` concentrated on one `detail` rung                                               |
| A rung is useless in the wild             | `image_resolved` distribution over `detail`                                                                  |
| Photo store off / full                    | `image_none`, `detail: 'cloud_required'` / `'at_cap'` — **today this is silent**                             |
| Fetched but not stored (decode or upload) | `image_none`, `detail: 'store_rejected'` — **today this is silent** (Finding 4)                              |
| Client is behind the Lambda's ladder      | `image_resolved`/`image_none` with `detail: 'other'` — visible, and the candidate still attached (Finding 6) |
| Recipe saved with no source page          | **no event at all** — by design (Finding 7)                                                                  |

**Success-path signal.** Hit rate = `image_resolved / (image_resolved + image_none)`, and the per-rung distribution is queryable — which is what makes the fix judgeable at all. The single-owner design in §7 is what keeps this arithmetic honest: two `image_resolved` events per save would have silently inflated the numerator above 100%.

**Critical vs. firehose.** All `info`. None `severity: 'critical'` — a missing dish photo is cosmetic and the recipe itself is saved. Paging Slack would be noise. (The existing `critical` on a lost _source document_ is unchanged.)

**Developer guidance, not just an enum.** Each `image_none` reason maps to a one-line console hint at the point of failure (`console.warn('[recipe-extract] …')`, which never leaves the device), naming the likely cause and the fix: e.g. `cloud_required` → "the family has cloud photo storage disabled; expected, not a bug"; `all_failed` with `site_refused` → "the CDN is refusing our Referer — check `pageUrl` reached image mode"; `store_rejected` → "cloud and cap were already checked, so this is a decode or upload failure — check `sniffImageType` vs `ACCEPTED_MIMES`, and the `usePhotos.add` console error just above".

## Acceptance Criteria

- [ ] A page whose image is on a third-party CDN attaches its photo
- [ ] A page with a JSON-LD Recipe node lacking `image` falls through to `og:image`
- [ ] An AVIF `og:image` attaches and is stored (post-compression) as JPEG
- [ ] A hotlink-protected CDN serves us with the new `Referer`; a missing/invalid `pageUrl` degrades to a fetch without one, never an error
- [ ] A YouTube capture attaches the video thumbnail — **including a `titleOnly` capture, which has no other image**
- [ ] Every **link-origin** capture emits exactly one of `image_resolved` / `image_none`; a hand-typed or document-only recipe emits neither
- [ ] **A link capture whose page offered zero images emits `image_none / count: 0 / no_candidates`** — distinct from a document save, which emits nothing (requirement 15 / Finding 7)
- [ ] **A capture started from the cookbook page attaches the dish image exactly once — one photo on the recipe, one `image_resolved` event** (requirement 14 / Finding 5)
- [ ] `image_resolved` never fires unless `photos.add` returned an id
- [ ] With cloud photos disabled, zero image fetches are made and `image_none/cloud_required` is logged
- [ ] Rung distribution is queryable in CloudWatch from `detail`, with **no allowlist or store-declaration change**
- [ ] A recipe with no usable image shows the polaroid placeholder, varied by recipe id and stable per recipe; **a `PolaroidImage` with no `variantSeed` looks exactly as it does today**
- [ ] Cancelling the form and re-saving the same capture still attaches the image; opening the form to edit a _different_ recipe attaches nothing
- [ ] `EveryoneSpread` / `ScrapbookSpine` render identically after the `stableVariant` refactor
- [ ] `guardedFetch` accepts no caller-supplied header other than the validated `referer`
- [ ] A malformed or absent `imageCandidates` field yields `[]`, never a throw
- [ ] **A candidate carrying an unrecognised `source` is still attached, labelled `other`** (Finding 6 / Lambda-first deploy safety)
- [ ] Diagnostic logging verified: each failure mode in the table is triageable from CloudWatch with no local repro

## Testing Plan

**Unit — Lambda (`__tests__/imageCandidates.test.mjs`, new; `handler.test.mjs` for the dispatcher)**

1. `collectImageCandidates` — one fixture per source; ladder order; dedupe; cap at 5; `&amp;`-escaped CDN URLs; root-relative and protocol-relative URLs; JSON-LD present but imageless; JSON-LD `image` as array and as `ImageObject`; JSON-LD `thumbnailUrl`; a candidate `screenUrl` rejects is absent from the output. **A `<base href>` fixture asserts the documented limitation** — resolution is against `finalUrl`, `<base>` is ignored (§1).
2. `findMeta` regression — its existing assertions must pass unchanged after the `findTagAttr` extraction. Plus two limitations asserted rather than left implicit: an **unquoted** `property=og:image` is not matched, and `og:image` does **not** match `og:image:secure_url` (the quoted needle).
3. `sniffImageType` — AVIF (`avif`/`avis`/`mif1` brands), GIF87a, GIF89a accepted; SVG still rejected; truncated buffers; a JPEG served as `text/html` still rejected (both gates).
4. `guardedFetch` — a valid `referer` is sent; an unscreenable one is dropped and the fetch proceeds; no other caller-supplied header can reach the wire.
5. Dispatcher — a non-string `pageUrl` is ignored, not fatal; a mode that does not read the second argument is unaffected.

**Unit — client** 6. `screenCandidates` — a cross-domain candidate is now accepted; `javascript:`/`data:` still rejected; a non-array, a null, and an item with a numeric `url` yield `[]` or are filtered, never throw; **an unknown `source` is kept and relabelled `other`, not dropped**. 7. `attachDishImage` (direct, with a fake `photos`) — first success wins and stops; all-fail path; `photos.add` returning `[]` continues to the next candidate and never reports success; a **queued** (offline) return counts as success and stops the loop; `canAdd === false` makes **zero** `fetchImage` calls; the attempt cap holds; the returned outcome carries the right reason in each case; the `File` is built from the base64 payload (a whole data URL passed to `base64ToFile` would throw — assert the call shape). 8. `image_none` is not emitted for a document/manual save, **and IS emitted with `count: 0` for a link capture whose page offered nothing** (the Finding 7 pair — these two must be asserted together or the gate is meaningless). 9. `stableIndex` / `stableFraction` — stable for a given id, distributed across ids, total over the bucket range; `EveryoneSpread`/`ScrapbookSpine` produce the same values as their old inline hashes for a fixed set of ids. 10. `RecipeFormModal` — cancel-then-save-same-prefill attaches; open-for-edit-then-save attaches nothing (the Finding 3 regression test). 11. **Single-attach regression (Finding 5):** a save driven by a `FamilyCookbookPage` prefill results in exactly **one** `photos.add` call for the dish image across both capture instances. Explicitly asserts the count, not just "it attached". 12. **(Pass 4) Close-race regression:** `handleSave` emits `close` immediately; assert the attach still uses the candidates it was handed after the watcher has nulled the ref. 13. Rung-vocabulary drift — every `ImageSource` has a `detail` rung name. 14. Mutation checks: invert the ladder order, delete the no-early-return fix, drop the attempt cap, drop the `photos.add` return check, drop the `dishImage != null` gate, re-add the candidates argument to `FamilyCookbookPage.handleSaved` — each must fail a test.

**Integration** 15. Recorded HTML fixtures: a Cloudinary-backed blog, a Food Network-shaped page (`cdn.sndimg.com`), a JSON-LD-with-thumbnail-only page, a multi-Recipe-node roundup (falls to the text branch and still yields `og:image`), and an AVIF-serving Next.js page.

**Manual (on device, per the pre-plan)** 16. Share from Gmail (Android), Apple Mail + the share sheet (iOS), and an installed PWA. 17. Confirm the varied placeholder across a cookbook grid, light and dark, at Large reading size — **explicitly confirm the tint renders (the Tailwind-arbitrary-class trap in §6 fails silently in a unit test)** — and that `EveryoneSpread`/`ScrapbookSpine` are visually unchanged.

**Gates**: `npm run build` (whole-graph import analysis — required before push per the project's own lesson), type-check, lint, stylelint, prettier, full vitest, lambda tests, `security:full`.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan prompt plus a direct read of the Lambda and client image path; surfaced two findings that change scope (the domain bound is a deliberate security control; the fallback illustration already exists in `PolaroidImage`, not `EmptyStateIllustration`).
- **Pass 2 (DRY + error handling)**: Cut all three proposed telemetry keys by reusing the already-allowlisted `detail`/`count` (removing five store-gate files **and** the draft's own silent failure — it never named the pinned `infrastructure/lambda/telemetry` mirror); found four existing silent failures the draft would have inherited or worsened (`photos.add`'s discarded return, the un-gated `image_none` denominator, the un-short-circuited `canAdd`, the mime-blind extension ternary); replaced the draft's `guardedFetch` headers-bag and missing `pageUrl` plumbing with the module's own allowlist discipline; corrected the hash lift from a **persisted** change-detection hash to the two byte-identical scrapbook variation hashes; substituted the existing `base64ToFile`, `firstImageUrl` and a generalised `findMeta` for three re-implementations; caught `RecipeFormModal.vue` as a missing consumer and its documented cross-contamination guard as a hard constraint on requirement 13; and recommended deferring the AI-gated in-body `<img>` rung and the `itemprop` rung as unearned scope.
- **Pass 3 (Sustainability)**: Caught that Pass 2's requirement-13 design would attach every dish image **twice** (both capture instances run an attach on one save, and `applyPrefill` fires on both routes) and fixed it structurally by giving the dish attach a single owner in `RecipeFormModal`, leaving `FamilyCookbookPage.handleSaved` untouched; stopped `screenCandidates` from dropping candidates with an unrecognised `source`, which would have made the plan's own Lambda-first deploy order silently lossy; lifted the bounded attach loop out of the 646-line `useRecipeCapture` into its own testable `attachDishImage` module; narrowed the dispatcher change to the one mode that needs it; corrected the claim that the Lambda suite is a single file; replaced two co-varying refs with one derived `computed`; moved SVG path data out of the SFC; centralised the `detail` vocabulary; and added explicit commit sequencing plus a dated removal for the `imageUrl` shim.
- **Pass 4 (Fresh-eyes sweep)**: Found that Pass 3's single-owner design made the plan's most important event unemittable — a bare candidate array cannot distinguish "the page offered nothing" from "there was no page" — and fixed it by carrying `{ kind, candidates } | null` on the prefill, which also supplies the `kind` label and collapses three write sites to one; corrected three instructions that collide with real signatures (`fetchImage`'s second parameter is already `signal`, `base64ToFile` takes raw base64 not a data URL, and JSON-LD `thumbnailUrl` is unreachable without one added line in `normalizeRecipeNode`); removed `compress_failed` as a value the code can never emit; stopped the ladder paying `asciiLower` on a 2 MB page six times; made `clearPending` conditional and pinned the close-race on the candidate argument; caught that a computed Tailwind arbitrary class generates no CSS so the placeholder tint must be inline; dropped the unimplementable `<base href>` fixture; extended requirement 10 to the `titleOnly` path with two thumbnail rungs and collapsed the two hand-built `ShareLink` literals onto `toShareLink`.

## Appendix A — deferred: the scraped `<img>` rung and its AI gate

Preserved so a later release can pick it up without re-deriving it.

- A seventh rung scrapes in-body `<img>` using the `dropTag` linear-scan discipline, ranked by explicit `width`/`height` attributes, ignoring anything under a plausible threshold or matching sprite/avatar/logo path segments.
- Because that rung alone can pick up something unrelated or unpleasant, it alone is gated by a new `image_relevance` extraction task returning `{ relevant: boolean, safe: boolean }` given the dish name and the image. The task must land in all three `EXTRACTION_TASKS` mirrors (`extractionPromptDrift.test.ts` enforces it).
- Consent reuses `useDocumentConsent`; limits reuse the existing per-family/per-IP buckets.
- Over budget → skip the rung and use the placeholder. Never attach unverified, never block the capture.
- Telemetry: `image_rejected` with `detail: 'ai_unsafe' | 'ai_irrelevant' | 'budget_skipped'` — all within the existing `detail` key, so this too needs no allowlist change.

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

See `docs/prompts/2026-09/2026-09-04-recipe-dish-image-ladder.md`.
