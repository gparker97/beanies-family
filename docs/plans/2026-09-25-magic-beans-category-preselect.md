# Plan: Tell us what this is — an optional, scalable category pick in the magic beans sheet (#108)

> Date: 2026-09-25
> Related issues: Notion tracker #108 (no GitHub issue — direct implementation)
> Plan file: `docs/plans/2026-09-25-magic-beans-category-preselect.md`
> Mockup: `docs/mockups/magic-beans-category-chips-2026-09-25.html` (direction C, approved by greg 2026-09-25)

## User Story

As a parent adding a school trip PDF, I want to tap "activity" before I hand it over so that beanies reads it as an event on the first try.

## Context

The magic beans sheet (`MagicBeansSheet.vue`, #84) asks "where is it?" (paste / camera / file) and deliberately never "what is it?". The three capability tiles at its foot are a static statement; the only way to steer the model is after a wrong answer, through `MagicMiscategorisedBanner` and a second read. greg's call (2026-09-25): the person handing something over always knows what it is, so let them help beanies out in advance, optionally. Nothing selected stays the default and stays the common case. The tile row also has to scale: three kinds today, transactions (#107) next, more later.

This is an explicit, per-capture user choice. It is NOT the per-surface positional hint that `docs/plans/2026-09-14-magic-beans-one-surface-and-meter.md` (§"Explicitly not doing") rejected, and it does not reopen that decision.

**What already exists and is reused (verified in code, 2026-09-25):**

- A kind hint already reaches every provider's prompt through `ExtractOptions.correction.to` (`documentExtractionService.ts:92`) → `ExtractionRequest.correction.to` (`types.ts:81`) → `EXTRACTION_TASKS.share.buildMessages(source, todayIso, kindHint)`. On the sealed managed path the prompt is built on the client (`managedProvider.ts:463-469`); BYOK passes it through `openaiCompatible.ts:149-152`; on-device throws `not_available` for `share` regardless.
- On the managed sealed path the wire body carries `correction: { token }` ONLY when a token exists (`managedProvider.ts:491`, `...(request.correction?.token ? { correction: { token } } : {})`). A hint with no token therefore never reaches the meter: the read is a normal, billable, grant-issuing read whose prompt happens to be hinted. No Lambda change is needed. The managed kind guard is gated on `body.correctionFree` (`managedProvider.ts:570`), so it does not fire for a hinted first read; both a `none` answer and a different-kind answer must be handled client-side (below). `sourceHash` (`managedProvider.ts:170-195`) hashes ONLY `request.source`, never `correction`, so the grant a hinted first read is issued still fingerprints the same bytes a later "not right?" re-sends.
- Reader availability per kind: `isReaderEnabled(readerForShareKind(kind))` (`useMagicReader.ts`), already used by the banner's `options` computed (`MagicMiscategorisedBanner.vue`). That computed is the ONLY place the "which kinds can this member be routed to" rule is written today; the door becomes its second caller, so the rule is lifted into one helper (§1).
- Tiles are drawn from `MAGIC_DESTINATIONS` / `MAGIC_DESTINATION_KINDS` (`magicDestinations.ts`), iterated by the sheet, the overlay and the banner. The module header is the checklist for adding a kind.
- The selected look on LIGHT already exists once, in `ChipButton.vue`'s `selectedClass`: `border-primary-500 text-primary-500 border-2 bg-[var(--tint-orange-8)]` (+ `hover:bg-[var(--tint-slate-10)]` at rest). The sheet's selected tile uses those SAME light tokens so there is one "selected" vocabulary on light. On dark, `ChipButton` uses `dark:bg-primary-500/15` (a primary wash on a pill); the tile is a squircle sitting on `surface-overlay`, so its dark selected background is the next surface step, `dark:bg-surface-hover`, with `dark:border-accent-lift` / `dark:text-accent-lift` as the accent's lift partner (requirement 3). The sheet does not use `ChipButton` itself because that is a pill (`rounded-full`, inline icon), and the approved mockup is the squircle emoji-over-label tile the sheet, overlay and banner already draw.
- The in-app orchestrator: `ingestInAppSource(input, grant, destination)` with `InAppInput` arms `file | paste | correction`; `read()` builds one `opts` object and calls `extractShareFromDocuments/Text/PreparedSource`; `readText()` is shared by the text arm AND the fetched-link arm; `runIngest()` handles `none`, the reader gate, the resolve hold, claim and dispatch; `ingestState` drives `AiProcessingOverlay`; `withIngestLock` wraps the whole run in a `catch` that `reportError`s and toasts, so nothing new below it can throw silently. The file's established shape for "tell the user and record it" is a small module-level function that logs and toasts (`notReady`, `refuseForQuota`); the spine calls it in one line rather than carrying the block inline.
- Telemetry on `magic-beans-capture`: `opened`, `corrected` (`kind`=to, `detail`=from), `classified` (`kind`), `reader_disabled`, `ready` (`kind`, `detail`=source), `failed` (`error_code`, `detail`). Context keys `action`, `kind`, `detail`, `error_code` are already allowlisted; no new key ships.
- Strings: `ai.capture.*` (title, tagline, label, placeholder, dest.event/travel/recipe), `ai.correct.*` (prompt, action "Tell us what this is", picked "Reading it again as a {kind}…", disagreed._, refused._). `fillTemplate` (`src/utils/fillTemplate.ts`) for `{kind}`. The beanie-floor test (`uiStrings.test.ts` "important-surface beanie values") lists `ai.correct.disagreed.` and `ai.correct.refused.` as important surfaces. `ai.capture.dest.*` values are Title Case tile names with no article (`Activity` / `Trip` / `Recipe`; lowercase in beanie), so any sentence that interpolates one must not put "a"/"an" in front of it.
- The prompt drift test (`extractionPromptDrift.test.ts`) pins that the client, the spike (`scripts/spikes/extractionPrompt.mjs`) and the Lambda mirror (`infrastructure/lambda/ai-extract/extractionPrompt.mjs`) build IDENTICAL share messages, hinted and unhinted, with the signature `(source, todayIso, kindHint?)`. The Lambda's legacy plaintext arm calls the builder with three arguments (`index.mjs:437`).

## Requirements

1. The tiles at the foot of `MagicBeansSheet` become tappable, single-select toggles. None selected on open (and on every reopen). Tapping the selected tile clears it.
2. The row is headed "Tell us what this is" with an "optional" marker and a state line: idle → "pick one, or let beanies work it out"; selected → "we'll read this as an activity / a trip / a recipe. tap again to let beanies decide." Beanie mode lowercases; English is sentence case per the casing standard.
3. Selected tile styling: Heritage Orange tint background + Heritage Orange border + Heritage Orange text on light; `dark:bg-surface-hover` + `dark:border-accent-lift` + `dark:text-accent-lift` on dark. Unselected tiles keep today's look (`bg-[var(--tint-slate-5)] dark:bg-surface-overlay`, `text-secondary-400 dark:text-ink-faint`). Focus ring per the theme (Sky Silk). No opacity on readable text.
4. Only kinds whose reader is enabled AND permitted for this member are rendered as tiles (same rule the banner uses). With one kind available the row still renders (a single tile is still a valid, optional pick).
5. The pick travels with the capture: paste, camera and file all carry it. The camera and file picks are held with the pending grant in `MagicBeansDoor` (the picker returns later) and are cleared/expired on the same three rules as the grant.
6. A picked kind is authoritative: the first read is a hinted read on every tier, using the SAME prompt channel a correction uses (`opts.correction = { to }`, no token). It is a normal billable read on the managed tier (no grant is spent; a grant IS issued as usual, so "not right?" still works afterwards). The client text budget is consumed as for any first read.
7. The hinted prompt must not claim "an earlier reading got that wrong" when there was no earlier reading. The share prompt builder gains a hint REASON and phrases the instruction accordingly; the three copies (client, spike, Lambda mirror) change identically and the drift test pins both reasons.
8. When a hinted read returns `kind: 'none'`, the user is told "beanies couldn't read this as a trip" (kind-specific, with what to do next), not the generic "unrecognised" toast, and the event says so. When a hinted read returns a DIFFERENT kind, the result is still delivered (the bean is spent and a result beats nothing) but the user is told which kind beanies read it as and the event says so — it is never silently reclassified.
9. `AiProcessingOverlay` shows the hinted tile lit from the start of the read (the same lifted style it uses for the resolved tile), so the pick reads as the answer there too; the other tiles do not tick. On resolve, behaviour is unchanged.
10. Telemetry: the pick and its outcome are measurable against the correction rate (see Observability Coverage).
11. Layout scales: a fourth (and sixth) tile fits at 360px without truncated labels. The grid is `repeat(auto-fit, minmax(4.5rem, 1fr))` (rem-based), so extra kinds re-flow to a second row with no redesign, and with three kinds the tiles fill the row edge to edge exactly as the current `flex-1` row does (`auto-fit` collapses empty tracks; `auto-fill` would leave an empty fourth track beside three tiles at 360px). Nothing in this change adds a kind; the transactions tile lands with #107 through the `magicDestinations.ts` checklist.
12. The "not right?" banner still works after a hinted read (the envelope's `correction` is set from the result exactly as today).
13. Help article `share-to-beanies` (features) and the "A shortcut from anywhere" info box in the cookbook article mention the optional pick in one sentence each.
14. No feature gate. No GitHub issue. Not remembering the last pick. No per-page default.

## Important Notes & Caveats

- **Keep the prompt channel single.** Do NOT add a second "hint" field beside `correction`. The correction type already models "a stated kind, optionally with a grant token"; a pre-select is the token-less case. The only new information the prompt needs is WHY the kind was stated, and that is one discriminator on the builder's fourth argument.
- **Build `opts.correction` once, in `read()`.** The hint is a property of the SOURCE, not of an arm: documents, pasted text and a fetched link page all reach the model through the one `opts` object (`readText` is shared by text and link). Attaching the hint per arm is how the link arm was missed in the first draft. The JSON-LD and title-only link shortcuts never invoke the model, so no hint applies there; they are already logged as `resolved` with `extraction_path`, and a JSON-LD recipe under an "event" pick is structured data beating a guess, which is the right outcome.
- **One noun, one representation, from the sheet's emit down.** The picked kind is called `hint` everywhere it travels (emit payload, door, `InAppInput`, `ShareSource`, `IngestState`, telemetry context) and is typed `ShareKind | undefined` — never `null` — so no call site converts between the two. `kind` is already overloaded on this path (`outcome.kind`, `classified.kind`, `input.kind` the discriminator); a picked kind that is also called `kind` is the one a future reader will confuse with the model's answer. The sheet's own ref is `pickedKind` (local, view-side name) and is the ONLY place the word "picked" appears in code.
- **The sheet stays a view.** It renders the tiles it is GIVEN (`kinds` prop) and emits what was picked; it does not import `useMagicReader` and does not know about permissions or flags. `MagicBeansDoor` already owns `useMagicReader()` (it gates on `canReadAny`) and is the orchestrator for everything below the tap, so "which kinds may this member pick" is its question. This keeps the sheet's test free of a module mock and keeps the MVO split the codebase documents (views bind and emit; orchestrators decide).
- **Derive "the stated kind" once.** `statedKind(source)` is a sibling of `sourceDetail(source)` — same closed-union shape, same reason: `ShareSource` IS the discriminator and both `read()` and `runIngest()` already receive it, so writing `source.kind === 'correction' ? undefined : source.hint` in each is two copies of one rule. In `ingestInAppSource`, where the lock is taken before a `ShareSource` exists, the hint is read off the `InAppInput` ONCE into a local and used for both the lock's facts and the `hinted` event.
- **The two new outcomes are two small helpers, not two blocks in the spine.** `runIngest` is the shared tail and is deliberately only the spine; the file already has the shape for "log it and tell the user" (`notReady`, `refuseForQuota`). `hintDisagreed(env, hint)` and `hintOverruled(env, hint, actual)` follow it, so the spine gains a one-line branch each and the toast/event pairing lives in one place per outcome.
- **`hintOverruled` fires only when the result is actually delivered — AFTER the reader gate.** Its copy says "check the details; Not right? is at the bottom", which is only true if a review modal opens. Placed before the gate, an overruled kind whose reader is off would show that toast AND the "reader unavailable" toast for one read, and the first would be false. After the gate, the reader-off case is reported once, by `reader_disabled` (which already carries `kind`), and the funnel still shows it was hinted via `classified.detail`.
- **No article in front of an interpolated tile name.** `ai.capture.dest.*` are the tiles' NAMES (`Activity`, `Trip`, `Recipe`; lowercase in beanie), not nouns in a sentence, so `a {kind}` renders "a Activity". The two outcome toasts quote the name instead (`You picked "{kind}"…`), which is correct for every kind and both casings without per-kind keys. The per-kind `ai.capture.pick.as.<kind>` strings exist for the one sentence that genuinely needs an article. (`ai.correct.picked`'s existing "as a {kind}" has the same flaw; out of scope here, noted for the translation pass.)
- **No nested ternary in the prompt builder, in any of the three copies.** The reason does not choose between two whole sentences; it chooses ONE clause (" An earlier reading got that wrong." or nothing) that is interpolated into the sentence that exists today. The `correction` output is then byte-identical to today by construction, the `stated` output differs by exactly that clause, and the three hand-mirrored copies carry one template instead of two.
- **Four positional arguments is the ceiling for `buildMessages`.** `(source, todayIso, kindHint?, hintReason?)` is accepted here because the Lambda's legacy arm (`index.mjs:437`) must keep calling with three and a default must reproduce today's prompt. If a FIFTH fact about the hint is ever needed, fold the third and fourth into one `hint?: { to, reason }` object across all three copies and the Lambda call site — do not add a fifth positional.
- **Do not touch `meter.mjs`, `correctionGrant.mjs` or `index.mjs`.** The sealed body never carries a token-less hint, so the server-side "hint only after a spent grant" fence is untouched and still true for the legacy plaintext arm. `index.mjs:437` keeps calling the builder with three arguments; the fourth defaults to `'correction'`, which reproduces today's prompt byte-for-byte.
- **The drift test is the contract.** Any change to the hinted share prompt must be made three times, byte-identical: `src/services/ai/extractionPrompt.ts`, `scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs`. Run `npm run test:lambda` too, since the Lambda file changed.
- **Never make the pick mandatory.** Save stays enabled on text alone; camera and file never require a pick.
- **The overlay tiles are the resolve moment** (`AiProcessingOverlay.vue` header). Pre-lighting the hinted tile must not remove the resolve: on resolve the lit tile is the same one (or, for an overruled read, the lit tile moves to the kind the model chose — the honest picture), and the other tiles fade exactly as today. The `magic-shimmer-once` pass on the lit tile plays when it first lights (i.e. at read start for a hinted read); that is accepted and documented in the header comment.
- **No new failure surface.** Every new line in the sheet is synchronous; every new line in the door runs before the existing `commit()`/`ingestInAppSource` boundary; every new line in the orchestrator runs inside `withIngestLock`'s existing `catch` (`reportError` + `ai.error.generic` toast). The two new model OUTCOMES (`none` under a hint, a different kind under a hint) are each given their own toast and event; there is no branch in which a hinted read ends without the user being told what happened, and no branch shows two toasts for one read. No new `try/catch` is needed and none is added.
- **`--tint-orange-10` does not exist.** `src/style.css` defines `--tint-orange-4/8/15` (each with a dark override). Use `--tint-orange-8`, which is also what `ChipButton`'s selected state uses.
- **Design note in `MagicBeansSheet.vue` (lines 6-24) and `magicDestinations.ts` ("the tiles never ask the user to choose")** must be rewritten, not left contradicting the code. The new note records that the tiles are now an OPTIONAL pick, explicit and per capture, and why that is not the positional hint #84 removed. The door test's "one list" comment (`MagicBeansDoor.test.ts:226`, still mentions `ChoiceModal`) is corrected in passing.
- **No shared tile component is extracted, by decision.** The sheet, overlay and banner each render `MAGIC_DESTINATIONS[kind].emoji` + `t(\`ai.capture.dest.${kind}\`)`inside three deliberately different containers (a toggle tile on a tint, a 16×16 resolve tile with a gradient lift, a white choice card on a tint panel). The shared thing is the DATA and the string key, and those are already shared; a component would be a`variant` prop wrapping two spans. Revisit only if a fourth surface appears.
- **`ai.capture.pick.title` and `ai.correct.action` read the same today ("Tell us what this is") and stay two keys, on purpose.** One is a heading over a group of tiles, the other is an inline action link at the foot of a review modal; they will be reworded independently and the translation pass treats them as different surfaces. Do not alias one to the other.
- **`ShareKindHint` is a duplicate of `ShareKind`** kept in step by the meter's tests; do not widen either here. `ShareKind` assigns to `ShareKindHint` structurally, so `source.hint` can be passed as `correction.to` with no cast.
- **Beanie-mode floor:** the two new outcome toasts (`ai.capture.pick.none.*`, `ai.capture.pick.overruled.*`) are important-surface copy exactly as `ai.correct.disagreed.*` is; their prefixes go on the floor list in `uiStrings.test.ts`. "beanies" and the kind nouns stay real nouns.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `managedProvider.ts` only puts `correction` on the wire when `request.correction.token` exists (verified 2026-09-25, `:491`). If that ever changes, a token-less hint would reach `meter.mjs` and be refused as `bad_correction`.
2. The managed kind guard is gated on `body.correctionFree` (verified, `:570`), so a hinted first read with a `none` or different-kind answer surfaces as a normal result, not as `correction_disagreed` / `malformed_output`.
3. `openaiCompatible.ts` passes `request.correction?.to` to the builder unconditionally and has NO kind guard of its own (verified: `correction` appears only at `:146-152`), so BYOK gets the hint and a `none` / different-kind answer surfaces as a normal result there too. Client-side handling in `runIngest` is therefore the only handling on every tier.
4. `onDeviceProvider` throws `not_available` for the `share` task; the pick has no effect there and the existing "not available" toast applies.
5. `isReaderEnabled` requires `canEditActivities` for every reader; the transactions reader (#107) will need its own permission rule, which lands with #107 through `MAGIC_READERS`, not here.
6. `BeanieFormModal` keeps focus inside the sheet; tiles are `<button type="button">` so keyboard users can tab to them and toggle with Enter/Space. Vue 3 renders `:aria-pressed="false"` as `aria-pressed="false"` (non-boolean attrs are coerced, not removed), which is what `ChipButton` and `TodoMemberFilter` rely on today.
7. `src/style.css` defines `--tint-orange-8` in both light and dark blocks (verified: lines 116 and 171).
8. `MagicBeansDoor.test.ts` already mocks `@/composables/useMagicReader` (line 18, `useMagicReader` only); the mock gains `availableShareKinds`. Its `MagicBeansSheet` stub declares `props: ['open']` and gains `'kinds'`. `MagicBeansSheet.test.ts` mocks only `useTranslation` and, with `kinds` as a prop, needs nothing more.
9. `sourceHash` hashes `request.source` only (verified, `managedProvider.ts:170-195`), so adding `reason` to `request.correction` cannot change the fingerprint a later correction must match. Requirement 12 depends on this.
10. Feature flags are reload-to-apply (`useMagicReader.ts` header: "read once at call time"); the door's `kinds` computed re-evaluates on a permission change within a session, and on the next load for a flag.

## Approach

Implements the approved mockup direction C (tappable tiles). Every token below is from `.claude/skills/beanies-theme/SKILL.md` / the CIG; the mockup's raw values were translated, not copied.

### 1. Shared availability helper (DRY)

`src/composables/useMagicReader.ts`: add

```ts
/** Kinds this member can be routed to right now — permission × flag — in tile order. */
export function availableShareKinds(): ShareKind[] {
  return MAGIC_DESTINATION_KINDS.filter((kind) => isReaderEnabled(readerForShareKind(kind)));
}
```

(`MAGIC_DESTINATION_KINDS` is imported from `@/constants/magicDestinations`; that module imports only a type from `@/types/magicPayload`, which `useMagicReader.ts` already imports, so there is no cycle.) `MagicMiscategorisedBanner.vue` `options` becomes `availableShareKinds().filter((k) => k !== props.from)`, its comment trimmed to the same-kind reason only. `MagicBeansDoor.vue` holds `const kinds = computed(availableShareKinds)` and passes it to the sheet (§3), so a permission change re-renders within the session (flags are reload-to-apply, as `useMagicReader` documents). One rule, two callers (banner, door); the sheet never calls it.

### 2. The sheet (`src/components/ai/MagicBeansSheet.vue`)

- Props: `open: boolean` (unchanged) and `kinds: ShareKind[]` — the tiles to draw, in order, already filtered by the door. The sheet renders exactly what it is given and asks no availability question of its own.
- State: `const pickedKind = ref<ShareKind | undefined>()`, reset to `undefined` in the existing `open` watcher alongside `text`.
- `togglePick(kind)`: `pickedKind.value = pickedKind.value === kind ? undefined : kind`.
- Emits change to carry the pick under ONE name: `submit: [text: string, hint?: ShareKind]`, `camera: [hint?: ShareKind]`, `file: [hint?: ShareKind]`. `handleSave` emits `(value, pickedKind.value)`. The two `AiSourceButtons` handlers become `@camera="emit('camera', pickedKind)"` / `@file="emit('file', pickedKind)"`. `undefined` is "no pick"; `null` never crosses this boundary.
- Template, replacing the static `<ul>`:
  - Header row: `<p class="font-outfit text-sm font-semibold text-[var(--color-text)] dark:text-ink">{{ t('ai.capture.pick.title') }}</p>` with `<span class="text-xs text-secondary-400 dark:text-ink-faint">{{ t('ai.capture.pick.optional') }}</span>` right-aligned.
  - `<div role="group" :aria-label="t('ai.capture.pick.title')" class="grid gap-2 grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))]">` (the same arbitrary-value utility `TravelPlansPage.vue` already uses for its card grid; `auto-fit`, not `auto-fill`, so three tiles fill the row with no empty track) with one `<button type="button" :aria-pressed="pickedKind === kind" @click="togglePick(kind)">` per kind in `kinds`. Classes: base `rounded-[14px] border-2 px-1.5 pt-2.5 pb-2 text-center transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#AED6F1] focus-visible:ring-offset-2` + unselected `border-transparent bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:bg-surface-overlay dark:hover:bg-surface-hover` + selected `border-primary-500 bg-[var(--tint-orange-8)] dark:border-accent-lift dark:bg-surface-hover` (the light tokens `ChipButton` ships; the dark background is the surface step above the tile's resting `surface-overlay`, with the accent's `-lift` partner on the border and label). Emoji span `aria-hidden="true"`; label `font-outfit mt-1.5 block text-xs font-semibold` + unselected `text-secondary-400 dark:text-ink-faint` / selected `text-primary-500 dark:text-accent-lift`. The selected/unselected class pairs are two `const` strings in `<script setup>` (`TILE_SELECTED`, `TILE_AT_REST`) bound with `:class`, so the template carries one binding rather than an inline ternary of two long class lists.
  - State line under the grid, one `<p class="font-outfit mt-2 text-xs font-semibold" :class="pickedKind ? 'text-primary-500 dark:text-accent-lift' : 'text-secondary-400 dark:text-ink-faint'">`: when picked, `{{ t(\`ai.capture.pick.as.${pickedKind}\`) }} {{ t('ai.capture.pick.undo') }}`as two interpolations (no string concatenation in code); otherwise`{{ t('ai.capture.pick.idle') }}`.
- Rewrite the file's design note (lines 6-24): the tiles are now an optional, explicit, per-capture pick; still never a mandatory "what IS this?"; still not a positional hint; the sheet draws the kinds the door gives it and does not gate.

### 3. The door (`src/components/ai/MagicBeansDoor.vue`)

- `const kinds = computed(availableShareKinds)` (import beside `useMagicReader`), passed as `:kinds="kinds"`.
- Replace the module `let pendingGrant: ConsentGrant | null` with ONE `let pending: { grant: ConsentGrant; hint?: ShareKind } | null`, so the grant and the hint are held and cleared as one value and cannot be half-cleared. `holdGrant(grant, hint)` → `pending = { grant, hint }`; `clearGrant()` → `pending = null` (the three clearing rules cover the hint by construction). `handlePickedFile` reads `const held = pending; clearGrant();`, keeps the existing expired-grant toast on `!held`, and passes `{ kind: 'file', file, hint: held.hint }` with `held.grant`.
- `handleCamera()` and `handleFile()` are byte-identical except the picker method and both gain a parameter, so they fold into one `commitToPicker(pick: 'pickCamera' | 'pickFile', hint?: ShareKind)`: `commit()` → `holdGrant(grant, hint)` → close sheet → `picker.value?.[pick]()`. The camera comment about the image-only `capture` input moves onto the `pickCamera` call site inside it.
- `handlePaste(text, hint?)` → `ingestInAppSource({ kind: 'paste', text, hint }, grant, destination())`.
- Template: `@submit="(text: string, hint?: ShareKind) => void handlePaste(text, hint)"`, `@camera="(hint?: ShareKind) => void commitToPicker('pickCamera', hint)"`, `@file="(hint?: ShareKind) => void commitToPicker('pickFile', hint)"`.

### 4. The orchestrator (`src/composables/useSharedDocumentIngest.ts`)

- `InAppInput` file and paste arms gain `hint?: ShareKind` (doc: "the kind the person stated in the sheet before the read; authoritative for the prompt, never sent to the meter").
- `ShareSource`: name the three FIRST-READ arms as `type FirstReadSource = ({ kind: 'documents'; … } | { kind: 'link'; … } | { kind: 'text'; … }) & { hint?: ShareKind }` and make `ShareSource = FirstReadSource | { kind: 'correction'; … }`. The hint is then declared once, the `correction` arm cannot carry it (it has `to`), and `sourceFromText` / `prepare` — which never produce a correction — return `FirstReadSource | null`, the type they always were. `inAppSource` attaches it in one place per arm: paste → `const source = await sourceFromText(input.text, IN_APP_ENV); return source && { ...source, hint: input.hint };` (this is what carries the hint onto a pasted LINK as well as text); file → `{ kind: 'documents', files: [stamped], hint: input.hint }`. The share path never sets it.
- `statedKind(source: ShareSource): ShareKind | undefined` — a module-level sibling of `sourceDetail`, `source.kind === 'correction' ? undefined : source.hint`, with the same header reason: the union is the discriminator, and this is written once. Both `read()` and `runIngest()` call it.
- `IngestState` reading arm gains `hint?: ShareKind` (the resolved arm does not need it: `kind` is the lit tile there). `withIngestLock`'s third parameter becomes an options object typed FROM the state so a new reading-time fact is declared once: `type ReadingFacts = Partial<Omit<Extract<IngestState, { phase: 'reading' }>, 'phase'>>`, default `{}`, `presentation` defaulting to `'global'` inside; it sets `ingestState.value = { phase: 'reading', presentation, hint }` from the first frame. The share call site passes nothing and is untouched.
- `ingestInAppSource`: read the hint off the input ONCE, before the lock — `const hint = input.kind === 'correction' ? undefined : input.hint;` — and use that local twice: in the lock's facts `{ presentation: destination ? 'local' : 'global', hint }`, and for the `hinted` event inside the run (beside the existing `corrected` event): `if (hint) logEvent({ level: 'info', surface: IN_APP_ENV.surface, message: 'the person told us what this is', context: { action: 'hinted', kind: hint } })`. This is the only place the hint is read off an `InAppInput` rather than a `ShareSource`, because the lock is taken before the source exists.
- `read()`: `const hint = statedKind(source);` then the hint is folded into the ONE `opts` object: `...(hint ? { correction: { to: hint, reason: 'stated' as const } } : {})`. Nothing else in `read()` changes: documents, text and the fetched-link page (via the shared `readText`) are all hinted through the same line, and the correction arm still spreads its own `correction` over `opts`. `correctableFrom(result)` is unchanged, so the banner works afterwards.
- Two module-level outcome helpers beside `refuseForQuota`, same shape (own `useToast`/`useTranslation`, one `logEvent`, one `showToast`), with a shared local `kindLabel = (t, k) => t(\`ai.capture.dest.${k}\`)`:
  - `hintDisagreed(env, hint)`: `logEvent({ level: 'info', …, message: 'the model could not read it as the stated kind', context: { action: 'hint_disagreed', kind: hint } })` and `showToast('info', t('ai.capture.pick.none.title'), fillTemplate(t('ai.capture.pick.none.message'), { kind: kindLabel(hint) }))`.
  - `hintOverruled(env, hint, actual)`: `logEvent({ level: 'warn', …, message: 'the model overruled the stated kind', context: { action: 'hint_overruled', kind: actual, detail: hint } })` and `showToast('info', t('ai.capture.pick.overruled.title'), fillTemplate(t('ai.capture.pick.overruled.message'), { picked: kindLabel(hint), actual: kindLabel(actual) }))`. `warn` because it is a prompt-not-honoured signal worth a filter, not a fault.
- `runIngest()`: `const hint = statedKind(source);`
  - `classified` gains `detail: source.kind === 'correction' ? 'corrected' : hint ? 'hinted' : 'unhinted'`.
  - The `none` branch becomes: `if (outcome.kind === 'none') { if (hint) hintDisagreed(env, hint); else showToast(…unrecognised…); return; }` — the existing toast line is unchanged.
  - The reader gate runs next, exactly as today (an overruled kind whose reader is off ends here, with `reader_disabled` and its one toast).
  - Immediately AFTER the reader gate and BEFORE the resolve hold: `if (hint && outcome.kind !== hint) hintOverruled(env, hint, outcome.kind);` then CONTINUE into the hold, claim and dispatch exactly as today — the bean is spent, the extraction is real, and "not right?" is at the foot of the modal that opens. Placing it after the gate is what makes the toast's promise true every time it is shown.

### 5. The prompt (three copies + types)

- `src/services/ai/types.ts` `ExtractionRequest.correction` and `src/services/ai/documentExtractionService.ts` `ExtractOptions.correction` gain `reason?: 'correction' | 'stated'` (absent = `'correction'`, so every existing caller is unchanged). Doc the two meanings on the request type; `documentExtractionService.ts:266` already spreads `opts.correction` into the request, so no other plumbing changes. `sourceHash` never reads `correction`, so the grant fingerprint is unaffected.
- `buildShareExtractionMessages(source, todayIso, kindHint?, hintReason = 'correction')` in all three copies. The reason selects ONE clause, not one of two sentences: a module-level `HINT_CONTEXT = { correction: ' An earlier reading got that wrong.', stated: '' }` (typed `Record<HintReason, string>` on the client), and the existing hinted system sentence becomes `The person who shared this has told us what it is: a ${kindHint}.${HINT_CONTEXT[hintReason]} Do NOT re-decide the category — set kind="${kindHint}" and extract the ${kindHint} fields. Only if the document contains nothing at all that could fill them, set kind="none".` The existing `kindHint ? … : …` ternary is untouched; no second ternary nests inside it. `correction` output is byte-identical to today; `stated` differs by that clause only. Both reasons share the rest of the hinted system message (so both drop the «"none" is always better than a wrong guess» rule) and the same user message. No runtime fallback on the lookup: an unknown reason is a compile error on the client, and the Lambda never passes one. The JSDoc above the builder is rewritten: `kindHint` is a kind the person STATED, either after seeing a wrong answer (`correction`, grant-backed on the managed tier) or before the first read (`stated`, billable); the positional-hint warning stays.
- `managedProvider.ts:463-469` and `openaiCompatible.ts:149-152` pass `request.correction?.reason` as the fourth builder argument.
- `ExtractionTaskEntry.buildMessages` (`extractionPrompt.ts:799-802`) gains the optional fourth parameter; the other three tasks ignore it, keeping one registry signature. The drift test's local `TaskEntry.buildMessages` type gains it too. Four positional parameters is the documented ceiling (see Notes).

### 6. The overlay (`src/components/ai/AiProcessingOverlay.vue`)

- Add `litKind()` = resolved kind, else `magicIngestState.value.phase === 'reading' ? magicIngestState.value.hint : null`. The three `resolvedKind() === kind` comparisons become `litKind() === kind`; `magic-tick` applies only when `!litKind()`; the spinner and the 30% exit opacity keep keying on `resolvedKind()` (as today). Header comment updated: a hinted read starts lit and resolves in place (or moves to the model's kind if it was overruled).

### 7. Strings (`src/services/translation/uiStrings.ts`, `en` + `beanie`)

- `ai.capture.pick.title`: "Tell us what this is" / "tell us what this is"
- `ai.capture.pick.optional`: "Optional" / "optional"
- `ai.capture.pick.idle`: "Pick one, or let beanies work it out." / "pick one, or let beanies work it out."
- `ai.capture.pick.as.event|travel|recipe`: "We'll read this as an activity." / "…as a trip." / "…as a recipe." (+ beanie lowercase). Keyed per kind so the article is right; item 6 on the `magicDestinations.ts` checklist.
- `ai.capture.pick.undo`: "Tap again to let beanies decide." / "tap again to let beanies decide."
- `ai.capture.pick.none.title`: "Beanies Couldn't Read It That Way" / "beanies couldn't read it that way"
- `ai.capture.pick.none.message`: `You picked "{kind}", but beanies couldn't find one in this. Hand it over again without a pick, or choose a different tile.` / `you picked "{kind}", but beanies couldn't find one in this. hand it over again without a pick, or choose a different tile.` (`{kind}` is the quoted tile name from `ai.capture.dest.*` — no article, correct for every kind and both casings.)
- `ai.capture.pick.overruled.title`: "Beanies Read It Differently" / "beanies read it differently"
- `ai.capture.pick.overruled.message`: `You picked "{picked}", but beanies read this as "{actual}". Check the details; Not right? is at the bottom if it's wrong.` / `you picked "{picked}", but beanies read this as "{actual}". check the details; not right? is at the bottom if it's wrong.`
- Add `'ai.capture.pick.none.'` and `'ai.capture.pick.overruled.'` to the important-surface prefix list in `uiStrings.test.ts` (beside `ai.correct.disagreed.`).
- Run `npm run translate` after adding keys (the parser is text-level).

### 8. Help Center

Two one-sentence updates (see Help Center Coverage). Bump `updatedDate` on both articles.

### 9. Tests

- `MagicBeansSheet.test.ts`: mount with `kinds: ['event', 'travel', 'recipe']` (no `useMagicReader` mock — the sheet no longer imports it); tiles render only the kinds given (a two-kind prop renders two); tap selects (`aria-pressed="true"`), second tap clears; reopen resets; `submit` carries `(text, hint)` and `(text, undefined)` when nothing is picked; camera/file emit the hint; state line switches.
- `MagicBeansDoor.test.ts`: the `useMagicReader` mock gains `availableShareKinds: () => [...]`; the `MagicBeansSheet` stub's `props` gains `'kinds'`; the door passes `kinds` to the sheet; the pick travels with a paste (`hint` on the input); the pick held for a picker is delivered with the file and cleared with the grant (extend the three existing stranded-grant tests to assert `hint` is gone too); "one list" comment corrected.
- `useSharedDocumentIngest.test.ts` (`ingestInAppSource (#84)` block): a hinted paste calls `extractShareFromText` with `correction: { to, reason: 'stated' }` and no `token`; a hinted paste of a URL reaches `extractShareFromText` hinted too (the link arm); `hinted` fires; `classified` carries `detail: 'hinted' | 'unhinted' | 'corrected'`; `none` under a hint shows the kind-specific toast and logs `hint_disagreed`; a different kind under a hint logs `hint_overruled`, toasts, AND still dispatches; a different kind under a hint whose reader is OFF logs `reader_disabled` only (one toast, no `hint_overruled`); `magicIngestState` is `{ phase: 'reading', hint }` from the first frame; unhinted behaviour is byte-identical to today.
- `useMagicReader.test.ts`: `availableShareKinds` filters on permission and flag.
- `MagicMiscategorisedBanner.test.ts`: still excludes `from` and disabled readers via the shared helper (its mock of `useMagicReader` gains `availableShareKinds`, built from the same `readersOn` switch it already has).
- `extractionPromptDrift.test.ts`: the hinted fixture loop runs for both reasons across the three copies; `stated` does not contain "earlier reading"; `correction` still does; `stated` also drops "is always better than a wrong guess"; the three-argument call still equals the explicit `'correction'` call (pins the Lambda's legacy arm).
- `AiProcessingOverlay`: no dedicated test exists (only incidental references in `MagicBeansSheet.test.ts` and `FamilyCookbookPage.keptRecipe.test.ts`); add a small one: a reading state with a hint lights that tile, ticks none, keeps the spinner; a resolved state behaves as today.

## Files Affected

- `src/components/ai/MagicBeansSheet.vue` — `kinds` prop, tappable tiles, pick state, emits carry `hint`, design note
- `src/components/ai/MagicBeansDoor.vue` — `kinds` computed from `availableShareKinds()`, one `pending` value (grant + hint), folded picker commit, carry the pick
- `src/components/ai/AiProcessingOverlay.vue` — `litKind()`, light the hinted tile from the start
- `src/components/ai/MagicMiscategorisedBanner.vue` — use `availableShareKinds()`
- `src/composables/useMagicReader.ts` — `availableShareKinds()`
- `src/composables/useSharedDocumentIngest.ts` — `hint` on `InAppInput` / `FirstReadSource` / reading `IngestState`; `statedKind()`; `withIngestLock` options typed from the state; one-line hinted `opts`; `hintDisagreed()` / `hintOverruled()` helpers; two one-line branches in `runIngest` (overruled after the reader gate); telemetry
- `src/services/ai/types.ts`, `src/services/ai/documentExtractionService.ts` — `reason` on `correction`
- `src/services/ai/extractionPrompt.ts`, `scripts/spikes/extractionPrompt.mjs`, `infrastructure/lambda/ai-extract/extractionPrompt.mjs` — `HINT_CONTEXT` clause (identical); registry signature
- `src/services/ai/providers/managedProvider.ts`, `src/services/ai/providers/openaiCompatible.ts` — pass the reason
- `src/constants/magicDestinations.ts` — checklist item 6 (`ai.capture.pick.as.<kind>`); note rewrite
- `src/services/translation/uiStrings.ts` — new `ai.capture.pick.*` keys (+ `npm run translate`); `uiStrings.test.ts` floor prefixes
- `src/content/help/features.ts` (share-to-beanies, `:1764`), `src/content/help/the-pod.ts` (cookbook shortcut box, `:551-556`) — one sentence each
- Tests listed in §9
- `docs/mockups/magic-beans-category-chips-2026-09-25.html` — already committed (direction C)
- `docs/plans/2026-09-25-magic-beans-category-preselect.md` — this plan

## Help Center Coverage

- **Action**: update existing · **Category**: features · **Slug**: `share-to-beanies` · **Title**: Share Something Straight to beanies · **Scope**: in the section that describes the in-app magic beans card, add one sentence: if you already know what you are handing over, tap its tile (activity, trip, recipe) before you read it; leave them alone and beanies works it out. · **Notes**: say the pick is optional and that "Not right?" still works afterwards.
- **Action**: update existing · **Category**: the-pod (cookbook article, "A shortcut from anywhere" info box) · **Scope**: one clause: "…tap the recipe tile first if you like, and beanies reads it as a recipe straight away."

## Observability Coverage

- **Events** (all on the existing surface `magic-beans-capture`, keys already allowlisted):
  - `action: 'hinted'`, `kind: <picked kind>`, `info`, at the start of a hinted in-app ingest (beside the existing `corrected` event, and like it, BEFORE triage — so it is the denominator including pastes that triage then refuses; `classified.detail = 'hinted'` is the post-triage count).
  - `action: 'classified'` gains `detail: 'hinted' | 'unhinted' | 'corrected'` (derived from the source), so "did the model return the stated kind" is `kind` vs the preceding `hinted.kind`, and the hinted share of reads is a filter on `detail`.
  - `action: 'hint_disagreed'`, `kind: <picked kind>`, `info`, when a hinted read returns `none` (a model outcome, not a fault). Emitted by `hintDisagreed()`.
  - `action: 'hint_overruled'`, `kind: <actual kind>`, `detail: <picked kind>`, `warn`, when a hinted read returns a different kind AND that kind's reader is open, so the result is delivered. `warn` so a rising rate is the first thing to look at before touching the prompt. Emitted by `hintOverruled()`, after the reader gate. When the overruled kind's reader is off, `reader_disabled` (already carrying `kind`) is the one event and one toast for that read; the preceding `classified(detail=hinted, kind=<actual>)` still shows it was a hinted read that came back different.
  - `action: 'hint_unused'`, `kind: <picked kind>`, `info`, when a pasted link answers WITHOUT the model (a schema.org JSON-LD page), so the pick was never consulted; the read is then classified `detail: 'unhinted'` and the person gets a one-line toast. A title-only link under a non-recipe pick returns `none` instead, so it reports as `hint_disagreed`. Added after code review round one.
  - Existing `failed` / `reader_disabled` / `ready` / `resolved` events fire unchanged, so a hinted read's funnel is complete.
- **Failure modes covered**: model ignores the hint (`hint_overruled`, and the user is told); model says none under a hint (`hint_disagreed`, and the user is told); provider error under a hint (`failed` after `hinted`, existing toast); a pasted link that resolves without the model (`resolved` with `extraction_path`, no hint applied, by design); a pick on an unavailable reader cannot happen (tiles are filtered) but if it did, `reader_disabled` still fires; anything thrown below the lock lands in `withIngestLock`'s existing `reportError` + toast. No new catch blocks; no silent fallback; no branch in which a hinted read ends without exactly one toast or a dispatch.
- **Success-path signal**: `ready` with `detail: <source>` after a `hinted` event gives the hinted conversion rate; compare the count of `hinted` to `corrected` per week to measure whether pre-selecting reduces corrections.
- **Critical vs telemetry**: nothing here is critical; no Slack page.
- **Privacy/store gate**: no new context key. `action`, `kind`, `detail` are already declared.

## Acceptance Criteria

- [ ] With nothing picked, a paste, photo or file behaves exactly as today (same events, same prompt, same toasts; `classified.detail` is `unhinted`).
- [ ] Tapping a tile selects it (orange on light, accent-lift on dark, `aria-pressed="true"`); tapping again clears it; reopening the sheet clears it.
- [ ] With "recipe" picked, an invitation PDF is read as a recipe attempt: the recipe reader opens with the extraction, OR the "couldn't read it that way" toast names "Recipe", OR the "read it differently" toast names both kinds and the activity reader opens; it is never silently reclassified, and never shows two toasts for one read.
- [ ] With "recipe" picked, a pasted recipe URL whose page has no JSON-LD is read hinted (the link arm carries the pick).
- [ ] A disabled or unpermitted reader's tile is not rendered (flag off → tile gone; member without canEditActivities never sees the sheet at all).
- [ ] Three tiles fill the row at 360px with no empty track; six tiles fit at 360px without truncated labels (verified with a temporary six-kind fixture in a screenshot harness, not committed).
- [ ] The managed tier is billed one read for a hinted read, issues a grant as usual, and "Not right?" still works afterwards; the wire body carries no `correction` field for a hinted first read.
- [ ] CloudWatch shows `hinted` → `classified(detail=hinted)` → `ready` for a hinted read that reached the model; a JSON-LD link under a pick shows `hinted` → `hint_unused` → `classified(detail=unhinted)` instead.
- [ ] Prompt drift test green for both hint reasons and for the three-argument legacy call; the `correction` reason's output is byte-identical to the pre-change prompt; `npm run test:lambda` green.
- [ ] Help Center article(s) listed in **Help Center Coverage** updated and verified to match the shipped behavior.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified.

## Testing Plan

1. `npm run validate` (type-check, lint, format, 8700+ unit tests, build) and `npm run test:lambda`.
2. Browser (Playwright harness under `scripts/design-screenshots/`, not `e2e/specs/`): open the sheet from the FAB at 360px and 1280px, light and dark; screenshot idle, picked, and the overlay during a hinted read (stub the provider). Confirm no horizontal scroll, three tiles edge to edge, and no truncated labels with the six-kind fixture; confirm the Sky Silk focus ring on keyboard focus.
3. Manual (greg): on the live managed tier, pick "trip", paste a flight confirmation email; the travel review opens; tap "Not right?" and confirm the free re-read is offered. Pick "recipe" and share an invitation photo; confirm either the kind-specific "couldn't read it that way" toast or the "read it differently" toast plus the activity review. Check CloudWatch for the `hinted` event and the matching `classified.detail`.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the approved mockup (direction C) and the verified prompt/meter path: reuse the correction hint channel token-less, add a hint reason to the three prompt copies, tappable tiles in the sheet, pick carried through door → orchestrator → provider, overlay pre-lit, kind-specific none toast, telemetry on the existing surface.
- **Pass 2 (DRY + error handling)**: fixed a non-existent `--tint-orange-10` token (→ `--tint-orange-8`, the same selected recipe `ChipButton` uses) and the focus ring (`ring-2`, per theme); corrected `ExtractOptions`' file; closed two silent paths — a hinted read returning a DIFFERENT kind (now `hint_overruled` warn + toast, still delivered) and a pasted LINK losing the pick (hint now on all three first-read `ShareSource` arms and folded into `opts` once in `read()`); door holds grant+hint as one value and folds the two identical picker handlers; `withIngestLock` takes an options object; `classified.detail` covers corrected reads too; new outcome toasts added to the beanie-floor list; recorded the decision not to extract a shared tile component.
- **Pass 3 (Sustainability)**: kept the sheet a pure view (`kinds` prop from the door, which already owns `useMagicReader`; no module mock in the sheet test); one noun and one representation for the pick (`hint`, `ShareKind | undefined`) from the emit down; `statedKind(source)` beside `sourceDetail` so the stated-kind rule is written once for `read()` and `runIngest()`; the two hinted outcomes became `hintDisagreed()` / `hintOverruled()` helpers in the file's existing log+toast shape so the spine gains two one-line branches, not two blocks; the prompt reason now selects one interpolated clause via `HINT_CONTEXT` instead of nesting a second ternary across three mirrored copies (and `correction` output is byte-identical by construction); `withIngestLock`'s options are typed from the reading arm of `IngestState` so a new fact is declared once; recorded four positional builder arguments as the ceiling and the two same-text string keys as deliberately separate.
- **Pass 4 (Fresh-eyes sweep)**: fixed two copy bugs before they shipped — the outcome toasts put "a" before a Title Case tile name ("a Activity"), so `{kind}` is now the quoted tile name; moved `hintOverruled` AFTER the reader gate so an overruled kind with its reader off gets one true toast (`reader_disabled`) instead of two, one of them false; `auto-fill` → `auto-fit` (three tiles left an empty fourth track at 360px) using the `grid-cols-[…]` utility the codebase already uses; corrected the `ChipButton` dark-token claim and the "flag toggle re-renders" claim (flags are reload-to-apply); the in-app hint is read off `InAppInput` once, not twice; named the first-read trio `FirstReadSource` so the hint intersection is declared once and `sourceFromText`/`prepare` return their honest type; pinned two verified facts as assumptions (`sourceHash` ignores `correction`, so requirement 12 holds; BYOK has no kind guard, so client handling is the only handling); noted the door test's sheet stub needs `kinds` in `props`.

## Prompt Log

> No GitHub issue created. This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial Prompt (beanies-pre-plan hand-off, tracker #108)

=== BEANIES PRE-PLAN === block as written back to Notion #108 on 2026-09-25 (Title, Type feature, Priority medium, Surfaces All / activities, travel plans, family cookbook, transactions, nook; Category AI / feature update / UI; Objective; User story; UX direction C approved; Mockup path; Scope; Out of scope; Acceptance criteria; Edge cases; Reuse hints; References; Notes; GitHub issue SKIP; Feature gate NO). Verbatim copy lives on the tracker row's `beanies-plan prompt` property.

### Follow-up 1 (greg, during pre-plan)

"once pre-plan is done move directly to /beanies-plan and mockup"

### Follow-up 2 (greg, mockup review)

"Let's go with C go ahead to /beanies-build-auto"

### Follow-up 3 (greg, copy)

"Rather than saying \"know what it is\" I think we should say \"tell us what this is\"" / "Since the user should obviously know, the ask is for the user to help out the AI by telling us in advance"

</details>
