# R3 — UI correctness, dark mode, i18n, copy, web security

> Reviewed commit: `af38fe75` — "feat(native): ask people to update, and give the block a way out"
> Plan under review: `docs/plans/2026-09-07-native-update-gate.md`
> Date: 2026-09-07

Scope: `FatalErrorOverlay.vue` (the extraction plus its two new pieces of chrome),
the changed confirm control in `ConfirmModal.vue`, the five new `appUpdate.*` keys,
`safeExternalHref` as the screen on both new link surfaces, keyboard/focus behaviour,
and a line-by-line fidelity diff of the extraction.

**Three findings. None of them is in the security screening, and none blocks the
feature.** The most substantive one is a performance regression that the extraction
introduced by accident, and it is not on the update path at all — it is on every
render of the app.

---

## Findings

### F1 — Medium — the extraction made device diagnostics run on every root render

**Where:** `src/App.vue:1875` (`:diagnostics="getDeviceDiagnostics()"`), against
`src/components/common/FatalErrorOverlay.vue:59` (`v-if="message"`).

**What is wrong.** Before the commit, the diagnostics call sat at
`src/App.vue:1943` (pre-commit revision), inside `<div v-if="initError">` opened at
`:1850`. A `v-if` that is false never evaluates the expressions inside it, so the call
ran only while the recovery screen was actually on screen.

After the commit the `v-if` moved _inside_ the component, so `<FatalErrorOverlay>` is
now an unconditional child of the root template and its props are evaluated on every
`App.vue` re-render — fatal or no fatal.

That expression is not cheap. `getDeviceDiagnostics` is `formatDeviceInfo`
(`src/App.vue:1591`), which calls `getDeviceInfo()` (`src/utils/diagnostics.ts:57-67`),
which calls `storageWorks()` twice (`src/utils/diagnostics.ts:36-55`). Each call does a
real write/read/delete round-trip:

```ts
area.setItem(probeKey, '1');
return area.getItem(probeKey) === '1';
// finally: area.removeItem(probeKey)
```

So **six synchronous Web Storage operations, on the main thread, on every re-render of
the app's root component** — and the root template re-renders on route changes, toast
pushes, the offline banner, sidebar toggles, and the boot transition.

**Concrete consequence.** Two, and the second is the nastier one:

1. Blocking `localStorage`/`sessionStorage` round-trips added to the critical path of
   every navigation, to produce a string that is displayed only on a screen almost
   nobody ever sees. On low-end Android and in a WKWebView these are not free.
2. On a device where Web Storage is blocked or throwing — iOS Safari private mode,
   blocked cookies, quota exhaustion, which is exactly the population this diagnostic
   exists to serve — `storageWorks` logs `console.warn('[diagnostics] storage probe
failed', e)` (`src/utils/diagnostics.ts:52`) on each failed probe. That is now two
   warnings per root render, forever, instead of two per fatal screen.

This also quietly contradicts the commit message's "the markup is a verbatim move":
the markup is, but the _evaluation site_ of one binding is not.

**Suggested fix.** Keep the expression behind the same condition it used to be behind.
In `App.vue`:

```ts
const fatalDiagnostics = computed(() => (initError.value ? getDeviceDiagnostics() : ''));
```

and bind `:diagnostics="fatalDiagnostics"`. (Inlining `initError ? … : ''` at the
binding works too but re-runs on every render of the ternary's dependency; a computed
memoises on `initError`.) An equally clean alternative is to drop the prop and let
`FatalErrorOverlay` call `formatDeviceInfo()` itself inside the `v-if`, which is
arguably where it belongs — the component already imports nothing else from `App.vue`.

---

### F2 — Medium — the new prompt's "Not now" renders as "Buy Now" in Chinese

**Where:** `public/translations/zh.json:22794-22797`.

```json
"appUpdate.prompt.notNow": {
  "translation": "立即购买",
```

**What is wrong.** `立即购买` means "Buy now" / "Purchase immediately". The English is
"Not now" (`src/services/translation/uiStrings.ts:4406-4409`). It is a mistranslation,
not a register choice.

**Concrete consequence.** On a Chinese-language device the new update prompt renders
with a Heritage Orange **更新** ("Update") confirm and a **立即购买** ("Buy Now")
dismiss. A person trying to postpone the update is offered what reads as a purchase
button; beanies sells nothing, so the copy is both wrong and alarming — and it sits on
the one modal whose whole job is to be trusted enough that people act on it later.

**This is pre-existing corpus damage that the commit propagates, not damage it
introduces.** The zh file keys translations by a hash of the `en` string, and "Not now"
appears five times with the same hash `8bjtp3`, all carrying the same bad value:
`trust.notNow` (`:2459`), `pwa.installDismiss` (`:2984`), `passkey.promptDecline`
(`:3124`), `communityNudge.snooze` (`:15439`), and now `appUpdate.prompt.notNow`. So
the new key inherited it automatically.

**Suggested fix.** Correct all five occurrences to `暂不` or `以后再说`, and add "Not
now" to the translation pipeline's glossary/override set so `npm run translate` stops
regenerating it (see `docs/TRANSLATION.md`). Fixing only the new key would leave four
identical live defects and the next regenerate would undo it.

---

### F3 — Low — the three new Chinese strings capitalise the brand name

**Where:** `public/translations/zh.json:22780` (`更新Beanies`), `:22785`
(`有较新版本的Beanies可供选择…`), `:22800` (`更新Beanies`).

**What is wrong.** The brand rule is "always lowercase" (`CLAUDE.md` § Brand Identity
and § Terminology Guide: `beanies.family`, never `Beanies`). The zh corpus mostly
honours it — 123 lowercase `beanies` against 15 capitalised, and 3 of those 15 are new
here.

**Concrete consequence.** It is visible _within a single flow_. The overlay message a
Chinese user sees when their file is refused is `podAccess.error.newerVersion`
(`public/translations/zh.json:22755`), which renders lowercase `beanies` twice; the
button and prompt title directly above it now render `Beanies`. The same product name
is spelled two ways on one screen.

**Suggested fix.** Lowercase the brand token in those three values, and — as with F2 —
pin it in the pipeline glossary so the regenerate does not re-capitalise it.

---

## Fidelity of the extraction

The task asked for _any_ difference that is not a pure binding rename. Comparing
`git show af38fe75^:src/App.vue` lines 1848-1947 against
`src/components/common/FatalErrorOverlay.vue`, the complete list is four items. A
mechanical diff of every `class="…"` attribute across the two revisions produces
exactly three lines of difference, which is the evidence for items 2-4 below.

1. **`showClearConfirm` moved and its reset changed shape.** Was a `ref` in `App.vue`
   reset by one line inside the store watcher (`App.vue:219`, pre-commit), which only
   fired `if (msg)`. Is now local to the component
   (`FatalErrorOverlay.vue:47-53`) and reset by `watch(() => props.message, …)`, which
   also fires on message → `null`. **Not a defect** — closing a destructive panel as
   the overlay disappears is strictly safer, and the behaviour on a new fatal is
   identical. Tested at `FatalErrorOverlay.test.ts:113-125`.

2. **The Reload button's class became a ternary** (`FatalErrorOverlay.vue:110-114`).
   The false branch is byte-identical to the class it replaced. When the fatal carries
   an action, Reload demotes to the bordered secondary (the exact class string the
   Clear-data button already used, dark partners and all) so there is one orange
   control. **Not a defect, but it is a deviation from the plan**: R3.3 (`plan:103`)
   specified inserting the anchor "at the head of the existing action row" and said
   nothing about restyling Reload. It is documented in a comment
   (`FatalErrorOverlay.vue:94-98`) and pinned by a test
   (`FatalErrorOverlay.test.ts:78-86`), and it is the better call.

3. **The anchor is new markup** (`:100-108`) — expected, this is R3.3.

4. **The URL caption is new markup** (`:133-138`) — expected, this is R3.4. It is
   `mt-1 mb-4` where the plan wrote `mt-1`; the preceding row's `mb-4` collapses with
   it, so the visible gap is the same 16px either way. Cosmetic, no consequence.

**No dark-mode class was lost.** Every `dark:` utility present in the `App.vue` block
survives verbatim: `dark:bg-surface-raised`, `dark:bg-orange-900/30`, `dark:text-white`,
`dark:text-ink-soft` (×4), `dark:text-danger-lift`, `dark:border-line-strong`,
`dark:text-ink`, `dark:hover:bg-surface-hover` (×2), `dark:border-orange-700`,
`dark:bg-orange-900/20`, `dark:text-accent-lift`, `dark:hover:text-ink`,
`dark:bg-surface-ground` (×2). Also unchanged: every `v-if` condition
(`clearDataHelps` ×2, `showClearConfirm && clearDataHelps`, `detail`), the ordering of
the message slab / action row / clear-confirm panel / disclosure, and the `z-[300]`
scrim.

---

## Verified correct

**Dark mode — the two new pieces of chrome.**

- The anchor (`FatalErrorOverlay.vue:100-108`) paints `bg-[#F15D22]` with `text-white`
  and no dark partner, and that is right, not an omission: it is the sanctioned filled
  primary in both modes (`.claude/skills/beanies-theme/SKILL.md:474` —
  `BaseButton (primary): bg-[#F15D22] … text-white`; `:79` — "Filled buttons keep true
  `primary-500` with white"). It is also the exact pair the Reload button has always
  used on this screen, so the two cannot drift.
- The URL caption (`:133-138`) is `text-gray-500` with an explicit `dark:text-ink-soft`
  partner. `--color-ink-soft` is `#c3ced6` (`packages/brand/theme.css:121`), measured at
  9.11 on `surface-raised` (`theme.css:102`) — the surface the panel actually paints
  (`:62`). No raw grey ramp under `dark:`, no opacity modifier on readable text,
  `text-xs` is the documented floor.
- The demoted Reload (`:110-114`) carries `dark:border-line-strong dark:text-ink
dark:hover:bg-surface-hover` — all three real tokens (`theme.css:124`, `:120`,
  `:112`).
- The scrim `bg-[#2C3E50]` (`:60`) is deliberately mode-invariant Deep Slate; it is
  pre-existing and correct. It does **not** make the panel's tokens moot, because the
  panel above it is `bg-white dark:bg-surface-raised` — every string inside is read
  against a surface that genuinely swaps, which is why the token audit above matters.

**Dark mode — `ConfirmModal`'s changed control.** The `class` and `:class` bindings on
the confirm control are untouched by the commit (they appear as context in the diff,
`ConfirmModal.vue:92-97`). No background, string, or accent is added or altered — only
the element type and four attribute bindings. Nothing to fix in this dimension.

**i18n.** All five keys are present in `src/services/translation/uiStrings.ts:4394-4415`
with both `en` and `beanie`, and match the plan's copy word for word. The `beanie`
register is correct: identical words, all lowercase, and — per the explicit instruction
carried into `plan:176` — no bean or pod euphemism anywhere (`'update beanies'`,
`'a newer version of beanies is available. update to stay in step with your family.'`,
`'update'`, `'not now'`). All five keys are present in `public/translations/zh.json`
(F2 and F3 are about the _values_, not their presence).

No user-visible string is hardcoded on any of the three new surfaces:

- `FatalErrorOverlay.vue` routes every string through `t()`, including the action label
  via `t(action.labelKey)` (`:107`), where `labelKey` is typed `UIStringKey`
  (`fatalErrorStore.ts:25`) — so a non-key cannot reach it.
- `useAppUpdate.ts` passes only `UIStringKey`s to `confirm()` (`:135-138`); its other
  strings are `logEvent` `message`/`context` fields, which are diagnostics, not UI.
- `versionPolicy.ts` renders nothing at all.
- The floor file's `reason` string (`web/public/min-app-version.json:3`) is genuinely
  never rendered: `FloorFile` declares only `promptBelowVersion`
  (`versionPolicy.ts:36-38`) and nothing reads `reason` off the parsed body. This was
  the i18n hazard the plan called out at `:58`, and it is closed.
- `src/content/help/how-it-works.ts:41-46` adds a bare-English paragraph, which is
  consistent with the entire `src/content/help/**` corpus and outside both i18n lint
  zones (`src/constants/**` + `src/composables/**` for `.ts`, `.vue` templates for the
  template rule). Accepted, not a new violation.

`npx eslint` on the four changed/new UI files reports zero errors (one pre-existing
`security/detect-object-injection` warning in `useAppUpdate.ts:40`).

**Security of the new link surfaces.** `safeExternalHref`
(`src/utils/url.ts:161-163` → `parseSafeUrl`, `:119-144`) holds. I ran the screen's
exact logic against the hostile set:

| input                      | result                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `javascript:alert(1)`      | `null` (becomes `https://javascript:alert(1)`, invalid port, throws) |
| `javascript://%0aalert(1)` | `null` (has `://`, protocol not allowlisted)                         |
| `data:text/html,<script>…` | `null`                                                               |
| `vbscript://x`             | `null`                                                               |
| `jaVAscript:alert(1)`      | `null` (the `://` probe is case-insensitive)                         |
| `  javascript:alert(1)  `  | `null` (trimmed first, `:123`)                                       |
| `https://user:pass@x.com`  | `null` (credentials rejected, `:142`)                                |
| `//evil.com/x`             | `https://evil.com/x` — a scheme-safe upgrade, never script           |

So no `javascript:`, `data:`, or `vbscript:` value can reach an `href` on either
surface. A protocol-relative value is upgraded to `https:` rather than rejected, which
is by design (`:126-133`) and harmless here since both callers pass a frozen constant
from `packages/brand/nav.ts:52-55`. Both surfaces screen before rendering:
`App.vue:227` (`fatalActionHref`) and `ConfirmModal.vue:17` (`safeConfirmHref`), and
both `v-if`/`:is` on the _screened_ value, so a rejected URL renders no anchor at all —
pinned at `FatalErrorOverlay.test.ts:88-94` and `ConfirmModal.test.ts:86-95`.

`rel="noopener noreferrer"` accompanies `target="_blank"` on both: static on the
overlay anchor (`FatalErrorOverlay.vue:103-104`), bound on the same condition as the
href in the modal (`ConfirmModal.vue:90-91`).

**No attribute leaks across the `<component :is>` swap.** Vue removes attributes bound
to `undefined`, and both directions are explicitly bound that way:
`:type="safeConfirmHref ? undefined : 'button'"` (`:88`) and `:href="safeConfirmHref"`
(`:89`, `undefined` in the button case because the computed ends `?? undefined`,
`:17`). Asserted in both directions — `ConfirmModal.test.ts:57-59` (button: no `href`,
`type="button"`) and `:67-70` (anchor: `href`/`target`/`rel`). Even had `type` leaked
onto the `<a>` it would be inert, but it does not.

**The promise always resolves.** `@click="handleConfirm"` is on the element regardless
of which tag it becomes (`ConfirmModal.vue:98`), and `handleConfirm`
(`useConfirm.ts:101-105`) resolves `true` and closes before the browser performs the
anchor's default navigation. Pinned at `ConfirmModal.test.ts:71-72`. Cancel still
resolves `false` with an href present (`:97-103`). There is no path where the anchor
swap leaves `confirm()` hanging.

**Accessibility.**

- The anchor is keyboard reachable: it is an `<a>` with a real `href`, so it is in the
  tab order by default. Enter activates it (Space does not, which is correct link
  semantics, and the URL caption below is the redundant path).
- It has a visible focus state — the UA default ring. There is no global focus reset in
  this codebase: the only `outline: none` in `src/style.css` is at `:513`, scoped to the
  `.beanies-input` class. So the anchor has exactly the same focus affordance as the
  buttons beside it. No regression, though the whole screen inherits the app's existing
  reliance on UA defaults.
- **The element swap cannot break a focus trap, because `BaseModal` has none.** It
  implements `role="dialog"` + `aria-modal="true"` (`BaseModal.vue:95-96`) and
  `useFullscreenOverlay`, which is Escape-close + body-scroll-lock only
  (`useFullscreenOverlay.ts:29-32`) — no `focus()`, no `tabindex`, no keydown trap
  anywhere in the file. Escape close is keyed on `state.open` → `handleCancel`
  (`ConfirmModal.vue:22-27`) and the scroll lock on the same flag, neither of which the
  swap touches. Focus order is unchanged: the anchor occupies the identical position in
  the footer row.
- The overlay anchor's label is real text (`t(action.labelKey)`), so no `aria-label` is
  needed, and the duplicated URL caption beneath is intentional (`:128-132`).

**One thing I checked and could not fault, worth recording.** `ConfirmModal` renders at
`z-[250]` (`BaseModal.vue:36`, `layer="top"`) and `FatalErrorOverlay` at `z-[300]`
(`:60`), so an update prompt raised while a fatal is on screen would be an invisible,
undismissable modal holding `hasOpenOverlays()` true for the session. It is not
reachable today: `canPrompt` gates on `isLoaded()` (`useAppUpdate.ts:109`), and every
`surfacePayloadFatal` call site is a boot/login/resume path with no document loaded
(`App.vue:600`, `ResumePodSetup.vue:320`, `useLoginFlow.ts:1008`) — `syncStore.ts:3539`
states the invariant outright. The plan reasoned about this at `plan:428`. Flagging it
only because the `resume` listener (`useAppUpdate.ts:169-171`) re-asks the gates on
every foreground, so if a fatal ever becomes raisable post-load the failure mode is
silent.
