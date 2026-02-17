import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { isCognitoConfigured } from '@/config/cognito';
import * as cognitoService from '@/services/auth/cognitoService';
import * as tokenManager from '@/services/auth/tokenManager';
import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import { generateUUID } from '@/utils/id';
import { toISODateString } from '@/utils/date';
import { useFamilyContextStore } from './familyContextStore';
import { useFamilyStore } from './familyStore';

export interface AuthUser {
  userId: string;
  email: string;
  familyId?: string;
  familyRole?: string;
}

export const useAuthStore = defineStore('auth', () => {
  // State
  const isInitialized = ref(false);
  const isAuthenticated = ref(false);
  const isOfflineSession = ref(false);
  const isLocalOnlyMode = ref(false);
  const currentUser = ref<AuthUser | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const isAuthConfigured = computed(() => isCognitoConfigured());
  const needsAuth = computed(
    () => isAuthConfigured.value && !isAuthenticated.value && !isLocalOnlyMode.value
  );
  const displayName = computed(() => currentUser.value?.email ?? 'Local User');

  /**
   * Initialize auth on app startup.
   * Tries Cognito session first, then cached session, then falls back to local-only.
   */
  async function initializeAuth(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      if (!isCognitoConfigured()) {
        // No Cognito configured — run in local-only mode
        isLocalOnlyMode.value = true;
        isAuthenticated.value = true;
        isInitialized.value = true;
        return;
      }

      // Try getting current Cognito session (works if user logged in previously)
      const session = await cognitoService.getCurrentSession();
      if (session) {
        const claims = cognitoService.getIdTokenClaims(session);

        // DEBUG: trace family ID resolution
        console.log('[Auth] JWT claims:', JSON.stringify(claims));

        // Resolve familyId: JWT claim → Cognito user attributes → registry lookup → cached session
        let familyId = claims.familyId;
        let familyRole = claims.familyRole;
        console.log('[Auth] JWT familyId:', familyId);
        if (!familyId) {
          // JWT claim missing — try fetching user attributes directly from Cognito
          const attrs = await cognitoService.getUserAttributes();
          console.log('[Auth] getUserAttributes result:', JSON.stringify(attrs));
          if (attrs?.['custom:familyId']) {
            familyId = attrs['custom:familyId'];
            familyRole = attrs['custom:familyRole'] ?? familyRole;
          }
        }
        if (!familyId) {
          // Cognito attributes also missing — try registry lookup by email
          familyId = await lookupFamilyByEmail(claims.email);
          console.log('[Auth] Registry lookup familyId:', familyId);
        }
        if (!familyId) {
          // All remote/registry lookups failed — try cached session as last resort
          const cachedSession = await tokenManager.getCachedSession(claims.sub);
          if (cachedSession?.familyId) {
            familyId = cachedSession.familyId;
            console.log('[Auth] Cached session familyId:', familyId);
          }
        }
        console.log('[Auth] Final resolved familyId:', familyId);

        currentUser.value = {
          userId: claims.sub,
          email: claims.email,
          familyId,
          familyRole,
        };
        isAuthenticated.value = true;
        isOfflineSession.value = false;

        // Cache session for offline use
        await tokenManager.cacheSession({
          userId: claims.sub,
          email: claims.email,
          idToken: session.getIdToken().getJwtToken(),
          accessToken: session.getAccessToken().getJwtToken(),
          refreshToken: session.getRefreshToken().getToken(),
          expiresAt: new Date(claims.exp * 1000),
          familyId: familyId ?? '',
        });

        // Activate the user's family
        if (familyId) {
          const familyContextStore = useFamilyContextStore();
          await familyContextStore.switchFamily(familyId);
        }

        isInitialized.value = true;
        return;
      }

      // No active Cognito session — check for cached session (offline support)
      const cachedSession = await tokenManager.getAnyCachedSession();
      if (cachedSession && tokenManager.isSessionValidForOffline(cachedSession)) {
        currentUser.value = {
          userId: cachedSession.userId,
          email: cachedSession.email,
          familyId: cachedSession.familyId,
        };
        isAuthenticated.value = true;
        isOfflineSession.value = true;

        // Activate the cached user's family
        if (cachedSession.familyId) {
          const familyContextStore = useFamilyContextStore();
          await familyContextStore.switchFamily(cachedSession.familyId);
        }

        isInitialized.value = true;
        return;
      }

      // No valid session — user needs to log in
      isInitialized.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to initialize auth';
      isInitialized.value = true;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Look up a user's family from the registry UserFamilyMapping by email.
   * Used as a fallback when custom:familyId is not in the JWT.
   */
  async function lookupFamilyByEmail(email: string): Promise<string | undefined> {
    try {
      const db = await getRegistryDatabase();
      const mappings = await db.getAllFromIndex('userFamilyMappings', 'by-email', email);
      if (mappings.length > 0 && mappings[0]) {
        // Return the most recently active mapping
        return mappings[0].familyId;
      }
    } catch {
      // Registry lookup failed — not critical
    }
    return undefined;
  }

  /**
   * Sign in with email and password.
   */
  async function signIn(
    email: string,
    password: string
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;

    try {
      const result = await cognitoService.signIn(email, password);

      if (!result.success || !result.session) {
        error.value = result.error ?? 'Sign in failed';
        return { success: false, error: error.value };
      }

      const claims = cognitoService.getIdTokenClaims(result.session);

      // Resolve familyId: JWT claim → Cognito user attributes → registry lookup → cached session
      let familyId = claims.familyId;
      let familyRole = claims.familyRole;
      if (!familyId) {
        const attrs = await cognitoService.getUserAttributes();
        if (attrs?.['custom:familyId']) {
          familyId = attrs['custom:familyId'];
          familyRole = attrs['custom:familyRole'] ?? familyRole;
        }
      }
      if (!familyId) {
        familyId = await lookupFamilyByEmail(claims.email);
      }
      if (!familyId) {
        // All remote/registry lookups failed — try cached session
        const cachedSession = await tokenManager.getCachedSession(claims.sub);
        if (cachedSession?.familyId) {
          familyId = cachedSession.familyId;
        }
      }

      currentUser.value = {
        userId: claims.sub,
        email: claims.email,
        familyId,
        familyRole,
      };
      isAuthenticated.value = true;
      isOfflineSession.value = false;

      // Cache session (only store familyId if we actually resolved one)
      await tokenManager.cacheSession({
        userId: claims.sub,
        email: claims.email,
        idToken: result.session.getIdToken().getJwtToken(),
        accessToken: result.session.getAccessToken().getJwtToken(),
        refreshToken: result.session.getRefreshToken().getToken(),
        expiresAt: new Date(claims.exp * 1000),
        familyId: familyId ?? '',
      });

      // Activate the user's family
      if (familyId) {
        const familyContextStore = useFamilyContextStore();
        await familyContextStore.switchFamily(familyId);
      }

      return { success: true };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Sign in failed';
      return { success: false, error: error.value };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign up a new user and create their family.
   */
  async function signUp(params: {
    email: string;
    password: string;
    familyName: string;
    memberName: string;
  }): Promise<{ success: boolean; error?: string; needsVerification?: boolean }> {
    isLoading.value = true;
    error.value = null;

    try {
      // Create the family first
      const familyContextStore = useFamilyContextStore();
      const family = await familyContextStore.createFamily(params.familyName);

      if (!family) {
        return { success: false, error: 'Failed to create family' };
      }

      // Create the owner member in the per-family database
      const familyStore = useFamilyStore();
      const member = await familyStore.createMember({
        name: params.memberName,
        email: params.email,
        role: 'owner',
        color: '#3b82f6',
      });

      // Create UserFamilyMapping in registry for family lookup during sign-in
      if (member) {
        const registryDb = await getRegistryDatabase();
        await registryDb.add('userFamilyMappings', {
          id: generateUUID(),
          email: params.email,
          familyId: family.id,
          familyRole: 'owner',
          memberId: member.id,
          isLocalOnly: false,
          lastActiveAt: toISODateString(new Date()),
        });
      }

      // Sign up with Cognito
      const result = await cognitoService.signUp({
        email: params.email,
        password: params.password,
        familyId: family.id,
        familyRole: 'owner',
      });

      if (!result.userConfirmed) {
        return { success: true, needsVerification: true };
      }

      // Auto sign-in after signup if confirmed
      const signInResult = await signIn(params.email, params.password);
      return signInResult;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Sign up failed';
      error.value = message;
      return { success: false, error: message };
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Sign out and clear session.
   */
  async function signOut(): Promise<void> {
    cognitoService.signOut();

    if (currentUser.value?.userId) {
      await tokenManager.clearCachedSession(currentUser.value.userId);
    }

    currentUser.value = null;
    isAuthenticated.value = false;
    isOfflineSession.value = false;
    isLocalOnlyMode.value = false;
  }

  /**
   * Continue without authentication (local-only mode).
   * Preserves the current setup flow for users who don't want accounts.
   */
  function continueWithoutAuth(): void {
    isLocalOnlyMode.value = true;
    isAuthenticated.value = true;
  }

  return {
    // State
    isInitialized,
    isAuthenticated,
    isOfflineSession,
    isLocalOnlyMode,
    currentUser,
    isLoading,
    error,
    // Getters
    isAuthConfigured,
    needsAuth,
    displayName,
    // Actions
    initializeAuth,
    signIn,
    signUp,
    signOut,
    continueWithoutAuth,
  };
});
