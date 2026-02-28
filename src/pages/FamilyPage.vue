<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { BaseCard, BaseButton, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
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
} from '@/types/models';

const route = useRoute();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingMember = ref<FamilyMember | null>(null);
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

function openAddModal() {
  editingMember.value = null;
  showAddModal.value = true;
}

function openEditModal(member: FamilyMember) {
  editingMember.value = member;
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingMember.value = null;
}

// Open modals from query params (e.g. navigated from Family Nook)
onMounted(() => {
  if (route.query.add === 'true') {
    openAddModal();
  } else if (route.query.edit) {
    const memberId = route.query.edit as string;
    const member = familyStore.members.find((m) => m.id === memberId);
    if (member) openEditModal(member);
  }
});

async function handleMemberSave(
  data: CreateFamilyMemberInput | { id: string; data: UpdateFamilyMemberInput }
) {
  if ('id' in data) {
    await familyStore.updateMember(data.id, data.data);
    closeEditModal();
  } else {
    await familyStore.createMember(data);
    showAddModal.value = false;
  }
}

async function handleMemberDelete(id: string) {
  closeEditModal();
  await deleteMember(id);
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
      <BaseCard
        v-for="member in familyStore.members"
        :key="member.id"
        :hoverable="true"
        :class="syncHighlightClass(member.id)"
      >
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
    <FamilyMemberModal
      :open="showAddModal"
      @close="showAddModal = false"
      @save="handleMemberSave"
      @delete="handleMemberDelete"
    />

    <!-- Edit Member Modal -->
    <FamilyMemberModal
      :open="showEditModal"
      :member="editingMember"
      @close="closeEditModal"
      @save="handleMemberSave"
      @delete="handleMemberDelete"
    />

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
