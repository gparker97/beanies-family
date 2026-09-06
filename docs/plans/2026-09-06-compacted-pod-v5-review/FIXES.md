# Fix list

> Applied in one batch AFTER all three reviewers finish. R3 mutates tracked
> files and restores them with `git checkout --`, which would silently discard
> an edit made underneath it, so nothing is applied while it runs.

## From R2 (all VERIFIED against the code by the implementer)

| #   | Sev     | Fix                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | MED     | A cancelled OS picker shows a red error. `openAndLoadFile`'s abort arm returns a bare `{success:false}` (`syncService.ts:2135-2138`), indistinguishable from failure, and the new `else` at `SettingsPage.vue:538-540` fires. Add `cancelled?: true` to `OpenFileResult`, set it in the abort arm, and return early at every caller. Also clear `lastError` there so a stale raw string cannot render. |
| F2  | MED     | `importError` is never cleared on the load-file path (only `handleManualImport` clears, `SettingsPage.vue:636`). Clear it in `handleLoadFromFileConfirmed`.                                                                                                                                                                                                                                            |
| F3  | MED     | `useLoginFlow.ts:444` is a FOURTH hand-rolled ladder (`deviceCannotOpen ? 'too-large' : 'corrupted'`) feeding `emitOutcome`, so the login funnel files every needs-update as `corrupted`. Convert to `payloadErrorKind`.                                                                                                                                                                               |
| F4  | LOW/MED | `openFileFailure` emits no telemetry, so the Settings picker, LoadPodView picker and JoinPodView drop zone are dark in CloudWatch and the plan's five-surface drill cannot pass. Report a blocker there (warning, non-paging), reusing the existing shape.                                                                                                                                             |
| F5  | LOW     | `UnsupportedBeanpodVersionError.fileVersion` is file-controlled and unclamped (`sync.ts:379-385`) and reaches `detail`. Clamp/sanitise in the constructor.                                                                                                                                                                                                                                             |
| F6  | LOW     | `lastVersionDetail` (`syncService.ts:341`) survives `reset()`, so a same-tab family switch suppresses the first `pod-version`. Clear it in `reset()`.                                                                                                                                                                                                                                                  |
| F7  | LOW     | `SettingsPage.vue:539` renders `syncStore.error` raw: a new untranslated-English render path. Drop the raw fallback.                                                                                                                                                                                                                                                                                   |
| F8  | INFO    | No worker codec for `UnsupportedBeanpodVersionError`. Verified unreachable today (no worker file imports `fileSync`), but add a comment saying so, or the codec, so the next reader is not left to re-derive it.                                                                                                                                                                                       |
| F9  | INFO    | Three stale `detectFileVersion` comments.                                                                                                                                                                                                                                                                                                                                                              |

## From R1

_(pending)_

## From R3

_(pending)_
