import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import { changeDoc } from '@/services/automerge/docService';
import { reportError } from '@/utils/errorReporter';
import { wrapAsync } from '@/composables/useStoreActions';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

export const useFamilyStore = defineStore('family', () => {
  // State
  const members = ref<FamilyMember[]>([]);
  const currentMemberId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const currentMember = computed(() => members.value.find((m) => m.id === currentMemberId.value));

  const owner = computed(() => members.value.find((m) => m.role === 'owner'));

  const hasOwner = computed(() => !!owner.value);

  const isSetupComplete = computed(() => hasOwner.value || members.value.length > 0);

  /**
   * Members sorted in roster order: adults (oldest → youngest) → children
   * (oldest → youngest) → pets (alphabetical). Pets always land last so
   * human-first surfaces like Meet the Beans, scrapbook cards, and
   * calendar member rails keep the family front-and-centre; humans still
   * sort by age within each tier and fall back to name.
   */
  const sortedMembers = computed(() =>
    [...members.value].sort((a, b) => {
      // Tier 1: pets always after humans.
      const aIsPet = !!a.isPet;
      const bIsPet = !!b.isPet;
      if (aIsPet !== bIsPet) return aIsPet ? 1 : -1;
      // Tier 2: adults before children (only meaningful between humans —
      // pets are already isolated in their own tier above).
      if (a.ageGroup !== b.ageGroup) return a.ageGroup === 'adult' ? -1 : 1;
      // Tier 3: oldest first within the same tier.
      const yearA = a.dateOfBirth?.year ?? Infinity;
      const yearB = b.dateOfBirth?.year ?? Infinity;
      if (yearA !== yearB) return yearA - yearB;
      // Tier 4: name for stability.
      return a.name.localeCompare(b.name);
    })
  );

  /**
   * Human members only — excludes pets. Use this for any surface where
   * a member must take an action: assignees (todos, activities, vacations),
   * owners (accounts, goals, assets), invite flows, login pickers,
   * permission UI, and member-scoped financial filters. Pets lack emails,
   * permissions, and logins, so they belong only in display / roster
   * surfaces (Meet the Beans, Scrapbook, photo galleries).
   */
  const humans = computed(() => members.value.filter((m) => !m.isPet));

  /** Humans sorted (same rule as sortedMembers). */
  const sortedHumans = computed(() => sortedMembers.value.filter((m) => !m.isPet));

  /** True when at least one pet exists — handy for conditional UI. */
  const hasPets = computed(() => members.value.some((m) => m.isPet));

  // Diagnostic: track permission changes on currentMember
  watch(currentMember, (newMember, oldMember) => {
    if (!oldMember || !newMember) return;
    if (oldMember.id !== newMember.id) {
      console.warn(
        '[familyStore] currentMember changed identity:',
        oldMember.id,
        '→',
        newMember.id
      );
    }
    if (oldMember.canViewFinances !== newMember.canViewFinances) {
      console.warn(
        '[familyStore] canViewFinances changed:',
        oldMember.canViewFinances,
        '→',
        newMember.canViewFinances,
        'member:',
        newMember.id,
        newMember.name
      );
    }
    if (oldMember.canEditActivities !== newMember.canEditActivities) {
      console.warn(
        '[familyStore] canEditActivities changed:',
        oldMember.canEditActivities,
        '→',
        newMember.canEditActivities,
        'member:',
        newMember.id,
        newMember.name
      );
    }
    if (oldMember.canManagePod !== newMember.canManagePod) {
      console.warn(
        '[familyStore] canManagePod changed:',
        oldMember.canManagePod,
        '→',
        newMember.canManagePod,
        'member:',
        newMember.id,
        newMember.name
      );
    }
  });

  /**
   * Diagnostic: log duplicate members so we can catch the "member listed
   * twice" class of bug. Distinct-id collisions shouldn't be possible
   * (UUIDs), but matching email OR matching name+dateOfBirth suggests
   * either a double-create from a UX race or a CRDT merge weirdness.
   * Purely informational — we don't silently dedupe because we can't
   * know which record is the "right" one to keep.
   */
  function logDuplicateMembers(list: FamilyMember[]): void {
    const byId = new Map<string, number>();
    const byEmail = new Map<string, FamilyMember[]>();
    const byKey = new Map<string, FamilyMember[]>();
    for (const m of list) {
      byId.set(m.id, (byId.get(m.id) ?? 0) + 1);
      if (m.email && !m.email.endsWith('@temp.beanies.family')) {
        const arr = byEmail.get(m.email.toLowerCase()) ?? [];
        arr.push(m);
        byEmail.set(m.email.toLowerCase(), arr);
      }
      const dob = m.dateOfBirth
        ? `${m.dateOfBirth.year ?? ''}-${m.dateOfBirth.month}-${m.dateOfBirth.day}`
        : '';
      const key = `${m.name.trim().toLowerCase()}|${m.ageGroup}|${dob}`;
      const arr = byKey.get(key) ?? [];
      arr.push(m);
      byKey.set(key, arr);
    }
    for (const [id, count] of byId) {
      if (count > 1) {
        console.warn('[familyStore] duplicate member id detected:', id, 'count:', count);
      }
    }
    for (const [email, arr] of byEmail) {
      if (arr.length > 1) {
        console.warn(
          '[familyStore] duplicate email across members:',
          email,
          'ids:',
          arr.map((m) => m.id)
        );
      }
    }
    for (const [key, arr] of byKey) {
      if (arr.length > 1) {
        console.warn(
          '[familyStore] likely-duplicate member (same name/age/dob):',
          key,
          'ids:',
          arr.map((m) => m.id)
        );
      }
    }
  }

  // Actions
  async function loadMembers() {
    await wrapAsync(isLoading, error, async () => {
      const prevMemberId = currentMemberId.value;
      const loaded = await familyRepo.getAllFamilyMembers();
      members.value = await normalizeRoles(loaded);
      logDuplicateMembers(members.value);

      // Restore currentMemberId: prefer authStore session, then previous value, then owner
      if (!currentMemberId.value) {
        // Try restoring from authStore session (survives page refresh via localStorage)
        try {
          const { useAuthStore } = await import('@/stores/authStore');
          const authStore = useAuthStore();
          const sessionMemberId = authStore.currentUser?.memberId;
          if (sessionMemberId && members.value.some((m) => m.id === sessionMemberId)) {
            currentMemberId.value = sessionMemberId;
            return;
          }
        } catch {
          // authStore not available yet — fall through
        }
        // Fallback to owner
        if (owner.value) {
          currentMemberId.value = owner.value.id;
        }
      } else if (!members.value.some((m) => m.id === currentMemberId.value)) {
        // currentMemberId no longer in members array — this shouldn't happen
        console.warn(
          '[familyStore] currentMemberId not found in members after reload:',
          currentMemberId.value,
          'members:',
          members.value.map((m) => m.id)
        );
        // Try authStore session
        try {
          const { useAuthStore } = await import('@/stores/authStore');
          const authStore = useAuthStore();
          const sessionMemberId = authStore.currentUser?.memberId;
          if (sessionMemberId && members.value.some((m) => m.id === sessionMemberId)) {
            currentMemberId.value = sessionMemberId;
            return;
          }
        } catch {
          // fall through
        }
        // Last resort: owner
        currentMemberId.value = owner.value?.id ?? prevMemberId;
      }
    });
  }

  async function createMember(input: CreateFamilyMemberInput): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const member = await familyRepo.createFamilyMember(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      members.value = [...members.value, member];
      return member;
    });
    return result ?? null;
  }

  /**
   * Recreate a member with a specific id. Mirrors `createMember`; used only to
   * rebuild the owner after a full-page redirect during onboarding wiped the
   * in-memory Automerge doc (the persisted `authStore.currentUser.memberId`
   * and the `.beanpod` envelope's `wrappedKeys` keyed by it must still match).
   */
  async function createMemberWithId(
    id: string,
    input: CreateFamilyMemberInput
  ): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const member = await familyRepo.createFamilyMemberWithId(id, input);
      members.value = [...members.value, member];
      return member;
    });
    return result ?? null;
  }

  async function updateMember(
    id: string,
    input: UpdateFamilyMemberInput
  ): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await familyRepo.updateFamilyMember(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        members.value = members.value.map((m) => (m.id === id ? updated : m));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteMember(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await familyRepo.deleteFamilyMember(id);
      if (success) {
        members.value = members.value.filter((m) => m.id !== id);
        if (currentMemberId.value === id) {
          currentMemberId.value = owner.value?.id ?? null;
        }
      }
      return success;
    });
    return result ?? false;
  }

  /**
   * Idempotent self-heal that runs on every load. Ensures exactly one
   * owner exists and migrates legacy `admin` rows to `member` while
   * preserving their effective canManagePod permission.
   *
   * All mutations happen inside a single `changeDoc()` call for atomicity.
   * Returns the (possibly mutated) member list with defaults re-applied.
   * Fast-path: if no writes are needed, returns the input unchanged.
   */
  async function normalizeRoles(list: FamilyMember[]): Promise<FamilyMember[]> {
    if (list.length === 0) return list;

    type Patch = Partial<
      Pick<FamilyMember, 'role' | 'canManagePod' | 'canViewFinances' | 'canEditActivities'>
    >;
    const patches = new Map<string, Patch>();

    const merge = (id: string, p: Patch) => patches.set(id, { ...(patches.get(id) ?? {}), ...p });

    // 1. Ensure exactly one owner.
    const owners = list.filter((m) => m.role === 'owner');
    if (owners.length > 1) {
      // Keep the earliest createdAt; demote the rest. Preserve their flags.
      const sorted = [...owners].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const m of sorted.slice(1)) {
        merge(m.id, { role: 'member' });
      }
    } else if (owners.length === 0) {
      const humansOnly = list.filter((m) => !m.isPet);
      const candidates = humansOnly.filter((m) => m.requiresPassword === false);
      const pool = candidates.length > 0 ? candidates : humansOnly;
      const candidate = [...pool].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (candidate) {
        merge(candidate.id, {
          role: 'owner',
          canManagePod: true,
          canViewFinances: true,
          canEditActivities: true,
        });
        reportError({
          surface: 'familyStore.normalize-roles',
          message: 'No owner found — promoting earliest human to owner',
          severity: 'warning',
          context: { candidateId: candidate.id, memberCount: list.length },
        });
      } else {
        reportError({
          surface: 'familyStore.normalize-roles',
          message: 'No owner and no human candidate — pod has only pets',
          severity: 'warning',
          context: { memberCount: list.length },
        });
      }
    }

    // 2. Migrate legacy `admin` rows to `member`. Lock in canManagePod=true
    //    so their effective permission survives the applyDefaults rule change.
    for (const m of list) {
      if (m.role === 'admin') {
        merge(m.id, {
          role: 'member',
          canManagePod: m.canManagePod ?? true,
        });
      }
    }

    if (patches.size === 0) return list;

    // Apply all patches in a single Automerge transaction.
    try {
      changeDoc((doc) => {
        for (const [id, patch] of patches) {
          const target = doc.familyMembers[id];
          if (!target) continue;
          if (patch.role !== undefined) target.role = patch.role;
          if (patch.canManagePod !== undefined) target.canManagePod = patch.canManagePod;
          if (patch.canViewFinances !== undefined) target.canViewFinances = patch.canViewFinances;
          if (patch.canEditActivities !== undefined)
            target.canEditActivities = patch.canEditActivities;
        }
      }, 'normalize roles');
    } catch (e) {
      console.error(
        '[familyStore.normalizeRoles] Automerge change rejected. Pod may render without an owner until reload.',
        e
      );
      reportError({
        surface: 'familyStore.normalize-roles',
        message: 'changeDoc rejected during role normalization',
        error: e,
        context: { patchCount: patches.size },
      });
      // Return the unmodified list rather than throw — the rest of load
      // should proceed; the user just won't see the owner crown until next reload.
      return list;
    }

    // Re-fetch via the repository so applyDefaults runs on the patched records.
    return familyRepo.getAllFamilyMembers();
  }

  /**
   * Transfer the Owner role from the current owner to `toMemberId`.
   * Atomic: both demote + promote happen in a single Automerge change.
   * Updates authStore.currentUser.role if the session belongs to either
   * the outgoing or incoming owner so the UI re-renders without a reload.
   */
  async function transferOwnership(toMemberId: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const target = members.value.find((m) => m.id === toMemberId);
      const currentOwner = owner.value;
      // requiresPassword === true ⇒ invitee hasn't joined yet (no passwordHash,
      // no auth identity bound to the pod). Transferring to such a member would
      // strand the pod with no working owner: the new "owner" can't log in and
      // the previous owner has demoted themselves out of the transfer flow.
      // normalizeRoles() does NOT self-heal this — it only fires on 0 or >1
      // owners, and exactly one owner exists (just an unreachable one).
      if (
        !target ||
        target.isPet ||
        target.id === currentOwner?.id ||
        target.requiresPassword === true
      ) {
        reportError({
          surface: 'familyStore.transferOwnership',
          message: 'Invalid transfer target',
          severity: 'warning',
          context: {
            toMemberId,
            currentOwnerId: currentOwner?.id,
            isPet: target?.isPet,
            requiresPassword: target?.requiresPassword,
          },
        });
        return false;
      }

      changeDoc((doc) => {
        if (currentOwner) {
          const out = doc.familyMembers[currentOwner.id];
          if (out) out.role = 'member';
        }
        const t = doc.familyMembers[toMemberId];
        if (!t) {
          throw new Error(`Target member ${toMemberId} not found in document`);
        }
        t.role = 'owner';
        t.canManagePod = true;
        t.canViewFinances = true;
        t.canEditActivities = true;
      }, 'transfer ownership');

      // In-place local state update — same pattern as updateMember above.
      members.value = members.value.map((m) => {
        if (currentOwner && m.id === currentOwner.id) return { ...m, role: 'member' };
        if (m.id === toMemberId) {
          return {
            ...m,
            role: 'owner',
            canManagePod: true,
            canViewFinances: true,
            canEditActivities: true,
          };
        }
        return m;
      });

      // Reflect role change in authStore session if applicable.
      try {
        const { useAuthStore } = await import('@/stores/authStore');
        const authStore = useAuthStore();
        if (currentOwner && authStore.currentUser?.memberId === currentOwner.id) {
          authStore.updateCurrentUserRole('member');
        } else if (authStore.currentUser?.memberId === toMemberId) {
          authStore.updateCurrentUserRole('owner');
        }
      } catch (e) {
        // Session role update is non-fatal — the doc transfer already succeeded.
        // Worst case: a UI permission gate uses the old role until next reload.
        console.warn('[familyStore.transferOwnership] authStore role sync failed', e);
        reportError({
          surface: 'familyStore.transferOwnership',
          message: 'authStore role sync after transfer failed',
          error: e,
          context: { currentOwnerId: currentOwner?.id, toMemberId },
        });
      }

      return true;
    });
    return result ?? false;
  }

  function setCurrentMember(id: string) {
    if (members.value.some((m) => m.id === id)) {
      currentMemberId.value = id;
    }
  }

  function resetState() {
    members.value = [];
    currentMemberId.value = null;
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    members,
    currentMemberId,
    isLoading,
    error,
    // Getters
    currentMember,
    owner,
    hasOwner,
    isSetupComplete,
    sortedMembers,
    humans,
    sortedHumans,
    hasPets,
    // Actions
    loadMembers,
    createMember,
    createMemberWithId,
    updateMember,
    deleteMember,
    transferOwnership,
    setCurrentMember,
    resetState,
  };
});
