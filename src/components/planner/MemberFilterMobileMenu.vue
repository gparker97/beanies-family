<script setup lang="ts">
/**
 * Compact member-filter dropdown for the calendar command bar on mobile.
 *
 * Extracted verbatim from the inline dropdown previously in
 * `FamilyPlannerPage` so the command bar can own it. Presentational: it
 * receives the SAME filter state the desktop `MemberChipFilter` does
 * (`isAllActive` / `isMemberActive` / `activeMemberNames`) and emits
 * `select-all` / `select-member`, which the page wires to its single
 * `useMemberFilterChips()` instance. It owns ONLY its open/close UI state.
 *
 * NOTE: this is NOT the deleted `MemberFilterDropdown.vue` — that component
 * carried a v-model setter that swallowed the store's last-member-deselect
 * refusal. There is no v-model here; deselect behaviour lives entirely in
 * `useMemberFilterChips.onSelectMember`.
 */
import { ref } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  isAllActive: boolean;
  isMemberActive: (id: string) => boolean;
  activeMemberNames: string[];
}>();

const emit = defineEmits<{
  'select-all': [];
  'select-member': [id: string];
}>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const open = ref(false);

function selectAll() {
  emit('select-all');
  open.value = false;
}
function selectMember(id: string) {
  emit('select-member', id);
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="font-outfit inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium transition-all"
      :class="
        props.isAllActive
          ? 'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400'
          : 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
      "
      @click="open = !open"
    >
      <span class="text-base">👨‍👩‍👧</span>
      {{
        props.isAllActive
          ? t('filter.allMembers')
          : props.activeMemberNames.length === 1
            ? props.activeMemberNames[0]
            : `${props.activeMemberNames.length} ${t('filter.members')}`
      }}
      <span class="text-xs opacity-60">▾</span>
    </button>

    <div v-if="open" class="fixed inset-0 z-20" @click="open = false" />

    <Transition
      enter-active-class="transition-all duration-150"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition-all duration-100"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="open"
        class="absolute top-full left-0 z-30 mt-1.5 min-w-[200px] rounded-2xl border border-gray-200/60 bg-white p-2 shadow-lg dark:border-slate-600 dark:bg-slate-800"
      >
        <button
          type="button"
          class="font-outfit flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
          :class="
            props.isAllActive
              ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
              : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)] dark:text-gray-300 dark:hover:bg-slate-700'
          "
          @click="selectAll"
        >
          <span class="text-base">👨‍👩‍👧</span>
          {{ t('filter.allMembers') }}
        </button>
        <button
          v-for="member in familyStore.humans"
          :key="member.id"
          type="button"
          class="font-outfit flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors"
          :class="
            props.isMemberActive(member.id)
              ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
              : 'text-[var(--color-text)] hover:bg-[var(--tint-slate-5)] dark:text-gray-300 dark:hover:bg-slate-700'
          "
          @click="selectMember(member.id)"
        >
          <span
            class="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{ backgroundColor: member.color }"
          >
            {{ member.name.charAt(0).toUpperCase() }}
          </span>
          {{ member.name }}
        </button>
      </div>
    </Transition>
  </div>
</template>
