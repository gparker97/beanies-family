<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { BaseCard, BaseButton, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import InviteLinkCard from '@/components/ui/InviteLinkCard.vue';
import MemberRoleManager from '@/components/family/MemberRoleManager.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import { useClipboard } from '@/composables/useClipboard';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { timeAgo } from '@/utils/date';
import { isTemporaryEmail } from '@/utils/email';
import { generateInviteQR } from '@/utils/qrCode';
import { usePermissions } from '@/composables/usePermissions';
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
const { canManagePod } = usePermissions();
const { syncHighlightClass } = useSyncHighlight();

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingMember = ref<FamilyMember | null>(null);
const isEditingFamilyName = ref(false);
const editFamilyName = ref('');
const showInviteModal = ref(false);
const isGeneratingInvite = ref(false);
const inviteLinkError = ref<string | null>(null);
const inviteLink = ref('');
const inviteQrUrl = ref('');

/** Build the base join URL (without token) for display/fallback. */
function buildBaseJoinUrl(): string {
  const fam = familyContextStore.activeFamilyId ?? '';
  const p = syncStore.storageProviderType ?? 'local';
  const fileRef = syncStore.fileName ? btoa(syncStore.fileName) : '';
  let url = `${window.location.origin}/join?fam=${fam}&p=${p}&ref=${fileRef}`;
  if (p === 'google_drive' && syncStore.driveFileId) {
    url += `&fileId=${encodeURIComponent(syncStore.driveFileId)}`;
  }
  return url;
}

/** Generate a crypto invite link with a token-wrapped family key. */
async function generateInviteLink(): Promise<string> {
  const fk = syncStore.familyKey;
  if (!fk) {
    // No family key — fall back to base URL (V3 or unconfigured)
    return buildBaseJoinUrl();
  }

  const { generateInviteToken, createInvitePackage, hashInviteToken } =
    await import('@/services/crypto/inviteService');

  const token = generateInviteToken();
  const pkg = await createInvitePackage(fk, token);
  const tokenHash = await hashInviteToken(token);

  // Store the invite package in the V4 envelope
  await syncStore.addInvitePackage(tokenHash, pkg);

  // Build full URL with token + provider info
  const base = buildBaseJoinUrl();
  return `${base}&t=${encodeURIComponent(token)}`;
}

async function openInviteModal() {
  inviteLinkError.value = null;
  inviteQrUrl.value = '';
  showInviteModal.value = true;

  // Generate a fresh invite link with crypto token + QR code
  isGeneratingInvite.value = true;
  try {
    inviteLink.value = await generateInviteLink();
    inviteQrUrl.value = await generateInviteQR(inviteLink.value);
  } catch (e) {
    inviteLinkError.value = (e as Error).message;
    inviteLink.value = buildBaseJoinUrl();
  } finally {
    isGeneratingInvite.value = false;
  }
}

// Per-member invite copy feedback
const copiedMemberId = ref<string | null>(null);
const { copy: copyMemberLink } = useClipboard();

async function copyMemberInviteLink(memberId: string) {
  // Generate a fresh invite link if we don't have one yet
  if (!inviteLink.value) {
    try {
      inviteLink.value = await generateInviteLink();
    } catch {
      openInviteModal();
      return;
    }
  }
  const ok = await copyMemberLink(inviteLink.value);
  if (ok) {
    copiedMemberId.value = memberId;
    setTimeout(() => {
      copiedMemberId.value = null;
    }, 2000);
  } else {
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
    const memberName = data.name;
    await familyStore.createMember(data);
    showAddModal.value = false;

    // Show success toast and auto-open invite modal
    showToast('success', t('family.memberAdded'), memberName);
    await openInviteModal();
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
          v-if="!isEditingFamilyName && familyContextStore.activeFamilyName && canManagePod"
          class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
          :title="t('family.editFamilyName')"
          @click="startEditFamilyName"
        >
          <BeanieIcon name="edit" size="sm" />
        </button>
      </div>
      <div v-if="canManagePod" class="flex gap-2">
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
        class="cursor-pointer"
        :class="syncHighlightClass(member.id)"
        @click="openEditModal(member)"
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
              <span @click.stop>
                <MemberRoleManager
                  :current-role="member.role"
                  :member-id="member.id"
                  :disabled="!canManagePod"
                  @change="handleRoleChange(member.id, $event)"
                />
              </span>
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
              v-if="member.requiresPassword && canManagePod"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-orange-600 dark:hover:bg-slate-700"
              :title="t('family.copyInviteLinkHint')"
              @click.stop="copyMemberInviteLink(member.id)"
            >
              <BeanieIcon name="copy" size="md" />
            </button>
            <button
              v-if="member.role !== 'owner' && canManagePod"
              class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-slate-700"
              @click.stop="deleteMember(member.id)"
            >
              <BeanieIcon name="trash" size="md" />
            </button>
          </div>
        </div>
      </BaseCard>
    </div>

    <!-- Add Member Modal -->
    <FamilyMemberModal
      v-if="canManagePod"
      :open="showAddModal"
      @close="showAddModal = false"
      @save="handleMemberSave"
      @delete="handleMemberDelete"
    />

    <!-- Edit Member Modal -->
    <FamilyMemberModal
      :open="showEditModal"
      :member="editingMember"
      :read-only="!canManagePod"
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

        <!-- Invite link + QR code -->
        <InviteLinkCard :link="inviteLink" :qr-url="inviteQrUrl" :loading="isGeneratingInvite" />

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
            {{
              syncStore.storageProviderType === 'google_drive'
                ? t('join.shareFileNoteCloud')
                : t('join.shareFileNote')
            }}
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
