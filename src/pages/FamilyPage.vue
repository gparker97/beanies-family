<script setup lang="ts">
import { ref } from 'vue';
import { BaseCard, BaseButton, BaseInput, BaseModal } from '@/components/ui';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import type { CreateFamilyMemberInput } from '@/types/models';

const familyStore = useFamilyStore();
const { t } = useTranslation();

const showAddModal = ref(false);
const isSubmitting = ref(false);

const colors: string[] = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
];

const newMember = ref<CreateFamilyMemberInput>({
  name: '',
  email: '',
  role: 'member',
  color: colors[0] ?? '#3b82f6',
});

function getRoleLabel(role: string): string {
  const roleKeys: Record<string, string> = {
    owner: 'family.role.owner',
    admin: 'family.role.admin',
    member: 'family.role.member',
  };
  const key = roleKeys[role];
  return key ? t(key as any) : role;
}

function openAddModal() {
  const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
  newMember.value = {
    name: '',
    email: '',
    role: 'member',
    color: randomColor,
  };
  showAddModal.value = true;
}

async function createMember() {
  if (!newMember.value.name.trim() || !newMember.value.email.trim()) return;

  isSubmitting.value = true;
  try {
    await familyStore.createMember(newMember.value);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

async function deleteMember(id: string) {
  const member = familyStore.members.find((m) => m.id === id);
  if (member?.role === 'owner') {
    alert('Cannot delete the owner account.');
    return;
  }
  if (confirm('Are you sure you want to remove this family member?')) {
    await familyStore.deleteMember(id);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ t('family.title') }}</h1>
        <p class="text-gray-500 dark:text-gray-400">Manage your family profiles</p>
      </div>
      <BaseButton @click="openAddModal">
        {{ t('family.addMember') }}
      </BaseButton>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <BaseCard v-for="member in familyStore.members" :key="member.id" :hoverable="true">
        <div class="flex items-start gap-4">
          <div
            class="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-lg font-medium text-white"
            :style="{ backgroundColor: member.color }"
          >
            {{ member.name.charAt(0).toUpperCase() }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <h3 class="truncate font-medium text-gray-900 dark:text-gray-100">
                {{ member.name }}
              </h3>
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="{
                  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400':
                    member.role === 'owner',
                  'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400':
                    member.role === 'admin',
                  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300':
                    member.role === 'member',
                }"
              >
                {{ getRoleLabel(member.role) }}
              </span>
            </div>
            <p class="truncate text-sm text-gray-500 dark:text-gray-400">
              {{ member.email }}
            </p>
          </div>
          <button
            v-if="member.role !== 'owner'"
            class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
            @click="deleteMember(member.id)"
          >
            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </BaseCard>
    </div>

    <!-- Add Member Modal -->
    <BaseModal :open="showAddModal" :title="t('family.addMember')" @close="showAddModal = false">
      <form class="space-y-4" @submit.prevent="createMember">
        <BaseInput
          v-model="newMember.name"
          :label="t('form.name')"
          placeholder="Enter name"
          required
        />

        <BaseInput
          v-model="newMember.email"
          type="email"
          :label="t('form.email')"
          placeholder="Enter email"
          required
        />

        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Profile Color
          </label>
          <div class="flex gap-2">
            <button
              v-for="color in colors"
              :key="color"
              type="button"
              class="h-8 w-8 rounded-full border-2 transition-all"
              :class="
                newMember.color === color
                  ? 'scale-110 border-gray-900 dark:border-white'
                  : 'border-transparent'
              "
              :style="{ backgroundColor: color }"
              @click="newMember.color = color"
            />
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="showAddModal = false">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="createMember">
            {{ t('family.addMember') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
