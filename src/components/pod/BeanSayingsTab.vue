<script setup lang="ts">
/**
 * Sayings tab — masonry-ish grid of StickyNote cards. Each card is a
 * button that opens SayingFormModal in edit mode. AddTile sits at the
 * end of the grid.
 *
 * StickyNote's rotation/color cycles by index, so visiting the tab
 * always gives a consistent scatter — no jitter on re-render.
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import StickyNote from '@/components/pod/shared/StickyNote.vue';
import SayingFormModal from '@/components/pod/SayingFormModal.vue';
import { useAutoOpenOnQuery } from '@/composables/useAutoOpenOnQuery';
import { useTranslation } from '@/composables/useTranslation';
import { useSayingsStore } from '@/stores/sayingsStore';
import type { SayingItem, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const sayingsStore = useSayingsStore();

const sayings = computed(() => sayingsStore.byMember(props.memberId).value);

const modalOpen = ref(false);
const editing = ref<SayingItem | null>(null);
useAutoOpenOnQuery(modalOpen);

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(s: SayingItem): void {
  editing.value = s;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}

function footerText(s: SayingItem): string {
  const parts: string[] = [];
  if (s.saidOn) parts.push(s.saidOn);
  if (s.place) parts.push(s.place);
  return parts.join(' · ');
}
</script>

<template>
  <div>
    <div v-if="sayings.length" class="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
      <button
        v-for="(s, i) in sayings"
        :key="s.id"
        type="button"
        class="block text-left"
        @click="openEdit(s)"
      >
        <StickyNote :text="s.words" :index="i" :footer-text="footerText(s)" />
      </button>
      <AddTile :label="t('sayings.addTile')" min-height="8rem" @click="openAdd" />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="💬"
        :message="t('sayings.empty')"
        :action-label="t('sayings.emptyCTA')"
        @action="openAdd"
      />
    </div>

    <SayingFormModal
      :open="modalOpen"
      :member-id="memberId"
      :saying="editing"
      @close="closeModal"
    />
  </div>
</template>
