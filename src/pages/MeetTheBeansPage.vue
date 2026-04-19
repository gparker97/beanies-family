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
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useSayingsStore } from '@/stores/sayingsStore';
import { useAllergiesStore } from '@/stores/allergiesStore';
import { useMedicationsStore } from '@/stores/medicationsStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { usePhotoStore } from '@/stores/photoStore';
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
const favoritesStore = useFavoritesStore();
const sayingsStore = useSayingsStore();
const allergiesStore = useAllergiesStore();
const medicationsStore = useMedicationsStore();
const recipesStore = useRecipesStore();
const photoStore = usePhotoStore();
const { t } = useTranslation();
const { canManagePod } = usePermissions();
const { syncHighlightClass } = useSyncHighlight();

/** Event bar color based on activity category. */
function getEventBarColor(category: ActivityCategory): string {
  return getActivityCategoryColor(category);
}

// Per-member highlights now live inside BeanCard.vue — it reads
// favorites / sayings / allergies / medications / notes directly from
// the content stores so the card stays in sync without parent wiring.

// --- Pod overview stats + cross-family rails --------------------------

const headerStats = computed(() =>
  t('family.hub.stats.summary')
    .replace('{beans}', String(familyStore.members.length))
    .replace('{favorites}', String(favoritesStore.favorites.length))
    .replace('{sayings}', String(sayingsStore.sayings.length))
    .replace('{recipes}', String(recipesStore.recipes.length))
    .replace('{meds}', String(medicationsStore.active.length))
    .replace('{allergies}', String(allergiesStore.allergies.length))
);

// Recent-sayings rail: most-recent-first, capped at 8.
const recentSayings = computed(() =>
  [...sayingsStore.sayings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8)
);

// Recipe rail: up to 4 recipes alphabetical, plus an "Add recipe" card
// rendered directly in the template when canManagePod.
const railRecipes = computed(() =>
  [...recipesStore.recipes].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 4)
);

// Recipe thumbnails resolved lazily, cached by photoId so re-renders
// don't re-fetch. Matches the pattern in FamilyCookbookPage.
const recipeThumbCache = ref<Record<string, string | null>>({});
function thumbForRecipe(recipeId: string): string | null {
  const recipe = recipesStore.recipes.find((r) => r.id === recipeId);
  const pid = recipe?.photoIds?.[0];
  if (!pid) return null;
  if (recipeThumbCache.value[pid] === undefined) {
    recipeThumbCache.value = { ...recipeThumbCache.value, [pid]: null };
    photoStore
      .getBlobUrl(pid)
      .then((url) => {
        recipeThumbCache.value = { ...recipeThumbCache.value, [pid]: url };
      })
      .catch((e) => console.warn('[meetTheBeans] recipe thumb resolve failed', e));
  }
  return recipeThumbCache.value[pid] ?? null;
}

// Sidebar: allergies across all members, severity-sorted, capped.
const SEVERITY_ORDER = { severe: 0, moderate: 1, mild: 2 } as const;
const sidebarAllergies = computed(() =>
  [...allergiesStore.allergies]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 5)
);

// Sidebar: today's active medications across the family.
const sidebarMedications = computed(() => medicationsStore.active.slice(0, 5));

function memberFor(id: string): FamilyMember | undefined {
  return familyStore.members.find((m) => m.id === id);
}

function stickyColorFor(index: number): string {
  return ['#fff7c8', '#d4f1f4', '#ffe4d6', '#e8f5e8'][index % 4] ?? '#fff7c8';
}

function goToBean(memberId: string, tab?: string): void {
  router.push(tab ? `/pod/${memberId}/${tab}` : `/pod/${memberId}`);
}

// Upcoming activities within the next 7 days (for quick info panel)
const upcomingThisWeek = computed(() => {
  const today = toDateInputValue(new Date());
  const weekFromNow = toDateInputValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  return activityStore.upcomingActivities.filter((e) => e.date >= today && e.date <= weekFromNow);
});

/** True when there are non-owner, non-pet members who could receive an invite link. */
const hasInvitableMembers = computed(
  () => familyStore.members.filter((m) => m.role !== 'owner' && !m.isPet).length > 0
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
      .filter((m) => !m.isPet)
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
    <!-- Pod overview header: kicker + family name + stats line +
         Invite Bean / Add Bean inline -->
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div
          class="font-outfit text-secondary-500/60 text-[11px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
        >
          {{ t('family.hub.kicker') }}
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <h1 class="font-outfit text-secondary-500 text-3xl font-extrabold dark:text-gray-100">
            {{ familyContextStore.activeFamilyName || t('family.title') }}
          </h1>
          <div v-if="isEditingFamilyName" class="flex items-center gap-2">
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
            class="text-secondary-500/40 hover:text-primary-500 rounded p-0.5 transition-colors"
            :title="t('family.editFamilyName')"
            @click="startEditFamilyName"
          >
            <BeanieIcon name="edit" size="sm" />
          </button>
        </div>
        <p class="font-inter text-secondary-500/60 mt-1 text-sm dark:text-gray-400">
          {{ headerStats }}
        </p>
      </div>
      <div v-if="canManagePod" class="flex flex-shrink-0 flex-wrap items-center gap-2">
        <button
          v-if="familyContextStore.activeFamilyId && hasInvitableMembers"
          type="button"
          class="font-outfit text-secondary-500 inline-flex items-center gap-1.5 rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-white dark:bg-slate-800/80 dark:text-gray-100 dark:hover:bg-slate-800"
          @click="openInviteModal"
        >
          <span aria-hidden="true">💌</span>
          <span>{{ t('family.hub.inviteBean') }}</span>
        </button>
        <button
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex items-center gap-1.5 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)]"
          @click="openAddModal"
        >
          <span aria-hidden="true">＋</span>
          <span>{{ t('family.hub.addBean') }}</span>
        </button>
      </div>
    </header>

    <!-- Pod overview layout: main (beans grid + rails) + right sidebar -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <!-- Main column -->
      <div class="space-y-6">
        <!-- Member cards grid -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BeanCard
            v-for="member in familyStore.members"
            :key="member.id"
            :member="member"
            :can-manage="canManagePod"
            :class="syncHighlightClass(member.id)"
            @edit="openEditModal(member)"
            @delete="deleteMember(member.id)"
            @share-invite="openShareModal"
            @role-change="handleRoleChange(member.id, $event)"
          />
        </div>

        <!-- Recent family sayings rail -->
        <section>
          <div class="mb-3 flex items-baseline justify-between gap-2">
            <h2 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-200">
              {{ t('family.hub.recentSayings') }}
            </h2>
            <router-link
              v-if="recentSayings.length > 0"
              to="/pod/scrapbook"
              class="font-inter text-primary-500 text-xs font-semibold hover:underline"
            >
              {{ t('family.hub.recentSayings.viewAll') }}
            </router-link>
          </div>
          <div
            v-if="recentSayings.length > 0"
            class="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2"
          >
            <button
              v-for="(saying, i) in recentSayings"
              :key="saying.id"
              type="button"
              class="group font-caveat flex w-56 flex-shrink-0 snap-start flex-col justify-between rounded-[18px] px-4 py-4 text-left shadow-[var(--card-shadow)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]"
              :style="{
                backgroundColor: stickyColorFor(i),
                transform: `rotate(${i % 2 === 0 ? '-1.5deg' : '1.2deg'})`,
              }"
              @click="goToBean(saying.memberId, 'sayings')"
            >
              <blockquote class="text-secondary-500 line-clamp-4 text-lg leading-snug font-medium">
                "{{ saying.words }}"
              </blockquote>
              <footer class="font-inter text-secondary-500/60 mt-3 text-[11px] font-semibold">
                — {{ memberFor(saying.memberId)?.name ?? t('family.title') }}
              </footer>
            </button>
          </div>
          <p v-else class="font-inter text-secondary-500/40 text-sm italic dark:text-gray-500">
            {{ t('family.hub.recentSayings.empty') }}
          </p>
        </section>

        <!-- Cookbook strip — kraft-paper backdrop -->
        <section
          class="rounded-[var(--sq)] p-5 shadow-[var(--card-shadow)]"
          style="
            background-image:
              linear-gradient(135deg, rgb(44 62 80 / 4%) 0%, transparent 60%),
              linear-gradient(to bottom right, #f4e4c1, #e8d4a8);
          "
        >
          <div class="mb-4 flex items-baseline justify-between gap-2">
            <div>
              <h2 class="font-outfit text-base font-bold" style="color: #5a4a2a">
                {{ t('family.hub.cookbook.title') }}
              </h2>
              <p class="font-caveat mt-0.5 text-sm" style="color: #8a6a3a">
                {{ t('family.hub.cookbook.sub') }}
              </p>
            </div>
            <router-link
              to="/pod/cookbook"
              class="font-inter text-xs font-semibold hover:underline"
              style="color: #5a4a2a"
            >
              {{ t('family.hub.cookbook.open') }}
            </router-link>
          </div>
          <div class="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
            <router-link
              v-for="recipe in railRecipes"
              :key="recipe.id"
              :to="`/pod/cookbook/${recipe.id}`"
              class="group flex w-36 flex-shrink-0 snap-start flex-col overflow-hidden rounded-[14px] bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div
                class="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-[#fff5e8] to-[#ffe4d6]"
              >
                <img
                  v-if="thumbForRecipe(recipe.id)"
                  :src="thumbForRecipe(recipe.id)!"
                  :alt="recipe.name"
                  class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div
                  v-else
                  class="font-caveat flex h-full w-full items-center justify-center text-center text-xs"
                  style="color: #8a6a3a"
                >
                  {{ t('family.hub.cookbook.noPhoto') }}
                </div>
              </div>
              <div class="px-2.5 py-2">
                <h3 class="font-outfit truncate text-[13px] font-bold" style="color: #2c3e50">
                  {{ recipe.name }}
                </h3>
              </div>
            </router-link>
            <button
              v-if="canManagePod"
              type="button"
              class="font-inter flex w-36 flex-shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed p-3 text-center text-xs font-semibold transition-colors hover:bg-white/40"
              style="border-color: rgb(90 74 42 / 30%); color: #5a4a2a"
              @click="router.push('/pod/cookbook?add=1')"
            >
              <span class="text-2xl leading-none" aria-hidden="true">+</span>
              <span>{{ t('family.hub.cookbook.add') }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- Right sidebar -->
      <aside class="space-y-5">
        <!-- Heads up — allergies -->
        <section
          class="rounded-[var(--sq)] p-4 shadow-[var(--card-shadow)]"
          style="background: linear-gradient(135deg, rgb(241 93 34 / 8%), rgb(230 126 34 / 4%))"
        >
          <div class="nook-section-label mb-3 flex items-center gap-1.5 text-[#F15D22]">
            <span aria-hidden="true">⚠️</span>
            <span>{{ t('family.hub.sidebar.allergies') }}</span>
          </div>
          <ul v-if="sidebarAllergies.length > 0" class="space-y-2">
            <li v-for="a in sidebarAllergies" :key="a.id" class="flex items-start gap-2">
              <span
                class="font-outfit mt-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
                :class="
                  a.severity === 'severe'
                    ? 'bg-[#F15D22] text-white'
                    : a.severity === 'moderate'
                      ? 'bg-[#E67E22]/20 text-[#B5591A]'
                      : 'bg-[#AED6F1]/30 text-[#1E5A85]'
                "
              >
                {{ a.severity }}
              </span>
              <div class="min-w-0 flex-1">
                <div
                  class="font-outfit text-secondary-500 truncate text-xs font-bold dark:text-gray-200"
                >
                  {{ a.name }}
                </div>
                <div class="text-secondary-500/50 truncate text-[11px] dark:text-gray-500">
                  {{ memberFor(a.memberId)?.name ?? '—' }}
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="font-inter text-secondary-500/50 text-xs italic dark:text-gray-500">
            {{ t('family.hub.sidebar.noAllergies') }}
          </p>
        </section>

        <!-- Today's care -->
        <section
          class="rounded-[var(--sq)] p-4 shadow-[var(--card-shadow)]"
          style="background: linear-gradient(135deg, rgb(174 214 241 / 30%), rgb(174 214 241 / 8%))"
        >
          <div class="nook-section-label mb-3 flex items-center gap-1.5 text-[#1E5A85]">
            <span aria-hidden="true">💊</span>
            <span>{{ t('family.hub.sidebar.todaysCare') }}</span>
          </div>
          <ul v-if="sidebarMedications.length > 0" class="space-y-2">
            <li v-for="m in sidebarMedications" :key="m.id" class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <div
                  class="font-outfit text-secondary-500 truncate text-xs font-bold dark:text-gray-200"
                >
                  {{ m.name }}
                </div>
                <div class="text-secondary-500/60 truncate text-[11px] dark:text-gray-400">
                  {{ m.dose }} · {{ m.frequency }}
                </div>
                <div class="text-secondary-500/40 truncate text-[10px] dark:text-gray-500">
                  {{ memberFor(m.memberId)?.name ?? '—' }}
                </div>
              </div>
            </li>
          </ul>
          <p v-else class="font-inter text-secondary-500/50 text-xs italic dark:text-gray-500">
            {{ t('family.hub.sidebar.noMeds') }}
          </p>
        </section>

        <!-- Events this week (compact) -->
        <section v-if="upcomingThisWeek.length > 0">
          <div class="nook-section-label text-secondary-500 mb-3 dark:text-gray-400">
            {{ t('family.hub.eventsThisWeek') }}
          </div>
          <ul class="divide-y divide-[var(--tint-slate-5)] dark:divide-slate-700">
            <li
              v-for="event in upcomingThisWeek.slice(0, 4)"
              :key="event.activity.id + event.date"
              class="flex gap-2.5 py-2.5"
            >
              <div
                class="w-1 flex-shrink-0 rounded-full"
                :style="{ backgroundColor: getEventBarColor(event.activity.category) }"
              />
              <div class="min-w-0 flex-1">
                <div class="text-secondary-500/40 text-[10px] dark:text-gray-500">
                  {{ event.date
                  }}{{ event.activity.startTime ? ', ' + event.activity.startTime : '' }}
                </div>
                <div
                  class="font-outfit text-secondary-500 truncate text-xs font-semibold dark:text-gray-200"
                >
                  {{ event.activity.title }}
                </div>
              </div>
            </li>
          </ul>
        </section>
      </aside>
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
