<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { BaseButton, BaseInput, BaseModal } from '@/components/ui';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import InviteLinkCard from '@/components/ui/InviteLinkCard.vue';
import BeanCard from '@/components/family/BeanCard.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import ShareInviteModal from '@/components/family/ShareInviteModal.vue';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { isValidEmail, isTemporaryEmail } from '@/utils/email';
import { toDateInputValue } from '@/utils/date';
import { normalizeAssignees } from '@/utils/assignees';
import { generateInviteQR } from '@/utils/qrCode';
import {
  shareFileWithEmail,
  getFileMetadata,
  listFilePermissions,
} from '@/services/google/driveService';
import { getValidToken } from '@/services/google/googleAuth';
import { usePermissions } from '@/composables/usePermissions';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { getActivityCategoryColor } from '@/constants/activityCategories';
import type {
  ActivityCategory,
  CreateFamilyMemberInput,
  FamilyMember,
  UpdateFamilyMemberInput,
} from '@/types/models';

const route = useRoute();
const router = useRouter();
const familyStore = useFamilyStore();
const familyContextStore = useFamilyContextStore();
const syncStore = useSyncStore();
const activityStore = useActivityStore();
const todoStore = useTodoStore();
const { t } = useTranslation();
const { canManagePod } = usePermissions();
const { syncHighlightClass } = useSyncHighlight();

/** Event bar color based on activity category. */
function getEventBarColor(category: ActivityCategory): string {
  return getActivityCategoryColor(category);
}

/** A highlight item shown on member cards (up to 2 per member). */
export interface MemberHighlight {
  emoji: string;
  title: string;
  subtitle: string;
}

// Per-member upcoming highlights (2 most important items: activities, todos, birthdays)
const memberHighlights = computed(() => {
  const today = toDateInputValue(new Date());
  const map = new Map<string, MemberHighlight[]>();

  for (const m of familyStore.members) {
    const items: MemberHighlight[] = [];

    // 1. Next upcoming activity for this member
    const nextActivity = activityStore.upcomingActivities.find((e) =>
      normalizeAssignees(e.activity).includes(m.id)
    );
    if (nextActivity) {
      items.push({
        emoji: nextActivity.activity.icon || '📅',
        title: `${nextActivity.activity.icon || '📅'} ${nextActivity.activity.startTime || nextActivity.date}`,
        subtitle: nextActivity.activity.title,
      });
    }

    // 2. Birthday milestone (if dateOfBirth is set)
    if (m.dateOfBirth && items.length < 2) {
      const month = String(m.dateOfBirth.month).padStart(2, '0');
      const day = String(m.dateOfBirth.day).padStart(2, '0');
      const birthdayThisYear = `${new Date().getFullYear()}-${month}-${day}`;
      // Show if birthday is upcoming (within next 90 days)
      if (birthdayThisYear >= today) {
        items.push({
          emoji: '🎂',
          title: `🎂 ${month}/${day}`,
          subtitle: t('family.hub.highlight.birthday'),
        });
      }
    }

    // 3. Next open todo for this member
    if (items.length < 2) {
      const memberTodos = todoStore.openTodos.filter((td) => normalizeAssignees(td).includes(m.id));
      const nextTodo = memberTodos[0];
      if (nextTodo) {
        items.push({
          emoji: '📋',
          title: `📋 ${memberTodos.length} ${memberTodos.length === 1 ? 'task' : 'tasks'}`,
          subtitle: t('family.hub.highlight.thisWeek'),
        });
      }
    }

    map.set(m.id, items);
  }
  return map;
});

// Upcoming activities within the next 7 days (for quick info panel)
const upcomingThisWeek = computed(() => {
  const today = toDateInputValue(new Date());
  const weekFromNow = toDateInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  return activityStore.upcomingActivities.filter((e) => e.date >= today && e.date <= weekFromNow);
});

/** True when there are non-owner members who could receive an invite link. */
const hasInvitableMembers = computed(
  () => familyStore.members.filter((m) => m.role !== 'owner').length > 0
);

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
const cachedInviteExpiry = ref<string | null>(null);
const shareEmail = ref('');
const isSharing = ref(false);
const shareResult = ref<'success' | 'error' | null>(null);

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
    cachedInviteExpiry.value = null;
    return buildBaseJoinUrl();
  }

  const { generateInviteToken, createInvitePackage, hashInviteToken } =
    await import('@/services/crypto/inviteService');

  const token = generateInviteToken();
  const pkg = await createInvitePackage(fk, token);
  const tokenHash = await hashInviteToken(token);

  // Store the invite package in the V4 envelope
  await syncStore.addInvitePackage(tokenHash, pkg);

  // Cache the expiry so we can reuse this link until it expires
  cachedInviteExpiry.value = pkg.expiresAt;

  // Build full URL with token + provider info
  const base = buildBaseJoinUrl();
  return `${base}&t=${encodeURIComponent(token)}`;
}

async function openInviteModal() {
  inviteLinkError.value = null;
  showInviteModal.value = true;

  // Reuse cached invite link if it hasn't expired
  const { isInviteExpired } = await import('@/services/crypto/inviteService');
  if (
    inviteLink.value &&
    inviteQrUrl.value &&
    cachedInviteExpiry.value &&
    !isInviteExpired(cachedInviteExpiry.value)
  ) {
    return;
  }

  // Generate a fresh invite link with crypto token + QR code
  inviteQrUrl.value = '';
  isGeneratingInvite.value = true;
  try {
    inviteLink.value = await generateInviteLink();
    inviteQrUrl.value = await generateInviteQR(inviteLink.value);
  } catch (e) {
    cachedInviteExpiry.value = null;
    inviteLinkError.value = (e as Error).message;
    inviteLink.value = buildBaseJoinUrl();
  } finally {
    isGeneratingInvite.value = false;
  }
}

// Share invite modal (per-member share button on card)
const showShareModal = ref(false);

async function openShareModal() {
  // Generate invite link if we don't have a valid cached one
  const { isInviteExpired } = await import('@/services/crypto/inviteService');
  const hasCachedLink =
    inviteLink.value && cachedInviteExpiry.value && !isInviteExpired(cachedInviteExpiry.value);

  if (!hasCachedLink) {
    try {
      inviteLink.value = await generateInviteLink();
    } catch {
      openInviteModal();
      return;
    }
  }
  showShareModal.value = true;
}

async function handleShareWithEmail() {
  if (!isValidEmail(shareEmail.value)) return;
  isSharing.value = true;
  shareResult.value = null;
  try {
    const token = await getValidToken();
    // Share the .beanpod file itself (existing behavior).
    await shareFileWithEmail(token, syncStore.driveFileId!, shareEmail.value, 'writer');
    // Also share the parent folder so photos uploaded to it by any member
    // are accessible to everyone. `shareFileWithEmail` works identically
    // for folders (it hits the generic permissions endpoint).
    const folderId = await resolveCanonicalFolderId(token);
    if (folderId) {
      await shareFileWithEmail(token, folderId, shareEmail.value, 'writer').catch((e) => {
        // Folder share failures aren't fatal for a first-time invite — the
        // .beanpod share already succeeded. Log so we notice in dev.
        console.warn('[meetTheBeans] Folder share failed (non-fatal)', e);
      });
    }
    shareResult.value = 'success';
    shareEmail.value = '';
    setTimeout(() => {
      shareResult.value = null;
    }, 3000);
  } catch {
    shareResult.value = 'error';
  } finally {
    isSharing.value = false;
  }
}

/**
 * Lazy lookup of the canonical app-folder ID by reading `.beanpod`'s
 * parent. Cached module-locally for the session so repeat shares don't
 * refetch. Returns null if we can't determine the folder — callers treat
 * folder share as best-effort.
 */
let cachedAppFolderId: string | null = null;
async function resolveCanonicalFolderId(token: string): Promise<string | null> {
  if (cachedAppFolderId) return cachedAppFolderId;
  if (!syncStore.driveFileId) return null;
  try {
    const meta = await getFileMetadata(token, syncStore.driveFileId, 'parents');
    const parents = meta.parents as string[] | undefined;
    cachedAppFolderId = parents?.[0] ?? null;
    return cachedAppFolderId;
  } catch (e) {
    console.warn('[meetTheBeans] Could not resolve canonical folder', e);
    return null;
  }
}

/**
 * Skip share attempts for emails that can never succeed:
 *   - Temporary placeholders (`@setup.local`, `@temp.beanies.family`)
 *     that the app itself generates for members without real emails.
 *   - Non-routable TLDs (`.local`, `.test`, `.invalid`, `.example`)
 *     reserved by RFC 2606 for internal/dev use.
 * Drive responds 403 "not a Google account" for all of these — each
 * attempt is a pointless round-trip and a noisy console error. The
 * migration still runs the share call for real-looking emails; Drive
 * remains the source of truth for whether the target account exists.
 */
function isUnshareableEmail(email: string): boolean {
  if (isTemporaryEmail(email)) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return (
    domain.endsWith('.local') ||
    domain.endsWith('.test') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.example') ||
    domain === 'example.com' ||
    domain === 'example.org'
  );
}

/**
 * One-time migration for existing families: ensure the app folder is
 * shared with every existing family-member email. Idempotent — we call
 * listFilePermissions first and only share with emails that aren't
 * already writers.
 *
 * Session-scoped guard lives in `sessionStorage` (not a script-setup
 * variable) so repeat page mounts during the same browser session
 * don't re-run the migration. The key includes the driveFileId so a
 * different family loaded in the same session still gets its turn.
 */
const MIGRATION_STORAGE_PREFIX = 'beanies:folderShareMigration:';
async function runFolderShareMigration(): Promise<void> {
  const driveFileId = syncStore.driveFileId;
  if (!driveFileId) return;
  const storageKey = `${MIGRATION_STORAGE_PREFIX}${driveFileId}`;
  if (sessionStorage.getItem(storageKey)) return;
  sessionStorage.setItem(storageKey, '1');

  try {
    const token = await getValidToken();
    const folderId = await resolveCanonicalFolderId(token);
    if (!folderId) return;
    const existingPerms = await listFilePermissions(token, folderId);
    const alreadyShared = new Set(
      existingPerms.map((p) => p.emailAddress?.toLowerCase()).filter((e): e is string => !!e)
    );
    const memberEmails = familyStore.members
      .map((m) => m.email?.trim().toLowerCase())
      .filter((e): e is string => !!e)
      .filter((e) => !isUnshareableEmail(e));
    for (const email of memberEmails) {
      if (!alreadyShared.has(email)) {
        await shareFileWithEmail(token, folderId, email, 'writer').catch((e) => {
          console.warn('[meetTheBeans] Migration folder share failed for', email, e);
        });
      }
    }
  } catch (e) {
    console.warn('[meetTheBeans] Folder share migration failed', e);
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

// Open modals from query params (e.g. navigated from Family Nook or global search)
function handleFamilyQueryParam() {
  if (route.query.add === 'true') {
    openAddModal();
    router.replace({ query: {} });
  } else if (route.query.edit) {
    const memberId = route.query.edit as string;
    const member = familyStore.members.find((m) => m.id === memberId);
    if (member) openEditModal(member);
    router.replace({ query: {} });
  }
}
watch(
  () => route.query.edit,
  (val) => {
    if (val) handleFamilyQueryParam();
  }
);
onMounted(handleFamilyQueryParam);

// Run the one-time folder-share migration once the .beanpod file ID is
// available (i.e. sync has settled). Defers until after the initial load
// so we don't compete with the sign-in path's API calls.
watch(
  () => syncStore.driveFileId,
  (id, prev) => {
    if (id && !prev) {
      void runFolderShareMigration();
    }
  },
  { immediate: true }
);

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

    // Wait for drawer close transition before opening invite modal
    await nextTick();

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
    <!-- Header: Bean Pod title + family name + actions -->
    <div>
      <div class="flex items-start justify-between">
        <div>
          <h1 class="font-outfit text-secondary-500 text-2xl font-bold dark:text-gray-100">
            {{ t('family.hub.title') }} 🫘
          </h1>
          <!-- Family name — prominent, editable -->
          <div class="mt-1 flex items-center gap-1.5">
            <span
              v-if="!isEditingFamilyName"
              class="font-outfit text-primary-500 text-lg font-bold"
            >
              {{ familyContextStore.activeFamilyName || t('family.title') }}
            </span>
            <div v-else class="flex items-center gap-2">
              <input
                v-model="editFamilyName"
                type="text"
                class="font-outfit text-primary-500 focus:border-primary-500 focus:ring-primary-500 w-48 rounded-lg border border-gray-300 px-3 py-1 text-lg font-bold focus:ring-1 focus:outline-none dark:border-slate-600 dark:bg-slate-800"
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
              class="text-primary-500/40 hover:text-primary-500/70 rounded p-0.5 transition-colors"
              :title="t('family.editFamilyName')"
              @click="startEditFamilyName"
            >
              <BeanieIcon name="edit" size="sm" />
            </button>
          </div>
          <p class="text-secondary-500/40 mt-0.5 text-sm dark:text-gray-500">
            {{ t('family.hub.subtitle').replace('{count}', String(familyStore.members.length)) }}
          </p>
        </div>
        <!-- Action buttons — stacked right on desktop -->
        <div v-if="canManagePod" class="flex flex-shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            class="font-outfit from-primary-500 to-terracotta-400 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
            @click="openAddModal"
          >
            {{ t('family.hub.addBean') }}
          </button>
          <button
            v-if="familyContextStore.activeFamilyId && hasInvitableMembers"
            class="hidden items-center gap-2 rounded-full border border-[var(--color-sky-silk-300)]/50 bg-gradient-to-r from-[var(--color-sky-silk-300)]/30 via-[var(--color-sky-silk-300)]/15 to-[var(--color-sky-silk-300)]/30 px-4 py-2 shadow-sm transition-all hover:from-[var(--color-sky-silk-300)]/40 hover:via-[var(--color-sky-silk-300)]/25 hover:to-[var(--color-sky-silk-300)]/40 hover:shadow-md sm:flex dark:border-[var(--color-sky-silk-300)]/20 dark:from-[var(--color-sky-silk-300)]/20 dark:via-[var(--color-sky-silk-300)]/10 dark:to-[var(--color-sky-silk-300)]/20"
            @click="openInviteModal"
          >
            <span class="text-base">💌</span>
            <span class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
              {{ t('login.inviteTitle') }}
            </span>
          </button>
        </div>
      </div>

      <!-- Invite button — full-width on mobile only -->
      <button
        v-if="canManagePod && familyContextStore.activeFamilyId && hasInvitableMembers"
        class="mt-4 flex w-full items-center gap-3 rounded-2xl border border-[var(--color-sky-silk-300)]/50 bg-gradient-to-r from-[var(--color-sky-silk-300)]/30 via-[var(--color-sky-silk-300)]/15 to-[var(--color-sky-silk-300)]/30 px-4 py-3 text-left shadow-sm transition-all hover:from-[var(--color-sky-silk-300)]/40 hover:via-[var(--color-sky-silk-300)]/25 hover:to-[var(--color-sky-silk-300)]/40 hover:shadow-md sm:hidden dark:border-[var(--color-sky-silk-300)]/20 dark:from-[var(--color-sky-silk-300)]/20 dark:via-[var(--color-sky-silk-300)]/10 dark:to-[var(--color-sky-silk-300)]/20"
        @click="openInviteModal"
      >
        <span
          class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/80 text-lg shadow-sm dark:bg-white/15"
        >
          💌
        </span>
        <span class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
          {{ t('login.inviteTitle') }}
        </span>
        <svg
          class="text-secondary-500/30 ml-auto h-4 w-4 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>

    <!-- 2-column layout: member cards + quick info panel -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Member cards (2/3 width on desktop) -->
      <div class="space-y-4 lg:col-span-2">
        <BeanCard
          v-for="member in familyStore.members"
          :key="member.id"
          :member="member"
          :highlights="memberHighlights.get(member.id) ?? []"
          :can-manage="canManagePod"
          :class="syncHighlightClass(member.id)"
          @edit="openEditModal(member)"
          @delete="deleteMember(member.id)"
          @share-invite="openShareModal"
          @role-change="handleRoleChange(member.id, $event)"
        />
      </div>

      <!-- Quick Info panel (1/3 width on desktop) -->
      <div class="space-y-5">
        <!-- Family Stats -->
        <div
          class="rounded-[var(--sq)] bg-gradient-to-br from-[var(--tint-silk-10)] to-[var(--tint-orange-4)] p-5 dark:from-slate-700/50 dark:to-slate-700/30"
        >
          <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
            🌳 {{ t('family.hub.familyStats') }}
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between">
              <span class="text-secondary-500/50 dark:text-gray-500">
                {{ t('family.hub.members') }}
              </span>
              <span class="font-outfit text-secondary-500 font-bold dark:text-gray-200">
                {{ familyStore.members.length }}
                {{ t('family.hub.statBeans') }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-secondary-500/50 dark:text-gray-500">
                {{ t('family.hub.totalActivities') }}
              </span>
              <span class="font-outfit text-secondary-500 font-bold dark:text-gray-200">
                {{ activityStore.activeActivities.length }}
                {{ t('family.hub.highlight.thisWeek') }}
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-secondary-500/50 dark:text-gray-500">
                {{ t('family.hub.upcomingEvents') }}
              </span>
              <span class="font-outfit text-secondary-500 font-bold dark:text-gray-200">
                {{ upcomingThisWeek.length }}
                {{ t('family.hub.statUpcoming') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Events This Week -->
        <div>
          <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
            {{ t('family.hub.eventsThisWeek') }}
          </div>
          <div
            v-if="upcomingThisWeek.length"
            class="divide-y divide-[var(--tint-slate-5)] dark:divide-slate-700"
          >
            <div
              v-for="event in upcomingThisWeek.slice(0, 5)"
              :key="event.activity.id + event.date"
              class="flex gap-3 py-3"
            >
              <!-- Color bar -->
              <div
                class="w-1 flex-shrink-0 rounded-full"
                :style="{ backgroundColor: getEventBarColor(event.activity.category) }"
              />
              <div class="min-w-0 flex-1">
                <div class="text-secondary-500/40 text-xs dark:text-gray-500">
                  {{ event.date
                  }}{{ event.activity.startTime ? ', ' + event.activity.startTime : '' }}
                </div>
                <div
                  class="font-outfit text-secondary-500 truncate text-sm font-semibold dark:text-gray-200"
                >
                  {{ event.activity.title }}
                </div>
                <div class="text-secondary-500/40 text-xs dark:text-gray-500">
                  {{
                    normalizeAssignees(event.activity).length
                      ? normalizeAssignees(event.activity)
                          .map((id) => familyStore.members.find((m) => m.id === id)?.name || '')
                          .filter(Boolean)
                          .join(', ')
                      : t('family.title')
                  }}
                </div>
              </div>
            </div>
          </div>
          <p v-else class="text-secondary-500/40 text-xs dark:text-gray-500">
            {{ t('family.hub.noEvents') }}
          </p>
        </div>
      </div>
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
      size="lg"
      @close="showInviteModal = false"
    >
      <div class="space-y-5">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('login.inviteDesc') }}
        </p>

        <!-- Step 1: Prepare the family data pod file -->
        <div class="space-y-3">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#F15D22] to-[#E67E22] text-xs font-bold text-white"
            >
              1
            </div>
            <h3 class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
              {{ t('invite.step1.title') }}
            </h3>
          </div>

          <div class="ml-8">
            <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">
              {{ t('invite.step1.desc') }}
            </p>

            <!-- Google Drive: auto-share file access -->
            <div
              v-if="syncStore.storageProviderType === 'google_drive'"
              class="space-y-3 rounded-2xl bg-gradient-to-br from-[var(--tint-silk-10)] to-[var(--tint-silk-20)] p-4 dark:from-slate-700/40 dark:to-slate-700/20"
            >
              <div class="flex gap-2">
                <BaseInput
                  v-model="shareEmail"
                  type="email"
                  :placeholder="t('invite.shareEmail.placeholder')"
                  class="flex-1"
                />
                <BaseButton
                  :loading="isSharing"
                  :disabled="!isValidEmail(shareEmail)"
                  @click="handleShareWithEmail"
                >
                  {{ t('invite.shareEmail.button') }}
                </BaseButton>
              </div>
              <p
                v-if="shareResult === 'success'"
                class="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
              >
                <span>✓</span>
                {{ t('invite.shareEmail.success') }}
              </p>
              <p v-if="shareResult === 'error'" class="text-xs text-[#F15D22]">
                {{ t('invite.shareEmail.error') }}
              </p>

              <!-- Encrypted file reassurance -->
              <div class="flex items-start gap-2 rounded-xl bg-white/60 p-2.5 dark:bg-slate-800/40">
                <span class="flex-shrink-0 text-xs">🔒</span>
                <p class="text-xs text-slate-400 dark:text-slate-500">
                  {{ t('invite.step1.encrypted') }}
                </p>
              </div>

              <!-- Child sharing tip -->
              <div class="flex items-start gap-2 rounded-xl bg-white/60 p-2.5 dark:bg-slate-800/40">
                <span class="flex-shrink-0 text-xs">👶</span>
                <p class="text-xs text-slate-400 dark:text-slate-500">
                  {{ t('invite.step1.childTip') }}
                </p>
              </div>
            </div>

            <!-- Local storage: manual file sharing reminder -->
            <div
              v-else
              class="flex items-start gap-3 rounded-2xl bg-gradient-to-br from-[var(--tint-orange-8)] to-[var(--tint-silk-10)] p-4 dark:from-slate-700/40 dark:to-slate-700/20"
            >
              <div
                class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[var(--tint-orange-15)]"
              >
                <span class="text-sm">📁</span>
              </div>
              <div class="space-y-1">
                <p class="text-sm text-slate-700 dark:text-slate-300">
                  {{ t('join.shareFileNote') }}
                </p>
                <p class="text-xs text-slate-400 dark:text-slate-500">
                  {{ t('invite.step1.encrypted') }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2: Send the magic link -->
        <div class="space-y-3">
          <div class="flex items-center gap-2.5">
            <div
              class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#AED6F1] to-[#87CEEB] text-xs font-bold text-[#2C3E50]"
            >
              2
            </div>
            <h3 class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-200">
              {{ t('invite.step2.title') }}
            </h3>
          </div>
          <div class="ml-8">
            <InviteLinkCard :link="inviteLink" :qr-url="inviteQrUrl" :loading="isGeneratingInvite">
              <template #actions>
                <button
                  v-if="inviteLink && !isGeneratingInvite"
                  class="font-outfit flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--color-sky-silk-300)]/50 bg-gradient-to-r from-[var(--color-sky-silk-300)]/30 via-[var(--color-sky-silk-300)]/15 to-[var(--color-sky-silk-300)]/30 px-5 py-3 text-sm font-semibold text-[var(--color-secondary-500)] shadow-sm transition-all hover:from-[var(--color-sky-silk-300)]/40 hover:via-[var(--color-sky-silk-300)]/25 hover:to-[var(--color-sky-silk-300)]/40 hover:shadow-md dark:border-[var(--color-sky-silk-300)]/20 dark:from-[var(--color-sky-silk-300)]/20 dark:via-[var(--color-sky-silk-300)]/10 dark:to-[var(--color-sky-silk-300)]/20 dark:text-gray-200"
                  @click="showShareModal = true"
                >
                  <span class="text-base">💌</span>
                  {{ t('share.title') }}
                </button>
              </template>
            </InviteLinkCard>
          </div>
        </div>

        <!-- What happens next — info card -->
        <div
          class="flex items-start gap-3 rounded-2xl bg-gradient-to-br from-[var(--tint-silk-10)] to-white p-4 dark:from-slate-700/30 dark:to-slate-800/50"
        >
          <div
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-[var(--tint-silk-20)]"
          >
            <span class="text-sm">💡</span>
          </div>
          <div class="space-y-1">
            <p class="text-xs font-medium text-slate-600 dark:text-slate-300">
              {{ t('invite.whatNext.title') }}
            </p>
            <p class="text-xs text-slate-400 dark:text-slate-500">
              {{ t('invite.whatNext.desc') }}
            </p>
          </div>
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

    <!-- Share Invite Link Modal -->
    <ShareInviteModal
      :open="showShareModal"
      :link="inviteLink"
      :family-name="familyContextStore.activeFamilyName || t('family.title')"
      :member-name="familyStore.currentMember?.name || t('family.title')"
      @close="showShareModal = false"
    />
  </div>
</template>
