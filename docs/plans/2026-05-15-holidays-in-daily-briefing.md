# Plan: surface public holidays in the daily briefing

> Date: 2026-05-15
> Related work: ships alongside `feat(nook): label the daily briefing card with eyebrow emphasis` (commit `fb07190`).

## Context

The daily-briefing box on the Family Nook (`FamilyStatusToast.vue`) surfaces today's actionable items — to-dos, pickups, medication reminders, photo-day heads-ups. Public-holiday data exists app-wide (203-country dataset, country-gated, exposed via `holidayStore.holidayForDate(dateISO)`), but the briefing doesn't surface holidays at all today. Families wake up on Christmas morning with no acknowledgement, and get no heads-up that school is closed tomorrow.

This plan adds two distinct holiday surfaces to the Nook:

1. **Day-of banner** — a quiet Sky Silk strip ABOVE the orange briefing box. Contextual, atmospheric, not actionable. `"Merry Christmas, beans"` for globally-recognised holidays; `"Today is {holidayName}"` for the rest.
2. **Tomorrow heads-up** — an italic info note at the TOP of the briefing list, inside the orange box. `"Tomorrow is Christmas Day"` + caption. No checkbox.

Two surfaces, two visual registers — atmospheric vs informational. Same data source, same country gate, same "show public holidays" toggle the planner already respects.

## User preferences (confirmed)

- **Tomorrow placement**: inside the briefing box, top of the list.
- **Greeting scope**: global-only allowlist (~8 globally-recognised holidays). Everything else uses `"Today is {holidayName}"`.

## Approach

### Data layer (no changes)

Already in place:

- `holidayStore.holidayForDate(dateISO)` → `HolidayOccurrence | undefined`
- `holidayStore.holidaysInRange(start, end)` → `HolidayOccurrence[]`
- Country gate baked into the store
- `settingsStore.showPublicHolidays` toggle (auto-gates on country)

The briefing's data path adds two lookups:

```ts
const todayHoliday = computed(() => holidayStore.holidayForDate(today.value));
const tomorrowHoliday = computed(() => holidayStore.holidayForDate(addDays(today.value, 1)));
```

### Shared greeting helper (`src/utils/holidayGreeting.ts` — new)

Maps a holiday's `name` to a warm greeting or falls through to `"Today is {holidayName}"`. Also maps to an emoji.

```ts
export function getHolidayGreeting(holiday, t): string;
export function getHolidayEmoji(holiday): string;
```

Allowlist (i18n-keyed):

- `nook.holiday.greeting.christmas` → `"Merry Christmas, beans"`
- `nook.holiday.greeting.newYear` → `"Happy New Year, beans"`
- `nook.holiday.greeting.lunarNewYear` → `"Happy Lunar New Year, beans"`
- `nook.holiday.greeting.easter`, `mothersDay`, `fathersDay`, `thanksgiving`, `diwali`, `eid`
- `nook.holiday.greeting.default` → `"Today is {holidayName}"`

Matching: keyed on the dataset's `name` field, case-insensitive, with fuzzy-prefix fallback (e.g. "Eid al-Fitr" / "Eid al-Adha" both match `eid`).

### Day-of banner (`src/components/nook/HolidayBriefingBanner.vue` — new)

Standalone strip rendered on `FamilyNookPage` immediately above `FamilyStatusToast`. Hidden when no holiday today, no country set, or toggle off.

Visual treatment:

- Full-width pill, Sky Silk gradient (`from-sky-silk-50 to-sky-silk-100`), thin Sky Silk border
- Layout: `[emoji] {greeting}` top line + caption underneath
- Emoji map: `🎄` Christmas, `🎆` New Year, `🌷` Easter, `🪔` Diwali, `🌙` Eid, `🌸` Lunar New Year, `🦃` Thanksgiving, fallback `🗓️`
- Fade-in on mount (300ms ease-out), respects `prefers-reduced-motion`

### Tomorrow heads-up (extends `useCriticalItems` + `FamilyStatusToast`)

New kind of briefing item, always at the top. Extends `CriticalItem`:

```ts
export interface CriticalItem {
  id: string;
  type: 'todo' | 'activity' | 'medication' | 'holiday';   // NEW: 'holiday'
  ...
}
```

- `'holiday'` always sorts to position 0 (pre-sort branch before timed/untimed ordering)
- One entry max per day; gated on country + toggle
- Render in `FamilyStatusToast.vue`: italic body, 💡 icon prefix, no checkbox, no chevron
- Copy: `"Tomorrow is {holidayName}"` + caption

## Critical files

| File                                                 | Change                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/holidayGreeting.ts`                       | **NEW** — `getHolidayGreeting(holiday, t)` + `getHolidayEmoji(holiday)`. Allowlist table for ~8 global holidays.                          |
| `src/components/nook/HolidayBriefingBanner.vue`      | **NEW** — Sky Silk strip above briefing.                                                                                                  |
| `src/pages/FamilyNookPage.vue`                       | Add `<HolidayBriefingBanner />` above `<FamilyStatusToast />`.                                                                            |
| `src/composables/useCriticalItems.ts`                | Extend `CriticalItem.type` to include `'holiday'`; new pre-sort branch pinning the holiday item to position 0; gated on country + toggle. |
| `src/components/nook/FamilyStatusToast.vue`          | Render branch for `type === 'holiday'` (italic note + 💡 icon, no checkbox/chevron).                                                      |
| `src/services/translation/uiStrings.ts`              | 8 greeting strings + default + tomorrow heads-up + caption strings (en + beanie).                                                         |
| `src/utils/__tests__/holidayGreeting.test.ts`        | **NEW** — allowlist hits/misses, beanie-mode rendering, default fallback.                                                                 |
| `src/composables/__tests__/useCriticalItems.test.ts` | Extend with holiday-tomorrow appears-at-top / absent-when-gates-off cases.                                                                |
| `public/translations/zh.json`                        | Auto-regenerated via `npm run translate`.                                                                                                 |

## Reused primitives (no duplication)

| Concept                     | Reuse                                            |
| --------------------------- | ------------------------------------------------ |
| Holiday data lookup         | `holidayStore.holidayForDate(dateISO)`           |
| Country gate                | inside `holidayStore`                            |
| `showPublicHolidays` toggle | `settingsStore` (planner already uses)           |
| Critical-items composable   | `useCriticalItems` — extend, don't replace       |
| Briefing render             | `FamilyStatusToast.vue` — extend the type switch |
| Translation interpolation   | manual `.replace('{x}', value)` after `t()`      |
| Sky Silk palette            | `--color-sky-silk-*` tokens in `src/style.css`   |
| Date arithmetic             | `addDays` from `@/utils/date`                    |
| Error reporting             | `reportError` for malformed-holiday warnings     |

## Out of scope (deliberate)

- Per-country greeting allowlists — global-only for v1
- Multi-day holidays (only "today" / "tomorrow"; first day per occurrence)
- Holiday-themed colour palettes — always Sky Silk, for visual consistency
- School-holiday data not in the public-holiday dataset
- Greetings for vacation start/end on the planner — separate
- Custom emojis from dataset — hardcoded mapping for global allowlist + `🗓️` fallback

## Verification

**Unit:**

- `npm run validate` — full type-check + lint + unit + build
- `holidayGreeting.test.ts`: allowlist hits, case-insensitive matching, fuzzy-prefix fallback, default fallback, beanie-mode lowercase
- `useCriticalItems.test.ts`: holiday-tomorrow appears at position 0 when country + toggle on + holiday exists; absent when either gate is off

**Manual (dev):**

- Dec 24, 2026 (US): briefing shows `💡 Tomorrow is Christmas Day` at top + Sky Silk banner with `Merry Christmas, beans`
- Dec 25, 2026 (US): banner shows greeting + 🎄 + caption; no tomorrow heads-up
- Non-holiday weekday: neither surface renders
- Toggle off: both disappear
- Country cleared: both disappear
- Beanie mode: lowercase greetings + copy
- Singapore / Vesak Day: default `Today is Vesak Day` (not in global allowlist)
- Language = zh: zh greetings render
- Mobile width (≤375px): banner doesn't overflow; tomorrow heads-up wraps cleanly

**Telemetry (post-deploy, 1 week):** zero baseline expected for `holidayGreeting.malformedHoliday`.
