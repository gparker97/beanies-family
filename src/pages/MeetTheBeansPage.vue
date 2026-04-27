<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import BeanCard from '@/components/family/BeanCard.vue';
import FamilyMemberModal from '@/components/family/FamilyMemberModal.vue';
import InviteWizardModal from '@/components/family/InviteWizardModal.vue';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm, alert as showAlert } from '@/composables/useConfirm';
import { isUnshareableEmail } from '@/utils/email';
import { toDateInputValue } from '@/utils/date';
import {
  listFilePermissions,
  resolveCanonicalFolderId,
  shareFileWithEmail,
} from '@/services/google/driveService';
import { getValidToken } from '@/services/google/googleAuth';
import { usePermissions } from '@/composables/usePermissions';
import { useInviteFlow } from '@/composables/useInviteFlow';
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

// Public Drive URL (ADR-021) — sync, no fetch, no cache.
function thumbForRecipe(recipeId: string): string | null {
  const recipe = recipesStore.recipes.find((r) => r.id === recipeId);
  const pid = recipe?.photoIds?.[0];
  if (!pid) return null;
  return photoStore.getPublicUrl(pid, 'thumb');
}

// Sidebar: allergies across all members, severity-sorted. Cap at 6 so
// the card stays scannable; overflow flows to /pod/safety via the
// "View all N →" link that renders below when totals exceed the cap.
const SIDEBAR_LIMIT = 6;
const SEVERITY_ORDER = { severe: 0, moderate: 1, mild: 2 } as const;
const sortedAllergies = computed(() =>
  [...allergiesStore.allergies].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  )
);
const sidebarAllergies = computed(() => sortedAllergies.value.slice(0, SIDEBAR_LIMIT));
const totalAllergies = computed(() => allergiesStore.allergies.length);

// Sidebar: today's active medications across the family.
const sidebarMedications = computed(() => medicationsStore.active.slice(0, SIDEBAR_LIMIT));
const totalActiveMedications = computed(() => medicationsStore.active.length);

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

const showAddModal = ref(false);
const showEditModal = ref(false);
const editingMember = ref<FamilyMember | null>(null);
const isEditingFamilyName = ref(false);
const editFamilyName = ref('');
const showInviteModal = ref(false);

// Single owner of invite-link state — see useInviteFlow for cache reuse,
// Drive sharing, link generation, QR rendering, and error handling.
const inviteFlow = useInviteFlow();

// Bean whose share button was tapped — drives the wizard's `prefill` prop.
// Null when the wizard was opened from the generic "Invite Beanie" button.
const pendingShareMember = ref<FamilyMember | null>(null);

const wizardPrefill = computed(() =>
  pendingShareMember.value
    ? {
        email: pendingShareMember.value.email || '',
        memberName: pendingShareMember.value.name,
      }
    : undefined
);

function openInviteModal() {
  pendingShareMember.value = null;
  inviteFlow.reset();
  showInviteModal.value = true;
}

function openShareModal(member: FamilyMember) {
  pendingShareMember.value = member;
  inviteFlow.reset();
  showInviteModal.value = true;
}

function handleWizardClose() {
  showInviteModal.value = false;
  pendingShareMember.value = null;
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
    const folderId = await resolveCanonicalFolderId(token, driveFileId);
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
    return;
  }
  const memberName = data.name;
  const isPet = data.isPet === true;
  let created;
  try {
    created = await familyStore.createMember(data);
  } catch (e) {
    console.error('[meetTheBeans] handleMemberSave failed', { error: e });
    showToast('error', t('family.addMemberFailed'));
    return;
  }
  showAddModal.value = false;
  await nextTick();

  if (!created) {
    // familyStore already logged with [familyStore] prefix; surface a
    // user-actionable toast and bail (don't open the invite wizard
    // pointing at a member that doesn't exist).
    showToast('error', t('family.addMemberFailed'));
    return;
  }

  showToast('success', t('family.memberAdded'), memberName);
  if (isPet) return;

  // Pre-select the freshly-created bean in the wizard. The wizard sees
  // `prefill` and starts at Step 1 (confirm-email) directly, skipping
  // the picker — the user just told us who they want to invite.
  pendingShareMember.value = created;
  inviteFlow.reset();
  showInviteModal.value = true;
}

/**
 * Wizard's "+ add a new beanie" tile was tapped — close the wizard so
 * FamilyMemberModal can take focus, then open the add-modal. The wizard
 * will reopen automatically once the new member is saved (see
 * handleMemberSave). If the user cancels the add-modal, the wizard
 * stays closed; they can reopen via "Invite Beanie" again.
 *
 * The nextTick lets the wizard's exit transition start before the
 * add-modal mounts — otherwise both dialogs are momentarily visible
 * (looks like a stack rather than a swap).
 */
async function handleAddBeanFromWizard() {
  showInviteModal.value = false;
  pendingShareMember.value = null;
  await nextTick();
  openAddModal();
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
          <h1
            class="font-outfit text-secondary-500 text-2xl leading-tight font-extrabold break-words sm:text-3xl dark:text-gray-100"
          >
            {{ familyContextStore.activeFamilyName || t('family.title') }}
          </h1>
          <div v-if="isEditingFamilyName" class="flex w-full items-center gap-2 sm:w-auto">
            <input
              v-model="editFamilyName"
              type="text"
              class="font-outfit text-primary-500 focus:border-primary-500 focus:ring-primary-500 w-full min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1 text-lg font-bold focus:ring-1 focus:outline-none sm:w-48 sm:flex-initial dark:border-slate-600 dark:bg-slate-800"
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
      <div
        v-if="canManagePod"
        class="flex w-full flex-shrink-0 flex-wrap items-center gap-2 sm:w-auto"
      >
        <button
          v-if="familyContextStore.activeFamilyId"
          type="button"
          class="font-outfit text-secondary-500 inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-white sm:flex-initial dark:bg-slate-800/80 dark:text-gray-100 dark:hover:bg-slate-800"
          @click="openInviteModal"
        >
          <span aria-hidden="true">💌</span>
          <span>{{ t('family.hub.inviteBean') }}</span>
        </button>
        <button
          type="button"
          class="font-outfit from-primary-500 to-terracotta-400 inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(241,93,34,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(241,93,34,0.3)] sm:flex-initial"
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
        <!-- Member cards grid — ordered adults -> children -> pets via sortedMembers. -->
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <BeanCard
            v-for="member in familyStore.sortedMembers"
            :key="member.id"
            :member="member"
            :can-manage="canManagePod"
            :class="syncHighlightClass(member.id)"
            @edit="openEditModal(member)"
            @delete="deleteMember(member.id)"
            @share-invite="openShareModal(member)"
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
              class="group font-caveat flex w-48 flex-shrink-0 snap-start flex-col justify-between rounded-[18px] px-4 py-4 text-left shadow-[var(--card-shadow)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)] sm:w-56"
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
          <router-link
            v-if="totalAllergies > sidebarAllergies.length"
            to="/pod/safety"
            class="font-outfit mt-3 inline-flex text-xs font-semibold text-[#F15D22] hover:underline"
          >
            {{
              t('family.hub.sidebar.viewAllAllergies').replace('{count}', String(totalAllergies))
            }}
          </router-link>
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
          <router-link
            v-if="
              sidebarMedications.length > 0 && totalActiveMedications > sidebarMedications.length
            "
            to="/pod/safety"
            class="font-outfit mt-3 inline-flex text-xs font-semibold text-[#1E5A85] hover:underline"
          >
            {{
              t('family.hub.sidebar.viewAllMeds').replace('{count}', String(totalActiveMedications))
            }}
          </router-link>
          <p
            v-if="sidebarMedications.length === 0"
            class="font-inter text-secondary-500/50 text-xs italic dark:text-gray-500"
          >
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

    <!-- Invite Family Member Wizard — both the generic "Invite Beanie" CTA
         and the per-bean share button funnel through here. The wizard
         renders Step 1 (confirm email) → Step 2 (send invite link). -->
    <InviteWizardModal
      :open="showInviteModal"
      :provider="syncStore.storageProviderType"
      :inviter-name="familyStore.currentMember?.name ?? t('family.title')"
      :family-name="familyContextStore.activeFamilyName || t('family.title')"
      :prefill="wizardPrefill"
      :invite-flow="inviteFlow"
      @close="handleWizardClose"
      @add-bean="handleAddBeanFromWizard"
    />
  </div>
</template>
