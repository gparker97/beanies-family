---
date: 2026-07-24
category: feature
issue: Notion #40
plan: docs/plans/2026-07-24-helpful-hints.md
tags: [helpful-hints, todos, notifications, reminders, settings]
---

# Helpful Hints — auto-generated to-do reminders (#40)

## Prompts

**Intake (via /beanies-pre-plan #40):**

> Now that we've built reminders let's /beanies-pre-plan #40 helpful hints. The plan should be to build this on top of the notification framework we've just released, and we can add the options for enabling/disabling helpful hints in settings (in the same reminders category we just created). Helpful hints are for giving a small nudge, and they should be able to be enabled/disabled on a granular basis (rather than all or nothing). if needed please update the tracker as needed and prepare the prompt, ask questions if anything is unclear

**Pre-plan clarifications (answers):**

- A hint is a to-do item that triggers a notification (both); the user can adjust/remove the notification per-item, or disable the specific hint in settings.
- Granularity: a family-synced master switch + per-hint-type toggles, per-device (matching the #55 reminder model).
- Toggle scope: a per-device per-type toggle suppresses that person's notification only; the shared to-do still appears for everyone.
- Mockup: none.
- dueDate = nudge date (not event date); dedicated "Helpful Hints" section atop the to-do list — both confirmed.

**Plan + build:**

> /beanies-plan proceed to build the plan → "show me the plan in the plan dialog" → "the 2 items above are ok for me" → "approve and implement full feature"

## Outcome

Implemented the full feature behind the `helpfulHints` dev flag (committed OFF in prod). Built on the #55 pull-based todo-reminder path: a hint is a dated to-do that automatically gets its notification with no new scheduler.

- **Pure engine** `src/utils/helpfulHints.ts` (6 rule-based triggers, dedup by `hintKey`, per-record error isolation) + full unit tests.
- **Reactive orchestrator** `src/composables/useHelpfulHints.ts` (init in `App.vue`; debounced reconcile; whole-run try/catch → reportError; does not watch `todos` → no reconcile↔reschedule loop).
- **todoStore**: one `manualActiveTodos` base getter re-bases every attention/open lane so hints are structurally excluded (never overdue-red); `hintTodos` / `visibleHintTodos` (audience-hidden filtering) / `acknowledgeHint`.
- **Reminder gate**: per-device per-type notification suppression in `buildTodoReminders` (via `ReminderPrefs`).
- **Off-store leak fixes**: daily briefing (`useCriticalItems`), global search (`GlobalSearch`), bean-tips count (`useBeanTips`).
- **UI**: hint row treatment (gentle tint, badge, "what's this?" explainer, Keep/Dismiss) in `TodoItemRow`; dedicated section in `FamilyTodoPage`; master + per-type toggles in `RemindersSettings`.
- **Settings** (family-synced master + device per-type), **feature flag**, **i18n** (`en` + `beanie`), **CloudWatch telemetry** (`helpful-hints` surface + allowlisted context keys + store-declaration update), and a **Help Center article** (`helpful-hints`).

Verification: type-check clean, full build clean, Vitest all green (engine 20, reminder gate 3, todoStore hint getters 5). Behind the flag, prod behaviour is unchanged.

Follow-ups: on-device verification once the flag is flipped on (hint appears, notification fires at the nudge time, birthday person can't see/search their own present hint, Keep/Dismiss + per-type mute behave); Chinese (`zh`) translations for the new keys via `npm run translate` (auto-translated keys need a spot-check).
