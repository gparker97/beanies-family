<script setup lang="ts">
import { ref } from 'vue';
import { BaseCard, BaseButton, BaseInput, BaseModal, BaseSelect } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import CreateMemberAccountModal from '@/components/family/CreateMemberAccountModal.vue';
import { useTranslation } from '@/composables/useTranslation';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import type {
  CreateFamilyMemberInput,
  FamilyMember,
  UpdateFamilyMemberInput,
  Gender,
  AgeGroup,
} from '@/types/models';

const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const authStore = useAuthStore();
const { t } = useTranslation();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingMemberId = ref<string | null>(null);
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

const genderOptions = [
  { value: 'male', label: t('family.gender.male') },
  { value: 'female', label: t('family.gender.female') },
  { value: 'other', label: t('family.gender.other') },
];

const ageGroupOptions = [
  { value: 'adult', label: t('family.ageGroup.adult') },
  { value: 'child', label: t('family.ageGroup.child') },
];

const monthOptions = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const dayOptions = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

const newMember = ref<CreateFamilyMemberInput>({
  name: '',
  email: '',
  gender: 'male' as Gender,
  ageGroup: 'adult' as AgeGroup,
  role: 'member',
  color: colors[0] ?? '#3b82f6',
});

const dobMonth = ref('1');
const dobDay = ref('1');
const dobYear = ref('');

function openAddModal() {
  const randomColor = colors[Math.floor(Math.random() * colors.length)] ?? '#3b82f6';
  newMember.value = {
    name: '',
    email: '',
    gender: 'male' as Gender,
    ageGroup: 'adult' as AgeGroup,
    role: 'member',
    color: randomColor,
  };
  dobMonth.value = '1';
  dobDay.value = '1';
  dobYear.value = '';
  showAddModal.value = true;
}

async function createMember() {
  if (!newMember.value.name.trim() || !newMember.value.email.trim()) return;

  isSubmitting.value = true;
  try {
    const input = { ...newMember.value };
    // Attach date of birth if month and day are filled
    if (dobMonth.value && dobDay.value) {
      input.dateOfBirth = {
        month: parseInt(dobMonth.value, 10),
        day: parseInt(dobDay.value, 10),
        ...(dobYear.value ? { year: parseInt(dobYear.value, 10) } : {}),
      };
    }
    await familyStore.createMember(input);
    showAddModal.value = false;
  } finally {
    isSubmitting.value = false;
  }
}

// Edit member state
const editMember = ref({
  name: '',
  email: '',
  gender: 'male' as Gender,
  ageGroup: 'adult' as AgeGroup,
  color: '#3b82f6',
});
const editDobMonth = ref('1');
const editDobDay = ref('1');
const editDobYear = ref('');

function openEditModal(member: FamilyMember) {
  editingMemberId.value = member.id;
  editMember.value = {
    name: member.name,
    email: member.email,
    gender: member.gender || 'other',
    ageGroup: member.ageGroup || 'adult',
    color: member.color,
  };
  editDobMonth.value = member.dateOfBirth?.month?.toString() ?? '1';
  editDobDay.value = member.dateOfBirth?.day?.toString() ?? '1';
  editDobYear.value = member.dateOfBirth?.year?.toString() ?? '';
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingMemberId.value = null;
}

async function saveEditMember() {
  if (!editMember.value.name.trim() || !editMember.value.email.trim()) return;
  if (!editingMemberId.value) return;

  isSubmitting.value = true;
  try {
    const input: UpdateFamilyMemberInput = {
      name: editMember.value.name,
      email: editMember.value.email,
      gender: editMember.value.gender,
      ageGroup: editMember.value.ageGroup,
      color: editMember.value.color,
    };
    if (editDobMonth.value && editDobDay.value) {
      input.dateOfBirth = {
        month: parseInt(editDobMonth.value, 10),
        day: parseInt(editDobDay.value, 10),
        ...(editDobYear.value ? { year: parseInt(editDobYear.value, 10) } : {}),
      };
    } else {
      input.dateOfBirth = undefined;
    }
    await familyStore.updateMember(editingMemberId.value, input);
    closeEditModal();
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
    <!-- Family name + actions -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span
          v-if="!isEditingFamilyName"
          class="text-sm font-medium text-gray-600 dark:text-gray-400"
        >
          {{ familyContextStore.activeFamilyName || t('family.title') }}
        </span>
        <div v-else class="flex items-center gap-2">
          <input
            v-model="editFamilyName"
            type="text"
            class="focus:border-primary-500 focus:ring-primary-500 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-900 focus:ring-1 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            @keyup.enter="saveFamilyName"
            @keyup.escape="cancelEditFamilyName"
          />
          <button
            class="rounded p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
            @click="saveFamilyName"
          >
            <BeanieIcon name="check" size="md" />
          </button>
          <button
            class="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700"
            @click="cancelEditFamilyName"
          >
            <BeanieIcon name="close" size="md" />
          </button>
        </div>
        <button
          v-if="!isEditingFamilyName && familyContextStore.activeFamilyName"
          class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
          title="Edit family name"
          @click="startEditFamilyName"
        >
          <BeanieIcon name="edit" size="sm" />
        </button>
      </div>
      <BaseButton @click="openAddModal">
        {{ t('family.addMember') }}
      </BaseButton>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <BaseCard v-for="member in familyStore.members" :key="member.id" :hoverable="true">
        <div class="flex items-start gap-4">
          <BeanieAvatar
            :variant="getMemberAvatarVariant(member)"
            :color="member.color"
            size="lg"
            :aria-label="member.name"
          />
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
          <div class="flex flex-shrink-0 gap-1">
            <button
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-slate-700"
              :title="t('family.editMember')"
              @click="openEditModal(member)"
            >
              <BeanieIcon name="edit" size="md" />
            </button>
            <button
              v-if="member.role !== 'owner'"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
              @click="deleteMember(member.id)"
            >
              <BeanieIcon name="trash" size="md" />
            </button>
          </div>
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

        <div class="grid grid-cols-2 gap-3">
          <BaseSelect
            v-model="newMember.gender"
            :options="genderOptions"
            :label="t('family.gender')"
            data-testid="gender-select"
          />
          <BaseSelect
            v-model="newMember.ageGroup"
            :options="ageGroupOptions"
            :label="t('family.ageGroup')"
            data-testid="age-group-select"
          />
        </div>

        <!-- Date of Birth (optional) -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('family.dateOfBirth') }}
          </label>
          <div class="grid grid-cols-3 gap-2">
            <BaseSelect
              v-model="dobMonth"
              :options="monthOptions"
              :label="t('family.dateOfBirth.month')"
            />
            <BaseSelect
              v-model="dobDay"
              :options="dayOptions"
              :label="t('family.dateOfBirth.day')"
            />
            <BaseInput
              v-model="dobYear"
              type="number"
              :label="t('family.dateOfBirth.year')"
              placeholder="Year"
            />
          </div>
        </div>

        <!-- Avatar Preview -->
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('family.avatarPreview') }}
          </span>
          <BeanieAvatar
            :variant="getMemberAvatarVariant(newMember)"
            :color="newMember.color"
            size="xl"
            data-testid="avatar-preview"
          />
        </div>

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

    <!-- Edit Member Modal -->
    <BaseModal :open="showEditModal" :title="t('family.editMember')" @close="closeEditModal">
      <form class="space-y-4" @submit.prevent="saveEditMember">
        <BaseInput
          v-model="editMember.name"
          :label="t('form.name')"
          placeholder="Enter name"
          required
        />

        <BaseInput
          v-model="editMember.email"
          type="email"
          :label="t('form.email')"
          placeholder="Enter email"
          required
        />

        <div class="grid grid-cols-2 gap-3">
          <BaseSelect
            v-model="editMember.gender"
            :options="genderOptions"
            :label="t('family.gender')"
            data-testid="edit-gender-select"
          />
          <BaseSelect
            v-model="editMember.ageGroup"
            :options="ageGroupOptions"
            :label="t('family.ageGroup')"
            data-testid="edit-age-group-select"
          />
        </div>

        <!-- Date of Birth (optional) -->
        <div>
          <label class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('family.dateOfBirth') }}
          </label>
          <div class="grid grid-cols-3 gap-2">
            <BaseSelect
              v-model="editDobMonth"
              :options="monthOptions"
              :label="t('family.dateOfBirth.month')"
            />
            <BaseSelect
              v-model="editDobDay"
              :options="dayOptions"
              :label="t('family.dateOfBirth.day')"
            />
            <BaseInput
              v-model="editDobYear"
              type="number"
              :label="t('family.dateOfBirth.year')"
              placeholder="Year"
            />
          </div>
        </div>

        <!-- Avatar Preview -->
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('family.avatarPreview') }}
          </span>
          <BeanieAvatar
            :variant="getMemberAvatarVariant(editMember)"
            :color="editMember.color"
            size="xl"
          />
        </div>

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
                editMember.color === color
                  ? 'scale-110 border-gray-900 dark:border-white'
                  : 'border-transparent'
              "
              :style="{ backgroundColor: color }"
              @click="editMember.color = color"
            />
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-3">
          <BaseButton variant="secondary" @click="closeEditModal">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :loading="isSubmitting" @click="saveEditMember">
            {{ t('action.saveChanges') }}
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
