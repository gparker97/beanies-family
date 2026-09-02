import { dedupedAppend } from '@/utils/segmentTravellers';
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import { getById as projectionGetById } from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';
import type { MutationOp } from '@/services/automerge/worker/protocol';
import { reportError } from '@/utils/errorReporter';
import { wrapAsync } from '@/composables/useStoreActions';
import { refreshRosterCache } from '@/services/auth/rosterCache';
import { computeInitials } from '@/utils/memberInitials';
import { isBlankMemberColor } from '@/constants/memberColors';
import { logEvent } from '@/services/telemetry/logEvent';
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

  /**
   * Display initials per member id — one letter, or two where two beans in this
   * family share a first letter.
   *
   * Computed once for the whole roster rather than per face: collision is a
   * property of the SET, so a per-member helper would rescan the roster on every
   * face on every render (O(n²) per card stack, on a month grid painting 100+
   * faces). Every avatar is a map read.
   */
  const initialsById = computed(() => computeInitials(members.value));

  /**
   * A bean with no usable colour renders a neutral face wherever hue is the
   * identity signal, which is a data defect worth counting — but `resolveMemberColor`
   * runs on the render path, so it cannot be the thing that reports it (it would be
   * rate-capped inside a single paint, and would need mutable state in a constants
   * file). Reported here instead: once per roster change, O(n), off the render path.
   */
  watch(
    members,
    (list) => {
      const blank = list.filter((m) => !m.isPet && isBlankMemberColor(m.color));
      if (blank.length === 0) return;
      logEvent({
        level: 'warn',
        surface: 'member-colour',
        message: 'member has no usable colour',
        context: { action: 'missing-colour', count: blank.length },
      });
    },
    { immediate: true }
  );

  // Keep the device-local pre-decrypt roster cache current (2026-08-28 login rethink).
  // Every mutation path replaces `members.value` wholesale, so a shallow watch on the
  // sorted projection covers load + add + update + remove with one seam. The service
  // no-ops on an empty list (so the sign-out reset can't erase a good roster) and on a
  // missing active family (join/create flows before registration).
  watch(sortedMembers, (list) => {
    void (async () => {
      // Phase 4: snapshot whether the open envelope has any password wraps so the
      // prove engine can suppress the password method for kit-born families on a
      // cold device. Dynamic import avoids a familyStore↔syncStore import cycle;
      // any failure leaves the flag unknown (safe default: password offered).
      let envelopeHasPasswordWraps: boolean | undefined;
      try {
        const { useSyncStore } = await import('./syncStore');
        const env = useSyncStore().envelope;
        if (env) envelopeHasPasswordWraps = Object.keys(env.wrappedKeys ?? {}).length > 0;
      } catch {
        // leave unknown
      }
      await refreshRosterCache(list, envelopeHasPasswordWraps);
    })();
  });

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

  /**
   * How the persisted session's memberId resolves against a freshly-loaded roster.
   *
   * ONE reader of that session (#80). Both `loadMembers` branches used to carry their own
   * copy of this lookup, which meant adding a rejection would have produced four copies of
   * a security decision nested three deep.
   */
  type MemberResolution =
    | { kind: 'use'; id: string }
    | { kind: 'none' } // no session member — the legitimate signup / pre-login bootstrap
    | { kind: 'reject' }; // an authenticated session names a member who is not here

  async function resolveSessionMember(roster: FamilyMember[]): Promise<MemberResolution> {
    try {
      const { useAuthStore } = await import('@/stores/authStore');
      const authStore = useAuthStore();
      const sessionMemberId = authStore.currentUser?.memberId;
      if (!sessionMemberId) return { kind: 'none' };
      // An EMPTY roster is "the doc did not load", not "your member was removed". App.vue's
      // path-3 fallback deliberately renders an empty doc when the cache is unavailable or
      // Drive permission was lost, and the user recovers from Settings. Rejecting here
      // would sign them out mid-boot on a recoverable error.
      if (roster.length === 0) return { kind: 'none' };
      if (roster.some((m) => m.id === sessionMemberId)) {
        // The pod itself now vouches for this member, which is the ONLY point at which a
        // restored pre-#80 session is worth sealing. Sealing it at restore time would
        // have signed an unverified blob (#80 review).
        //
        // Its own try: the outer catch treats a throw as "no session member", so without
        // this a failure in an optional re-seal would cost the member their session.
        try {
          authStore.confirmSessionMember();
        } catch (e) {
          console.warn('[familyStore] could not re-seal a restored legacy session', e);
        }
        return { kind: 'use', id: sessionMemberId };
      }
      // Present, authenticated, and naming somebody who is not in the pod. Never fall
      // through to the owner — that IS the escalation this exists to stop.
      return authStore.isAuthenticated ? { kind: 'reject' } : { kind: 'none' };
    } catch {
      // authStore not constructed yet (boot ordering) — same as "no session member".
      return { kind: 'none' };
    }
  }

  /** Has a session been rejected for integrity reasons? Blocks the owner fallback. */
  async function sessionWasRejected(): Promise<boolean> {
    try {
      const { useAuthStore } = await import('@/stores/authStore');
      return useAuthStore().sessionRejected;
    } catch {
      return false;
    }
  }

  /**
   * This session names nobody real. State the fact and let authStore act on it — this
   * store does not clear storage or hand-roll a sign-out tail.
   *
   * `reason` separates the two ROUTINE ways to reach here from the one alarming way.
   * Loading a different family's pod file, and removing your own bean, both legitimately
   * leave an authenticated session naming somebody who is not in the new roster; reporting
   * those as integrity rejections drowns the single metric that means somebody edited a
   * session. Both still end the session — they just say why.
   */
  async function rejectSession(
    reason: 'unknown-member' | 'roster-switched' | 'self-removed' = 'unknown-member'
  ): Promise<void> {
    currentMemberId.value = null;
    const { useAuthStore } = await import('@/stores/authStore');
    useAuthStore().invalidateSession(reason);
  }

  // Actions
  async function loadMembers() {
    await wrapAsync(isLoading, error, async () => {
      const prevMemberId = currentMemberId.value;
      const loaded = await familyRepo.getAllFamilyMembers();
      const roster = await normalizeRoles(loaded);
      // Resolve the session member BEFORE publishing the roster. Assigning members.value
      // first left a tick where the roster existed but currentMemberId was still null,
      // and usePermissions (which now refuses to read the session `role` once a roster
      // exists) reported the owner as a non-owner for that tick — the Piggy Bank nav
      // vanished and the canViewFinances true->false diagnostic fired on every boot.
      const resolvedForRoster = currentMemberId.value ? null : await resolveSessionMember(roster);
      members.value = roster;
      logDuplicateMembers(members.value);

      // Restore currentMemberId: prefer authStore session, then previous value, then owner
      if (!currentMemberId.value) {
        const resolved = resolvedForRoster ?? (await resolveSessionMember(members.value));
        if (resolved.kind === 'use') {
          currentMemberId.value = resolved.id;
          return;
        }
        if (resolved.kind === 'reject') {
          await rejectSession('roster-switched');
          return;
        }
        // No session member at all: the legitimate signup / pre-login bootstrap.
        // NOT reachable after a rejection — `sessionRejected` stays true until a real
        // sign-in, so a rejected session cannot be handed the owner's row on the next
        // reload and read as owner again.
        if (owner.value && !(await sessionWasRejected())) {
          currentMemberId.value = owner.value.id;
        }
      } else if (!members.value.some((m) => m.id === currentMemberId.value)) {
        const resolved = await resolveSessionMember(members.value);
        if (resolved.kind === 'use') {
          currentMemberId.value = resolved.id;
          return;
        }
        if (resolved.kind === 'reject') {
          await rejectSession('roster-switched');
          return;
        }
        // Last resort. The old code fell back to the OWNER here, which silently promoted
        // a member whose record had vanished (#80). Reuse the previous id only if it is
        // still real; otherwise this session names nobody.
        currentMemberId.value =
          prevMemberId && members.value.some((m) => m.id === prevMemberId) ? prevMemberId : null;
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

  /**
   * Record confirmed document-name → member mappings so they auto-match next time.
   *
   * MOVED OUT OF THE VIEW, and the reason is the invariant rather than tidiness: the same
   * member may appear several times in one confirmation (a passenger listed per leg), and a
   * second sequential `updateMember` for that member would read the aliases from BEFORE the
   * first write and clobber it. Grouping per member is therefore load-bearing, and it lived
   * only as a comment inside a 123-line handler in TravelPlansPage — so any future caller
   * that learned aliases from anywhere else would have re-broken it silently.
   *
   * Deliberately warn-not-throw at the call site's discretion: this returns how many members
   * were written and swallows nothing, but a failure here must never undo the trip that was
   * already saved.
   */
  async function learnAliases(pairs: Array<{ memberId: string; alias: string }>): Promise<number> {
    if (!pairs.length) return 0;

    const byMember = new Map<string, string[]>();
    for (const { memberId, alias } of pairs) {
      byMember.set(memberId, [...(byMember.get(memberId) ?? []), alias]);
    }

    let written = 0;
    for (const [memberId, additions] of byMember) {
      const member = members.value.find((m) => m.id === memberId);
      // Skip a member who has vanished (removed on another device) rather than creating one.
      if (!member) continue;
      await updateMember(memberId, { aliases: dedupedAppend(member.aliases, additions) });
      written += 1;
    }
    return written;
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
          // Self-removal. Do NOT inherit the owner's row (#80): deletion is gated on
          // canManagePod, and the call-site guard only blocks deleting THE OWNER — so a
          // non-owner manager who removed their own bean used to land on the owner's
          // record and read as owner. This session is simply over.
          currentMemberId.value = null;
          const { useAuthStore } = await import('@/stores/authStore');
          const authStore = useAuthStore();
          // Unauthenticated self-delete is the signup-time CreateMembersStep path — it
          // just clears, exactly as before, minus the owner inheritance.
          // `self-removed`, not `unknown-member`: the member chose this. Reporting a
          // deliberate departure as an integrity rejection is what makes the tamper
          // metric unreadable.
          if (authStore.isAuthenticated) authStore.invalidateSession('self-removed');
        }
        await invalidateDeviceCredentials(id);
      }
      return success;
    });
    return result ?? false;
  }

  /**
   * Retire a removed member's biometric/passkey credentials on THIS device.
   *
   * Lives here, in the orchestrator, rather than at the three view call sites
   * (CreateMembersStep / BeanDetailPage / MeetTheBeansPage): views must not call services
   * (MVO), and putting it at the call sites would triplicate it and leak on any fourth
   * path added later.
   *
   * Deliberately non-fatal. A keystore failure must NOT block the deletion or flip
   * `deleteMember`'s return value — the member row is already gone, and reporting `false`
   * for a deletion that happened would be a worse lie than a stale credential. It is
   * wrapped INSIDE `wrapAsync`'s success branch for the same reason: `wrapAsync` already
   * toasts and sets `error` on any throw, so an unguarded throw here would both
   * double-toast and mis-report the outcome.
   *
   * SCOPE: this reaches only credentials enrolled on this device — the passkey registry is
   * device-local. Revoking a removed member's access on THEIR devices, and their ability
   * to decrypt the pod at all, is tracker #77.
   */
  async function invalidateDeviceCredentials(memberId: string): Promise<void> {
    try {
      const { removeAllPasskeysForMember } = await import('@/services/auth/passkeyService');
      await removeAllPasskeysForMember(memberId);
    } catch (e) {
      reportError({
        surface: 'member-removal',
        message: 'failed to invalidate device credentials for a removed member',
        error: e,
        severity: 'warning',
        context: { action: 'invalidate_credentials', member_id_tail: memberId.slice(-8) },
      });
    }
    // The PIN device-unlock wrap is family-key material too: a removed member's PIN must
    // stop unwrapping the family key on this device (review: it previously survived
    // removal forever — only sign-out tiers and family deletion ever reclaimed it).
    try {
      const { getActiveFamilyId } = await import('@/services/indexeddb/database');
      const familyId = getActiveFamilyId();
      if (familyId) {
        const { removePinUnlock } = await import('@/services/auth/deviceUnlock');
        await removePinUnlock(familyId, memberId);
      }
    } catch (e) {
      reportError({
        surface: 'member-removal',
        message: 'failed to remove the PIN unlock wrap for a removed member',
        error: e,
        severity: 'warning',
        context: { action: 'invalidate_pin_wrap', member_id_tail: memberId.slice(-8) },
      });
    }
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

    // Apply all patches in a single atomic batch. Skip members absent from the
    // projection (the worker `patch` would reject the whole batch on a missing
    // entity — the old code skipped them per-member). `{quiet}`: this fires on a
    // load path where a critical toast is wrong; the reportError below classifies.
    try {
      const ops: MutationOp[] = [];
      for (const [id, patch] of patches) {
        if (!projectionGetById('familyMembers', id)) continue;
        const p: Record<string, unknown> = {};
        if (patch.role !== undefined) p.role = patch.role;
        if (patch.canManagePod !== undefined) p.canManagePod = patch.canManagePod;
        if (patch.canViewFinances !== undefined) p.canViewFinances = patch.canViewFinances;
        if (patch.canEditActivities !== undefined) p.canEditActivities = patch.canEditActivities;
        if (Object.keys(p).length)
          ops.push({ op: 'patch', collection: 'familyMembers', id, patch: p });
      }
      if (ops.length) await mutate({ op: 'batch', ops }, { quiet: true });
    } catch (e) {
      console.error(
        '[familyStore.normalizeRoles] Automerge change rejected. Pod may render without an owner until reload.',
        e
      );
      reportError({
        surface: 'familyStore.normalize-roles',
        message: 'mutation batch rejected during role normalization',
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

      // Demote old owner + promote target in one atomic batch. The target was
      // validated present above; the worker `patch` still throws (→ rejects the
      // batch) if it's somehow gone, preserving the "target not found" guard.
      const ops: MutationOp[] = [];
      if (currentOwner && projectionGetById('familyMembers', currentOwner.id)) {
        ops.push({
          op: 'patch',
          collection: 'familyMembers',
          id: currentOwner.id,
          patch: { role: 'member' },
        });
      }
      ops.push({
        op: 'patch',
        collection: 'familyMembers',
        id: toMemberId,
        patch: {
          role: 'owner',
          canManagePod: true,
          canViewFinances: true,
          canEditActivities: true,
        },
      });
      await mutate({ op: 'batch', ops });

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
    initialsById,
    // Actions
    loadMembers,
    createMember,
    createMemberWithId,
    updateMember,
    learnAliases,
    deleteMember,
    transferOwnership,
    setCurrentMember,
    resetState,
  };
});
