# Code review: the native update gate

> Reviewed commit: `af38fe75` — "feat(native): ask people to update, and give the block a way out"
> Plan under review: `docs/plans/2026-09-07-native-update-gate.md` (Phase A)
> Date: 2026-09-07

Four reviewers, four dimensions, each with a fresh context window and each told to
verify against the code rather than against the plan's prose. The plan was given to
every one of them as the contract, because a review that only asks "is this code good"
cannot catch the more expensive failure: code that is fine on its own terms and is not
what was agreed.

| Report                                                       | Dimension                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [R1](R1-correctness-and-platform.md)                          | Runtime correctness, the Capacitor contract, the extraction |
| [R2](R2-errors-and-observability.md)                          | Silent failures, the allowlist, the rate limiter            |
| [R3](R3-ui-i18n-security.md)                                  | Dark mode, i18n registers, href screening, a11y             |
| [R4](R4-conformance-and-tests.md)                             | Acceptance criteria walked line by line, test quality, DRY  |
| [FIXES](FIXES.md)                                             | What was confirmed, what was fixed, what was declined       |

The one place the implementation deliberately went past the plan is recorded in FIXES
and in `docs/STATUS.md`: the plan said "no new component", and `FatalErrorOverlay.vue`
was extracted from `App.vue` anyway, because the alternative was asserting on source
text and this repo carries an explicit lesson against that.
