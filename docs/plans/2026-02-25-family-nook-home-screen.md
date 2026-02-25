# Plan: Family Nook — Home Screen (#97)

> Date: 2026-02-25
> Related issues: #97

## Context

Issue #97 introduces the Family Nook as the warm, cosy home screen of beanies.family. It replaces the financial dashboard as the first screen after login, showing everything happening with the family at a glance — schedules, to-dos, milestones, and a doorway to The Piggy Bank. The route `/nook` and nav item already exist as placeholders.

## Approach

8 new components under `src/components/nook/` + 1 new page `FamilyNookPage.vue`:

1. NookGreeting — welcome header with name, date, action buttons
2. FamilyStatusToast — orange gradient status bar
3. NookYourBeans — family avatar row
4. ScheduleCards — today + this week 2-col grid
5. NookTodoWidget — compact todo widget with quick-add
6. MilestonesCard — upcoming birthdays + goal deadlines
7. PiggyBankCard — dark gradient net worth card
8. RecentActivityCard — merged activity feed

Route changes: default redirect → `/nook`, update mobile tab.
Translation keys: ~30 new `nook.*` keys.

## Files affected

| File                                         | Action                               |
| -------------------------------------------- | ------------------------------------ |
| `src/pages/FamilyNookPage.vue`               | New — main page                      |
| `src/components/nook/NookGreeting.vue`       | New                                  |
| `src/components/nook/FamilyStatusToast.vue`  | New                                  |
| `src/components/nook/NookYourBeans.vue`      | New                                  |
| `src/components/nook/ScheduleCards.vue`      | New                                  |
| `src/components/nook/NookTodoWidget.vue`     | New                                  |
| `src/components/nook/MilestonesCard.vue`     | New                                  |
| `src/components/nook/PiggyBankCard.vue`      | New                                  |
| `src/components/nook/RecentActivityCard.vue` | New                                  |
| `src/router/index.ts`                        | Update redirect + route              |
| `src/constants/navigation.ts`                | Remove comingSoon, update mobile tab |
| `src/services/translation/uiStrings.ts`      | Add ~30 nook keys                    |
| `src/style.css`                              | Add missing tint CSS vars            |
