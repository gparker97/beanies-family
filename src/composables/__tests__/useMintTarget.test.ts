/**
 * `useMintTarget` — who a magic link is being minted for.
 *
 * The behaviour worth pinning is not the picker mechanics; it is the two properties that, when
 * wrong, are invisible until someone is locked out:
 *
 *  - `targetId` must FOLLOW the signed-in member while nobody has chosen otherwise, rather than
 *    being seeded once. A Settings card can mount before the session resolves, and a seeded
 *    `null` would leave it minting for `''` forever.
 *  - `needsJoiningLink` must be true for an unclaimed member, because handing them a magic link
 *    gives them a wrap inside an envelope their Google account cannot read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ⚠️ REACTIVE, NOT A PLAIN OBJECT. `targetId` is a `computed`, so it can only re-evaluate when
 * its dependency is reactive. A plain mock made the "session resolves after setup" case fail
 * for a reason that has nothing to do with the code under test — the composable does track a
 * real Pinia store correctly.
 */
const authMocks = vi.hoisted(() => ({
  state: null as unknown as { currentUser: { memberId: string } | null },
}));

/**
 * ⚠️ REACTIVE, for the same reason `authMocks` is. `target` and `candidates` are computeds, so a
 * plain array reassigned mid-test does not invalidate them and an assertion about a roster
 * CHANGE silently passes against the stale value.
 */
const familyMocks = vi.hoisted(() => ({
  state: null as unknown as {
    members: Array<Record<string, unknown>>;
    /** Whether the signed-in member may act on another member's behalf. */
    canManagePod: boolean;
  },
}));

vi.mock('@/stores/authStore', async () => {
  const { reactive } = await import('vue');
  authMocks.state = reactive({ currentUser: null as { memberId: string } | null });
  return { useAuthStore: () => authMocks.state };
});
vi.mock('@/stores/familyStore', async () => {
  const { reactive } = await import('vue');
  familyMocks.state = reactive({
    members: [] as Array<Record<string, unknown>>,
    canManagePod: true,
  });
  return {
    useFamilyStore: () => ({
      get members() {
        return familyMocks.state.members;
      },
      get sortedHumans() {
        return familyMocks.state.members.filter((m) => !m.isPet);
      },
    }),
  };
});
vi.mock('@/composables/usePermissions', async () => {
  const { computed } = await import('vue');
  return {
    usePermissions: () => ({ canManagePod: computed(() => familyMocks.state.canManagePod) }),
  };
});

import { useMintTarget } from '@/composables/useMintTarget';

const ME = { id: 'me', name: 'Greg', requiresPassword: false };
const SPOUSE = { id: 'sp', name: 'Mary', requiresPassword: false };
const UNJOINED = { id: 'kid', name: 'Lewis', requiresPassword: true };
const PET = { id: 'dog', name: 'Bean', requiresPassword: false, isPet: true };

beforeEach(() => {
  authMocks.state.currentUser = { memberId: 'me' };
  familyMocks.state.members = [ME, SPOUSE, UNJOINED, PET];
  familyMocks.state.canManagePod = true;
});

describe('defaulting to self', () => {
  it('follows the signed-in member without being seeded', () => {
    const t = useMintTarget();
    expect(t.targetId.value).toBe('me');
    expect(t.isSelf.value).toBe(true);
    expect(t.targetName.value).toBe('Greg');
  });

  it('picks up a session that resolves AFTER setup', () => {
    // ⚠️ THE REASON `explicitTargetId` STARTS AS `null` RATHER THAN THE CURRENT MEMBER. A
    // Settings card can mount before the roster and session have hydrated; a value captured at
    // setup would pin `null` and leave the card minting for an empty id, which `mintMagicLink`
    // correctly refuses as "the pod is not open" — a confusing error on a healthy screen.
    authMocks.state.currentUser = null;
    const t = useMintTarget();
    expect(t.targetId.value).toBeNull();
    // ⚠️ SELF, NOT OTHER. The first version compared ids, so an unresolved session read as
    // "minting for someone else" and every host rendered its other-member copy with a BLANK
    // name ("This cancels the magic link  is holding now."), while `facts()` booked
    // `target=other` for a self-mint.
    expect(t.isSelf.value).toBe(true);

    authMocks.state.currentUser = { memberId: 'me' };
    expect(t.targetId.value).toBe('me');
    expect(t.isSelf.value).toBe(true);
  });
});

describe('choosing someone else', () => {
  it('reports the chosen member and that it is no longer self', () => {
    const t = useMintTarget();
    t.openPicker();
    expect(t.isPickerOpen.value).toBe(true);

    t.choose('sp');
    expect(t.targetId.value).toBe('sp');
    expect(t.targetName.value).toBe('Mary');
    expect(t.isSelf.value).toBe(false);
    // Choosing closes the picker; leaving it open would hide the button it was opened from.
    expect(t.isPickerOpen.value).toBe(false);
  });

  it('reset goes back to self and closes, so a reopened sheet cannot mint for a stale member', () => {
    const t = useMintTarget();
    t.choose('sp');
    t.openPicker();

    t.reset();
    expect(t.targetId.value).toBe('me');
    expect(t.isSelf.value).toBe(true);
    expect(t.isPickerOpen.value).toBe(false);
  });

  it('cancelling closes the picker without changing the target', () => {
    const t = useMintTarget();
    t.choose('sp');
    t.openPicker();
    t.cancelPicker();
    expect(t.isPickerOpen.value).toBe(false);
    expect(t.targetId.value).toBe('sp');
  });
});

describe('routing and the candidate list', () => {
  it('sends an unclaimed member to the joining route instead of a magic link', () => {
    const t = useMintTarget();
    t.choose('kid');
    expect(t.needsJoiningLink.value).toBe(true);
  });

  it('a claimed member gets a magic link', () => {
    const t = useMintTarget();
    t.choose('sp');
    expect(t.needsJoiningLink.value).toBe(false);
  });

  it('never offers a pet, because a pet cannot sign in', () => {
    const t = useMintTarget();
    expect(t.candidates.value.map((m) => m.id)).toEqual(['me', 'sp', 'kid']);
  });

  it('offers ONLY yourself when you may not manage the pod', () => {
    // ⚠️ THE AUTHORIZATION CHECK, AND IT IS NOT COSMETIC. Minting for another member issues a
    // credential that opens the whole family's pod, and `memberLinkKeys` is newest-wins, so it
    // DESTROYS the link that member is holding. The PIN step-up proves you are you; it does not
    // prove you may act on someone else. Without this, a member-role bean — or a child's bean
    // left signed in on the family laptop — could pick the owner and revoke their saved link.
    familyMocks.state.canManagePod = false;
    const t = useMintTarget();
    expect(t.candidates.value.map((m) => m.id)).toEqual(['me']);
    expect(t.canMintForOthers.value).toBe(false);
  });

  it('a target removed from the roster is NOT treated as safe to mint for', () => {
    // `needsJoiningLink` is false for a missing member (that is the mint branch), and
    // `mintMagicLink` does not refuse an unknown id — `linkMint.test.ts` pins that it returns a
    // real link. So "we could not resolve them" needs to be its own state, or a member removed
    // by a background merge between picking and tapping gets a wrap published against a dead id.
    const t = useMintTarget();
    t.choose('sp');
    expect(t.isResolvable.value).toBe(true);
    familyMocks.state.members = [ME];
    expect(t.isResolvable.value).toBe(false);
    expect(t.needsJoiningLink.value).toBe(false);
  });

  it('an unresolvable target is not treated as joined', () => {
    // Fail safe: with no member found, `needsJoiningLink` is false and the mint refuses on its
    // own guards rather than this composable guessing a route.
    familyMocks.state.members = [];
    const t = useMintTarget();
    expect(t.target.value).toBeNull();
    expect(t.targetName.value).toBe('');
    expect(t.needsJoiningLink.value).toBe(false);
  });
});
