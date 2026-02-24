import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { hashPassword, verifyPassword } from '@/services/auth/passwordService';
import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';
import { useSettingsStore } from './settingsStore';
import { deleteFamilyDatabase } from '@/services/indexeddb/database';
import { flushPendingSave } from '@/services/sync/syncService';

export interface AuthUser {
  memberId: string;
  email: string;
  familyId?: string;
  role?: string;
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const isInitialized = ref(false);
  const isAuthenticated = ref(false);
  const currentUser = ref<AuthUser | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const needsAuth = computed(() => !isAuthenticated.value);
  const displayName = computed(() => {
    if (!currentUser.value) return '';
    const familyStore = useFamilyStore();
    const member = familyStore.members.find((m) => m.id === currentUser.value?.memberId);
    return member?.name ?? currentUser.value.email ?? '';
  });

  /**
   * Initialize auth on app startup.
   * Checks if a family exists in registry — if yes, auth happens after file load.
   */
  async function initializeAuth(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      // Check if any family exists in registry
      const db = await getRegistryDatabase();
      const families = await db.getAll('families');

      if (families.length > 0) {
        // Family exists — user will authenticate after file loads
        isInitialized.value = true;
        // Don't set isAuthenticated yet — wait for signIn()
        return;
      }

      // No family exists — user needs to create or join one
      isInitialized.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to initialize auth';
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign in with member selection and password.
   * Called after the data file is loaded and member is selected.
   */
  async function signIn(
    memberId: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      const familyStore = useFamilyStore();
      const member = familyStore.members.find((m) => m.id === memberId);

      if (!member) {
        error.value = 'Member not found';
        return { success: false, error: error.value };
      }

      if (!member.passwordHash) {
        error.value = 'No password set for this member';
        return { success: false, error: error.value };
      }

      const valid = await verifyPassword(password, member.passwordHash);
      if (!valid) {
        error.value = 'Incorrect password';
        return { success: false, error: error.value };
      }

      const familyContextStore = useFamilyContextStore();

      currentUser.value = {
        memberId: member.id,
        email: member.email,
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member.role,
      };
      isAuthenticated.value = true;
      familyStore.setCurrentMember(member.id);

      // Track last login timestamp
      const now = toISODateString(new Date());
      familyStore.updateMember(member.id, { lastLoginAt: now });

      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Sign in failed';
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign up: create a new family + owner member with password.
   * This is the owner-only "Create Pod" flow.
   */
  async function signUp(params: {
    email: string;
    password: string;
    familyName: string;
    memberName: string;
  }): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      // Create the family
      const familyContextStore = useFamilyContextStore();
      const family = await familyContextStore.createFamily(params.familyName);

      if (!family) {
        return { success: false, error: 'Failed to create family' };
      }

      // Hash the password
      const passwordHashValue = await hashPassword(params.password);

      // Create the owner member with password hash
      const familyStore = useFamilyStore();
      const member = await familyStore.createMember({
        name: params.memberName,
        email: params.email,
        gender: 'male',
        ageGroup: 'adult',
        role: 'owner',
        color: '#3b82f6',
        passwordHash: passwordHashValue,
        requiresPassword: false,
      });

      // Create UserFamilyMapping in registry
      if (member) {
        const registryDb = await getRegistryDatabase();
        await registryDb.add('userFamilyMappings', {
          id: generateUUID(),
          email: params.email,
          familyId: family.id,
          familyRole: 'owner',
          memberId: member.id,
          lastActiveAt: toISODateString(new Date()),
        });
      }

      // Mark onboarding as completed — the create pod wizard handles everything
      const settingsStore = useSettingsStore();
      await settingsStore.setOnboardingCompleted(true);

      // Auto sign in
      currentUser.value = {
        memberId: member!.id,
        email: params.email,
        familyId: family.id,
        role: 'owner',
      };
      isAuthenticated.value = true;

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sign up failed';
      error.value = message;
      return { success: false, error: message };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Set password for an existing member (used during joiner onboarding).
   */
  async function setPassword(
    memberId: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const passwordHashValue = await hashPassword(password);
      const familyStore = useFamilyStore();
      await familyStore.updateMember(memberId, {
        passwordHash: passwordHashValue,
        requiresPassword: false,
      });

      const familyContextStore = useFamilyContextStore();
      const member = familyStore.members.find((m) => m.id === memberId);

      currentUser.value = {
        memberId,
        email: member?.email ?? '',
        familyId: familyContextStore.activeFamilyId ?? undefined,
        role: member?.role,
      };
      isAuthenticated.value = true;
      familyStore.setCurrentMember(memberId);

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to set password';
      return { success: false, error: message };
    }
  }

  /**
   * Join an existing family as a pre-created member.
   * Sets the member's password, creates a UserFamilyMapping, and marks onboarding complete.
   */
  async function joinFamily(params: {
    memberId: string;
    password: string;
    familyId: string;
  }): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      // Set password (this also auto-signs in and sets currentMember)
      const result = await setPassword(params.memberId, params.password);
      if (!result.success) return result;

      // Create UserFamilyMapping in registry DB
      const familyStore = useFamilyStore();

      // Track last login timestamp for the newly joined member
      const now = toISODateString(new Date());
      await familyStore.updateMember(params.memberId, { lastLoginAt: now });

      const member = familyStore.members.find((m) => m.id === params.memberId);
      const registryDb = await getRegistryDatabase();
      await registryDb.add('userFamilyMappings', {
        id: generateUUID(),
        email: member?.email ?? '',
        familyId: params.familyId,
        familyRole: member?.role === 'owner' ? 'owner' : 'member',
        memberId: params.memberId,
        lastActiveAt: toISODateString(new Date()),
      });

      // Mark onboarding as completed
      const settingsStore = useSettingsStore();
      await settingsStore.setOnboardingCompleted(true);

      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to join family';
      error.value = message;
      return { success: false, error: message };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign out: reset auth state and optionally delete IndexedDB cache.
   * File handle is preserved so next login auto-reconnects to the data file.
   */
  async function signOut(): Promise<void> {
    // Flush any pending debounced save so recent changes persist to file
    await flushPendingSave();

    const familyId = currentUser.value?.familyId;

    // Delete the per-family IndexedDB cache unless this is a trusted device
    const settingsStore = useSettingsStore();
    if (familyId && !settingsStore.isTrustedDevice) {
      try {
        await deleteFamilyDatabase(familyId);
      } catch (e) {
        console.warn('Failed to delete family database on sign-out:', e);
      }
    }

    // Clear auth state
    currentUser.value = null;
    isAuthenticated.value = false;
  }

  /**
   * E2E test helper: restore auth from sessionStorage (dev mode only).
   * When the e2e_auto_auth flag is set, auto-authenticate so the app
   * skips the login page and loads family data from IndexedDB cache.
   */
  function restoreE2EAuth(): boolean {
    if (!import.meta.env.DEV) return false;
    try {
      if (sessionStorage.getItem('e2e_auto_auth') !== 'true') return false;
      isAuthenticated.value = true;
      isInitialized.value = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sign out and always clear the per-family IndexedDB cache,
   * regardless of trusted device status. Also resets the trust flag.
   */
  async function signOutAndClearData(): Promise<void> {
    // Flush any pending debounced save so recent changes persist to file
    await flushPendingSave();

    const familyId = currentUser.value?.familyId;

    // Always delete regardless of trust setting
    if (familyId) {
      try {
        await deleteFamilyDatabase(familyId);
      } catch (e) {
        console.warn('Failed to delete family database on sign-out:', e);
      }
    }

    // Clear trust flag
    const settingsStore = useSettingsStore();
    await settingsStore.setTrustedDevice(false);

    // Clear auth state
    currentUser.value = null;
    isAuthenticated.value = false;
  }

  return {
    // State
    isInitialized,
    isAuthenticated,
    currentUser,
    isLoading,
    error,
    // Getters
    needsAuth,
    displayName,
    // Actions
    initializeAuth,
    signIn,
    signUp,
    setPassword,
    joinFamily,
    signOut,
    signOutAndClearData,
    restoreE2EAuth,
  };
});
