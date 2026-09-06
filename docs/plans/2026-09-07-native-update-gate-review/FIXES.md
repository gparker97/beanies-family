# What the review found, and what was done about it

> Reviewed commit: `af38fe75`. Fixes landed in the follow-up commit on the same day.
> Four reviewers, four dimensions, fresh context each. Reports: R1-R4 in this directory.

The reviewers agreed on more than they disagreed on, and the overlap is worth naming:
**three of the four independently found the same two defects** (the diagnostics call and
the gated caption), and two independently found the launch-time race. A finding two
strangers reach separately is a different kind of evidence from one that needs arguing
for.

Two of the confirmed defects were introduced by the `FatalErrorOverlay` extraction
itself, which is the honest cost of that decision and is recorded as such below.

---

## Fixed

### 1. The prompt would almost never have fired (R1-2, R2-3, R4)

`checkForUpdate()` resolves in a couple of hundred milliseconds. `isLoaded()` stays
false for seconds while the family document loads. So the launch evaluation reliably
found the boot gate shut, and `App.addListener('resume', ...)` was the only other
trigger: **a person who opens beanies and closes it was never asked.**

The worst part is that it was invisible. `checked` would keep reporting `behind=true`
across the fleet with a near-zero `prompted` rate, which reads as "rarely interrupts
anyone" and is in fact "never asks anyone".

Fixed with `watch([docVersion, isOnline], ...)` inside the existing scope.
`docVersion` is bumped by the same hook that flips `loaded` true, so the first bump IS
"the document is here". Pinned by a test that keeps `docVersion` a real ref, because a
stubbed number would make the watcher fire never, which is the defect.

### 2. `canPrompt` suppressed silently, five ways (R2-3)

Against `CLAUDE.md`'s first observability rule: log the decision, not just the crash.
`maybePrompt` now emits `prompt-deferred` carrying the first closed gate
(`offline` / `busy` / `booting`), **once per reason per session**. Bounded on purpose:
every gate is re-checked on resume and on every document change, so an unbounded event
would be a flood from exactly the devices with something to say. Three rows is the
whole budget and it is enough to make a quiet fleet explicable.

### 3. `getDeviceDiagnostics()` ran on every root render (R1-1, R3-1)

**Introduced by the extraction.** The call used to sit inside `v-if="initError"`;
moving the `v-if` into the component left it in an unconditional prop expression. It is
not cheap: `getDeviceInfo` probes storage with real `setItem`/`getItem`/`removeItem`
round-trips against both `localStorage` and `sessionStorage`, and on a device with
blocked storage it also emits two `console.warn`s per render. `App.vue` re-renders on
every navigation, breakpoint change and auth change.

Now a `computed` that reads `initError` first, so it costs nothing until the one moment
it is needed.

### 4. The block screen could still become a dead end (R1-6, R2-1, R4)

The URL caption was gated on `actionHref`, the _screened_ value, and printed it. So a
URL that failed screening removed the link **and** the address, in exactly the case
where a person who cannot use the app at all had nothing left to act on. Meanwhile
`blocked` was already logged, so CloudWatch would have recorded "we gave them a way
out" for every device that got none.

The caption now prints `action.url` and is gated on the action alone. Screening decides
whether the browser may follow an address; it does not decide whether a person stuck
behind a block may read it.

### 5. A double tap started two sign-outs (R1-4)

**Introduced by the extraction.** `showClearConfirm.value = false` was the first line of
`handleClearDataAndSignOut`; the move dropped it, and the component's watcher did not
fire in its place. Clearing the family database takes real time and the panel stayed on
screen for all of it. A `confirmClearData()` now closes before it emits.

### 6. The panel survived a new fatal with the same message (R1-5)

**Introduced by the extraction.** `App.vue`'s watcher reset on the whole
`[message, detail, clearDataHelps]` tuple; the component watched `message` alone. Two
failures can carry the same sentence and different detail. Now watches the tuple.

### 7. The floor's error classifier would have misled triage (R2-2)

Any unrecognised throw fell through to `malformed` — the class that means "the JSON we
hand-deployed is wrong", a person's mistake with a person's fix. But **iOS surfaces
`localizedDescription`, whose timeout reads "The request timed out."** — "timed out",
not "timeout" — and matched none of the patterns. With 3-second timeouts on mobile, an
entirely routine network class would have shown up in CloudWatch as a broken file. The
shipped test passed only because it used a synthetic string no platform produces.

`classify()` now matches generously, returns `unknown` rather than guessing, and keeps
`malformed` for the one throw that really is ours (`JSON.parse`, via `SyntaxError`). The
test now pins the real strings from both platforms.

### 8. `payloadFailureSurface.ts` imported a composable (R1-3, R4)

Six lines above a comment saying it must not, and against the plan's own criterion. The
measured cost today was small, but Phase B puts the Play adapter in that composable and
the app's single payload chokepoint would have pulled a native plugin into its graph.
`storeUrlFor` now lives in `src/services/appUpdate/storeUrl.ts`, which imports one
constant and one type.

### 9. `blocked` was counted for the button, not the block (R1-9, R2-4)

Gated on `storeUrl` being non-null, so every web version-block was invisible on the
`app-update` surface — the half of the fleet where "how often does this actually
happen" would have been answered. Now fires for every `needs-update`, with
`detail: store-link | no-store-link` keeping the populations separable.

### 10. `compareAppVersions` was called twice (R1-7)

Against the plan's own "one question, asked once". Now one call, and the two answers
read off it.

### 11. The comparison could be WRONG, not just undecided (R1-8)

`'0.09'` silently equalled `'0.9'` (leading zero), and seventeen-digit fields compared
equal past `Number`'s exact range. Both are plausible typos in a hand-edited file, and
both produced a confident wrong answer rather than the `null` every caller handles. Each
field is now `0` or an unpadded number of at most six digits.

### 12. Two failures shared one CloudWatch bucket (R2-5)

The composable emitted `unparseable-version`, the floor file's class. But `versionPolicy`
already screens the floor with the same grammar, so reaching that branch means
`APP_VERSION` **itself** does not parse: a bad constant in a shipped build, silencing
the prompt fleet-wide, fixed in a completely different file. Now
`app-version-unparseable`, and the event's shape is exported from `versionPolicy.ts` so
the two sites cannot drift.

### 13. "Not now" said "Buy Now" in Chinese (R3-2, R4)

`立即购买` = "Buy Now", on the dismiss button of an update prompt. Pre-existing corpus
damage, shared by hash across **five** keys — `trust.notNow`, `pwa.installDismiss`,
`passkey.promptDecline`, `communityNudge.snooze` and the new
`appUpdate.prompt.notNow`. All five now read `以后再说`. Out of this change's scope
strictly speaking, and fixed anyway: shipping a new prompt whose decline button offers
to sell you something is not a defensible place to draw a scope line.

### 14. Brand casing in Chinese (R3-3)

15 zh strings rendered `Beanies` against 107 rendering `beanies`. All 15 corrected;
the rule is unconditional.

### 15. Two tests that asserted nothing (R4)

The `fatalErrorStore` invariant test used a guarded `expect` that ran in one of its
three steps. Rewritten as an explicit implication. And Testing Plan #3's direct
`isAppQuiet()` case did not exist, so the `catch` that the whole verbatim-move rule
exists to protect had no assertion behind it — `src/utils/__tests__/appQuiet.test.ts`
now covers it.

---

## Not changed, deliberately

- **The `FatalErrorOverlay` extraction stands.** The plan contradicted itself: R3.3 says
  "no new component", Testing Plan #7 demands a mounted overlay test, and that test is
  unsatisfiable while the markup lives in `App.vue`. R4 diffed the moved markup and found
  it character-identical. It cost two of the defects above, both now fixed, and bought 13
  mounted assertions on a screen that previously had none.
- **Reload demoting to secondary when an action is present** (R3's fidelity note) is not
  a deviation: R3.3 specifies it, and the no-action branch is byte-identical.
- **`.catch(() => undefined)` on the listener removal.** Plan-prescribed, matches
  `iosShareAdapter.ts`, and the only reachable failure is a plugin teardown race.
- **Accept is still inferred from the absence of a dismissal.** An `accepted` event would
  claim the person reached the store, which a link click cannot know.

## Still owed, and none of it is CI-checkable

The three manual proofs the plan named, all greg's to run on a device:

1. The floor must be proven to **LOAD** — a `checked` event carrying a real `floor=`.
   Failing open on a CORS refusal looks exactly like a healthy fleet.
2. The store handoff, tapped on both platforms.
3. The force path, with a hand-edited file.

Plus the operational step: the floor file only exists once the Astro site is deployed,
and `promptBelowVersion` should only be raised once the new build is live on **both**
stores. Runbook § 7.
