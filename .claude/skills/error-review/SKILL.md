---
name: error-review
description: Triage a production error report from `#beanies-errors` Slack — parse the alert, load the relevant code, decide if it's genuine signal or noise, and propose a structural fix either way. Use this whenever greg pastes a Slack error blob OR invokes `/error-review`.
---

# error-review — Production Error Triage

The auto-error reporter (commit `2950638`) fires structured Slack alerts to `#beanies-errors` for every caught error in the app — `showToast('error')`, Vue render exceptions, unhandled JS errors, unhandled promise rejections. This skill is the standardized triage workflow for those alerts.

The skill exists because the cost of treating noise as a real bug (over-fixing, churn) and the cost of treating a real bug as noise (users hit it, we don't act) are both high, and the right answer requires consistent surface-area review every time. Freestyling each triage drifts.

---

## When to Invoke

- **Via slash command**: `/error-review` followed by the pasted Slack alert blob
- **Proactively**: when greg pastes a Slack error message into the chat, even without invoking the slash command — recognise the shape (`:rotating_light:`, "beanies error", `Surface:`, `Stack:`, `Context:` fields, or a fenced code block with that structure) and run this workflow

---

## Workflow

### Step 1: Parse the alert into structured fields

Pull these out of the pasted blob:

- **Surface** (e.g. `unhandled-promise-rejection`, `vue-error-handler`, `join-flow:INVITE_TOKEN_INVALID`, page name)
- **Family** (id-tail + name) — useful only for cross-referencing if the same family hits repeated errors
- **Time** (UTC) — note time-of-day patterns
- **Build SHA** — load-bearing; if the user is on a stale SHA we may already have shipped a fix
- **Message** — the Error.message string
- **Stack** — full stack trace
- **Context** — every key/value (provider_type, save_failure_level, online, connection_type, browser UA, etc.)
- **Repeat count** — if there's a `🔁 fired N more times in 60s` line, capture it

State each parsed field back briefly so greg can sanity-check that nothing was misread.

### Step 2: Locate the source

Based on the surface, find the calling code. Run these in parallel:

| Surface shape | How to locate the source |
| --- | --- |
| `unhandled-promise-rejection` | Read `src/main.ts` global handler. Then grep the message text against the codebase to find the un-caught `.then()`/`await` call site. Stack trace usually points at the leaking line. |
| `vue-error-handler` | Read `src/main.ts` Vue handler. Stack frame names the component. |
| Named surface like `join-flow:CODE` | Grep the literal code (e.g. `INVITE_TOKEN_INVALID`) — usually lands on the `JOIN_ERRORS` registry in `src/composables/useJoinFlow.ts`. |
| Page-name surface (e.g. `accounts`, `meet-the-beans`) | Grep `surface: '<name>'` in `src/pages/` and `src/components/`. |
| Message contains `[some-prefix]` | Grep the literal `[some-prefix]` — that's the calling module logging itself with a prefix. |
| Toast surface | Grep `showToast('error',` to find toast call sites; cross-reference with the message. |

If multiple call sites match, look at the stack frames and the context fields (e.g. `provider_type`, route hint) to narrow down.

### Step 3: Build SHA freshness check

```bash
git log --oneline -20
git log --oneline <build-sha>..HEAD 2>/dev/null | head -10
```

- If the build SHA is HEAD or close: error reflects current code.
- If commits exist between the build SHA and HEAD that touch the surface area: a fix may have already shipped — note it. Skip ahead to "did we already fix this?" verification before proposing more work.
- If the user is many builds behind: errors from old code are still informative (existing users still on that build hit it) but the priority is lower if it's already fixed in HEAD.

### Step 4: Apply the triage checklist

Answer each in order. Annotate the answer with the evidence (code line, stack frame, context field).

| Question | Noise indicator | Genuine indicator |
| --- | --- | --- |
| **A. Whose code is the originating frame?** | Browser platform (SW lifecycle, ResizeObserver, IndexedDB internals), third-party SDK internals (gapi, gsi, google.picker) | Our code path — anything in `src/` |
| **B. Is the error message a known browser quirk?** | "Failed to update a ServiceWorker", "ResizeObserver loop limit", "AbortError: aborted by user", "NetworkError when attempting to fetch" during navigation | Concrete app-level message, often with our `[prefix]` |
| **C. Was there user-visible impact?** | Background-only (telemetry, periodic poll, prefetch). `save_failure_level: none`. No toast actually shown. | Toast was shown to user (`vue-error-handler` / `error.<name>` keys). Save failed (`save_failure_level: warning`/`critical`). Drive file not found. Auth flow stuck. |
| **D. Repeat shape?** | Single firing or repeat-count from one family — usually a one-environment quirk | Same surface firing across multiple families/sessions over time — systemic |
| **E. Build correlation?** | Error existed for builds before the most recent change to that surface | Surface area has a recent commit; error appeared after that deploy |
| **F. Recover-and-continue?** | The next attempt would succeed (transient network, idempotent retry) | The error blocks a flow until the user takes specific action |
| **G. Already a known noise pattern?** | Match against the `Known noise patterns` memory entry (see Memory section below). | Not in the known list |

### Step 5: Verdict

After working through the checklist, commit to one of three verdicts:

- **NOISE** — a transient, browser-platform, or third-party signal that fires routinely under normal use and has no user impact. Flowed to Slack only because we forgot to catch it at the source.
- **GENUINE** — actual app behavior is wrong; users are or will be affected. Needs a code fix.
- **AMBIGUOUS** — checklist is split. Need more data: another firing, a repro, or a quick instrumented log. Note exactly what would tip the verdict.

State the verdict explicitly with one sentence of justification — not a paragraph. The justification should reference specific checklist answers.

### Step 6: Propose the action

#### If NOISE — structural fix, never "ignore"

Noise that reaches Slack is a code defect: we forgot to catch a transient at the source. The fix is **always** structural so it can't reappear. Pick the right pattern:

1. **Catch at the call site** with a `.catch()` (or `try/catch` for `await`) that logs `[<module>] <action> failed (transient): <Error>` to the console and does NOT promote to the error reporter. Compliant with the no-silent-failures rule (caught + classified + logged + documented fallback).
2. **Extract a helper** if the pattern appears at 2+ sites. Naming pattern: `safe<Action>(...)` (see `src/utils/safeServiceWorkerUpdate.ts` from 2026-04-28 as the canonical example).
3. **Allowlist in `main.ts`** — last resort, only for patterns we genuinely cannot catch at the source (e.g. browser internals fire the rejection from outside our code). Add a small known-noise filter list to the `unhandledrejection` listener with explicit comments naming each entry.

For every noise classification:
- Save a `Known noise pattern` memory entry (see Memory section below)
- Update `CHANGELOG.md` with a `Fixed` entry under the current date (the user-facing benefit is "less Slack noise / cleaner error visibility" — frame it that way)
- Verify the fix with `npm run type-check && npm run lint && npm test -- --run` before committing
- Commit message format: `fix(noise): silence <pattern> from #beanies-errors`

#### If GENUINE — surface-area review + holistic fix

Don't fix the immediate symptom in isolation. Apply the project's plan-thoroughness standard:

1. **Scope the surface area.** Are there other call sites with the same pattern? `grep` the function/composable/store at fault. If the same vulnerability exists elsewhere, the fix should land at all of them.
2. **DRY pass.** Per the project DRY rule, if a pattern recurs at 2+ sites, extract a helper now, not later.
3. **No-silent-failures pass.** Every code path on the way to the bug should be checked for missing try/catch, missing logged-fallback, or critical-vs-non-critical mis-classification.
4. **Test coverage.** Are there unit tests covering the path? If yes, why didn't they catch this? If no, add them as part of the fix.
5. **Edge cases.** What invariants does the fix rely on? Re-entry, concurrency, stale state, race-with-other-overlay. Annotate.
6. **Plan if non-trivial.** If the fix touches 3+ files or has architectural implications, exit to plan mode and use the `beanies-plan` skill — don't bleed straight into implementation.
7. **Verify** with type-check, lint, full unit suite, and chromium e2e if any flow is exercised by the test suite.
8. **CHANGELOG.md** with a `Fixed` entry framing the user-facing benefit, not the implementation.

#### If AMBIGUOUS — propose the smallest data-gathering step

Don't guess. Propose specifically:

- A targeted `console.warn` instrumentation to add for one release so the next firing carries diagnostic context
- A check against the existing diagnostics blob (`useJoinFlow.buildDiagnosticReport()`) for fields that would clarify
- A "wait for next firing" stance with explicit criteria for what would tip noise → genuine

Mark a TODO in memory so when the next data point arrives, this triage is resumed instead of restarted.

---

## Output Format

Single message, scannable, no padding:

```
## Error Review — [today's date]

**Parsed**
- Surface: ...
- Build: <sha> (status: at HEAD / superseded by <sha> / N commits behind)
- Message: ...
- Browser/OS: ...
- Repeats: ...
- Context: <only the fields that matter — provider, save_failure_level, online, etc.>

**Source located**
- File: `src/.../foo.ts:123` (function `someFn`)
- Why: <stack trace pointer / grep hit / context field correlation>

**Triage**
- A (origin frame): <evidence> → <noise/genuine indicator>
- B (known browser quirk): <yes/no, name the quirk if yes>
- C (user impact): <yes/no, evidence>
- D (repeat shape): <single / repeated-by-one-family / cross-family>
- E (build correlation): <recent commit touched this / no>
- F (recoverable?): <yes/no, why>
- G (known noise list): <hit / miss>

**Verdict: NOISE | GENUINE | AMBIGUOUS**
<one-sentence justification referencing checklist answers>

**Proposed action**
<structural fix shape | surface-area review + plan | data-gathering step>
```

After greg approves the action, proceed with implementation per the skill's "Propose the action" branch.

---

## Memory

This skill maintains a `Known noise patterns` memory entry that future triages check first. Path:

```
~/.claude/projects/-home-greg-projects-beanies-family/memory/reference_known_noise.md
```

Format (one entry per pattern):

```markdown
### <pattern-id> — <one-line description>

- **Pattern**: <regex or substring of the message>
- **Surface**: <surface field where it fires>
- **Source**: <file:line of the call site that leaks>
- **Fix applied**: <commit-sha + summary> OR `pending`
- **Classified**: <YYYY-MM-DD>
- **Notes**: <anything future-you needs to know — false positives to watch for, conditions that would re-elevate to genuine>
```

When a pattern is classified as noise:
1. Append an entry to this file
2. Add a one-line pointer to `MEMORY.md` if there isn't a `Known noise patterns` index entry yet (`- [Known noise patterns](reference_known_noise.md) — production errors classified as transient/platform noise + the fix shipped for each`)

When checking against the list at Step 4-G:
1. Read the file
2. Match the alert's surface + message against each entry
3. If a hit: skip to verdict NOISE with reasoning "matches known pattern <id>"

---

## Rules

- **Never "ignore the error".** Every noise verdict ships a structural fix that prevents it from firing again. Even if the fix is one line. The error reporter exists to catch real things; noise that fires monthly trains us to ignore the channel.
- **Always check the build SHA.** Stale-build errors may already be fixed at HEAD. Skipping this step wastes investigation time.
- **Stack frame is the truth.** When the message is ambiguous about which call site leaked, follow the stack. Browser-platform frames don't lie.
- **Don't propose a fix from the alert alone.** Always read the source. Always grep for similar patterns at sibling call sites — if the same hole exists at 3 places, fix all 3.
- **Verdict before action.** Don't start writing code mid-triage. The triage produces the verdict; the verdict picks the action shape.
- **No deploy without explicit instruction.** Per project convention: never trigger the deploy workflow proactively. Wait for greg to say "deploy."
- **Update memory.** Every confirmed noise pattern goes into `reference_known_noise.md` so the next triage starts from the known list, not from scratch.
- **Update CHANGELOG.md.** Both noise fixes and genuine bug fixes belong in the changelog under the current date — frame the entry around what the user/operator notices, not the implementation.
