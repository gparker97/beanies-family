# E2E Health Log

Track E2E test failures to measure signal-to-noise ratio. See `docs/adr/007-testing-strategy.md` for the full E2E testing strategy.

## How to Log

After each CI E2E failure, add a row:

- **(a) Bug caught** — real code defect discovered by E2E
- **(b) Intentional change** — test updated to match new app behavior
- **(c) Flake** — passed on retry, no code change needed

## Targets

- **Signal-to-noise ratio (a / b):** > 2.0
- **Review frequency:** Quarterly
- **Cull threshold:** Any test logged as (b) or (c) more than twice should be rewritten or removed

## Log

| Date       | Test | Category | Notes                                                               |
| ---------- | ---- | -------- | ------------------------------------------------------------------- |
| 2026-03-25 | —    | —        | E2E suite overhauled: 87 → 21 tests, 15 → 7 files. Tracking begins. |
