<script setup lang="ts">
/**
 * Quick-add parent picker. Rendered inside QuickAddSheet when the
 * sheet's stage is `picker` — i.e. the user tapped an item whose
 * `contextKey` is unfilled by the current route.
 *
 * Three picker kinds share one layout + one state machine:
 *  - memberId picker (saying, favorite, note, medication, allergy)
 *  - recipeId picker (cook-log)
 *  - medicationId picker (dose-log)
 *
 * Picker-kind is derived from the pending item's `contextKey`. A
 * single `tiles` computed resolves the data source per kind; a single
 * renderer loop draws them. Adding a new contextKey is a new `case`
 * in the switch — everything else (animations, back button, empty
 * state, click plumbing) is shared.
 */
import { computed } from 'vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useQuickAdd } from '@/composables/useQuickAdd';
import { useTranslation } from '@/composables/useTranslation';
import { getAvatarVariant } from '@/composables/useMemberAvatar';
import { getMemberAvatarUrl } from '@/composables/useMemberInfo';
import { useFamilyStore } from '@/stores/familyStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { usePhotoStore } from '@/stores/photoStore';
import { assertNever } from '@/utils/assertNever';
import type { AvatarVariant } from '@/constants/avatars';
import type { QuickAddContextKey, QuickAddItem } from '@/constants/quickAddItems';

const props = defineProps<{ pending: QuickAddItem }>();

const { t } = useTranslation();
const { commitPicker, cancelPicker } = useQuickAdd();
const familyStore = useFamilyStore();
const recipesStore = useRecipesStore();
const medicationsStore = useMedicationsStore();
const photoStore = usePhotoStore();

// `contextKey` is always defined on picker-pending items (the picker
// is only triggered when contextKey is set and unresolvable from the
// current route — see useQuickAdd.needsPicker). Narrowing for TS.
const contextKey = computed<QuickAddContextKey>(() => {
  if (!props.pending.contextKey) {
    throw new Error(
      `[QuickAddPicker] item "${props.pending.id}" has no contextKey — picker should not have been opened`
    );
  }
  return props.pending.contextKey;
});

// --- i18n keys per picker kind -------------------------------------------

interface PickerCopy {
  titleKey:
    | 'quickAdd.picker.bean.title'
    | 'quickAdd.picker.recipe.title'
    | 'quickAdd.picker.medication.title'
    | 'quickAdd.picker.vacation.title';
  emptyKey:
    | 'quickAdd.picker.bean.empty'
    | 'quickAdd.picker.recipe.empty'
    | 'quickAdd.picker.medication.empty'
    | 'quickAdd.picker.vacation.empty';
}

const copy = computed<PickerCopy>(() => {
  switch (contextKey.value) {
    case 'memberId':
      return {
        titleKey: 'quickAdd.picker.bean.title',
        emptyKey: 'quickAdd.picker.bean.empty',
      };
    case 'recipeId':
      return {
        titleKey: 'quickAdd.picker.recipe.title',
        emptyKey: 'quickAdd.picker.recipe.empty',
      };
    case 'medicationId':
      return {
        titleKey: 'quickAdd.picker.medication.title',
        emptyKey: 'quickAdd.picker.medication.empty',
      };
    case 'vacationId':
      // Reserved for symmetry — trip-idea has a dedicated empty-state
      // toast on TravelPlansPage, so this branch isn't exercised
      // today. Kept compile-safe via assertNever.
      return {
        titleKey: 'quickAdd.picker.vacation.title',
        emptyKey: 'quickAdd.picker.vacation.empty',
      };
    default:
      return assertNever(contextKey.value, 'QuickAddPicker.copy');
  }
});

// --- Tile data (unified shape, per-kind source) --------------------------

type TileVisual =
  | { kind: 'avatar'; variant: AvatarVariant; color: string; photoUrl: string | null }
  | { kind: 'photo'; src: string | null; emojiFallback: string }
  | { kind: 'emoji'; emoji: string };

interface PickerTile {
  id: string;
  name: string;
  subtitle?: string;
  visual: TileVisual;
}

const tiles = computed<PickerTile[]>(() => {
  switch (contextKey.value) {
    case 'memberId':
      return familyStore.sortedHumans.map((m) => ({
        id: m.id,
        name: m.name,
        visual: {
          kind: 'avatar',
          variant: getAvatarVariant(m.gender, m.ageGroup),
          color: m.color,
          photoUrl: getMemberAvatarUrl(m),
        },
      }));
    case 'recipeId':
      return [...recipesStore.recipes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({
          id: r.id,
          name: r.name,
          visual: {
            kind: 'photo',
            src: r.photoIds?.[0] ? photoStore.getPublicUrl(r.photoIds[0], 'thumb') : null,
            emojiFallback: '\u{1F35C}', // 🍜
          },
        }));
    case 'medicationId':
      return medicationsStore.active.map((med) => {
        const owner = familyStore.members.find((m) => m.id === med.memberId);
        return {
          id: med.id,
          name: med.name,
          subtitle: owner?.name,
          visual: { kind: 'emoji', emoji: '\u{1F48A}' }, // 💊
        };
      });
    case 'vacationId':
      return []; // unused today; trip-idea has its own empty-state toast
    default:
      return assertNever(contextKey.value, 'QuickAddPicker.tiles');
  }
});

const isEmpty = computed(() => tiles.value.length === 0);

function handleTileClick(id: string): void {
  commitPicker(id);
}

function handleBack(): void {
  cancelPicker();
}
</script>

<template>
  <div class="picker-body" data-testid="quick-add-picker">
    <header class="picker-header">
      <button
        type="button"
        class="picker-back"
        :aria-label="t('quickAdd.picker.back')"
        @click="handleBack"
      >
        <span aria-hidden="true">←</span>
      </button>
      <h2 class="picker-title">{{ t(copy.titleKey) }}</h2>
    </header>

    <div v-if="!isEmpty" class="picker-grid">
      <button
        v-for="(tile, idx) in tiles"
        :key="tile.id"
        type="button"
        class="picker-tile"
        :style="{ '--stagger-delay': `${80 + idx * 50}ms` }"
        :data-testid="`quick-add-picker-tile-${tile.id}`"
        @click="handleTileClick(tile.id)"
      >
        <div class="picker-visual">
          <BeanieAvatar
            v-if="tile.visual.kind === 'avatar'"
            :variant="tile.visual.variant"
            :color="tile.visual.color"
            size="md"
            :photo-url="tile.visual.photoUrl ?? undefined"
            :aria-label="tile.name"
          />
          <template v-else-if="tile.visual.kind === 'photo'">
            <img
              v-if="tile.visual.src"
              :src="tile.visual.src"
              :alt="tile.name"
              class="picker-photo"
              loading="lazy"
            />
            <span v-else class="picker-emoji" aria-hidden="true">
              {{ tile.visual.emojiFallback }}
            </span>
          </template>
          <span v-else class="picker-emoji" aria-hidden="true">{{ tile.visual.emoji }}</span>
        </div>
        <div class="picker-label-stack">
          <span class="picker-label">{{ tile.name }}</span>
          <span v-if="tile.subtitle" class="picker-subtitle">{{ tile.subtitle }}</span>
        </div>
      </button>
    </div>

    <div v-else class="picker-empty" data-testid="quick-add-picker-empty">
      <span class="picker-empty-emoji" aria-hidden="true">🌱</span>
      <p class="picker-empty-message">{{ t(copy.emptyKey) }}</p>
    </div>
  </div>
</template>

<style scoped>
.picker-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.picker-header {
  align-items: center;
  display: flex;
  gap: 8px;
  margin: 0;
}

.picker-back {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 10px;
  color: rgb(44 62 80 / 80%);
  cursor: pointer;
  display: inline-flex;
  font-size: 1.25rem;
  height: 36px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.15s ease-out;
  width: 36px;
}

.picker-back:hover {
  background: rgb(241 93 34 / 8%);
  color: #f15d22;
}

.picker-back:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .picker-back {
  color: rgb(241 242 244 / 80%);
}

.picker-title {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 1.125rem;
  font-weight: 700;
  margin: 0;
}

:global(.dark) .picker-title {
  color: rgb(241 242 244);
}

.picker-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.picker-tile {
  align-items: center;
  animation: picker-pop 450ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
  animation-delay: var(--stagger-delay, 0ms);
  background: white;
  border: 1px solid rgb(44 62 80 / 10%);
  border-radius: 14px;
  cursor: pointer;
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  -webkit-tap-highlight-color: transparent;
  text-align: left;
  transition:
    transform 0.15s ease-out,
    background-color 0.15s ease-out,
    border-color 0.15s ease-out;
}

.picker-tile:hover {
  background: rgb(241 93 34 / 4%);
  border-color: rgb(241 93 34 / 20%);
  transform: translateY(-1px);
}

.picker-tile:active {
  transform: translateY(0) scale(0.98);
}

.picker-tile:focus-visible {
  outline: 2px solid rgb(241 93 34 / 90%);
  outline-offset: 2px;
}

:global(.dark) .picker-tile {
  background: rgb(30 41 59);
  border-color: rgb(241 242 244 / 10%);
}

:global(.dark) .picker-tile:hover {
  background: rgb(241 93 34 / 10%);
}

.picker-visual {
  align-items: center;
  display: flex;
  flex-shrink: 0;
  height: 44px;
  justify-content: center;
  width: 44px;
}

.picker-photo {
  border-radius: 10px;
  height: 44px;
  object-fit: cover;
  width: 44px;
}

.picker-emoji {
  font-size: 1.75rem;
  line-height: 1;
}

.picker-label-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.picker-label {
  color: rgb(44 62 80);
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .picker-label {
  color: rgb(241 242 244);
}

.picker-subtitle {
  color: rgb(44 62 80 / 60%);
  font-size: 0.75rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global(.dark) .picker-subtitle {
  color: rgb(241 242 244 / 60%);
}

.picker-empty {
  align-items: center;
  color: rgb(44 62 80 / 65%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

:global(.dark) .picker-empty {
  color: rgb(241 242 244 / 65%);
}

.picker-empty-emoji {
  font-size: 2rem;
  line-height: 1;
}

.picker-empty-message {
  font-family: Outfit, sans-serif;
  font-size: 0.875rem;
  margin: 0;
}

@keyframes picker-pop {
  0% {
    opacity: 0;
    transform: translateY(16px) scale(0.65);
  }

  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .picker-tile {
    animation: none;
  }

  .picker-tile:hover {
    transform: none;
  }
}
</style>
