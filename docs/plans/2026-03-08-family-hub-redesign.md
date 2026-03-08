# Plan: Issue #73 — Family Hub Redesign ("The Bean Pod")

> Date: 2026-03-08
> Related issues: #73

## Context

The current `FamilyPage.vue` (480 lines) uses a flat 3-column grid of `BaseCard` member cards. Issue #73 and the v7 UI Framework Proposal ("The Treehouse — Family Hub", Proposal 03) call for a redesigned 2-column layout with a header, richer member cards showing per-member activity stats, and a quick info side panel. All existing functionality must be preserved: view/add/edit/delete members, invite flow with crypto tokens + QR + email sharing, role management, family name inline editing, and query-param-based modal opening.

## Approach

Refactor `FamilyPage.vue` in-place. Extract one new component (`FamilyMemberCard.vue`) for the redesigned member card since it has enough complexity (avatar, stats grid, role pill, status, actions). No new composable needed — per-member stat counts are simple one-liner filters computed directly in `FamilyPage.vue` and passed as props, avoiding a new file for 4 trivial `.filter().length` calls. The quick info panel is lightweight markup inline in the page. All existing script logic (invite generation, clipboard, modals, family name editing) stays untouched.

### Reuse audit — what already exists

| Existing                                                         | Reuse for                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `BaseCard` (ui)                                                  | Wrap member cards + quick info stats box                                            |
| `BeanieAvatar` + `getMemberAvatarVariant()`                      | Member avatar display (same pattern as `NookYourBeans.vue`)                         |
| `MemberRoleManager`                                              | Role pill + change handler (already in current page)                                |
| `FamilyMemberModal`                                              | Add/edit member modal (unchanged)                                                   |
| `InviteLinkCard`                                                 | Invite link + QR in invite modal (unchanged)                                        |
| `BeanieIcon`                                                     | Edit, copy, trash, check, close icons (already in current page)                     |
| `BaseButton`, `BaseInput`, `BaseModal`                           | Buttons, inputs, invite modal (unchanged)                                           |
| `usePermissions` / `canManagePod`                                | Permission gating (unchanged)                                                       |
| `useSyncHighlight`                                               | Sync visual feedback on cards (unchanged)                                           |
| `useClipboard`                                                   | Invite link copying (unchanged)                                                     |
| `nook-section-label` CSS utility                                 | Section headers ("Quick Info", "Events This Week")                                  |
| `activityStore.upcomingActivities`                               | Events list in quick info panel (already computed, sorted, expanded for recurrence) |
| `activityStore.activeActivities`                                 | Per-member activity count                                                           |
| `todoStore.openTodos`                                            | Per-member todo count                                                               |
| `goalsStore.goals` / `getGoalsByMemberId()`                      | Per-member goal count                                                               |
| `timeAgo()` from `@/utils/date`                                  | Last-seen display (unchanged)                                                       |
| Brand tint variables (`--tint-silk-10`, `--tint-orange-8`, etc.) | Card/panel backgrounds                                                              |

**Nothing is being duplicated.** No new composable file, no new utility, no new base component. The only new file is `FamilyMemberCard.vue` which extracts card markup that currently lives inline in FamilyPage.

---

### Step 1: Create `FamilyMemberCard.vue`

**File:** `src/components/family/FamilyMemberCard.vue`

Extracts the per-member card from the current FamilyPage template grid, restyled per v7 mockup:

**Layout:**

```
┌──────────────────────────────────────────────┐
│ [BeanieAvatar lg]  Name        [copy] [trash]│
│                    Role pill                  │
│                    Status badge               │
│                    ┌─────────┬──────────┐     │
│                    │📚 Act: 3│✅ Todo: 2│     │
│                    ├─────────┼──────────┤     │
│                    │🎯 Goal:1│📅 Evt: 0 │     │
│                    └─────────┴──────────┘     │
└──────────────────────────────────────────────┘
```

**Props:**

- `member: FamilyMember`
- `stats: { activities: number; todos: number; goals: number; events: number }`
- `canManage: boolean`
- `copiedFeedback: boolean` (shows "Link copied!" when true)

**Emits:** `edit`, `delete`, `copy-invite`

**Styling (faithful to v7 mockup + beanie theme conventions):**

- Card: `BaseCard` with `:hoverable="true"`, standard squircle + shadow
- Avatar: `BeanieAvatar` size `lg`, using `getMemberAvatarVariant(member)` + `member.color`
- Name: `font-outfit text-base font-bold text-secondary-500 dark:text-gray-100`
- Role pill: reuse existing `MemberRoleManager` component (already renders as a pill with `@click.stop`)
- Status badge: same amber/green pills from current page (move markup into card)
- Stats grid: `grid grid-cols-2 gap-2 mt-3`, each cell is a small rounded box (`rounded-xl bg-[var(--tint-slate-5)] dark:bg-slate-700/40 px-3 py-2`):
  - Emoji + count in `font-outfit text-xs font-semibold`
  - Label in `text-xs text-secondary-500/50`
- Action buttons: top-right, same copy/trash icons from current page
- All text through `t()` for i18n

**This component replaces** the `<BaseCard v-for="member">` block currently at lines 288-371 of FamilyPage.vue. Same events, same actions — just restyled and extracted.

### Step 2: Refactor `FamilyPage.vue` layout

**File:** `src/pages/FamilyPage.vue` (modify in-place)

**Script changes:**

- Import `FamilyMemberCard`, `useActivityStore`, `useTodoStore`, `useGoalsStore`
- Add per-member stats as a single computed (no new composable — just a Map):
  ```typescript
  const memberStats = computed(() => {
    const map = new Map<
      string,
      { activities: number; todos: number; goals: number; events: number }
    >();
    for (const m of familyStore.members) {
      map.set(m.id, {
        activities: activityStore.activeActivities.filter((a) => a.assigneeId === m.id).length,
        todos: todoStore.openTodos.filter((t) => t.assigneeId === m.id).length,
        goals: goalsStore.getGoalsByMemberId(m.id).length,
        events: upcomingThisWeek.value.filter((e) => e.activity.assigneeId === m.id).length,
      });
    }
    return map;
  });
  ```
- Add `upcomingThisWeek` computed that filters `activityStore.upcomingActivities` to next 7 days (for the quick info panel event list)
- **All existing script logic stays unchanged** — invite generation, clipboard, modals, family name editing, delete, role change, query param handling

**Template redesign:**

**Header section** (replaces current lines 235-285):

```html
<div class="flex items-center justify-between">
  <div>
    <h1 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
      {{ t('family.hub.title') }} 🫘
    </h1>
    <p class="text-secondary-500/40 text-sm dark:text-gray-500">
      <!-- "{count} beans growing strong" -->
      {{ t('family.hub.subtitle', { count: familyStore.members.length }) }}
    </p>
    <!-- Family name inline edit (retain existing markup) -->
  </div>
  <div class="flex gap-2">
    <!-- Invite button (retain existing) -->
    <!-- + Add Bean button: gradient pill -->
    <button
      v-if="canManagePod"
      class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 rounded-full bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(241,93,34,0.2)] transition-all"
      @click="openAddModal"
    >
      {{ t('family.hub.addBean') }}
    </button>
  </div>
</div>
```

**2-column content area** (replaces current grid at line 287):

```html
<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
  <!-- Member cards: 2/3 width on desktop -->
  <div class="space-y-4 lg:col-span-2">
    <FamilyMemberCard
      v-for="member in familyStore.members"
      :key="member.id"
      :member="member"
      :stats="memberStats.get(member.id)"
      :can-manage="canManagePod"
      :copied-feedback="copiedMemberId === member.id"
      :class="syncHighlightClass(member.id)"
      @edit="openEditModal(member)"
      @delete="deleteMember(member.id)"
      @copy-invite="copyMemberInviteLink(member.id)"
    />
  </div>

  <!-- Quick Info panel: 1/3 width on desktop, below on mobile -->
  <div class="space-y-5">
    <!-- Family Stats box -->
    <div
      class="rounded-[var(--sq)] bg-gradient-to-br from-[var(--tint-silk-10)] to-[var(--tint-orange-4)] p-5 dark:from-slate-700/50 dark:to-slate-700/30"
    >
      <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
        🌳 {{ t('family.hub.familyStats') }}
      </div>
      <!-- 3 stat rows: label left, bold value right -->
      <div class="space-y-2 text-xs">
        <div class="flex justify-between">
          <span class="text-secondary-500/50">{{ t('family.hub.members') }}</span>
          <span class="font-outfit text-secondary-500 font-bold dark:text-gray-200">
            {{ familyStore.members.length }}
          </span>
        </div>
        <!-- Total Activities row -->
        <!-- Upcoming Events row -->
      </div>
    </div>

    <!-- Events This Week -->
    <div>
      <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
        {{ t('family.hub.eventsThisWeek') }}
      </div>
      <!-- List of upcoming activities this week, or empty state -->
      <div v-if="upcomingThisWeek.length" class="space-y-2">
        <div
          v-for="event in upcomingThisWeek.slice(0, 5)"
          :key="event.activity.id + event.date"
          class="flex items-center gap-3 rounded-xl p-2 hover:bg-[var(--tint-slate-5)] dark:hover:bg-slate-700/40"
        >
          <span class="text-base">{{ event.activity.icon || '📅' }}</span>
          <div class="min-w-0 flex-1">
            <div
              class="font-outfit text-secondary-500 truncate text-sm font-semibold dark:text-gray-200"
            >
              {{ event.activity.title }}
            </div>
            <div class="text-secondary-500/40 text-xs dark:text-gray-500">
              {{ event.date }} · {{ event.activity.startTime || '' }}
            </div>
          </div>
        </div>
      </div>
      <p v-else class="text-secondary-500/40 text-xs dark:text-gray-500">
        {{ t('family.hub.noEvents') }}
      </p>
    </div>
  </div>
</div>
```

**Modals section stays exactly as-is** (lines 374-477) — FamilyMemberModal (add), FamilyMemberModal (edit), BaseModal (invite).

### Step 3: Add i18n keys

**File:** `src/services/translation/uiStrings.ts`

New keys (using existing pattern — `en` Title Case for labels, `beanie` all lowercase):

```
'family.hub.title'           → { en: 'The Bean Pod', beanie: 'the bean pod' }
'family.hub.subtitle'        → { en: '{count} Beans Growing Strong', beanie: '{count} beans growing strong' }
'family.hub.addBean'         → { en: '+ Add Bean', beanie: '+ add bean' }
'family.hub.quickInfo'       → { en: 'Quick Info', beanie: 'quick info' }
'family.hub.familyStats'     → { en: 'Family Stats', beanie: 'family stats' }
'family.hub.members'         → { en: 'Members', beanie: 'beanies' }
'family.hub.totalActivities' → { en: 'Total Activities', beanie: 'total activities' }
'family.hub.upcomingEvents'  → { en: 'Upcoming Events', beanie: 'upcoming events' }
'family.hub.eventsThisWeek'  → { en: 'Events This Week', beanie: 'events this week' }
'family.hub.noEvents'        → { en: 'No Events This Week', beanie: 'no events this week' }
'family.hub.stat.activities' → { en: 'Activities', beanie: 'activities' }
'family.hub.stat.todos'      → { en: 'Todos', beanie: 'todos' }
'family.hub.stat.goals'      → { en: 'Goals', beanie: 'goals' }
'family.hub.stat.events'     → { en: 'Events', beanie: 'events' }
```

### Step 4: Run translation sync

`npm run translate` to sync new keys to all language files.

## Files affected

| Action     | File                                         | Why                                                             |
| ---------- | -------------------------------------------- | --------------------------------------------------------------- |
| **Create** | `src/components/family/FamilyMemberCard.vue` | Extract + restyle member card from FamilyPage                   |
| **Modify** | `src/pages/FamilyPage.vue`                   | New layout, header, quick info panel, per-member stats computed |
| **Modify** | `src/services/translation/uiStrings.ts`      | ~14 new i18n keys                                               |

**Unchanged (reused as-is):** `FamilyMemberModal.vue`, `InviteLinkCard.vue`, `MemberRoleManager.vue`, `BeanieAvatar.vue`, `BaseCard.vue`, `BaseButton.vue`, `BaseModal.vue`, `BeanieIcon.vue`

**No new composable, utility, or base component needed.**

## Design fidelity notes

- **Typography**: All sizes use standard Tailwind classes (`text-xs` min 12px, `text-sm`, `text-base`, `text-2xl`). The mockup's sub-12px sizes (0.6rem, 0.65rem) are mapped up to `text-xs` per the beanie theme rule "minimum 12px".
- **Colors**: Heritage Orange `#F15D22`, Terracotta `#E67E22`, Sky Silk `#AED6F1`, Deep Slate `#2C3E50` via existing CSS variables and Tailwind color scale.
- **Gradient button**: `from-primary-500 to-terracotta-400` — matches existing gradient CTA pattern used in BeanieFormModal save buttons.
- **Card shape**: Squircle corners `rounded-[var(--sq)]` + `shadow-[var(--card-shadow)]` — standard card pattern.
- **Stats grid**: 2×2 with emoji + count + label per cell — faithful to mockup's per-member stats concept, adapted to use counts from real store data.
- **Quick info panel**: Gradient background box for family stats, event list with activity icons — faithful to mockup's right panel.
- **Dark mode**: All elements have dark: variants using existing slate-700/800 patterns.
- **Mobile**: `grid-cols-1 lg:grid-cols-3` — single column on mobile, quick info stacks below cards.

## Verification

1. `npm run type-check` — no errors
2. `npm run lint` — clean
3. `npm run dev` — visual check:
   - Desktop: 2-column layout (member cards 2/3, quick info 1/3)
   - Mobile (<1024px): single column, quick info below cards
   - Header: "The Bean Pod 🫘" title + gradient "+ Add Bean" pill button
   - Member cards: avatar, name, role pill, status badge, 2×2 stats grid, action icons
   - Stats show real per-member counts (0 when no data)
   - Click card → edit modal opens
   - Delete button works (non-owner only)
   - Copy invite link works (pending members)
   - Family name inline edit works
   - Invite modal works (link + QR + email sharing)
   - Query params `?add=true` / `?edit={id}` still work
   - Quick info panel: family stats + events this week list (or empty state)
   - Dark mode renders correctly
   - Sync highlight animation works on cards
4. `npm run translate` — sync succeeds
5. `npm run test:run` — existing tests pass
