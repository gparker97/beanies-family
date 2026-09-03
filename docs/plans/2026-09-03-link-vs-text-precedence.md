# Plan: link-vs-text precedence — read the message, not the link inside it

> Date: 2026-09-03
> Related issues: None — direct implementation (follows #83 / #84)
> Plan file: `docs/plans/2026-09-03-link-vs-text-precedence.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is in the `## Prompt Log` section below.

## User Story

As a parent, I want to share a school email whose details are in the body — even though it also contains the school's website, a payment link and a signature URL — and have beanies read **the email**, so that I get the field trip rather than whatever happens to be on the museum's homepage.

## Context

#83 gave shared TEXT a reader. It did not revisit the precedence that decides between text and a link, because that precedence was written when text had no reader at all: finding a URL was the _only_ way a text share could ever produce anything.

`sourceFromText` therefore still does this, before any size band runs (`useSharedDocumentIngest.ts:364-370`):

```ts
const candidates = extractUrls(capped).map(trimUrlPunctuation);
const url = candidates.find((c) => routeUrl(c).kind !== 'invalid');
if (url) {
  logReceivedKind(env, 'link', 0);
  return { kind: 'link', url }; // ← FIRST usable URL wins, unconditionally
}
```

**Verified against production on 2026-09-03.** A real Grade 5 field-trip email (4,526 characters) contains `https://lkcnhm.nus.edu.sg/` in its third paragraph. `routeUrl` returns `{ kind: 'page' }` for it — any https URL whose hostname contains a dot is "valid" (`src/utils/recipeSourceUrl.ts:113-133`). So the share is routed to the LINK path, `resolveRecipeSource` fetches the **museum's homepage**, and beanies extracts from a page that contains no field trip, no date, no $42 co-payment and no workshop. The outcome is `kind: 'none'` or worse — a confidently wrong extraction from an unrelated page.

The same text, sent to the prod proxy as a text source, classified correctly:

```json
{
  "kind": "event",
  "event": {
    "title": "Grade 5 Field Trip to Lee Kong Chian Natural History Museum",
    "location": "Lee Kong Chian Natural History Museum at the National University of Singapore",
    "category": "field_trip",
    "description": "…IPC unit 'Existing, Endangered, Extinct'… Co-payment of $42 per student…",
    "confidence": { "title": 1, "location": 1, "date": 0, "startTime": 0 }
  }
}
```

So the reader works. The router sends it to the wrong place.

**This defeats the exact user story #83 was built for.** That plan's first line is "A parent gets a field-trip email with no PDF and no attachment — the details **are** the message body." School emails nearly always carry a link: the school site, a payment portal, a signature URL, an unsubscribe footer. Under the current rule, almost none of them reach the text reader.

### What is already shipped and must be composed with, not contradicted

The #83 code review added the **inverse** guard — for links we cannot read (`useSharedDocumentIngest.ts:385-395`):

```ts
const withoutUrls = candidates.reduce((rest, c) => rest.split(c).join(' '), trimmed).trim();
if (candidates.length && withoutUrls.length < MIN_SHARE_TEXT_CHARS) {
  // refuse as a LINK ("Can't Use That Link"), not as text
}
```

That guard already computes the quantity this plan needs: **`withoutUrls`, the prose with the URLs removed.** The new rule is the same measurement read in the other direction, which is why it composes cleanly rather than fighting.

### ⚠️ The ordering the first draft got wrong, and why it matters

An earlier draft of this plan placed the new rule so that a link-bearing share with substantial prose "fell through to the text bands". **That is a regression, and it is already pinned by a shipped test.**

- `prepare` sets `overCeilingByBytes` as a FLAG rather than returning, and the comment says why in as many words: iOS delivers a shared URL as a `.txt`, so refusing there "would break a `.txt` that BEGINS WITH A LINK — which takes the link path today and must keep doing so" (`useSharedDocumentIngest.ts:505-517`). `useSharedDocumentIngest.test.ts:880-893` pins it with a 200 KB `.txt` whose prose is 500 characters — over any sane note threshold.
- The same applies to the client budget (`:435-442`): a link-bearing share has **never** consumed the text budget, and must not start refusing outright once that budget is spent.

**Rule, stated once and obeyed below: the new precedence may only send a share to the text arm when the text arm can actually READ it.** Where the text arm cannot run (over the ceiling, or out of budget) and a usable link exists, the link still wins. This is not a special case bolted on — it is the same asymmetric-failure argument that sets the threshold direction, applied consistently: never refuse a share for which a working path exists.

### ⚠️ The shape the second draft got wrong: one function holding all of it

Pass 2's snippet kept every part of this in one body: five interacting booleans, four refusal branches, a dynamic import, and a `try/catch` nested three levels deep inside the link block. `sourceFromText` is already 124 lines with four exits; that draft took it past 150 and made the ordering invariant — the thing this plan exists to get right and keep right — something a reader has to reconstruct from scattered conditions.

**The precedence itself must be readable in one screen.** Pass 3 therefore splits the executors out so the top of the function is the decision and nothing else. No behaviour changes with the split; it is the same call graph, and each helper has one job with named outcomes rather than a `null` that means three different things:

- `urlCandidates(capped)` — dedupe after `trimUrlPunctuation`, which can collapse two candidates onto one string and defeat `extractUrls`' own dedupe.
- `proseLength(trimmed, candidates)` — the one measurement, stripping **both** the scheme-prefixed and scheme-less forms of each candidate.
- `linkSourceFrom(candidates, prose, env)` — the dynamic import, the existing `find`, the existing refusal. Returns `ShareSource | 'refused' | 'unavailable' | 'no-usable-link'`.
- `textSourceFrom(trimmed, bands, env)` — the three existing refusals in their existing order, each reading a band already decided. No re-measurement.

## Requirements

1. **A share whose body is substantial prose is read as TEXT**, even when it contains usable links.
2. **A share that is essentially just a link keeps the LINK path**, unchanged — including a short human note around it ("Made this last night 😍 \<url>").
3. **The rule is one measurement**, reusing the `withoutUrls` the unreadable-link guard already computes. No second notion of "how much prose is there".
4. **The unreadable-link refusal still fires exactly when it fires today**, and no share that works today becomes a refusal.
5. **No extra AI call and no extra fetch.** This changes which single path runs, never how many. On the new rule's own path it must also load _less_ code, not more.
6. **The decision is observable** — the funnel must say which way a share went and why, with **no new telemetry key and no change to any existing key's meaning**.
7. **Email-length text is not silently truncated at a cap sized for link notes** (see the `MAX_SHARE_TEXT_CHARS` decision below).
8. **The one fallible operation in `sourceFromText` — the dynamic import — degrades to a readable outcome and is diagnosable**, rather than surfacing as the generic AI error.
9. **The precedence is legible after the change.** The decision reads as one flat block of named booleans; the link arm and the text arm are separately named units; no branch nests more than one level. A future reader must be able to answer "which arm runs, and when can it not?" without tracing four refusals.

## Important Notes & Caveats

- **⚠️ The link path is the ONLY way to get schema.org recipe data.** `resolveRecipeSource`'s `jsonld` arm returns exact quantities with the model never invoked. Biasing toward text costs that for any recipe share that carries a long note. This is the real trade the threshold makes, and it is why the threshold must be LOW (favouring the link) rather than a midpoint.
- **⚠️ Asymmetric failure costs — this is what sets the threshold's direction.** Choosing text when the link was the point degrades gracefully: `classify` still returns `recipe`, the user still gets a named recipe to finish. Choosing the link when the text was the point fails hard: an unrelated page is fetched and the share is lost. Bias toward text, but only once the prose is clearly a body rather than a caption.
- **⚠️ `extractUrls` matches BARE domains too**, not just `https://` (`src/utils/url.ts:66-78`), filtered by a `FALSE_POSITIVES` extension set. An email signature line like `www.smmis.edu.sg` is a candidate. That is exactly why the count must be of prose-with-URLs-REMOVED rather than "does a URL exist".
- **⚠️ …and a bare-domain candidate is returned SCHEME-PREFIXED, so today's strip misses it.** `extractUrls` pushes `` `https://${cleaned}` `` (`url.ts:75`) for the bare-domain pass, while the strip splits the ORIGINAL text on that candidate (`useSharedDocumentIngest.ts:385`) — a string that is not in the text. **Verified by running it**: `www.smmis.edu.sg` yields the candidate `https://www.smmis.edu.sg`, and the domain is left in the prose and counted. Latent and harmless while this only gated a refusal (it made the refusal slightly _less_ likely, in the safe direction); **not** harmless once the same number picks the arm. Fixed locally in §2 by stripping both forms. `url.ts` is still not touched — its return contract is used by three other callers and is correct for them.
- **⚠️ Considered and REJECTED: splitting `routeUrl` into a leaf module to avoid the dynamic import.** It would let the router be statically imported without the ~22 KB recipe graph, deleting §2a entirely — but it edits `recipeSourceUrl.ts`, which this plan otherwise leaves alone, and it trades a guarded lazy load for a permanent entry-chunk cost on every cold boot. Revisit only if `link_router_unavailable` actually appears in logs.
- **⚠️ Considered and REJECTED: any remote-config or server-driven threshold.** `MAX_LINK_NOTE_CHARS` is a deploy-time constant and tuning it is a one-line PR. Inventing a config surface for a heuristic that will be adjusted perhaps twice is a permanent maintenance cost for a temporary convenience.
- **⚠️ `routeUrl` is extremely permissive** — `{ kind: 'page' }` for any https URL with a dot in the hostname (`recipeSourceUrl.ts:125-132`). It is a _recipe-source_ router being used as a general "is this a link" test. Do not tighten it here; three other callers depend on it, and the fix belongs in the precedence, not the URL parser.
- **⚠️ Considered and REJECTED: reusing `pickRecipeLinks`' filters.** `recipeSourceUrl.ts:146-164` already drops "never a recipe" hosts and bare homepages with no path — literally the shape of the failing `https://lkcnhm.nus.edu.sg/`. Applying it here would fix the reported case and not the class (the same email with a deep payment-portal link still breaks), and it would move recipe policy into the general share router. Prose length is the correct axis. Recorded so this is not re-proposed.
- **Do NOT change `routeUrl`, `extractUrls`, or the `MIN_SHARE_TEXT_CHARS` floor.**
- **Do NOT add a user-facing "read as text or follow the link?" prompt.** #84's entire thesis is that the user should not have to classify their own content; a disambiguation dialog re-introduces exactly the question that feature deleted.
- **Do NOT add a telemetry context key.** `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`) is mirrored in `infrastructure/lambda/telemetry/index.mjs`, pinned by a Lambda test, and declared to Apple and Google (`diagnosticContext.ts:55-59`). And **do not overload `file_count`**, whose documented meaning is "how many documents another app handed over" (`diagnosticContext.ts:186-190`) and whose value `logReceivedKind` pins at 0 for non-file shares precisely so dashboards keep meaning what they mean (`useSharedDocumentIngest.ts:226-229`). See §5 for the zero-cost alternative.
- **The in-app paste path inherits this automatically** — `sourceFromText` is shared by both doors since #84 (`useSharedDocumentIngest.ts:1061`), and `MagicBeansSheet.vue:66-72` deliberately refuses to hold a second opinion about acceptable text. No second rule anywhere.

## Assumptions

> **Review these before implementation.** Verified against the tree on 2026-09-03; re-verify.

1. `sourceFromText` is the single place both doors decide text-vs-link (`useSharedDocumentIngest.ts:337`, called at `:570` and `:1061`), and it still computes `candidates` / `withoutUrls`.
2. `MIN_SHARE_TEXT_CHARS = 25` (`share/types.ts:65`), `MAX_SHARE_TEXT_CHARS = 4000` (`:45`), `MAX_SHARE_TEXT_CEILING = 32_000` (`:58`), `MAX_SHARE_TEXT_BYTES = (CEILING+1)*4` (`:76`).
3. `ShareIntentPlugin.java:99` mirrors `32001` — the **ceiling + 1**, explicitly _not_ the read cap (`:86`) — so raising the read cap touches no native code. The service-worker mirror (`public/share-target-sw.js:26`) also tracks the ceiling, not the read cap.
4. `ai-extract` accepts `MAX_TEXT_CHARS = 32_000` (`infrastructure/lambda/ai-extract/index.mjs:49`), and the already-shipped link arm routinely sends up to `24_000` characters of fetched page text (`infrastructure/lambda/content-fetch/modes/page.mjs:17`). The client read cap is therefore a cost choice, not a wire bound, and 10,000 is well under what the link path already spends.
5. `peekAttempt` is side-effect-free (`src/utils/attemptBudget.ts:179-182`), so it may be evaluated before the arm decision without consuming anything.
6. `logReceivedKind(env, 'file' | 'link' | 'text', fileCount)` is the triage event; `withIngestLock` is the outermost catch (`:884-897`).

## Approach

### 1. One threshold, on the prose that is already computed

Add a single constant beside the existing text policy in `src/services/share/types.ts`:

```ts
/**
 * Above this much prose (URLs removed), the BODY is the share and a link inside it is
 * incidental — a school email, a class-group message, a forwarded newsletter.
 * At or below it, the share is a link with a note around it and the LINK path wins.
 *
 * ⚠️ Deliberately LOW. The link path is the only route to schema.org recipe data, which the
 * model never has to guess at; a midpoint threshold would swallow chattier recipe shares to
 * no benefit. Tuning this is expected — see the triage log message in `sourceFromText`.
 */
export const MAX_LINK_NOTE_CHARS = 200;
```

### 2. `sourceFromText`, restructured to decide once and never refuse a workable share

Everything below already exists in the function; the change is **order plus one comparison**, with the bands hoisted into named booleans so each condition is evaluated once and read twice rather than recomputed.

```ts
const trimmed = text.trim();
const capped = text.slice(0, MAX_SHARE_TEXT_CHARS);

// `Set` because `trimUrlPunctuation` can collapse two distinct candidates onto one string,
// which defeats `extractUrls`' own dedupe (`url.ts:81`) and would run the same whole-string
// split twice. This value now decides the ARM, not just a refusal, so it pays to be exact.
const candidates = [...new Set(extractUrls(capped).map(trimUrlPunctuation))];
const prose = candidates.reduce((rest, c) => rest.split(c).join(' '), trimmed).trim().length;

// The bands, decided BEFORE the arm. Nothing here has a side effect (`peekAttempt` is a
// pure read — `attemptBudget.ts:179-182`), and each is read exactly twice: once to decide
// whether the text arm can run at all, once by the refusal that reports it.
const overCeiling = overCeilingByBytes || trimmed.length > MAX_SHARE_TEXT_CEILING;
const budgetKey = textBudgetKey();
const quota = budgetKey ? peekAttempt(budgetKey, SHARE_TEXT_BUDGET) : null;
// ⚠️ "Can the text arm actually READ this?", not "should it". A link-bearing share must never
// become a refusal because the text arm it was newly routed to could not run — see Context.
const textArmUsable = !overCeiling && trimmed.length >= MIN_SHARE_TEXT_CHARS && quota?.ok !== false;

// THE CHANGE. A body outweighs the links inside it; a note around a link does not.
const bodyOutweighsLinks = prose > MAX_LINK_NOTE_CHARS;

if (candidates.length && (!bodyOutweighsLinks || !textArmUsable)) {
  // …dynamic import of routeUrl, the existing `candidates.find(...)`, the existing
  // `logReceivedKind(env, 'link', 0)` return, and the existing unreadable-link refusal
  // (still `prose < MIN_SHARE_TEXT_CHARS`, still before any band)…
}

// …the three existing refusals in their existing order (ceiling, minimum, quota), each now
// reading the boolean computed above, then the existing truncation flag and text return.
```

Why this is exactly today's behaviour plus one rule:

- `bodyOutweighsLinks === false` → the whole link block runs as it does today, in the same order, with the same refusal.
- `textArmUsable === false` → the link block also runs, which is today's behaviour and what `useSharedDocumentIngest.test.ts:880-893` pins.
- No candidates → the block is skipped entirely and the bands run, as today.
- Only "prose > 200 **and** the text arm can read it" is new.
- `trimmed.length >= MIN` is implied whenever `bodyOutweighsLinks` (URL removal can only shorten: each candidate is replaced by one space), so the "too short" refusal remains reachable only on the no-usable-link path, exactly as today.

**Efficiency (requirement 5):** the dynamic `import('@/utils/recipeSourceUrl')` now sits _inside_ the link block. In the dominant new case — a long email — it is never loaded. That matters: the import comment at `:358-363` exists specifically to keep the ~22 KB recipe graph out of the eager chunk, and this change stops paying for it on the path that has no use for it.

### 2a. The one fallible operation, handled (requirement 8)

The dynamic import is the only thing in `sourceFromText` that can throw, and it is a network fetch when the chunk is not precached — on a path whose contract says "NO NETWORK … which is what lets the single offline guard sit between this and consent" (`:463-465`). Today a rejection escapes to `withIngestLock`'s catch (`:884-897`) and the user is shown `ai.error.generic` for what is really "offline, or a stale deploy".

```ts
let routeUrl: (typeof import('@/utils/recipeSourceUrl'))['routeUrl'];
try {
  ({ routeUrl } = await import('@/utils/recipeSourceUrl'));
} catch (err) {
  // Not silent, and not fatal: if the text arm can read this, read it — the user gets a
  // result instead of an error. `reportError` (not `logEvent`) because a chunk that will not
  // load is a deploy/caching fault a developer must see, with the failing module named.
  reportError({
    surface: env.surface,
    message: 'link router chunk failed to load — falling back to the text arm',
    severity: 'error',
    error: err,
    context: { action: 'rejected_type', detail: 'link_router_unavailable' },
  });
  if (!textArmUsable) {
    showToast('error', t('ai.error.title'), t('ai.error.generic'));
    return null; // told, logged, one outcome
  }
  // fall through to the bands: the message itself is still perfectly readable
}
```

No new context key: `action` and `detail` are both already allowlisted, and `'link_router_unavailable'` is a fixed developer-authored enum value. The developer guidance lives in the message string, which CloudWatch surfaces verbatim.

### 3. Why 200, and what it costs

| Share                                                         | prose (URLs removed) | Path                         | Right?                                                                    |
| ------------------------------------------------------------- | -------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `https://example.com/cake`                                    | 0                    | unreadable-link guard → link | ✅ unchanged                                                              |
| `Made this last night 😍 <url>`                               | ~22                  | link                         | ✅ unchanged                                                              |
| `Have a look at this recipe I found, looks amazing <url>`     | ~49                  | link                         | ✅ unchanged                                                              |
| Over-ceiling `.txt` beginning with a link, 500 chars of prose | 500                  | **link** (text arm unusable) | ✅ unchanged — pinned at test:880                                         |
| Link + long prose, text budget spent                          | >200                 | **link** (text arm unusable) | ✅ unchanged                                                              |
| A 4,526-char school email with 2 links                        | ~4,400               | **text**                     | ✅ **the fix**                                                            |
| A 250-char personal note + recipe link                        | ~250                 | **text**                     | ⚠️ degraded — recipe without exact quantities                             |
| Share-sheet excerpt (300–800 chars) + article link            | >200                 | **text**                     | ⚠️ degraded — the excerpt is read, not the page                           |
| Bare link + a 400–900 char confidentiality footer             | >200                 | **text**                     | ❌ **worse than today** — the model reads a disclaimer and answers `none` |

The last row is the honest cost and **cannot be tuned away**: any threshold that admits a 4,526-character email also admits a 900-character legal footer. It is accepted because it is rare (a forwarded email whose _only_ content is a URL), it is loud rather than silent (`kind: 'none'`, and the user is told), and it is detectable blind — see the failure-modes table in Observability Coverage. A tweet-length threshold (280) was considered and rejected as too permissive: it would swallow chattier recipe shares without helping either row above.

### 4. `MAX_SHARE_TEXT_CHARS` — raise 4,000 → 10,000

The 4,000 cap was sized when a text share was a _note around a link_. An ordinary school email is 4,526 characters, so the very first real-world example overflows it and silently loses its tail after a notice.

`ai-extract` accepts 32,000 and the **already-shipped link arm routinely sends up to 24,000** characters of fetched page text (`content-fetch/modes/page.mjs:17`), so 10,000 is still materially cheaper than what a single link share already costs. ~4,000 characters is ~1,000 tokens; this makes a sub-cent call roughly 2.5× a sub-cent call.

Unchanged: the ceiling, the byte gate `(CEILING+1)*4`, and both native mirror **values** — `ShareIntentPlugin.java:99` and `public/share-target-sw.js:26` mirror `32001`, the ceiling + 1.

⚠️ **But both files carry prose comments quoting the old `4000`** (`.java:86`; `share-target-sw.js:27, 33`). Correct the comments; change no value. A comment-only edit is behaviour-free, and leaving it is exactly how a mirror rots — the failure this session has already had to fix twice.

⚠️ **Consequences to carry through, all of which break shipped tests (see Testing Plan):**

- `MAX_SHARE_TEXT_CHARS` bounds `capped`, the string `extractUrls` scans. URL extraction now sees more of the message — correct and strictly better (today a link past 4,000 characters is invisible), but it changes the outcome of `useSharedDocumentIngest.test.ts:425-443`, which was written to pin the _old_ invisibility.
- The byte gate's over-ceiling arm slices `MAX_SHARE_TEXT_CHARS * 4`, so the hostile-file decode bound moves 16 KB → 40 KB. Still bounded, still far below the 128 KB the ordinary arm allows, but `useSharedDocumentIngest.test.ts:877` asserts `slice(0, 16_000)` exactly and must become `40_000`. That assertion firing is it working as intended.
- Four tests hardcode the literal `4000` (`:826`, `:840-841`, `:849-855`). They must import `MAX_SHARE_TEXT_CHARS` instead, so the next tuning is a one-line change rather than a four-test edit.
- The truncate band narrows from 4,000–32,000 to 10,000–32,000, so far fewer shares get the notice at all. The ceiling refusal is unchanged.

### 4a. Tests broken by the cap raise — the full list, verified

Pass 2 under-counted these. The literals are not the whole problem: **two tests break on their INPUTS**, which is why a literal-only sweep would leave them failing for a reason that looks unrelated.

| Location    | What breaks                                                                                                                                                                                                                                                                                 | Fix                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `:425-443`  | `'x '.repeat(3000)` + buried URL: the URL is now visible AND the prose (~6,000) wins the arm; no truncation either                                                                                                                                                                          | Re-anchor on `MAX_SHARE_TEXT_CHARS`; bury the URL past the constant, keep the claim |
| `:440`      | `expect(sent.length).toBe(4000)`                                                                                                                                                                                                                                                            | `toBe(MAX_SHARE_TEXT_CHARS)`                                                        |
| `:826`      | input `'a'.repeat(10_000)` is now **exactly** the cap → nothing truncates, "exactly ONE notice" fails                                                                                                                                                                                       | `'a'.repeat(MAX_SHARE_TEXT_CHARS + 2_000)`                                          |
| `:827`      | `expect(sent).toHaveLength(4000)`                                                                                                                                                                                                                                                           | `toHaveLength(MAX_SHARE_TEXT_CHARS)`                                                |
| `:840-841`  | "does not truncate at the cap exactly" — both input and assertion                                                                                                                                                                                                                           | both from the constant                                                              |
| `:850-855`  | surrogate test: `'a'.repeat(3999) + '🎉'.repeat(50)` is 4,099 chars — under the new cap, so nothing truncates                                                                                                                                                                               | `'a'.repeat(MAX_SHARE_TEXT_CHARS - 1) + '🎉'.repeat(50)`, assert `MAX - 1`          |
| **`:1363`** | **`const LONG = 'a'.repeat(10_000)`** in `describe('the truncation notice is only made once it is TRUE')`. `10000 > 10000` is false → **`:1387-1391` ("IS shown, exactly once") hard-fails**, and `:1367-1385` keep passing while asserting nothing — three regression pins silently voided | `'a'.repeat(MAX_SHARE_TEXT_CHARS + 2_000)`                                          |
| `:877`      | `slice(0, 16_000)`                                                                                                                                                                                                                                                                          | `slice(0, MAX_SHARE_TEXT_CHARS * 4)`                                                |

**No `4000`, `3999`, `16_000` or bare `10_000` literal tied to this cap may survive anywhere in the suite** — `grep -n "4000\|3999\|16_000\|10_000"` over the ingest test file must return nothing but the constant import. After this, retuning the cap is one edit in `types.ts`.

Verified by running the real `extractUrls` over every link-bearing fixture: `:263` prose 32, `:272` prose 3, `:298` ~11, `:782` prose **80**, `:884` prose **500**, `:1356` prose 44 — all decided identically before and after. `MAX_LINK_NOTE_CHARS = 200` is safe against the entire shipped suite.

### 5. Observability — one bit, no new key, no changed meaning

`logReceivedKind` already carries `detail: 'file' | 'link' | 'text'`, which says which path ran. What it does not say is _why_, and a mis-tuned threshold is exactly the thing that will need diagnosing from logs.

**Rejected: bucketing the prose length into `file_count`.** It contradicts that key's documented meaning (`diagnosticContext.ts:186-190`) and `logReceivedKind`'s own promise that `file_count` is 0 for non-file shares (`:226-229`), and — decisively — it is redundant. The link arm is reachable **only** when a routable candidate exists (`:365-370`), so `detail='link'` already means "links were present and won". The single genuinely new fact is one bit: _this text share had links in it and the body won anyway_.

**Rejected: a fourth boolean parameter on `logReceivedKind`.** The helper has four call sites, two of them file shares where the flag is meaningless, and a boolean at a call site says nothing at the point you read it. The next reason to annotate a triage would add a fifth parameter.

**Adopted: a small `note` union carried in the event's MESSAGE**, which is developer-authored free text, is not allowlisted, is transmitted verbatim, and is already how this file distinguishes outcomes ('shared link is not one beanies can read', 'shared text was too long to read'):

```ts
/** Why a triage went the way it did, when the bare `detail` does not say. Extend by adding a
 *  case here — never by adding another boolean parameter. */
type TriageNote = 'outweighed_links';
const TRIAGE_NOTES: Record<TriageNote, string> = {
  outweighed_links: 'the message outweighed the links in it',
};

function logReceivedKind(env, detail, fileCount, note?: TriageNote): void {
  logEvent({
    level: 'info',
    surface: env.surface,
    // ⚠️ PREFIX IS STABLE. Every message starts 'share triaged', so a saved query moves from
    // `= "share triaged"` to `like /^share triaged/` and keeps working as notes are added.
    message: note ? `share triaged — ${TRIAGE_NOTES[note]}` : 'share triaged',
    context: { action: 'triaged', detail, file_count: fileCount },
  });
}
```

Zero new keys, zero allowlist edits, zero Lambda-mirror edits, zero `PrivacyInfo.xcprivacy` / Data-Safety / `privacy.astro` edits, one event per triage (so the `triaged → classified → ready` funnel keeps its denominator), and no character count anywhere.

### 6. ADR-035 — one line, so the record does not go stale

ADR-035's context rests on "the only way to reach the text arm was for a user to share a **link**", and it sized the abuse limits for the traffic #83 was expected to create. This change is what actually makes the raw-text arm the common path, and §4 raises the per-call payload 2.5×: worst-case per-device raw-text volume goes from 20 × 4,000 to 20 × 10,000 characters an hour.

That is not a new decision — the trade ADR-035 accepted is unchanged and no limit moves — but leaving it unsaid means the next person sizing those limits works from a number that is no longer true. Append a dated consequences line. **No new ADR:** nothing is being reversed.

## Files Affected

- `src/services/share/types.ts` — add `MAX_LINK_NOTE_CHARS` in its **own section below** the three-band block (whose banner says the bands must not be reconciled — this is a precedence threshold on a different string, not a fourth band); raise `MAX_SHARE_TEXT_CHARS` to 10,000, amending the comment at `:38-45` to say why the number moved and that the native mirrors track the ceiling, not this
- `src/composables/useSharedDocumentIngest.ts` — restructure `sourceFromText` per §2 (hoist `trimmed`/`candidates`/`prose` and the three band booleans; move the link block behind the new condition; guard the dynamic import per §2a); one optional parameter on `logReceivedKind`
- `src/composables/__tests__/useSharedDocumentIngest.test.ts` — the precedence matrix below, **plus the three shipped assertions this change invalidates** (`:425-443`, `:877`, and re-confirming `:880-893` still passes) and the four `4000` literals
- `src/content/help/features.ts` — the link-vs-text paragraph, **and** the now-false "Too much at once" bullet at `:1863`
- `android/app/src/main/java/family/beanies/app/ShareIntentPlugin.java` — **comment only** (`:86`, stale `4000`); no value changes
- `public/share-target-sw.js` — **comment only** (`:27`, `:33`, stale `4,000`); no value changes
- `docs/adr/035-plain-text-share-provenance.md` — one dated consequences line (§6)
- `CHANGELOG.md`, `docs/STATUS.md`

**Explicitly NOT touched:** `src/utils/url.ts`, `src/utils/recipeSourceUrl.ts`, `src/utils/diagnosticContext.ts`, `src/utils/attemptBudget.ts`, `infrastructure/lambda/**`, `android/**`, `ios/**`, `src/components/ai/MagicBeansSheet.vue`. If a diff touches any of them, or changes any _value_ under `android/` or `public/`, the change has drifted from this plan.

## Help Center Coverage

- **Action**: `update existing`
- **Category**: `features`
- **Slug**: `share-to-beanies`
- **Title**: unchanged
- **Scope**: two edits, both in the share article.
  1. Between "Sharing text you have selected" (`features.ts:1831`) and "Sharing a link" (`:1869`), one short paragraph saying what beanies does when both are present: share a whole message and it reads the message; share a link with a few words around it and it opens the link.
  2. Rewrite the "Too much at once" bullet at `:1863`. It currently says "A whole email thread is more than beanies reads in one go. Pick out the part with the details" — advice this change makes wrong for an ordinary email. Keep the honest half (a very long thread is still read from the beginning, and beanies says so).
- **Notes**: Must not promise a precise threshold or quote any character count — it is a heuristic and will be tuned. Frame it as "a whole message" vs "a link with a note".

## Observability Coverage

Surface: **`share-target-ingest`** and **`magic-beans-capture`** (existing, per `IngestEnv`).

| Event                                                                   | Level   | Context                                                          | Why                                                                                             |
| ----------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `share triaged` (existing)                                              | `info`  | `{ action: 'triaged', detail: 'link' \| 'text', file_count: 0 }` | Unchanged in every respect                                                                      |
| `share triaged — the message outweighed the links in it` (new message)  | `info`  | identical context                                                | The only new fact: the body won over a usable link. One `filter @message like /outweighed/`     |
| `shared link is not one beanies can read` (existing)                    | `info`  | `{ action: 'rejected_type', detail: 'unreadable_link' }`         | Unchanged — proves the refusal still fires exactly where it did                                 |
| `link router chunk failed to load — falling back to the text arm` (new) | `error` | `{ action: 'rejected_type', detail: 'link_router_unavailable' }` | The one fallible operation. Never silent, names the module, says in the message what to look at |

**Failure modes → the event that diagnoses them blind**

- Threshold too low (recipe shares wrongly read as text): the `outweighed` message rising while `extraction_path='jsonld'` falls.
- Threshold too high (emails still fetched): `detail='link'` flat after release and `classified kind='none'` staying high.
- The rule never fires: no `outweighed` messages at all.
- Chunk regression after a deploy: `detail='link_router_unavailable'` appearing at all.

**Success-path signal:** the `triaged → classified → ready` funnel is unchanged and still emits exactly one `triaged` event per share, so conversion per path stays measurable.

**No new context key, and no existing key changes meaning.** **Never logged:** the prose, any substring of it, any character count, or any URL.

## Acceptance Criteria

- [ ] The Grade 5 field-trip email fixture routes to **text**; `resolveRecipeSource` is never called
- [ ] A bare link, and a link with a short note, still route to **link** — byte-identical behaviour
- [ ] An unreadable link still gets the link-shaped refusal, under exactly the conditions it does today
- [ ] **No share that succeeds today becomes a refusal**: the over-ceiling `.txt` beginning with a link still takes the link path, and a link-bearing share still works with the text budget exhausted
- [ ] No share produces more than one AI call or more than one fetch, and the link-router chunk is **not** loaded when the body wins
- [ ] A 4,526-character email is not truncated; a 12,000-character one is, with exactly one notice; 32,001 is still refused
- [ ] A bare-domain signature line (`www.school.edu.sg`) is excluded from the prose count, not counted as 17 characters of body
- [ ] The link path spends no budget: `localStorage` is not written on a link share
- [ ] **No test in the suite contains a cap-derived literal** (`4000`, `3999`, `16_000`, or a bare `10_000` input) — all derived from `MAX_SHARE_TEXT_CHARS`
- [ ] `sourceFromText`'s body is the decision only; each helper has one job and no branch nests more than one level
- [ ] The ceiling, the byte gate constant and both native mirrors are unchanged, and no file under `android/`, `ios/`, `infrastructure/`, `public/` or `src/utils/` is modified
- [ ] The triage event count per share is unchanged; the message prefix `share triaged` is preserved; `file_count` still means documents; no character count appears in any log
- [ ] A failed dynamic import produces a reported error naming the module, and reads as text where it can
- [ ] The in-app paste path gets the same rule with no second implementation (`MagicBeansSheet.vue` unchanged)
- [ ] Help Center article updated, including the "Too much at once" bullet; ADR-035 carries the consequences line
- [ ] `type-check`, `lint`, `lint:style`, `format:check`, `test`, `test:lambda` clean

## Testing Plan

1. **Repair the three shipped assertions this change invalidates, first, so the rest is measured against green.**
   - `useSharedDocumentIngest.test.ts:425-443` ("caps sender-supplied text before anything parses it") is written against a 4,000 cap with a URL at offset 6,000. Re-anchor it on `MAX_SHARE_TEXT_CHARS` — put the URL past the imported constant and keep the assertion "a URL past the cap is unfindable, and the text is read truncated with one notice".
   - `:877` asserts `slice(0, 16_000)`; the over-ceiling decode arm is `MAX_SHARE_TEXT_CHARS * 4`, so it becomes `40_000`. Anchor it on the constant rather than a new literal.
   - Replace the `4000` literals at `:826`, `:840-841`, `:849-855` with the imported constant.
2. **Confirm, do not rewrite, the regression pins.** `:880-893` (over-ceiling `.txt` beginning with a link) and `:781-784` (link + short note) must pass **unmodified**. If either needs editing, the ordering in §2 has been implemented wrongly.
3. **Unit — the precedence matrix**, each row a different outcome:
   - bare link → link; link + 20-char note → link; link + 49-char note → link (the recipe case that must not regress)
   - link + 250-char note → text
   - the school-email fixture → text, and `resolveRecipeSource` never called
   - unreadable link + long prose → **text**
   - unreadable link + short note → link refusal (the shipped guard, unchanged)
   - no links, long prose → text (unchanged)
   - **link + long prose, budget exhausted → link**, with no quota toast
   - **link + long prose, over-ceiling `.txt` → link**, with no "too long" toast
4. **Unit — the cap**: 4,526 chars not truncated; 12,000 truncated with exactly one notice; 32,001 refused.
5. **Unit — the prose measurement**: a body of exactly `MAX_LINK_NOTE_CHARS` prose → link; one character more → text. **The scheme-less strip, with a fixture that actually discriminates**: `'a'.repeat(190) + ' www.someschool.edu.sg'` → **link** (`resolveRecipeSource` called). Two-form prose is 190 (≤ 200); one-form prose is 212 (> 200), so this **fails against the pre-fix strip**. ⚠️ Do NOT use `Regards\nwww.school.edu.sg` — both strips land under `MIN_SHARE_TEXT_CHARS` (24 and 7), so it passes either way and proves nothing. Also cover §2b's band: an unreadable bare-domain share whose one-form prose clears 25 and two-form prose does not → link refusal, not a model call.
6. **Unit — efficiency**: `vi.mock('@/utils/recipeSourceUrl')` with a `routeUrl` spy; with a long body and a link present, assert `routeUrl` has **zero** calls and `resolveRecipeSource` was not called. (Deterministic — replaces "assert the module was never resolved", which the harness cannot promise.)
7. **Unit — the budget is not spent by the link arm**: share a link with a `localStorage.setItem` spy installed; assert zero writes to the budget key, and that a subsequent text share still has its full budget. This pins the `peekAttempt`-is-free assumption rather than trusting a comment in another module.
8. **Unit — the import guard**: make the dynamic import reject; assert (a) with readable text, the text arm runs and an error is reported naming the module; (b) with unreadable text, the user gets a toast and `null` is returned — no silent path.
9. **Unit — observability**: every triage message starts `share triaged`;: exactly one `triaged` event per share; the `outweighed` message appears only for the new rule; `file_count` is 0 for link and text; extend the existing "never logs the shared text, a substring of it, or its exact length" test (`:975`) to cover the new message.
10. **Mutation-verify**: inverting `>` to `<` must fail the email row; deleting `bodyOutweighsLinks` must fail it; deleting `textArmCanRun` must fail step 3's last two rows; dropping the scheme-less form from `proseLength` must fail step 5's last row.
11. **Manual**: share the real email from Gmail on Android and Apple Mail on iOS; confirm the activity review modal opens with title, location and description, and that a recipe link share still fetches schema.org quantities.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from a verified production reproduction; identified `withoutUrls` (already computed by the shipped unreadable-link guard) as the one measurement, and set the threshold low to protect schema.org recipe fetches.
- **Pass 2 (DRY + error handling)**: Found the draft's ordering turned two working link shares into hard refusals — one pinned by a shipped test (`test:880-893`) and protected by an explicit design comment (`useSharedDocumentIngest.ts:505-517`); replaced "fall through to the bands" with a `textArmUsable` precondition so no working share becomes a refusal. Rejected the `file_count` bucket as a contract violation (`diagnosticContext.ts:186-190`) _and_ as redundant with `detail='link'`, replacing it with one message variant and zero new keys. Caught the shipped tests broken by the cap raise and four hardcoded `4000` literals. Deduplicated `candidates` before the O(n·m) prose reduce. Moved the dynamic import inside the link block (so the dominant new path loads less code) and wrapped it, since it was the function's only unguarded failure and sits on the offline path. Recorded `pickRecipeLinks`' filters as considered-and-rejected.
- **Pass 3 (Sustainability)**: Split `sourceFromText` into a flat decision plus four one-job helpers with named outcomes, instead of a 150-line body with five booleans and a three-deep `try/catch`; replaced the proposed 4th boolean parameter on `logReceivedKind` with an extensible `TriageNote` union and a stable message prefix; **fixed a real latent defect the plan was about to promote to arm-selection duty** — `extractUrls` returns bare domains scheme-prefixed (`url.ts:75`) so they were never stripped from the prose (verified by running it); corrected and completed the cap-raise test list (two tests break on their INPUTS, not their assertions); pinned the `peekAttempt`-is-free assumption with a `localStorage` test rather than trusting another module's comment; recorded the 2.5× raw-text volume shift against ADR-035; made the efficiency test deterministic; recorded the leaf-module and remote-config alternatives as rejected.
- **Pass 4 (Fresh-eyes sweep)**: Re-verified every line number and computed every fixture by running the real `extractUrls`. **Found a fourth broken test the "complete" §4a list missed** — `test:1363`'s `LONG = 'a'.repeat(10_000)` hard-fails at the new cap and silently voids three more pins in that block. **Found §2's code contradicting its own mandate** (it shipped the one-form strip the caveat says must be fixed). **Found Requirement 4 falsified by the plan's own fix** — the two-form strip makes the unreadable-link refusal fire strictly more often; reconciled in §2b with the exact band and a test. **Found the scheme-strip fixture non-discriminating** (both strips land under 25, so it passed either way); replaced with one that straddles the threshold. Attacked the threshold and added the two shapes genuinely WORSE than before (a link wrapped in a confidentiality footer; a share-sheet excerpt), correcting the "degrades gracefully" claim and mapping both to an existing log signature. Caught the stale `4000` comments in `ShareIntentPlugin.java` and `share-target-sw.js` that the file-freeze would have preserved, and the Help Center paragraph at `features.ts:1843` the change obsoletes. **Cut the ceremony**: all four Pass-3 helpers, the one-entry `TRIAGE_NOTES` record, §2a's nested try/toast/`return null` (replaced by `.catch` + rethrow, since `withIngestLock` already handles that case), and two rejected-alternative paragraphs.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt

> yes pls write up the plan. once complete pls implement and run a code review to ensure it is working as designed and does not introduce new bugs or side effects or security issues.

Following the session's production verification, in which greg supplied a real Grade 5 field-trip email and said:

> this should be considered an email, and the idea is it should come back classified as an activity and add an entry to the calendar

### Follow-up 1 — the character cap

> yes pls raise the character cap. even 10000 should be ok I think

(Pass 1 proposed 8,000; greg raised it to 10,000. Applied while folding in Pass 2, so passes 3 and 4 review the 10,000 version.)

</details>
