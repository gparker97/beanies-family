<script setup lang="ts">
/**
 * Quick-add bottom sheet.
 *
 * Sits inside `<BaseModal>` so it inherits backdrop, focus trap, Esc
 * handling, and body-scroll lock from the existing infrastructure.
 * No new BaseModal variant — positioning is scoped CSS on the body
 * content. If a second bottom-sheet surface emerges, promote this to
 * a `BaseModal placement="bottom-sheet"` prop (see plan § Deferred).
 *
 * Section ordering is driven entirely by `QUICK_ADD_BY_GROUP` — no
 * hard-coded item lists in the template, so adding an entity to the
 * config automatically lands it in the right place.
 */
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import QuickAddPicker from '@/components/common/QuickAddPicker.vue';
import QuickAddMemberPicker from '@/components/common/QuickAddMemberPicker.vue';
import {
  QUICK_ADD_BY_GROUP,
  type QuickAddGroup,
  type QuickAddItem,
} from '@/constants/quickAddItems';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';

const { t } = useTranslation();
const { canViewFinances, canEditActivities } = usePermissions();
const { isOpen, stage, close, triggerAction } = useQuickAdd();

/**
 * Per-member filter applied to every group. Items declare a
 * `requiredPermission` ('finance' | 'activities'); the sheet hides
 * any item the current member can't act on — and hides a whole
 * section when it ends up empty.
 */
function itemAllowed(item: QuickAddItem): boolean {
  if (item.requiredPermission === 'finance') return canViewFinances.value;
  return canEditActivities.value;
}

const allowedByGroup = computed<Record<QuickAddGroup, readonly QuickAddItem[]>>(() => ({
  everyday: QUICK_ADD_BY_GROUP.everyday.filter(itemAllowed),
  family: QUICK_ADD_BY_GROUP.family.filter(itemAllowed),
  money: QUICK_ADD_BY_GROUP.money.filter(itemAllowed),
  care: QUICK_ADD_BY_GROUP.care.filter(itemAllowed),
}));

/** Narrowed picker-stage payload — `null` when sheet is in main mode. */
const pickerItem = computed<QuickAddItem | null>(() =>
  stage.value.mode === 'picker' ? stage.value.pending : null
);

/**
 * Member-required items get an INLINE picker (bean-jar expansion at
 * the bottom of the main grid) so the user stays spatially anchored
 * to their tap. Recipe + medication pickers stay as a full view-swap
 * — they're list-shaped and can be long.
 */
const isMemberInlinePicker = computed(() => pickerItem.value?.contextKey === 'memberId');

/** True when we render the view-swap picker (recipe / medication). */
const isSwapPicker = computed(() => pickerItem.value !== null && !isMemberInlinePicker.value);

/** Used to highlight the tapped tile while the inline picker is open. */
function isPending(item: QuickAddItem): boolean {
  return pickerItem.value?.id === item.id;
}

/**
 * Inline-picker layout strategy:
 *  - Picker slots in DIRECTLY AFTER the section holding the pending
 *    item (Everyday, Family, or Care — Money has no member items).
 *  - Sections BELOW the pending's section are hidden while picker is
 *    open. Keeping them visible pushes the picker mid-sheet with more
 *    content below, making it hard for users to see "what just
 *    happened" when they re-tap an item further up on mobile.
 *  - Sections AT or ABOVE the pending section stay visible so the
 *    user can still tap a different everyday-item / family-item to
 *    change their mind without pressing Back first.
 */
const GROUP_ORDER: Record<QuickAddGroup, number> = {
  everyday: 0,
  family: 1,
  money: 2,
  care: 3,
};

function showSection(group: QuickAddGroup): boolean {
  if (!isMemberInlinePicker.value || !pickerItem.value) return true;
  return GROUP_ORDER[group] <= GROUP_ORDER[pickerItem.value.group];
}

function pickerAfter(group: QuickAddGroup): boolean {
  if (!isMemberInlinePicker.value || !pickerItem.value) return false;
  return pickerItem.value.group === group;
}

// The secondary groups — iterated in display order. Everyday renders
// in its own kraft-paper card above this list.
const SECONDARY_GROUPS: readonly {
  id: QuickAddGroup;
  titleKey:
    | 'quickAdd.groups.family.title'
    | 'quickAdd.groups.money.title'
    | 'quickAdd.groups.care.title';
  suffixKey?: 'quickAdd.groups.money.setup';
}[] = [
  { id: 'family', titleKey: 'quickAdd.groups.family.title' },
  {
    id: 'money',
    titleKey: 'quickAdd.groups.money.title',
    suffixKey: 'quickAdd.groups.money.setup',
  },
  { id: 'care', titleKey: 'quickAdd.groups.care.title' },
];

function handleItemClick(item: QuickAddItem): void {
  triggerAction(item);
}
</script>

<template>
  <BaseModal :open="isOpen" size="md" :closable="true" @close="close">
    <!-- Recipe / medication picker: full view-swap -->
    <QuickAddPicker v-if="isSwapPicker" :pending="pickerItem!" />

    <!-- Main grid (+ inline member picker appended when a member-required
         item is pending). Tapping a different item while the picker is
         open just updates `pending` — the picker re-renders in place. -->
    <div v-else class="sheet-body" data-testid="quick-add-sheet">
      <header class="sheet-header">
        <h2 id="quick-add-sheet-title" class="sheet-title">
          {{ t('quickAdd.title') }}
        </h2>
        <!-- Corner × — primary close affordance, always in reach. The
             bottom "close" pill is a secondary/thumb-friendly fallback. -->
        <button
          type="button"
          class="sheet-close-x"
          :aria-label="t('quickAdd.close')"
          data-testid="quick-add-close-x"
          @click="close"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <!-- Everyday beans — kraft-paper card with 3x2 grid -->
      <section
        v-if="allowedByGroup.everyday.length > 0"
        class="everyday-card"
        :aria-labelledby="'quick-add-everyday-kicker'"
      >
        <div class="everyday-header">
          <span id="quick-add-everyday-kicker" class="everyday-kicker">
            {{ t('quickAdd.groups.everyday.kicker') }}
          </span>
          <span class="everyday-subhint">
            {{ t('quickAdd.groups.everyday.subhint') }}
          </span>
        </div>
        <div class="everyday-grid">
          <button
            v-for="(item, idx) in allowedByGroup.everyday"
            :key="item.id"
            type="button"
            class="everyday-item"
            :class="{ 'is-pending': isPending(item) }"
            :style="{ '--stagger-delay': `${120 + idx * 60}ms` }"
            :data-testid="`quick-add-item-${item.id}`"
            :aria-pressed="isPending(item) ? 'true' : undefined"
            @click="handleItemClick(item)"
          >
            <span class="everyday-emoji" aria-hidden="true">{{ item.emoji }}</span>
            <span class="everyday-label">{{ t(item.labelKey) }}</span>
          </button>
        </div>
      </section>

      <!-- Inline picker slotted after Everyday when Saying is pending -->
      <QuickAddMemberPicker v-if="pickerAfter('everyday')" />

      <!-- Secondary groups — Family, Money (setup), Care. Each section
           may render a picker directly after it when its group holds
           the pending item. Sections below the pending's group are
           hidden via `showSection` to keep the picker anchored at the
           visible bottom of the sheet. -->
      <template v-for="(group, gIdx) in SECONDARY_GROUPS" :key="group.id">
        <section
          v-if="showSection(group.id) && allowedByGroup[group.id].length > 0"
          class="secondary-group"
          :style="{ '--stagger-delay': `${400 + gIdx * 100}ms` }"
        >
          <h3 class="secondary-title">
            {{ t(group.titleKey) }}
            <em v-if="group.suffixKey" class="secondary-suffix"> · {{ t(group.suffixKey) }} </em>
          </h3>
          <div class="secondary-grid">
            <button
              v-for="(item, idx) in allowedByGroup[group.id]"
              :key="item.id"
              type="button"
              class="secondary-item"
              :class="{ 'is-pending': isPending(item) }"
              :style="{ '--stagger-delay': `${400 + gIdx * 100 + idx * 40}ms` }"
              :data-testid="`quick-add-item-${item.id}`"
              :aria-pressed="isPending(item) ? 'true' : undefined"
              @click="handleItemClick(item)"
            >
              <span class="secondary-emoji" aria-hidden="true">{{ item.emoji }}</span>
              <span class="secondary-text">
                <span class="secondary-label">{{ t(item.labelKey) }}</span>
                <span class="secondary-hint">{{ t(item.hintKey) }}</span>
              </span>
            </button>
          </div>
        </section>
        <QuickAddMemberPicker v-if="pickerAfter(group.id)" />
      </template>

      <!-- Footer: thumb-friendly close for mobile. The corner × is the
           primary affordance; this wide pill is the reach-friendly
           fallback. Styled as a filled slate "utility" pill so it reads
           distinctly different from the orange-accented action tiles. -->
      <footer class="sheet-footer">
        <button type="button" class="sheet-close" data-testid="quick-add-close" @click="close">
          {{ t('quickAdd.close') }}
        </button>
      </footer>
    </div>
  </BaseModal>
</template>

<style scoped>
.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sheet-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.sheet-title {
  color: rgb(var(--color-ink, 44 62 80));
  font-family: Outfit, sans-serif;
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
}

:global(.dark) .sheet-title {
  color: rgb(241 242 244);
}

/* Corner × — small, muted, always-there. Used chiefly by desktop /
   keyboard users; mobile thumb-users have the wider bottom pill. */
.sheet-close-x {
  align-items: center;
  background: transparent;
  border: none;
  border-radius: 999px;
  color: rgb(44 62 80 / 55%);
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  font-family: Outfit, sans-serif;
  font-size: 1.5rem;
  font-weight: 400;
  height: 32px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 0.15s ease-out,
    color 0.15s ease-out,
    transform 0.15s ease-out;
  width: 32px;
}

.sheet-close-x:hover {
  background: rgb(44 62 80 / 8%);
  color: rgb(44 62 80);
}

.sheet-close-x:active {
  transform: scale(0.9);
}

.sheet-close-x:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .sheet-close-x {
  color: rgb(241 242 244 / 55%);
}

:global(.dark) .sheet-close-x:hover {
  background: rgb(241 242 244 / 10%);
  color: rgb(241 242 244);
}

/* --- Everyday kraft-paper card --- */
.everyday-card {
  background: linear-gradient(
    135deg,
    var(--tint-orange-15, rgb(241 93 34 / 15%)) 0%,
    var(--tint-orange-8, rgb(241 93 34 / 8%)) 100%
  );
  border: 1px solid var(--tint-orange-15, rgb(241 93 34 / 20%));
  border-radius: 20px;
  padding: 18px;
  position: relative;
}

.everyday-header {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.everyday-kicker {
  color: #f15d22;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.everyday-subhint {
  color: rgb(44 62 80 / 65%);
  font-size: 0.75rem;
  font-style: italic;
}

:global(.dark) .everyday-subhint {
  color: rgb(241 242 244 / 65%);
}

.everyday-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.everyday-item {
  align-items: center;
  animation: jar-pop 550ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: var(--stagger-delay, 0ms);
  background: white;
  border: 1px solid rgb(241 93 34 / 15%);
  border-radius: 16px;
  box-shadow: 0 2px 6px -2px rgb(44 62 80 / 10%);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  padding: 14px 8px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.15s ease-out,
    box-shadow 0.15s ease-out,
    border-color 0.15s ease-out;
}

:global(.dark) .everyday-item {
  background: rgb(30 41 59);
  border-color: rgb(241 93 34 / 25%);
}

.everyday-item:hover {
  border-color: rgb(241 93 34 / 35%);
  box-shadow: 0 6px 12px -4px rgb(241 93 34 / 25%);
  transform: translateY(-2px);
}

.everyday-item:active {
  transform: translateY(0) scale(0.97);
}

.everyday-item:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

/* Tile is the pending item while the inline member picker is open —
   Heritage Orange ring anchors "you tapped this; now pick a beanie". */
.everyday-item.is-pending {
  border-color: rgb(241 93 34 / 70%);
  box-shadow:
    0 0 0 3px rgb(241 93 34 / 22%),
    0 6px 14px -4px rgb(241 93 34 / 30%);
  transform: translateY(-2px);
}

.everyday-emoji {
  font-size: 1.625rem;
  line-height: 1;
}

.everyday-label {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
}

:global(.dark) .everyday-label {
  color: rgb(241 242 244);
}

/* --- Secondary groups --- */
.secondary-group {
  animation: fade-up 350ms ease-out backwards;
  animation-delay: var(--stagger-delay, 0ms);
}

.secondary-title {
  color: rgb(44 62 80 / 75%);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 0 0 10px;
  text-transform: uppercase;
}

:global(.dark) .secondary-title {
  color: rgb(241 242 244 / 75%);
}

.secondary-suffix {
  color: rgb(44 62 80 / 55%);
  font-family: Inter, sans-serif;
  font-size: 0.75rem;
  font-style: italic;
  font-weight: 400;
  letter-spacing: 0;
  margin-left: 4px;
  text-transform: none;
}

:global(.dark) .secondary-suffix {
  color: rgb(241 242 244 / 55%);
}

.secondary-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.secondary-item {
  align-items: center;
  background: white;
  border: 1px solid rgb(44 62 80 / 10%);
  border-radius: 14px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  padding: 12px 14px;
  -webkit-tap-highlight-color: transparent;
  text-align: left;
  transition:
    transform 0.15s ease-out,
    background-color 0.15s ease-out,
    border-color 0.15s ease-out;
}

.secondary-item:hover {
  background: rgb(241 93 34 / 4%);
  border-color: rgb(241 93 34 / 20%);
  transform: translateY(-1px);
}

.secondary-item:active {
  transform: translateY(0) scale(0.98);
}

.secondary-item:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

.secondary-item.is-pending {
  background: rgb(241 93 34 / 6%);
  border-color: rgb(241 93 34 / 70%);
  box-shadow:
    0 0 0 3px rgb(241 93 34 / 22%),
    0 6px 14px -4px rgb(241 93 34 / 30%);
  transform: translateY(-1px);
}

:global(.dark) .secondary-item {
  background: rgb(30 41 59);
  border-color: rgb(241 242 244 / 10%);
}

:global(.dark) .secondary-item:hover {
  background: rgb(241 93 34 / 10%);
}

.secondary-emoji {
  flex-shrink: 0;
  font-size: 1.375rem;
  line-height: 1;
}

.secondary-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.secondary-label {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
}

:global(.dark) .secondary-label {
  color: rgb(241 242 244);
}

.secondary-hint {
  color: rgb(44 62 80 / 60%);
  font-size: 0.75rem;
  line-height: 1.3;
}

:global(.dark) .secondary-hint {
  color: rgb(241 242 244 / 60%);
}

/* --- Footer close --- */
.sheet-footer {
  align-items: center;
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

/* Bottom close — filled slate pill. Intentionally neutral (no orange,
   no white) so it reads as a "utility / dismiss" target rather than
   another action. Wider than the corner × so it's thumb-friendly. */
.sheet-close {
  background: rgb(44 62 80 / 6%);
  border: 1px solid transparent;
  border-radius: 999px;
  color: rgb(44 62 80 / 80%);
  cursor: pointer;
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  min-width: 140px;
  padding: 11px 28px;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 0.15s ease-out,
    color 0.15s ease-out,
    transform 0.15s ease-out;
}

.sheet-close:hover {
  background: rgb(44 62 80 / 10%);
  color: rgb(44 62 80);
}

.sheet-close:active {
  transform: scale(0.97);
}

.sheet-close:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .sheet-close {
  background: rgb(241 242 244 / 8%);
  color: rgb(241 242 244 / 80%);
}

:global(.dark) .sheet-close:hover {
  background: rgb(241 242 244 / 14%);
  color: rgb(241 242 244);
}

/* --- Animations (gated on reduced-motion) --- */
@keyframes jar-pop {
  0% {
    opacity: 0;
    transform: translateY(28px) scale(0.35);
  }

  70% {
    opacity: 1;
    transform: translateY(-2px) scale(1.04);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes fade-up {
  0% {
    opacity: 0;
    transform: translateY(10px);
  }

  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .everyday-item,
  .secondary-group {
    animation: none;
  }

  .everyday-item:hover,
  .secondary-item:hover {
    transform: none;
  }
}
</style>
