<script setup lang="ts">
import { ref, computed } from 'vue';
import { BaseCard, BaseButton, BaseInput, BaseModal, BaseSelect } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { timeAgo } from '@/utils/date';
import { isTemporaryEmail } from '@/utils/email';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import type {
  CreateFamilyMemberInput,
  FamilyMember,
  UpdateFamilyMemberInput,
  Gender,
  AgeGroup,
} from '@/types/models';

const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();
const { t } = useTranslation();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingMemberId = ref<string | null>(null);
const isSubmitting = ref(false);
const isEditingFamilyName = ref(false);
const editFamilyName = ref('');
const showInviteModal = ref(false);
const inviteCopiedCode = ref(false);
const inviteCopiedLink = ref(false);

const inviteCode = computed(() => familyContextStore.activeFamilyId ?? '');
const inviteLink = computed(() => {
  const fam = inviteCode.value;
  const p = 'local';
  const ref = syncStore.fileName ? btoa(syncStore.fileName) : '';
  return `${window.location.origin}/join?fam=${fam}&p=${p}&ref=${ref}`;
});

function openInviteModal() {
  inviteCopiedCode.value = false;
  inviteCopiedLink.value = false;
  showInviteModal.value = true;
}

async function copyInviteCode() {
  try {
    await navigator.clipboard.writeText(inviteCode.value);
    inviteCopiedCode.value = true;
    setTimeout(() => {
      inviteCopiedCode.value = false;
    }, 2000);
  } catch {
    // fallback — select text for manual copy
  }
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    inviteCopiedLink.value = true;
    setTimeout(() => {
      inviteCopiedLink.value = false;
    }, 2000);
  } catch {
    // fallback
  }
}

// Per-member invite copy feedback
const copiedMemberId = ref<string | null>(null);

async function copyMemberInviteLink(memberId: string) {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copiedMemberId.value = memberId;
    setTimeout(() => {
      copiedMemberId.value = null;
    }, 2000);
  } catch {
    // fallback — open the invite modal instead
    openInviteModal();
  }
}

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

const monthOptions = computed(() => [
  { value: '1', label: t('month.january') },
  { value: '2', label: t('month.february') },
  { value: '3', label: t('month.march') },
  { value: '4', label: t('month.april') },
  { value: '5', label: t('month.may') },
  { value: '6', label: t('month.june') },
  { value: '7', label: t('month.july') },
  { value: '8', label: t('month.august') },
  { value: '9', label: t('month.september') },
  { value: '10', label: t('month.october') },
  { value: '11', label: t('month.november') },
  { value: '12', label: t('month.december') },
]);

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
  requiresPassword: true,
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
    requiresPassword: true,
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
const editModalCopied = ref(false);

const editingMemberFull = computed(() =>
  editingMemberId.value ? familyStore.members.find((m) => m.id === editingMemberId.value) : null
);

async function copyEditModalInviteLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    editModalCopied.value = true;
    setTimeout(() => {
      editModalCopied.value = false;
    }, 2000);
  } catch {
    // ignore
  }
}

function openEditModal(member: FamilyMember) {
  editModalCopied.value = false;
  editingMemberId.value = member.id;
  editMember.value = {
    name: member.name,
    email: isTemporaryEmail(member.email) ? '' : member.email,
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
  if (!editMember.value.name.trim()) return;
  if (!editingMemberId.value) return;

  // If the user entered a real email, use it; otherwise keep whatever the member already has
  const originalMember = familyStore.members.find((m) => m.id === editingMemberId.value);
  const emailToSave = editMember.value.email.trim() || originalMember?.email || '';

  isSubmitting.value = true;
  try {
    const input: UpdateFamilyMemberInput = {
      name: editMember.value.name,
      email: emailToSave,
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
    await showAlert({
      title: 'confirm.cannotDeleteOwnerTitle',
      message: 'family.cannotDeleteOwner',
    });
    return;
  }
  if (await showConfirm({ title: 'confirm.deleteMemberTitle', message: 'family.deleteConfirm' })) {
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
          :title="t('family.editFamilyName')"
          @click="startEditFamilyName"
        >
          <BeanieIcon name="edit" size="sm" />
        </button>
      </div>
      <div class="flex gap-2">
        <BaseButton
          v-if="familyContextStore.activeFamilyId"
          variant="secondary"
          @click="openInviteModal"
        >
          {{ t('login.inviteTitle') }}
        </BaseButton>
        <BaseButton @click="openAddModal">
          {{ t('family.addMember') }}
        </BaseButton>
      </div>
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
              {{ isTemporaryEmail(member.email) ? t('family.emailNotSet') : member.email }}
            </p>
            <!-- Status badge -->
            <div class="mt-1.5 flex items-center gap-2">
              <span
                v-if="member.requiresPassword"
                class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-amber-500" />
                {{ t('family.status.waitingToJoin') }}
              </span>
              <template v-else>
                <span
                  class="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300"
                >
                  <span class="h-1.5 w-1.5 rounded-full bg-green-500" />
                  {{ t('family.status.active') }}
                </span>
                <span class="text-xs text-gray-400 dark:text-gray-500">
                  {{
                    member.lastLoginAt
                      ? t('family.lastSeen').replace('{date}', timeAgo(member.lastLoginAt))
                      : t('family.neverLoggedIn')
                  }}
                </span>
              </template>
            </div>
            <!-- Copied feedback -->
            <p
              v-if="copiedMemberId === member.id"
              class="mt-1 text-xs font-medium text-green-600 dark:text-green-400"
            >
              {{ t('family.linkCopied') }}
            </p>
          </div>
          <div class="flex flex-shrink-0 gap-1">
            <button
              v-if="member.requiresPassword"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
              :title="t('family.copyInviteLinkHint')"
              @click="copyMemberInviteLink(member.id)"
            >
              <BeanieIcon name="copy" size="md" />
            </button>
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
          :placeholder="t('family.enterName')"
          required
        />

        <BaseInput
          v-model="newMember.email"
          type="email"
          :label="t('form.email')"
          :placeholder="t('family.enterEmail')"
          required
        />

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              :placeholder="t('family.year')"
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
            {{ t('family.profileColor') }}
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
    <BaseModal
      :open="showEditModal"
      :title="t('family.editMember')"
      size="xl"
      @close="closeEditModal"
    >
      <form class="space-y-4" @submit.prevent="saveEditMember">
        <BaseInput
          v-model="editMember.name"
          :label="t('form.name')"
          :placeholder="t('family.enterName')"
          required
        />

        <BaseInput
          v-model="editMember.email"
          type="email"
          :label="t('form.email')"
          :placeholder="t('family.enterEmail')"
          :required="!!editMember.email"
        />

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              :placeholder="t('family.year')"
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
            {{ t('family.profileColor') }}
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

        <!-- Invite section (only for unclaimed members) -->
        <div
          v-if="editingMemberFull?.requiresPassword"
          class="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/40 dark:bg-amber-900/20"
        >
          <h4 class="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            {{ t('family.inviteSection.title') }}
          </h4>
          <p class="mb-3 text-sm text-amber-800 dark:text-amber-300">
            {{ t('family.inviteSection.desc') }}
          </p>
          <ol
            class="mb-4 list-inside list-decimal space-y-1 text-sm text-amber-700 dark:text-amber-300/90"
          >
            <li>{{ t('family.inviteSection.step1') }}</li>
            <li>{{ t('family.inviteSection.step2') }}</li>
            <li>{{ t('family.inviteSection.step3') }}</li>
          </ol>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 truncate rounded-lg border border-amber-200 bg-white px-3 py-2 font-mono text-xs text-gray-900 select-all dark:border-amber-700 dark:bg-slate-800 dark:text-gray-100"
            >
              {{ inviteLink }}
            </code>
            <BaseButton variant="secondary" @click="copyEditModalInviteLink">
              {{ editModalCopied ? t('login.copied') : t('login.copyLink') }}
            </BaseButton>
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

    <!-- Invite Family Member Modal -->
    <BaseModal
      :open="showInviteModal"
      :title="t('login.inviteTitle')"
      @close="showInviteModal = false"
    >
      <div class="space-y-5">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('login.inviteDesc') }}
        </p>

        <!-- Shareable Link -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('login.inviteLink') }}
          </label>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-xs text-gray-900 select-all dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            >
              {{ inviteLink }}
            </code>
            <BaseButton variant="secondary" @click="copyInviteLink">
              {{ inviteCopiedLink ? t('login.copied') : t('login.copyLink') }}
            </BaseButton>
          </div>
        </div>

        <!-- Family Code (manual fallback) -->
        <div>
          <label class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('login.inviteCode') }}
          </label>
          <div class="flex items-center gap-2">
            <code
              class="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-sm text-gray-900 select-all dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            >
              {{ inviteCode }}
            </code>
            <BaseButton variant="secondary" @click="copyInviteCode">
              {{ inviteCopiedCode ? t('login.copied') : t('login.copyCode') }}
            </BaseButton>
          </div>
        </div>

        <!-- File sharing info card -->
        <div class="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 dark:bg-amber-900/20">
          <div
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-amber-100 dark:bg-amber-800/30"
          >
            <svg
              class="h-4 w-4 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p class="text-sm text-amber-800 dark:text-amber-200">
            {{ t('join.shareFileNote') }}
          </p>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end">
          <BaseButton variant="secondary" @click="showInviteModal = false">
            {{ t('action.close') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
