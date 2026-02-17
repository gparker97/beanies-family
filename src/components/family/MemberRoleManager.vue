<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  currentRole: 'owner' | 'admin' | 'member';
  memberId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'change', role: 'admin' | 'member'): void;
}>();

const showDropdown = ref(false);

const availableRoles: { value: 'admin' | 'member'; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

function selectRole(role: 'admin' | 'member') {
  showDropdown.value = false;
  if (role !== props.currentRole) {
    emit('change', role);
  }
}

function closeDropdown() {
  showDropdown.value = false;
}
</script>

<template>
  <div class="relative">
    <button
      v-if="currentRole !== 'owner'"
      type="button"
      class="rounded-full px-2 py-0.5 text-xs transition-colors"
      :class="{
        'bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:hover:bg-purple-900/50':
          currentRole === 'admin',
        'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600':
          currentRole === 'member',
      }"
      :disabled="disabled"
      @click="showDropdown = !showDropdown"
      @blur="closeDropdown"
    >
      {{ currentRole === 'admin' ? 'Admin' : 'Member' }}
      <svg class="ml-0.5 inline h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <span
      v-else
      class="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    >
      Owner
    </span>

    <div
      v-if="showDropdown"
      class="absolute left-0 z-50 mt-1 w-28 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
    >
      <button
        v-for="role in availableRoles"
        :key="role.value"
        type="button"
        class="w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-slate-700"
        :class="
          role.value === currentRole
            ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
            : 'text-gray-700 dark:text-gray-300'
        "
        @mousedown.prevent="selectRole(role.value)"
      >
        {{ role.label }}
      </button>
    </div>
  </div>
</template>
