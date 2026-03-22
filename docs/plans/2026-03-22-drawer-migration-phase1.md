# Plan: Migrate Activity Forms from Modals to Drawers (Phase 1)

> Date: 2026-03-22
> Related issues: None (architectural improvement)

## Context

The app uses modals extensively (20+ modals via BeanieFormModal) but the drawer pattern (DayAgendaSidebar) is more space-efficient — full viewport height, fewer borders, better mobile UX. The decision is to migrate all form-based UI to drawers, keeping modals only for small decision dialogs (ConfirmModal, PasswordModal, TrustDeviceModal, PasskeyPromptModal, RecurringEditScopeModal, CreatedConfirmModal, logout confirmation).

**Phase 1 scope:** Activity-related forms only (ActivityModal, ActivityViewEditModal). If this looks good, Phase 2 converts everything else.

**Rules:**

- All drawers slide from the right
- NEVER drawer-on-drawer or modal-on-modal
- Modal on top of drawer IS allowed (e.g., ConfirmModal over a form drawer)
- Drawer sizes must be easy to adjust (single mapping object)
- Filenames stay as-is for Phase 1; bulk rename in Phase 2

## DRY Strategy

BeanieFormModal's branded UI (icon squircle header, Cloud White body, gradient save button, delete button, `#footer-start` slot) is **container-agnostic** — it works identically whether inside a modal or a drawer. Both `BaseModal` and `BaseSidePanel` have **identical slot APIs** (`#header`, default, `#footer`).

**Approach:** Add a `variant: 'modal' | 'drawer'` prop to `BeanieFormModal`. Use `<component :is>` to switch between `BaseModal` and `BaseSidePanel`. All 16 existing consumers are unaffected (variant defaults to `'modal'`). Zero code duplication, no new component file.

## Implementation Steps

### Step 1: Create shared overlay scroll lock utility

**New file:** `src/utils/overlayStack.ts`

Both `BaseModal` and `BaseSidePanel` independently manage `document.body.style.overflow` with identical code (watch + onUnmounted). **Bug:** When ConfirmModal (z-50) opens on top of a drawer (z-40), closing the modal restores scroll while the drawer is still open.

Create a ref-counted lock:

```ts
let count = 0;

export function lockBodyScroll() {
  count++;
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll() {
  count = Math.max(0, count - 1);
  if (count === 0) document.body.style.overflow = '';
}
```

### Step 2: Update `BaseModal` to use overlay stack

**File:** `src/components/ui/BaseModal.vue`

Replace the inline overflow watcher (lines 56-65) and the `onUnmounted` overflow cleanup (line 73) with calls to `lockBodyScroll()` / `unlockBodyScroll()` from Step 1.

- `watch(open)`: call `lockBodyScroll()` on open, `unlockBodyScroll()` on close
- `onUnmounted`: call `unlockBodyScroll()` (handles component destruction while open)

No other changes to BaseModal.

### Step 3: Extend `BaseSidePanel`

**File:** `src/components/ui/BaseSidePanel.vue`

Three additions:

1. **`size` prop** with configurable mapping:

   ```ts
   size?: 'narrow' | 'medium' | 'wide' | 'full'  // default: 'narrow'

   const sizeClasses = {
     narrow: 'max-w-md',   // 448px — DayAgendaSidebar, light forms
     medium: 'max-w-lg',   // 512px — view/edit forms
     wide:   'max-w-xl',   // 576px — creation forms with many fields
     full:   'max-w-2xl',  // 672px — wizards, complex forms
   }
   ```

   Replace hardcoded `max-w-md` on line 75 with `sizeClasses[props.size]`.

2. **`closable` prop** (default: `true`):
   - When `false`, escape key and backdrop click are ignored (prevents close during form submission)
   - Close button is visually disabled
   - Mirrors `BaseModal`'s existing `closable` behavior (lines 44-48)

3. **Accessibility:** Add `role="dialog" aria-modal="true"` to the panel div (line 74).
   - BaseModal already has this (line 107). BaseSidePanel does not.
   - **Critical for e2e tests:** The planner e2e tests (`e2e/specs/09-planner.spec.ts`) use `page.locator('[role="dialog"]')` and `page.locator('div[role="dialog"]')` extensively to find form elements. Without this attribute, tests would fail silently (selectors wouldn't match).

4. **Use overlay stack:** Replace inline overflow watcher (lines 29-38) and `onUnmounted` cleanup (line 46) with `lockBodyScroll()` / `unlockBodyScroll()`.

### Step 4: Add `variant` prop to `BeanieFormModal`

**File:** `src/components/ui/BeanieFormModal.vue`

1. Add prop: `variant?: 'modal' | 'drawer'` (default: `'modal'`)

2. Import `BaseSidePanel` alongside `BaseModal`

3. Replace `<BaseModal ...>` with `<component :is="containerComponent" v-bind="containerProps" @close="emit('close')">` where:

   ```ts
   const containerComponent = computed(() =>
     props.variant === 'drawer' ? BaseSidePanel : BaseModal
   );

   const drawerSizeMap: Record<string, string> = {
     narrow: 'narrow',
     default: 'medium',
     wide: 'wide',
   };
   const modalSizeMap: Record<string, string> = {
     narrow: 'lg',
     default: 'xl',
     wide: '2xl',
   };

   const containerProps = computed(() => {
     if (props.variant === 'drawer') {
       return {
         open: props.open,
         size: drawerSizeMap[props.size] || 'medium',
         closable: !props.isSubmitting,
       };
     }
     return {
       open: props.open,
       size: modalSizeMap[props.size] || 'xl',
       closable: !props.isSubmitting,
       fullscreenMobile: true,
       customHeader: props.customHeader,
     };
   });
   ```

4. The entire template body (branded header, Cloud White body, footer with delete/save/`footer-start`) stays **completely unchanged**. Only the wrapping container switches.

**Why this is safe:** All 16 existing BeanieFormModal consumers omit `variant`, so they default to `'modal'` — zero behavioral change. The three consumers that use `#footer-start` (ActivityViewEditModal, TransactionViewEditModal, VacationWizard) continue to work since that slot is in BeanieFormModal's footer template, not in the container.

### Step 5: Convert `ActivityModal` to drawer

**File:** `src/components/planner/ActivityModal.vue`

One prop addition at line 358:

```vue
<BeanieFormModal
  variant="drawer"
  :open="open"
  ...
```

Consider setting `size="wide"` — ActivityModal has 20+ fields and benefits from the extra width (576px vs default 512px). All form logic, validation, emits unchanged.

### Step 6: Convert `ActivityViewEditModal` to drawer

**File:** `src/components/planner/ActivityViewEditModal.vue`

One prop addition at line 583:

```vue
<BeanieFormModal
  v-if="activity"
  variant="drawer"
  :open="true"
  ...
```

Keep default size (maps to `'medium'` / 512px). All inline edit logic, scope handling, `#footer-start` slot unchanged.

### Step 7: Verify page orchestration (anti-stacking)

**File:** `src/pages/FamilyPlannerPage.vue`

Review each drawer transition for anti-stacking compliance:

| Trigger                                              | Closes                                           | Opens                                       | Anti-stacking                                                    |
| ---------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| Calendar day click                                   | —                                                | DayAgendaSidebar                            | Only drawer                                                      |
| Sidebar "Add Activity" (`handleSidebarAdd` line 151) | `sidebarDate = null`                             | ActivityModal                               | Already correct                                                  |
| Sidebar edit activity (`handleSidebarEdit` line 158) | `sidebarDate = null`                             | ActivityViewEditModal (via `openViewModal`) | Already correct                                                  |
| View "Edit" button (`handleViewOpenEdit` line 163)   | `viewingActivity = null` (in composable line 40) | ActivityModal (`showModal = true`)          | Already correct                                                  |
| Page-level "Add Activity" (`openAddModal` line 139)  | —                                                | ActivityModal                               | **Needs fix:** add `sidebarDate = null` to close sidebar if open |

**One fix needed:** In `openAddModal()` (line 139), add `sidebarDate.value = null;` as the first line to close DayAgendaSidebar if it's open when the user clicks the page-level "Add Activity" button.

**File:** `src/pages/FamilyNookPage.vue`

FamilyNookPage doesn't have DayAgendaSidebar, so no sidebar-to-drawer transitions. The `handleActivityOpenEdit` (line 64) sets `viewingActivity = null` via `scopedActivityOpenEdit()` before opening the edit drawer — already correct.

### Step 8: Update e2e tests

**File:** `e2e/specs/09-planner.spec.ts`

The e2e tests use `[role="dialog"]` selectors (lines 37, 47, 597, 601, 605) which will continue to work because Step 3 adds `role="dialog"` to BaseSidePanel.

However, the tests reference modals by text content ("activity details", "edit activity", "new activity") which are independent of container type — these selectors remain valid.

**One test comment update:** Line 25 says "defaults to week view" — we changed the default to month view in the prior commit. Update this comment to avoid confusion during test maintenance.

No functional test changes needed — the e2e tests interact via text content and roles, not CSS selectors tied to modal-specific markup.

### Step 9: Add unit test for BeanieFormModal variant behavior

**New file:** `src/components/ui/__tests__/BeanieFormModal.test.ts`

Add a focused unit test verifying the `variant` prop switches the container:

```ts
import { mount } from '@vue/test-utils';
import BeanieFormModal from '../BeanieFormModal.vue';
import BaseSidePanel from '../BaseSidePanel.vue';
import BaseModal from '../BaseModal.vue';

describe('BeanieFormModal', () => {
  it('renders BaseModal by default (variant="modal")', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { open: true, title: 'Test' },
    });
    expect(wrapper.findComponent(BaseModal).exists()).toBe(true);
    expect(wrapper.findComponent(BaseSidePanel).exists()).toBe(false);
  });

  it('renders BaseSidePanel when variant="drawer"', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { open: true, title: 'Test', variant: 'drawer' },
    });
    expect(wrapper.findComponent(BaseSidePanel).exists()).toBe(true);
    expect(wrapper.findComponent(BaseModal).exists()).toBe(false);
  });

  it('maps size correctly for drawer variant', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { open: true, title: 'Test', variant: 'drawer', size: 'wide' },
    });
    const panel = wrapper.findComponent(BaseSidePanel);
    expect(panel.props('size')).toBe('wide');
  });

  it('passes closable=false when isSubmitting', () => {
    const wrapper = mount(BeanieFormModal, {
      props: { open: true, title: 'Test', variant: 'drawer', isSubmitting: true },
    });
    const panel = wrapper.findComponent(BaseSidePanel);
    expect(panel.props('closable')).toBe(false);
  });
});
```

Note: May need to mock `useTranslation` and `Teleport` depending on test setup. Check `src/components/transactions/TransactionModal.test.ts` for existing patterns.

### Step 10: Add unit test for overlay scroll lock

**New file:** `src/utils/__tests__/overlayStack.test.ts`

```ts
import { lockBodyScroll, unlockBodyScroll } from '../overlayStack';

describe('overlayStack', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
    // Reset internal counter — may need to export a reset function for tests
  });

  it('locks body scroll on first lock', () => {
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps body locked with multiple overlays', () => {
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('unlocks body when all overlays close', () => {
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('never goes below zero', () => {
    unlockBodyScroll();
    unlockBodyScroll();
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
  });
});
```

Add a `resetOverlayStack()` export for test isolation.

## Files affected

| File                                                  | Change                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `src/utils/overlayStack.ts`                           | **NEW** — ref-counted body scroll lock (~15 lines)                |
| `src/utils/__tests__/overlayStack.test.ts`            | **NEW** — unit tests for overlay stack                            |
| `src/components/ui/BaseModal.vue`                     | Use overlay stack (replace inline overflow management)            |
| `src/components/ui/BaseSidePanel.vue`                 | Add `size` + `closable` props, `role="dialog"`, use overlay stack |
| `src/components/ui/BeanieFormModal.vue`               | Add `variant` prop, dynamic container via `<component :is>`       |
| `src/components/ui/__tests__/BeanieFormModal.test.ts` | **NEW** — unit tests for variant switching                        |
| `src/components/planner/ActivityModal.vue`            | Add `variant="drawer"` (one prop)                                 |
| `src/components/planner/ActivityViewEditModal.vue`    | Add `variant="drawer"` (one prop)                                 |
| `src/pages/FamilyPlannerPage.vue`                     | Add `sidebarDate = null` in `openAddModal()`                      |
| `e2e/specs/09-planner.spec.ts`                        | Update comment (week→month default)                               |

## What does NOT change

- `BaseModal` API (backward compatible)
- `BeanieFormModal` API for existing consumers (variant defaults to `'modal'`)
- `DayAgendaSidebar` (already uses BaseSidePanel directly)
- `useFormModal` composable (container-agnostic)
- `useActivityScopeEdit` composable (container-agnostic)
- All 14 non-activity BeanieFormModal consumers (AccountModal, TransactionModal, GoalModal, etc.)
- ConfirmModal, RecurringEditScopeModal, CreatedConfirmModal (stay as modals)
- Z-index layering (drawers z-40, modals z-50/z-60 — already correct)

## Verification

1. **Run unit tests:** `npm run test:run` — all existing tests pass, new overlay stack and BeanieFormModal variant tests pass
2. **Run type check:** `npm run type-check` — no TypeScript errors
3. **Desktop flow:**
   - Click calendar day → DayAgendaSidebar slides from right
   - Click activity in sidebar → sidebar closes, view drawer slides in
   - Click "Edit" in view drawer → view drawer closes, edit drawer slides in
   - Click delete in edit drawer → ConfirmModal opens ON TOP of drawer
   - Confirm → both close, no orphaned backdrops, scroll restored
4. **Add activity with sidebar open:** Click "Add Activity" button → sidebar closes, edit drawer opens (no two drawers visible)
5. **Mobile:** Drawers fill full screen width, close button works, body doesn't scroll behind drawer
6. **Overflow stacking:** Open drawer → open ConfirmModal → close ConfirmModal → body still locked → close drawer → body scroll restored
7. **Recurring scope:** RecurringEditScopeModal opens on top of view drawer (z-60 over z-40)
8. **FamilyNookPage:** Activity view/edit flows work identically
9. **Run e2e tests:** `npx playwright test e2e/specs/09-planner.spec.ts` — all planner tests pass
10. **Spot check non-activity modals:** Open AccountModal, TransactionModal, GoalModal — confirm they still render as centered modals (variant defaults to `'modal'`)
