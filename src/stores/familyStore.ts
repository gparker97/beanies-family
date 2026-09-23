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
import { reconcileDeviceKeysWithRoster } from '@/services/auth/passkeyService';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { computeInitials } from '@/utils/memberInitials';
import { sameAccount } from '@/utils/email';
import { isBlankMemberColor } from '@/constants/memberColors';
import { logEvent } from '@/services/telemetry/logEvent';
import { REQUIRED_EPOCH } from '@/services/pod/podSoak';
import { APP_VERSION } from '@/constants/appVersion';
import {
  getAllRemovedMembers,
  removeMemberAndRecord,
} from '@/services/automerge/repositories/removedMemberRepository';
import {
  membersWithDeviceCredentials,
  retireMemberDeviceCredentials,
} from '@/services/auth/deviceCredentials';
import type { SessionRejectionKind } from '@/stores/authStore';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

/**
 * What `deleteMember` did (tracker #77). A discriminated union so an impossible mix
 * (`removed: false` with a save status) cannot be represented.
 *
 * `drive: 'manual-check'` means the family should confirm by hand that the person no
 * longer has the file shared with them: either a Drive delete failed, or nothing matched —
 * and a Drive share targets whatever address was typed into the invite, which the app never
 * stored, so "nothing matched" is not proof of revocation.
 */
export type MemberRemovalOutcome =
  | { removed: false; refusal: 'offline' | 'not-found' | 'error' }
  | {
      removed: true;
      save: 'saved' | 'pending';
      drive: 'revoked' | 'not-applicable' | 'manual-check';
      manualCheckEmail: string | null;
    };

export const useFamilyStore = defineStore('family', () => {
  // State
  const members = ref<FamilyMember[]>([]);
  const currentMemberId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  /**
   * WHICH family the current `members` list was read for.
   *
   * Captured at the read, not derived later, because the two can diverge: `activateFamily`
   * flips the active family and then awaits an IndexedDB write, so for that window the
   * registry says B while this roster still holds A. Anything that DELETES on the strength
   * of this roster has to know which family it actually describes — see
   * `reconcileDeviceKeysWithRoster`, where a mismatch drops the pass.
   */
  const rosterFamilyId = ref<string | null>(null);
  /**
   * Members this pod records as REMOVED (tracker #77), loaded with the roster. The
   * authenticated fact every destructive eviction step keys on — never mere absence from
   * `members`, which a half-loaded roster would also produce.
   */
  const removedMemberIds = ref<ReadonlySet<string>>(new Set());

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
  // Sources include `currentMemberId` deliberately. `loadMembers` publishes the roster and
  // only THEN resolves the session member (behind an await), so a watcher on the roster
  // alone always runs with `currentMember` still undefined on a fresh open — and the
  // keystore reconcile requires a resolved session member as its proof that this is a real
  // decrypted roster rather than a partial paint. Watching the roster alone made that pass
  // deterministically skipped on the first publish, recovering only if some later mutation
  // happened to re-fire it. Extra firings are cheap: the roster-cache write is idempotent
  // and TOCTOU-guarded, and the reconcile's drain is one-shot per family.
  watch([sortedMembers, currentMemberId], ([list]) => {
    void refreshRosterCache(list);
    // Reconcile the device's ADOPTED keystore material against the live roster (#82):
    // a member removed while the app was uninstalled loses their surviving blob, and a
    // member who is still here gets their real name back on the pre-decrypt picker.
    // The signed-in member is passed IN because `passkeyService` must not import a
    // store. Pets are included deliberately — the id list is a superset, and a superset
    // can only ever PROTECT a blob from deletion. Native-only and a no-op elsewhere;
    // never throws, like its sibling above.
    void reconcileDeviceKeysWithRoster(
      rosterFamilyId.value,
      list.map((m) => ({ id: m.id, name: m.name })),
      currentMember.value?.id ?? null
    );
  });

  // A member this device holds credentials for was REMOVED (#77): retire those credentials
  // here too — the remover's other devices, a shared family tablet. Per-member only, and
  // NOT through `authStore.evictRemovedMember`: this is housekeeping, it never forgets a
  // family, and sharing that function's single-flight would let a watcher run swallow a
  // sign-in gate's eviction. Its own watcher, not part of the roster one above, which has
  // partial-paint rules this does not need: the removal record is authoritative.
  //
  // Watches the family id TOO, and tracks what it has already handled per family: the
  // removal set is republished on every load, so diffing against `previous` would either
  // miss a set published before its family id (the first load) or rescan every historical
  // removal on every boot.
  const removalsHandledHere = new Set<string>();
  watch([removedMemberIds, rosterFamilyId], async ([removed, familyId]) => {
    if (!familyId || removed.size === 0) return;
    const fresh = [...removed].filter((id) => !removalsHandledHere.has(`${familyId}:${id}`));
    if (fresh.length === 0) return;
    try {
      const holders = await membersWithDeviceCredentials(familyId);
      const toRetire = fresh.filter((id) => holders.has(id));
      for (const memberId of toRetire) await retireMemberDeviceCredentials(familyId, memberId);
      // Marked only once handled, so a failed scan is retried on the next publish.
      for (const id of fresh) removalsHandledHere.add(`${familyId}:${id}`);
      if (toRetire.length > 0) {
        logEvent({
          level: 'info',
          surface: 'device-eviction',
          message: 'evicted',
          context: {
            action: 'evicted',
            kind: 'member',
            stage: 'removed-watch',
            count: toRetire.length,
          },
        });
      }
    } catch (e) {
      reportError({
        surface: 'device-eviction',
        message: 'could not retire a removed member’s credentials on this device',
        error: e,
        severity: 'warning',
        context: { action: 'removed_watch_failed', count: fresh.length },
      });
    }
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
    | { kind: 'reject' } // an authenticated session names a member who is not here
    | { kind: 'removed' }; // …and the pod records that member as removed (#77)

  async function resolveSessionMember(
    roster: FamilyMember[],
    removed: ReadonlySet<string>
  ): Promise<MemberResolution> {
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
      const vouched = roster.find((m) => m.id === sessionMemberId);
      if (vouched) {
        // The pod itself now vouches for this member, which is the ONLY point at which a
        // restored pre-#80 session is worth sealing. Sealing it at restore time would
        // have signed an unverified blob (#80 review).
        //
        // The ROSTER ROW is passed, not just the fact that it matched. A bare legacy
        // session is an unauthenticated shape in every field, and only `memberId` was
        // ever checked — so sealing the blob as-is laundered a hand-edited `role`,
        // `email` and `familyId` into a permanently signature-valid session that outlived
        // the sunset the legacy branch is time-boxed by. Sealing the pod's own values
        // instead commits a verified fact, which is the whole point of confirming.
        //
        // Its own try: the outer catch treats a throw as "no session member", so without
        // this a failure in an optional re-seal would cost the member their session.
        try {
          authStore.confirmSessionMember({
            memberId: vouched.id,
            email: vouched.email,
            role: vouched.role,
            displayName: vouched.name,
          });
        } catch (e) {
          console.warn('[familyStore] could not re-seal a restored legacy session', e);
        }
        return { kind: 'use', id: sessionMemberId };
      }
      // Present, authenticated, and naming somebody who is not in the pod. Never fall
      // through to the owner — that IS the escalation this exists to stop. A member the
      // pod records as removed is its own, EXPECTED, case (#77) — not an integrity event.
      if (!authStore.isAuthenticated) return { kind: 'none' };
      return removed.has(sessionMemberId) ? { kind: 'removed' } : { kind: 'reject' };
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
  async function rejectSession(reason: SessionRejectionKind = 'unknown-member'): Promise<void> {
    currentMemberId.value = null;
    const { useAuthStore } = await import('@/stores/authStore');
    useAuthStore().invalidateSession(reason);
  }

  /**
   * Which of the two roster-time rejections is this?
   *
   * Both call sites used to hard-code `'roster-switched'`, which made `'unknown-member'`
   * — the only `INTEGRITY_REJECTIONS` kind this store can produce — unreachable, so the
   * #80 tamper alarm could never fire from the roster path at all (#80 review). The fact
   * that separates them is whether we are looking at a DIFFERENT pod: a session naming
   * somebody absent from the pod it belongs to is the alarming case; the same session
   * against a pod it was never part of is ordinary file-switching churn.
   *
   * Unknown family on either side degrades to `'roster-switched'` — the quiet
   * classification — so an ambiguous case can never manufacture a false tamper alert.
   */
  async function classifyRosterRejection(): Promise<'unknown-member' | 'roster-switched'> {
    try {
      const [{ useAuthStore }, { useFamilyContextStore }] = await Promise.all([
        import('@/stores/authStore'),
        import('@/stores/familyContextStore'),
      ]);
      const sessionFamilyId = useAuthStore().currentUser?.familyId;
      const activeFamilyId = useFamilyContextStore().activeFamilyId;
      if (!sessionFamilyId || !activeFamilyId) return 'roster-switched';
      return sessionFamilyId === activeFamilyId ? 'unknown-member' : 'roster-switched';
    } catch {
      return 'roster-switched';
    }
  }

  /**
   * Act on a session resolution. Returns true when it settled `currentMemberId` (so the
   * caller stops), false for `none`. The ONE place the use/reject/removed handling lives —
   * both `loadMembers` branches used to carry their own copy.
   */
  async function applyResolution(resolved: MemberResolution): Promise<boolean> {
    if (resolved.kind === 'use') {
      currentMemberId.value = resolved.id;
      return true;
    }
    if (resolved.kind === 'removed') {
      // Removal, not tampering (#77). The device eviction this leaves pending runs from the
      // sign-in surface — NOT here, mid-load, where post-load housekeeping would re-arm a
      // family torn down underneath it.
      await rejectSession('member-removed');
      return true;
    }
    if (resolved.kind === 'reject') {
      await rejectSession(await classifyRosterRejection());
      return true;
    }
    return false;
  }

  // Actions
  async function loadMembers() {
    await wrapAsync(isLoading, error, async () => {
      // Captured BEFORE the read, so it names the family whose doc was actually read.
      const readForFamilyId = getActiveFamilyId();
      const removed = new Set((await getAllRemovedMembers()).map((r) => r.id));
      const loadedRaw = await familyRepo.getAllFamilyMembers();
      // A row whose id the pod records as REMOVED is a resurrection (a concurrent
      // delete/patch race — automergeRepository.ts) and never a member. Filtered BEFORE
      // `normalizeRoles`, so a removed row can never be promoted or patched.
      const loaded = loadedRaw.filter((m) => !removed.has(m.id));
      if (loaded.length !== loadedRaw.length) {
        logEvent({
          level: 'warn',
          surface: 'family-roster',
          message: 'removed_member_row_filtered',
          context: {
            action: 'removed_member_row_filtered',
            count: loadedRaw.length - loaded.length,
          },
        });
      }
      const roster = await normalizeRoles(loaded);
      // Resolve the session member BEFORE publishing the roster. Assigning members.value
      // first left a tick where the roster existed but currentMemberId was still null,
      // and usePermissions (which now refuses to read the session `role` once a roster
      // exists) reported the owner as a non-owner for that tick — the Piggy Bank nav
      // vanished and the canViewFinances true->false diagnostic fired on every boot.
      const resolvedForRoster = currentMemberId.value
        ? null
        : await resolveSessionMember(roster, removed);
      members.value = roster;
      rosterFamilyId.value = readForFamilyId;
      // With the roster and its family, never before: the removed-members watcher needs to
      // know which family these removals belong to.
      removedMemberIds.value = removed;
      logDuplicateMembers(members.value);

      // Restore currentMemberId: prefer authStore session, then previous value, then owner
      if (!currentMemberId.value) {
        const resolved = resolvedForRoster ?? (await resolveSessionMember(members.value, removed));
        if (await applyResolution(resolved)) return;
        // No session member at all: the legitimate signup / pre-login bootstrap.
        // NOT reachable after a rejection — `sessionRejected` stays true until a real
        // sign-in, so a rejected session cannot be handed the owner's row on the next
        // reload and read as owner again.
        if (owner.value && !(await sessionWasRejected())) {
          currentMemberId.value = owner.value.id;
        }
      } else if (!members.value.some((m) => m.id === currentMemberId.value)) {
        if (await applyResolution(await resolveSessionMember(members.value, removed))) return;
        // An EMPTY roster is "the doc did not load", not "your member was removed" — the
        // same reasoning `resolveSessionMember` uses to return `none` rather than reject.
        // Nulling here anyway cost a signed-in non-owner `canEditActivities` and
        // `canViewFinances` for the rest of the session on a recoverable error (#80
        // review). Hold the id; the next successful load re-resolves it.
        if (members.value.length === 0) return;
        // Last resort. The old code fell back to the OWNER here, which silently promoted
        // a member whose record had vanished (#80). This session now names nobody.
        //
        // There is deliberately no "reuse the previous id" fallback: `prevMemberId` is
        // captured as `currentMemberId` and this branch is entered precisely BECAUSE that
        // id is absent from the roster, so the check could only ever be false. The
        // version that pretended otherwise read as a safety net and was dead code.
        logEvent({
          level: 'warn',
          surface: 'session-integrity',
          message: 'current_member_cleared',
          context: { action: 'session_rejected', kind: 'member-vanished' },
        });
        currentMemberId.value = null;
      }
    });
  }

  /**
   * The ONE classifier of "is this member still here" (#77), used by the session
   * resolution and by `authStore.gateProvenMember`. `removed` only when the pod records the
   * removal; a member merely missing from the roster is `absent`, which proves nothing.
   */
  function memberStatus(id: string): 'live' | 'removed' | 'absent' {
    if (removedMemberIds.value.has(id)) return 'removed';
    return members.value.some((m) => m.id === id) ? 'live' : 'absent';
  }

  /** Deselect the current member without choosing another (a removed member's unlock). */
  function clearCurrentMember(): void {
    currentMemberId.value = null;
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
      const updated = await familyRepo.updateFamilyMember(id, withLoginStamps(id, input));
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        members.value = members.value.map((m) => (m.id === id ? updated : m));
      }
      return updated;
    });
    return result ?? null;
  }

  /**
   * Fold the compaction soak markers into any patch that records a login.
   *
   * ⚠️ HERE, NOT AT THE CALL SITES. `authStore` writes `lastLoginAt` from SEVEN
   * places; adding two fields at seven sites is seven chances to forget and
   * seven places to keep in step. Doing it in the one function they all funnel
   * through means the markers cannot drift from the timestamp they describe.
   *
   * ⚠️ AND ONLY WHEN THE VALUE CHANGES. `lastLoginAt` is only ever in a patch on
   * a genuine login or resume, so this cannot fire on a background write — but
   * writing an identical value would still emit an Automerge change, and this
   * feature exists to stop history growing for no reason.
   */
  function withLoginStamps(id: string, input: UpdateFamilyMemberInput): UpdateFamilyMemberInput {
    if (!('lastLoginAt' in input)) return input;
    const current = members.value.find((m) => m.id === id);
    const next: UpdateFamilyMemberInput = { ...input };
    if (current?.lineageEpoch !== REQUIRED_EPOCH) next.lineageEpoch = REQUIRED_EPOCH;
    if (current?.appVersion !== APP_VERSION) next.appVersion = APP_VERSION;
    return next;
  }

  /**
   * Remove a member from the family and revoke their access (tracker #77).
   *
   * In order — each step's reason is load-bearing:
   *  1. refuse a member that does not exist;
   *  2. refuse in a Google Drive family that cannot durably save right now (offline): a
   *     revocation that never reaches the file has not happened, and nothing has changed yet;
   *  3. snapshot what the Drive step needs, before the row goes;
   *  4. `observeRemote()` — the one pre-merge, so the magic-link stamp beats any remote mint
   *     this device never saw. OUTSIDE `wrapAsync`: it is a 20s credential save;
   *  5. stage the magic-link overwrite (kept for OLD clients, which ignore `revokedKeys`);
   *  6. delete the row and record the removal in ONE change (the authenticated fact every
   *     eviction keys on). Row first: `healStaleWrappedKey` re-wraps a missing entry while
   *     the row exists — though the `member:` tombstone makes the order robust anyway;
   *  7. tombstone every wrap attributed to them, and every invite;
   *  8. drop their Drive refresh-token copy and this device's credentials for them;
   *  9. ONE durable save (credential budget);
   * 10. remove their Google Drive access to the file and folder.
   */
  async function deleteMember(id: string): Promise<MemberRemovalOutcome> {
    const target = members.value.find((m) => m.id === id);
    if (!target) return refuse('not-found', id);

    const { useSyncStore } = await import('./syncStore');
    const syncStore = useSyncStore();
    const isDrive = syncStore.storageProviderType === 'google_drive';
    if (isDrive && !syncStore.canDurablySaveNow()) return refuse('offline', id);

    const familyId = getActiveFamilyId();
    const actorId = currentMemberId.value;
    const remaining = members.value.filter((m) => m.id !== id);
    const snapshot = { email: target.email, googleAccountEmail: target.googleAccountEmail };

    await syncStore.observeRemote();

    const staged = await wrapAsync(isLoading, error, async () => {
      syncStore.stageMemberLinkTombstone(id);
      if (!(await removeMemberRow(id, { recordRemoval: true, removedBy: actorId }))) return null;
      const retired = syncStore.retireMemberKeyMaterial(id, 'remove');
      await removeDriveConnectionIfUnshared(snapshot.googleAccountEmail, remaining);
      if (familyId) await retireMemberDeviceCredentials(familyId, id);
      return retired;
    });
    if (staged === undefined) return { removed: false, refusal: 'error' }; // wrapAsync toasted
    if (staged === null) return refuse('not-found', id);

    const saveStatus = await syncStore.syncNowDurable(syncStore.CREDENTIAL_PUBLISH_TIMEOUT_MS);
    if (saveStatus !== 'saved') {
      // NOT critical: the staged changes are not rolled back and ride the next save, and a
      // timeout here is usually a slow upload that will still land (see the note on
      // `revokeMemberLink`: paging on a timeout paged on-call for revocations that worked).
      logEvent({
        level: 'warn',
        surface: 'member-removal',
        message: 'removal_not_published',
        context: { action: 'removal_not_published', save_status: saveStatus },
      });
      if (saveStatus === 'failed') {
        reportError({
          surface: 'member-removal',
          message: 'member removed on this device but the save to the family file failed',
          severity: 'warning',
          context: { action: 'removal_not_published', save_status: saveStatus },
        });
      }
    }

    let drive: 'revoked' | 'not-applicable' | 'manual-check' = 'not-applicable';
    let manualCheckEmail: string | null = null;
    let driveKind = 'not-applicable';
    if (isDrive && syncStore.driveFileId) {
      const [{ driveRevocationCandidates, revokeMemberDriveAccess }, { getGoogleAccountEmail }] =
        await Promise.all([
          import('@/services/google/driveAccessRevocation'),
          import('@/services/google/googleAuth'),
        ]);
      const emails = driveRevocationCandidates(
        snapshot,
        remaining,
        getGoogleAccountEmail(),
        actorId === id
      );
      driveKind = await revokeMemberDriveAccess({ fileId: syncStore.driveFileId, emails });
      drive = driveKind === 'revoked' ? 'revoked' : 'manual-check';
      if (drive === 'manual-check') manualCheckEmail = emails[0] ?? null;
    }

    logEvent({
      level: 'info',
      surface: 'member-removal',
      message: 'removal_outcome',
      context: {
        action: 'remove',
        save_status: saveStatus,
        kind: driveKind,
        count: staged.tombstonesWritten,
        provider_type: syncStore.storageProviderType ?? 'none',
        member_id_tail: id.slice(-8),
      },
    });
    return {
      removed: true,
      save: saveStatus === 'saved' ? 'saved' : 'pending',
      drive,
      manualCheckEmail,
    };
  }

  /**
   * Undo a member added moments ago during onboarding (`CreateMembersStep`), before anyone
   * could have been invited. No pre-gate, no tombstones, no Drive, no durable save — there
   * is nothing to revoke — so it REFUSES a member who holds anything that says otherwise.
   * A member invited but not yet joined is not a draft: their Drive share and invite exist
   * from the moment of the invite, and they go through `deleteMember`.
   */
  async function discardDraftMember(id: string): Promise<boolean> {
    const target = members.value.find((m) => m.id === id);
    if (!target) return false;
    const { useSyncStore } = await import('./syncStore');
    const hasWrap = useSyncStore().holdsKeyMaterialFor(id);
    if (target.pinHash || target.passwordHash || target.lastLoginAt || hasWrap) {
      refuse('not-draft', id);
      return false;
    }
    const removed = await wrapAsync(isLoading, error, () =>
      removeMemberRow(id, { recordRemoval: false, removedBy: null })
    );
    if (!removed) return false;
    const familyId = getActiveFamilyId();
    if (familyId) await retireMemberDeviceCredentials(familyId, id);
    logEvent({
      level: 'info',
      surface: 'member-removal',
      message: 'draft_discarded',
      context: { action: 'draft_discarded', member_id_tail: id.slice(-8) },
    });
    return true;
  }

  function refuse(
    kind: 'offline' | 'not-found' | 'not-draft',
    id: string
  ): { removed: false; refusal: 'offline' | 'not-found' } {
    logEvent({
      level: 'warn',
      surface: 'member-removal',
      message: 'removal_refused',
      context: { action: 'removal_refused', kind, member_id_tail: id.slice(-8) },
    });
    return { removed: false, refusal: kind === 'offline' ? 'offline' : 'not-found' };
  }

  /**
   * Delete the member's row (optionally recording the removal in the same change) and
   * end the session if it was their own. Shared by `deleteMember` and `discardDraftMember`.
   */
  async function removeMemberRow(
    id: string,
    opts: { recordRemoval: boolean; removedBy: string | null }
  ): Promise<boolean> {
    if (opts.recordRemoval) {
      await removeMemberAndRecord(id, opts.removedBy);
      // The caller retires this device's credentials itself; the watcher need not.
      const familyId = rosterFamilyId.value;
      if (familyId) removalsHandledHere.add(`${familyId}:${id}`);
      removedMemberIds.value = new Set([...removedMemberIds.value, id]);
    } else if (!(await familyRepo.deleteFamilyMember(id))) {
      return false;
    }
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
    return true;
  }

  /**
   * Drop the removed member's Drive refresh-token copy from the pod — unless a remaining
   * member is bound to the same Google account. Never fatal: reported, not thrown.
   */
  async function removeDriveConnectionIfUnshared(
    accountEmail: string | undefined,
    remaining: readonly FamilyMember[]
  ): Promise<void> {
    if (!accountEmail) return;
    if (remaining.some((m) => sameAccount(m.googleAccountEmail, accountEmail))) return;
    try {
      const { removeDriveConnectionByAccount } =
        await import('@/services/automerge/repositories/driveRepository');
      await removeDriveConnectionByAccount(accountEmail);
    } catch (e) {
      reportError({
        surface: 'member-removal',
        message: 'could not remove a removed member’s Drive token copy from the pod',
        error: e,
        severity: 'warning',
        context: { action: 'drive_connection_remove_failed' },
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

  /**
   * Name who this session is BEFORE the roster that would vouch for them exists.
   *
   * ⚠️ WHY NOT `setCurrentMember`. That one checks the id against `members`, and
   * the whole point of this call is that we are about to load a DIFFERENT
   * family's roster — so `members` still holds the previous family's rows (or
   * none), the guard cannot pass, and the assignment silently does nothing. That
   * silence is what left a cross-family load rendering with every permission
   * false: no sidebar, no Family Data section, until a page refresh.
   *
   * The check is not skipped, it is DEFERRED to the moment it can actually be
   * made: `loadMembers` re-validates `currentMemberId` against the roster it
   * loads, and an id that is not in it takes the ordinary rejection path. So the
   * caller must have EARNED the claim — today's only caller passes the single
   * member whose wrapped key the entered password just opened.
   */
  function preselectSessionMember(id: string) {
    currentMemberId.value = id;
  }

  function resetState() {
    members.value = [];
    removedMemberIds.value = new Set();
    rosterFamilyId.value = null;
    currentMemberId.value = null;
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    members,
    rosterFamilyId,
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
    discardDraftMember,
    removedMemberIds,
    memberStatus,
    clearCurrentMember,
    transferOwnership,
    setCurrentMember,
    preselectSessionMember,
    resetState,
  };
});
