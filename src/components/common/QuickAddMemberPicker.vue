<script setup lang="ts">
/**
 * Inline member picker — the "bean-jar expansion" variant of the
 * picker flow. Renders at the bottom of the main sheet body when the
 * user taps a member-required item (saying / favorite / note /
 * medication / allergy) without a member in context.
 *
 * Why inline here and view-swap for recipe/medication:
 * - Families are small (3–8 beanies) — fits a tight inline card
 * - Member selection is the most common picker case
 * - Staying in the main grid keeps the spatial connection to the
 *   tapped tile (which is highlighted via `is-pending`) and lets
 *   the user change their mind without backing out
 * - Recipes and medications can be unbounded — they need a full
 *   scrollable view; fan-out/inline doesn't scale past ~8 items
 *
 * Implementation notes:
 * - No absolute positioning. Flow-layout only → no edge-collision
 *   math, works anywhere the sheet puts it.
 * - `scrollIntoView({ block: 'nearest' })` on mount ensures the
 *   picker is visible when sheet content is taller than the
 *   viewport (phones + long sheets).
 * - Reads `stage.pending` directly from `useQuickAdd` — no need
 *   for a prop, single source of truth.
 */
import { computed, onMounted, nextTick, useTemplateRef, watch } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';
import { getAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl } from '@/composables/useMemberInfo';
import { useFamilyStore } from '@/stores/familyStore';

const { t } = useTranslation();
const { stage, commitPicker, cancelPicker } = useQuickAdd();
const familyStore = useFamilyStore();

// Pets can't be the target of sayings / favorites / notes / meds /
// allergies per the existing pod conventions — same filter the Bean
// detail page + scrapbook use elsewhere.
const members = computed(() => familyStore.sortedHumans);

// The pending item backs the header copy ("Pick a beanie for
// <Label>"). Guarded — this component should only mount when
// `stage.mode === 'picker'`, but we stay defensive against future
// mount-order bugs.
const pendingLabel = computed(() => {
  if (stage.value.mode !== 'picker') return '';
  return t(stage.value.pending.labelKey);
});

const rootRef = useTemplateRef<HTMLElement>('rootRef');

async function scrollPickerIntoView(): Promise<void> {
  await nextTick();
  rootRef.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Initial mount (new position when pending's GROUP changes → v-if
// re-mounts us in the new slot).
onMounted(() => {
  void scrollPickerIntoView();
});

// Re-tapping ANOTHER member-required item within the same group keeps
// us mounted (same v-if slot), so onMounted doesn't fire. Watch the
// pending id and re-scroll — without this, mobile users scrolling up
// and tapping a sibling would see no response and the picker would
// feel broken even though it updated its highlight + header copy.
watch(
  () => (stage.value.mode === 'picker' ? stage.value.pending.id : null),
  (newId, oldId) => {
    if (!newId || !oldId || newId === oldId) return;
    void scrollPickerIntoView();
  }
);

function handlePick(memberId: string): void {
  commitPicker(memberId);
}
</script>

<template>
  <section
    ref="rootRef"
    class="inline-picker"
    data-testid="quick-add-member-picker-inline"
    :aria-label="t('quickAdd.picker.bean.title')"
  >
    <header class="picker-header">
      <button
        type="button"
        class="back-chip"
        :aria-label="t('quickAdd.picker.back')"
        @click="cancelPicker"
      >
        <span aria-hidden="true">←</span>
        <span>{{ t('quickAdd.picker.back') }}</span>
      </button>
      <div class="picker-title-stack">
        <span class="picker-kicker">{{ t('quickAdd.picker.bean.title') }}</span>
        <span v-if="pendingLabel" class="picker-for-label">{{ pendingLabel }}</span>
      </div>
    </header>

    <div v-if="members.length === 0" class="empty">
      <span class="empty-emoji" aria-hidden="true">🌱</span>
      <p class="empty-message">{{ t('quickAdd.picker.bean.empty') }}</p>
    </div>

    <div v-else class="grid">
      <button
        v-for="(member, idx) in members"
        :key="member.id"
        type="button"
        class="tile"
        :style="{ '--stagger-delay': `${60 + idx * 50}ms` }"
        :data-testid="`quick-add-member-inline-tile-${member.id}`"
        @click="handlePick(member.id)"
      >
        <BeanieAvatar
          :variant="getAvatarVariant(member.gender, member.ageGroup)"
          :color="member.color"
          size="sm"
          :photo-url="getMemberAvatarUrl(member) ?? undefined"
          :aria-label="member.name"
        />
        <span class="name">{{ member.name }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.inline-picker {
  animation: inline-expand 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
  background: linear-gradient(
    135deg,
    var(--tint-orange-15, rgb(241 93 34 / 15%)) 0%,
    var(--tint-orange-8, rgb(241 93 34 / 8%)) 100%
  );
  border: 1px solid var(--tint-orange-15, rgb(241 93 34 / 22%));
  border-radius: 18px;
  padding: 14px;
  transform-origin: top center;
}

@keyframes inline-expand {
  from {
    opacity: 0;
    transform: translateY(-4px) scaleY(0.94);
  }

  to {
    opacity: 1;
    transform: translateY(0) scaleY(1);
  }
}

.picker-header {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.back-chip {
  align-items: center;
  background: white;
  border: 1px solid rgb(241 93 34 / 22%);
  border-radius: 999px;
  color: #f15d22;
  cursor: pointer;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  gap: 4px;
  padding: 5px 11px;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color 0.15s ease-out,
    border-color 0.15s ease-out;
}

.back-chip:hover {
  background: rgb(241 93 34 / 10%);
  border-color: rgb(241 93 34 / 38%);
}

.back-chip:active {
  transform: scale(0.97);
}

.back-chip:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .back-chip {
  background: rgb(30 41 59);
}

.picker-title-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.picker-kicker {
  color: #f15d22;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
  text-transform: uppercase;
}

.picker-for-label {
  color: rgb(44 62 80 / 65%);
  font-family: Inter, sans-serif;
  font-size: 0.75rem;
  font-style: italic;
  font-weight: 400;
  line-height: 1.2;
}

:global(.dark) .picker-for-label {
  color: rgb(241 242 244 / 65%);
}

.grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

@media (width >= 480px) {
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.tile {
  align-items: center;
  animation: tile-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: var(--stagger-delay, 0ms);
  background: white;
  border: 1px solid rgb(241 93 34 / 15%);
  border-radius: 14px;
  box-shadow: 0 2px 6px -2px rgb(44 62 80 / 10%);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 6px;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.15s ease-out,
    border-color 0.15s ease-out,
    box-shadow 0.15s ease-out;
}

.tile:hover {
  border-color: rgb(241 93 34 / 38%);
  box-shadow: 0 6px 12px -4px rgb(241 93 34 / 28%);
  transform: translateY(-2px);
}

.tile:active {
  transform: translateY(0) scale(0.97);
}

.tile:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .tile {
  background: rgb(30 41 59);
  border-color: rgb(241 93 34 / 28%);
}

.name {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .name {
  color: rgb(241 242 244);
}

.empty {
  color: rgb(44 62 80 / 65%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px 12px;
  text-align: center;
}

:global(.dark) .empty {
  color: rgb(241 242 244 / 65%);
}

.empty-emoji {
  font-size: 1.75rem;
  line-height: 1;
}

.empty-message {
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  margin: 0;
}

@keyframes tile-pop {
  0% {
    opacity: 0;
    transform: translateY(10px) scale(0.7);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .inline-picker,
  .tile {
    animation: none;
  }

  .tile:hover {
    transform: none;
  }
}
</style>
