<script setup lang="ts">
import { ref } from 'vue';
import { BaseCard, BaseButton, BaseInput, BaseModal } from '@/components/ui';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import CreateMemberAccountModal from '@/components/family/CreateMemberAccountModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import type { CreateFamilyMemberInput } from '@/types/models';

const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const authStore = useAuthStore();
const { t } = useTranslation();

const showAddModal = ref(false);
const showCreateAccountModal = ref(false);
const isSubmitting = ref(false);
const isEditingFamilyName = ref(false);
const editFamilyName = ref('');
const createAccountMemberName = ref('');
const createAccountMemberEmail = ref('');

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

async function handleRoleChange(memberId: string, newRole: 'admin' | 'member') {
  await familyStore.updateMemberRole(memberId, newRole);
}

function startEditFamilyName() {
  editFamilyName.value = familyContextStore.activeFamilyName ?? '';
  isEditingFamilyName.value = true;
}

async function saveFamilyName() {
  if (!editFamilyName.value.trim()) return;
  await familyContextStore.updateFamilyName(editFamilyName.value.trim());
  isEditingFamilyName.value = false;
}

function cancelEditFamilyName() {
  isEditingFamilyName.value = false;
}

function openCreateAccountModal(memberName: string, memberEmail: string) {
  createAccountMemberName.value = memberName;
  createAccountMemberEmail.value = memberEmail;
  showCreateAccountModal.value = true;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Family Name Header -->
    <div class="flex items-center justify-between">
      <div>
        <div class="flex items-center gap-2">
          <h1
            v-if="!isEditingFamilyName"
            class="text-2xl font-bold text-gray-900 dark:text-gray-100"
          >
            {{ familyContextStore.activeFamilyName || t('family.title') }}
          </h1>
          <div v-else class="flex items-center gap-2">
            <input
              v-model="editFamilyName"
              type="text"
              class="focus:border-primary-500 focus:ring-primary-500 rounded-lg border border-gray-300 px-3 py-1.5 text-xl font-bold text-gray-900 focus:ring-1 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
              @keyup.enter="saveFamilyName"
              @keyup.escape="cancelEditFamilyName"
            />
            <button
              class="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
              @click="saveFamilyName"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
            <button
              class="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
              @click="cancelEditFamilyName"
            >
              <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <button
            v-if="!isEditingFamilyName && familyContextStore.activeFamilyName"
            class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
            title="Edit family name"
            @click="startEditFamilyName"
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </button>
        </div>
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
              <MemberRoleManager
                :current-role="member.role"
                :member-id="member.id"
                @change="handleRoleChange(member.id, $event)"
              />
            </div>
            <p class="truncate text-sm text-gray-500 dark:text-gray-400">
              {{ member.email }}
            </p>
            <!-- Create Login button for members without auth -->
            <button
              v-if="authStore.isAuthConfigured && !authStore.isLocalOnlyMode"
              class="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mt-1 text-xs"
              @click="openCreateAccountModal(member.name, member.email)"
            >
              Create Login
            </button>
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

    <!-- Create Member Account Modal -->
    <CreateMemberAccountModal
      :open="showCreateAccountModal"
      :member-name="createAccountMemberName"
      :member-email="createAccountMemberEmail"
      @close="showCreateAccountModal = false"
      @create="showCreateAccountModal = false"
    />
  </div>
</template>
