<script setup lang="ts">
/**
 * Allergies tab — one card per Allergy, sorted severity-first.
 * Severe entries get a red left stripe; moderate amber; mild green.
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import AllergyFormModal from '@/components/pod/AllergyFormModal.vue';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { useTranslation } from '@/composables/useTranslation';
import { usePermissions } from '@/composables/usePermissions';
import { useAllergiesStore } from '@/stores/allergiesStore';
import type { Allergy, AllergySeverity, AllergyType, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const allergiesStore = useAllergiesStore();

const SEVERITY_ORDER: Record<AllergySeverity, number> = { severe: 0, moderate: 1, mild: 2 };

const allergies = computed(() =>
  [...allergiesStore.byMember(props.memberId).value].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )
);

const modalOpen = ref(false);
const editing = ref<Allergy | null>(null);
useQuickAddIntent((action) => {
  if (action === 'add-allergy' && canEditActivities.value) {
    editing.value = null;
    modalOpen.value = true;
  }
});

const TYPE_EMOJI: Record<AllergyType, string> = {
  food: '\u{1F35C}',
  medication: '\u{1F48A}',
  environmental: '\u{1F33E}',
  contact: '\u270B',
  insect: '\u{1F41D}',
};

const SEVERITY_STYLE: Record<AllergySeverity, { bar: string; badge: string }> = {
  severe: {
    bar: 'bg-red-500',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  moderate: {
    bar: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  mild: {
    bar: 'bg-green-500',
    badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  },
};

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(a: Allergy): void {
  editing.value = a;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <div>
    <div v-if="allergies.length" class="grid gap-3 md:grid-cols-2">
      <button
        v-for="a in allergies"
        :key="a.id"
        type="button"
        class="relative flex flex-col items-start gap-2 overflow-hidden rounded-[var(--sq)] bg-white p-4 pl-5 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        @click="openEdit(a)"
      >
        <span
          class="absolute top-0 bottom-0 left-0 w-1.5"
          :class="SEVERITY_STYLE[a.severity].bar"
          aria-hidden="true"
        />
        <div class="flex w-full items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col">
            <div class="flex items-center gap-2">
              <span class="text-xl" aria-hidden="true">{{ TYPE_EMOJI[a.allergyType] }}</span>
              <h4 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
                {{ a.name }}
              </h4>
            </div>
            <span
              class="font-outfit text-secondary-500/60 mt-0.5 text-[11px] font-semibold tracking-wide uppercase"
            >
              {{ t(`allergies.type.${a.allergyType}`) }}
            </span>
          </div>
          <span
            class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
            :class="SEVERITY_STYLE[a.severity].badge"
          >
            {{ t(`allergies.severity.${a.severity}`) }}
          </span>
        </div>
        <p
          v-if="a.reaction"
          class="font-outfit text-secondary-500/70 line-clamp-2 text-sm dark:text-gray-400"
        >
          {{ a.reaction }}
        </p>
        <p
          v-if="a.emergencyResponse"
          class="font-outfit text-secondary-500/80 mt-1 text-xs font-semibold dark:text-gray-300"
        >
          🚨 {{ a.emergencyResponse }}
        </p>
      </button>
      <AddTile v-if="canEditActivities" :label="t('allergies.addTile')" @click="openAdd" />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="⚠️"
        :message="t('allergies.empty')"
        :action-label="canEditActivities ? t('allergies.emptyCTA') : ''"
        @action="openAdd"
      />
    </div>

    <AllergyFormModal
      :open="modalOpen"
      :member-id="memberId"
      :allergy="editing"
      @close="closeModal"
    />
  </div>
</template>
