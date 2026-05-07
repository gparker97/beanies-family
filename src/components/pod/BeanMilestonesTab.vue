<script setup lang="ts">
/**
 * Milestones tab — chronological list of this bean's big moments.
 * Mirrors `BeanSayingsTab` scaffold (imports / store / list / form-modal).
 *
 * Visual treatment matches the cross-family timeline: each card has a
 * `<MilestoneThumb>` showing the first photo (or category emoji
 * fallback) plus a multi-photo badge when there are extras. Tapping
 * the thumbnail opens `<PhotoViewer>` in read-only mode with built-in
 * prev/next cycling. Tapping the rest of the card opens the edit
 * form. Sorted `occurredOn DESC` (newest first — same as other
 * per-bean tabs; the cross-family timeline uses ascending instead).
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import MilestoneFormModal from '@/components/pod/MilestoneFormModal.vue';
import MilestoneThumb from '@/components/pod/MilestoneThumb.vue';
import PhotoViewer from '@/components/media/PhotoViewer.vue';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useMilestoneLightbox } from '@/composables/useMilestoneLightbox';
import { useMilestonesStore } from '@/stores/milestonesStore';
import { MILESTONE_CATEGORIES } from '@/constants/milestoneCategories';
import { formatDateShort } from '@/utils/date';
import type { Milestone, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t, isBeanieMode } = useTranslation();
const { canEditActivities } = usePermissions();
const milestonesStore = useMilestonesStore();
const lightbox = useMilestoneLightbox();

const milestones = computed(() => milestonesStore.byMember(props.memberId).value);

const modalOpen = ref(false);
const editing = ref<Milestone | null>(null);

useQuickAddIntent((action) => {
  if (action === 'add-milestone' && canEditActivities.value) {
    editing.value = null;
    modalOpen.value = true;
  }
});

function categoryLabel(m: Milestone): string {
  const safe = milestonesStore.safeCategoryFor(m);
  const cat = MILESTONE_CATEGORIES.find((c) => c.id === safe);
  if (!cat) return '';
  const label = t(cat.titleKey);
  return isBeanieMode.value ? label.toLowerCase() : label;
}

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(m: Milestone): void {
  editing.value = m;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <div>
    <div v-if="milestones.length" class="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <button
        v-for="m in milestones"
        :key="m.id"
        type="button"
        class="block rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-transform hover:scale-[1.02] dark:bg-slate-800"
        @click="openEdit(m)"
      >
        <div class="flex items-start gap-3">
          <!-- Thumbnail: photo (with lightbox) or category emoji
               fallback. Click is `.stop`-ped inside the component so
               it doesn't fall through to the card's edit-on-click. -->
          <MilestoneThumb :milestone="m" size="md" @open-lightbox="lightbox.openFor(m)" />
          <div class="min-w-0 flex-1">
            <p
              class="font-outfit text-primary-600 text-[11px] font-semibold tracking-wide uppercase dark:text-orange-300"
            >
              {{ formatDateShort(m.occurredOn) }}
            </p>
            <p
              class="font-outfit mt-0.5 truncate text-sm font-semibold text-[var(--color-text)] dark:text-gray-100"
            >
              {{ m.title }}
            </p>
            <p class="font-outfit text-secondary-500/60 mt-0.5 text-[11px] dark:text-gray-400">
              {{ categoryLabel(m) }}
            </p>
            <p
              v-if="m.description"
              class="font-outfit text-secondary-500/80 mt-1.5 line-clamp-2 text-xs leading-snug dark:text-gray-300"
            >
              {{ m.description }}
            </p>
          </div>
        </div>
      </button>
      <AddTile
        v-if="canEditActivities"
        :label="t('milestone.addTile')"
        min-height="8rem"
        @click="openAdd"
      />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="🌟"
        :message="t('milestone.empty')"
        :action-label="canEditActivities ? t('milestone.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <MilestoneFormModal
      :open="modalOpen"
      :member-id="memberId"
      :milestone="editing"
      @close="closeModal"
    />

    <!-- Read-only lightbox for milestone photos. Shared
         `useMilestoneLightbox` composable owns the state; same pattern
         used by FamilyTimelinePage. -->
    <PhotoViewer
      :open="lightbox.isOpen.value"
      :photo-ids="lightbox.photoIds.value"
      :initial-index="0"
      read-only
      @close="lightbox.close"
    />
  </div>
</template>
