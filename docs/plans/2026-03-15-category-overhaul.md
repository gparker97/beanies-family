# Plan: Comprehensive Category Overhaul for Transactions & Activities

> Date: 2026-03-15
> Related issues: #137 (https://github.com/gparker97/beanies-family/issues/137)
> Plan file: `docs/plans/2026-03-15-category-overhaul.md`

## User Story

As a family member, I want granular categories for transactions and activities so that I can accurately classify my spending and family activities, while the UI keeps things simple by grouping categories logically and only showing detail when I ask for it.

## Context

The current category system has 8 income categories (4 groups), 27 expense categories (9 groups), and 6 flat activity categories. The user wants to replace these entirely with a richer, more granular set — adding new groups (Sports, Medical, Charity, Subscriptions, Education/Lessons, Competitions, School, Educational, Fun) and expanding existing ones. No backwards compatibility is needed — existing transactions/activities with removed category IDs will require re-selection on next save.

Activity categories are currently fragmented across 6 files (`models.ts`, `activityIcons.ts`, `activityStore.ts`, `ActivityModal.vue`, `activityPresets.ts`, `uiStrings.ts`). This overhaul consolidates them into a single source of truth (`activityCategories.ts`), mirroring the clean pattern already established for transaction categories in `categories.ts`.

The budget system also needs updating: currently allocations are per-category, but with 46 expense categories this becomes overwhelming. The new approach: budget at the group level by default, with optional per-category drill-down.

## Requirements

### Transaction Categories — Money In (12 categories, 4 groups)

**Employment:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `freelance` | Freelance | 💻 | `code` | `#10b981` |
| `salary` | Salary | 💼 | `briefcase` | `#22c55e` |
| `consultancy` | Consultancy | 🤝 | `handshake` | `#059669` |
| `other_employment` | Other Employment Income | 💼 | `briefcase` | `#16a34a` |

**Investments:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `dividends` | Dividends | 💰 | `dollar-sign` | `#0891b2` |
| `investments` | Investment Returns | 📈 | `trending-up` | `#14b8a6` |
| `other_investment` | Other Investment Income | 📊 | `bar-chart` | `#0d9488` |

**Property:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `rental` | Rental Income | 🏠 | `home` | `#06b6d4` |
| `other_property` | Other Property Income | 🏡 | `home` | `#0284c7` |

**Other:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `gifts` | Gifts Received | 🎁 | `gift` | `#0284c7` |
| `refunds` | Refunds | 🔄 | `refresh` | `#0369a1` |
| `other_income` | Other Income | 📦 | `plus-circle` | `#059669` |

### Transaction Categories — Money Out (46 categories, 13 groups)

**Entertainment:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `entertainment` | Entertainment | 🎬 | `film` | `#4f46e5` |
| `hobbies` | Hobbies | 🎨 | `palette` | `#9333ea` |
| `other_entertainment` | Other Entertainment | 🎭 | `theater` | `#6d28d9` |

**Subscriptions:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `software` | Software | 💻 | `monitor` | `#7c3aed` |
| `streaming` | Streaming | 📺 | `tv` | `#8b5cf6` |
| `other_subscriptions` | Other Subscriptions | 📱 | `repeat` | `#6366f1` |

**Family:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `childcare` | Childcare | 👶 | `users` | `#be123c` |
| `pets` | Pets | 🐾 | `paw` | `#881337` |
| `other_family` | Other Family | 👨‍👩‍👧 | `users` | `#9f1239` |

**Education / Lessons:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `tuition` | Tutor / Tuition | 📚 | `book-open` | `#7e22ce` |
| `school_fees` | School Fees | 🏫 | `school` | `#6b21a8` |
| `other_lessons` | Other Lessons | 🎓 | `graduation-cap` | `#581c87` |

**Sports:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `sports_equipment` | Sports Equipment | 🏅 | `dumbbell` | `#15803d` |
| `sports_team` | Sports Team / Practice | ⚽ | `users` | `#166534` |
| `golf` | Golf | ⛳ | `flag` | `#14532d` |
| `gym` | Gym / Fitness | 🏋️ | `dumbbell` | `#22c55e` |
| `yoga` | Yoga / Pilates | 🧘 | `heart` | `#16a34a` |
| `other_sports` | Other Sports | 🏃 | `activity` | `#059669` |

**Food:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `coffee` | Coffee / Snacks | ☕ | `coffee` | `#0891b2` |
| `dining_out` | Dining Out | 🍽️ | `utensils` | `#06b6d4` |
| `groceries` | Groceries | 🛒 | `shopping-cart` | `#14b8a6` |
| `other_food` | Other Food | 🍴 | `utensils` | `#0d9488` |

**Housing:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `home_maintenance` | Home Maintenance | 🔨 | `tool` | `#f59e0b` |
| `rent` | Rent / Mortgage | 🏠 | `home` | `#ef4444` |
| `utilities` | Utilities | ⚡ | `zap` | `#f97316` |
| `other_housing` | Other Housing | 🏗️ | `building` | `#d97706` |

**Financial:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `debt_payment` | Debt Payment | 💳 | `credit-card` | `#e11d48` |
| `insurance` | Insurance | 🔒 | `shield` | `#c026d3` |
| `taxes` | Taxes | 📄 | `file-text` | `#db2777` |

**Other:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `other_expense` | Other Expense | 📦 | `more-horizontal` | `#334155` |

**Charity:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `donations` | Donations | 💝 | `heart-handshake` | `#475569` |
| `gifts_given` | Gifts Given | 🎁 | `gift` | `#64748b` |
| `other_charity` | Other Charity | 🤲 | `hand-heart` | `#374151` |

**Personal:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `clothing` | Clothing / Shopping | 👕 | `shirt` | `#0284c7` |
| `personal_care` | Personal Care | 💅 | `heart` | `#0369a1` |
| `other_personal` | Other Personal | 🛍️ | `shopping-bag` | `#1d4ed8` |

**Medical:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `healthcare` | Healthcare | 🏥 | `activity` | `#dc2626` |
| `dental` | Dental | 🦷 | `smile` | `#b91c1c` |
| `other_medical` | Other Medical Expense | ⚕️ | `stethoscope` | `#991b1b` |

**Transportation:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `car_maintenance` | Car / Bike Maintenance | 🔧 | `settings` | `#10b981` |
| `car_payment` | Car Payment | 🚗 | `car` | `#eab308` |
| `gas` | Gas / Fuel | ⛽ | `fuel` | `#84cc16` |
| `public_transit` | Public Transit | 🚌 | `train` | `#22c55e` |
| `taxi` | Taxi / Ride Hailing | 🚕 | `navigation` | `#a3e635` |
| `other_transportation` | Other Transportation | 🚙 | `car` | `#65a30d` |

**Travel:**
| ID | Name | Emoji | Icon | Color |
|---|---|---|---|---|
| `flights` | Flight | ✈️ | `airplane` | `#be123c` |
| `hotel` | Hotel | 🏨 | `hotel` | `#a21caf` |
| `other_travel` | Other Travel | 🧳 | `luggage` | `#86198f` |

### Activity Categories (6 groups, 30 categories)

**School:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `after_school` | After School Activity | 🏫 | `#3B82F6` |
| `school_recital` | School Recital / Presentation | 🎭 | `#2563EB` |
| `other_school` | Other School Activity | 📋 | `#1D4ED8` |

**Educational:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `tutoring` | Tutoring | 📚 | `#8B5CF6` |
| `math` | Math | 🧮 | `#7C3AED` |
| `language` | Language | 🌐 | `#6D28D9` |
| `science` | Science | 🔬 | `#5B21B6` |
| `other_educational` | Other Educational | 📖 | `#4C1D95` |

**Sports:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `tennis` | Tennis | 🎾 | `#22C55E` |
| `badminton` | Badminton | 🏸 | `#16A34A` |
| `golf_activity` | Golf | ⛳ | `#15803D` |
| `baseball` | Baseball / Softball | ⚾ | `#166534` |
| `gym_activity` | Gym / Fitness | 🏋️ | `#059669` |
| `yoga_activity` | Yoga / Pilates | 🧘 | `#0D9488` |
| `other_sports_activity` | Other Sports | 🏃 | `#14B8A6` |

**Competitions:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `spelling_bee` | Spelling Bee | 🐝 | `#F59E0B` |
| `math_competition` | Math Competition | 🔢 | `#D97706` |
| `cubing` | Cubing Competition | 🧩 | `#B45309` |
| `other_competition` | Other Competition | 🏆 | `#92400E` |

**Lessons:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `piano` | Piano | 🎹 | `#AED6F1` |
| `guitar` | Guitar | 🎸 | `#93C5FD` |
| `trumpet` | Trumpet | 🎺 | `#60A5FA` |
| `drum` | Drum | 🥁 | `#3B82F6` |
| `music` | Music | 🎵 | `#2563EB` |
| `art` | Art | 🎨 | `#818CF8` |
| `dance` | Dance / Ballet | 💃 | `#A78BFA` |
| `other_lesson` | Other Lesson | 📓 | `#7C3AED` |

**Fun:**
| ID | Name | Emoji | Color |
|---|---|---|---|
| `birthday` | Birthday Party | 🎂 | `#F15D22` |
| `wedding` | Wedding | 💒 | `#E67E22` |
| `bar_mitzvah` | Bar Mitzvah | ✡️ | `#D97706` |
| `other_celebration` | Other Celebration | 🎉 | `#F59E0B` |

### Budget: Group-Level Allocation with Optional Category Drill-Down

- **No model change.** `BudgetCategory` stays `{ categoryId: string; amount: number }`.
- Group-level entries use `categoryId: 'group:Food'`, `'group:Housing'`, etc.
- Helper `isGroupBudget(categoryId)` checks the `group:` prefix.
- Helper `getGroupName(categoryId)` extracts the group name.
- **BudgetSettingsModal default view:** One row per expense group with a single amount input. Each row has an expand chevron — clicking reveals per-category inputs within that group using `ConditionalSection`.
- **When user sets group-level amount:** Store `{ categoryId: 'group:Food', amount: 500 }`.
- **When user expands and sets per-category:** Store individual entries and remove the group entry.
- **Budget store spending aggregation:** For `group:Food` entry, sum all transactions whose category belongs to the Food group.
- **BudgetPage spending section:** For group-level budgets, show the group name + group emoji + total spending across all categories in that group. For category-level budgets, show individual categories as today.

### Activity Category Architecture (DRY Consolidation)

**Single source of truth: `activityCategories.ts`**

Define an `ActivityCategoryDef` interface with `id`, `name`, `emoji`, `color`, `group`. One `ACTIVITY_CATEGORIES` array. All maps and helpers derived from it:

- `ACTIVITY_EMOJI_MAP` — derived
- `ACTIVITY_GROUP_EMOJI_MAP` — defined (6 groups)
- `ACTIVITY_COLORS` — derived
- `getActivityCategoryById(id)` — lookup helper
- `getActivityCategoriesGrouped()` — returns grouped structure for chip picker

**`ActivityCategoryPicker.vue`** — thin wrapper around `GroupedChipPicker` (mirrors `CategoryChipPicker.vue`).

**`ActivityModal.vue`** — removes ~70 lines of hardcoded options. Uses `ActivityCategoryPicker`. Icon auto-set from category's emoji when category changes.

**Delete `activityIcons.ts`** — absorbed into `activityCategories.ts`.

**`activityStore.ts`** — removes local `CATEGORY_COLORS`, imports from `activityCategories.ts`.

### Onboarding Activity Presets

Keep the preset system. Update with popular new categories (~7-8): Piano, Tennis, Art, Dance, Tutoring, Birthday, Other Lesson.

### Translation Keys

All new category names go through the i18n system — add translation keys for every new category and group. Remove old activity category keys.

## Important Notes & Caveats

- **No backwards compatibility.** Existing transactions/activities with removed category IDs will show as "uncategorized" and require re-selection on next save.
- **Financial group is kept** (Debt Payment, Insurance, Taxes) — confirmed explicitly.
- **"Other" group for expenses** is a single standalone category (`other_expense`). It appears as its own line in budget settings.
- **Activity category type** changes from a 6-value string union to a 30-value string union. The `ActivityCategory` type in `models.ts` is updated.
- **Activity presets** (`activityPresets.ts`) are rebuilt with popular picks. Keep count small (~7-8) for onboarding simplicity.
- **Budget `group:` prefix convention** avoids any Automerge document schema change. The `categoryId` field is already a plain string.
- Icon names (Lucide icons) should be verified to exist in the BeanieIcon component.
- Existing budgets will need recreation by the user (only the developer is using the app).

## Assumptions

> **Review these before implementation.**

1. The `BeanieIcon` component supports all icon names used (verify: `handshake`, `theater`, `monitor`, `tv`, `school`, `graduation-cap`, `dumbbell`, `building`, `hand-heart`, `shopping-bag`, `smile`, `stethoscope`, `navigation`, `luggage`).
2. The `GroupedChipPicker` component works unchanged with new data.
3. No database migration needed — Automerge documents accept any string for category fields.
4. Budget amounts stored in the Automerge doc will clear and the user recreates their budget.
5. E2E tests that reference specific category IDs will need updating.

## Approach (Phased)

### Phase 1: Data layer

1. **Rewrite `categories.ts`** — New income (12) + expense (46) categories. Update `CATEGORY_EMOJI_MAP`, `GROUP_EMOJI_MAP`. Keep existing helper functions unchanged — they work with new data.
2. **Create `activityCategories.ts`** — Single source of truth for 30 activity categories. Export `ACTIVITY_CATEGORIES`, derived maps (`ACTIVITY_EMOJI_MAP`, `ACTIVITY_COLORS`), and helper functions (`getActivityCategoryById`, `getActivityCategoriesGrouped`).
3. **Delete `activityIcons.ts`** — Absorbed into `activityCategories.ts`.
4. **Update `models.ts`** — Replace `ActivityCategory` type with new 30-value string union.
5. **Update `activityStore.ts`** — Remove local `CATEGORY_COLORS`. Import and re-export from `activityCategories.ts`. `getActivityColor()` uses new map.
6. **Update `activityPresets.ts`** — New ~7 presets from popular new categories.

### Phase 2: Budget system

7. **Update `budgetStore.ts`** — Add `isGroupBudget()` / `getGroupName()` helpers. Update `categoryBudgetStatus` to handle `group:` entries by aggregating spending across all categories in that group.
8. **Update `BudgetSettingsModal.vue`** — Group-level rows with `ConditionalSection` expand for per-category drill-down.
9. **Update `BudgetPage.vue`** — Spending section handles both group-level and category-level budget entries.

### Phase 3: Pickers & modals

10. **Create `ActivityCategoryPicker.vue`** — Thin wrapper around `GroupedChipPicker`.
11. **Update `ActivityModal.vue`** — Remove `ACTIVITY_ICON_OPTIONS`, `ACTIVITY_ICON_GROUPS`. Use `ActivityCategoryPicker`. Auto-set icon from category emoji.
12. **`CategoryChipPicker.vue`** — No changes (reads from `getCategoriesGrouped()`).

### Phase 4: Translation & cleanup

13. **Update `uiStrings.ts`** — Add all new translation keys. Remove old activity category keys.
14. **Run `npm run translate`** — Verify parsing.
15. **Search for stale references** — Deleted `activityIcons.ts`, old category IDs in tests.
16. **Type-check, lint, build.**

## Files Affected

| File                                             | Change                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `src/constants/categories.ts`                    | Full rewrite — new categories, emoji maps, group maps             |
| `src/constants/activityCategories.ts`            | **NEW** — single source of truth for activity categories          |
| `src/constants/activityIcons.ts`                 | **DELETE** — absorbed into activityCategories.ts                  |
| `src/constants/activityPresets.ts`               | Updated presets                                                   |
| `src/types/models.ts`                            | Update `ActivityCategory` type                                    |
| `src/stores/activityStore.ts`                    | Import colors from activityCategories.ts, remove local definition |
| `src/stores/budgetStore.ts`                      | Group-level budget support                                        |
| `src/components/ui/ActivityCategoryPicker.vue`   | **NEW** — thin wrapper around GroupedChipPicker                   |
| `src/components/budget/BudgetSettingsModal.vue`  | Group-level allocation UI                                         |
| `src/pages/BudgetPage.vue`                       | Group-level spending display                                      |
| `src/components/planner/ActivityModal.vue`       | Use ActivityCategoryPicker, remove hardcoded options              |
| `src/services/translation/uiStrings.ts`          | All new translation keys                                          |
| `src/components/dashboard/BudgetSummaryCard.vue` | Verify — no changes expected                                      |
| Test files                                       | Update stale category ID references                               |

## Acceptance Criteria

- [ ] 12 income categories across 4 groups
- [ ] 46 expense categories across 13 groups (including Financial)
- [ ] 30 activity categories across 6 groups, defined in single `activityCategories.ts`
- [ ] `activityIcons.ts` deleted — no orphan imports
- [ ] `CATEGORY_COLORS` removed from `activityStore.ts` — imported from `activityCategories.ts`
- [ ] `ACTIVITY_ICON_OPTIONS` / `ACTIVITY_ICON_GROUPS` removed from `ActivityModal.vue`
- [ ] `ActivityCategoryPicker.vue` wraps `GroupedChipPicker` (same pattern as `CategoryChipPicker`)
- [ ] Budget settings: group-level allocation by default, expandable to per-category
- [ ] Budget page: spending works for both group and category-level budgets
- [ ] All translation keys added (`en` + `beanie`)
- [ ] `npm run translate`, `npm run type-check`, `npm run lint`, `npm run build` all pass
- [ ] No hardcoded references to removed category IDs

## Testing Plan

1. Create income/expense transactions — verify all new categories appear grouped correctly in picker
2. Create activities — verify all 30 categories appear in 6 groups via ActivityCategoryPicker
3. Budget: set group-level allocations, verify spending aggregation is correct
4. Budget: expand a group, set per-category allocations, verify display
5. Onboarding: verify activity presets work with new category IDs
6. Existing data: old categories show as uncategorized, can be re-assigned on next save
7. Dark mode and mobile viewports
8. Full build + lint + type-check
