import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { useWallLock, RELOCK_AFTER_MS } from '@/composables/useWallLock';
import { useFamilyStore } from '@/stores/familyStore';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

type Member = Record<string, unknown>;

function adult(id: string, over: Member = {}): Member {
  return { id, name: id, ageGroup: 'adult', pinHash: 'x', ...over };
}
function child(id: string, over: Member = {}): Member {
  return { id, name: id, ageGroup: 'child', pinHash: 'x', ...over };
}

/** `others` join the roster but are never the signed-in member. */
function withMember(over: Member = {}, others: Member[] = []) {
  const familyStore = useFamilyStore();
  const member = adult('greg', over);
  familyStore.members = [member, ...others] as never;
  // currentMember is derived from the store's current member id in the app;
  // set directly so the lock has an identity to verify against.
  Object.defineProperty(familyStore, 'currentMember', { value: member, configurable: true });
  return member;
}

describe('useWallLock', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('is locked when the wall opens — a child must not arrive at an editable wall', () => {
    withMember();
    const scope = effectScope();
    scope.run(() => {
      expect(useWallLock().isLocked.value).toBe(true);
    });
    scope.stop();
  });

  it('refuses to offer unlock when nobody in the family has a PIN or password', () => {
    withMember({ pinHash: undefined, passwordHash: undefined });
    const scope = effectScope();
    scope.run(() => {
      const lock = useWallLock();
      expect(lock.canUnlock.value).toBe(false);
      lock.requestUnlock();
      // No challenge is opened, because ReauthChallenge would dead-end.
      expect(lock.challengeOpen.value).toBe(false);
    });
    scope.stop();
  });

  it('unlocks on a verified challenge and relocks itself after inactivity', () => {
    withMember();
    const scope = effectScope();
    scope.run(() => {
      const lock = useWallLock();
      lock.requestUnlock();
      expect(lock.challengeOpen.value).toBe(true);
      lock.onVerified();
      expect(lock.isLocked.value).toBe(false);

      vi.advanceTimersByTime(RELOCK_AFTER_MS + 1);
      expect(lock.isLocked.value).toBe(true);
    });
    scope.stop();
  });

  it('keeps the wall unlocked while someone is still using it', () => {
    withMember();
    const scope = effectScope();
    scope.run(() => {
      const lock = useWallLock();
      lock.requestUnlock();
      lock.onVerified();

      vi.advanceTimersByTime(RELOCK_AFTER_MS - 1000);
      lock.noteActivity();
      vi.advanceTimersByTime(RELOCK_AFTER_MS - 1000);
      expect(lock.isLocked.value).toBe(false);
    });
    scope.stop();
  });

  /**
   * The capability split: editing the family's shared calendar is a FAMILY
   * capability (any grown-up), leaving into the signed-in member's session is
   * an IDENTITY one (only them). See `useWallLock`'s header.
   */
  describe('who can unlock what', () => {
    it("accepts any adult's PIN for edits, so the other parent is not locked out", () => {
      withMember({}, [adult('sofia')]);
      const scope = effectScope();
      scope.run(() => {
        const lock = useWallLock();
        expect(lock.unlockCandidates.value.map((m) => m.id)).toEqual(['greg', 'sofia']);
      });
      scope.stop();
    });

    it("never accepts a child's PIN — a wall a child can unlock is not locked", () => {
      withMember({}, [child('leo')]);
      const scope = effectScope();
      scope.run(() => {
        expect(useWallLock().unlockCandidates.value.map((m) => m.id)).toEqual(['greg']);
      });
      scope.stop();
    });

    it('excludes a pet, and anyone who has not set a PIN', () => {
      withMember({}, [adult('bella', { isPet: true }), adult('nan', { pinHash: undefined })]);
      const scope = effectScope();
      scope.run(() => {
        expect(useWallLock().unlockCandidates.value.map((m) => m.id)).toEqual(['greg']);
      });
      scope.stop();
    });

    it("another adult's PIN does NOT let the signed-in member be impersonated", () => {
      // greg is signed in but has no credential of his own; sofia does.
      withMember({ pinHash: undefined, passwordHash: undefined }, [adult('sofia')]);
      const scope = effectScope();
      scope.run(() => {
        const lock = useWallLock();
        // Sofia can unlock edits…
        expect(lock.canUnlock.value).toBe(true);
        // …but nobody can prove they are greg, so leaving cannot be gated on it.
        expect(lock.canVerifyIdentity.value).toBe(false);
      });
      scope.stop();
    });

    it('records who unlocked, so an unexpected edit can be traced', () => {
      const sofia = adult('sofia');
      withMember({}, [sofia]);
      const scope = effectScope();
      scope.run(() => {
        const lock = useWallLock();
        lock.onVerified(sofia as never);
        expect(lock.unlockedBy.value?.id).toBe('sofia');
      });
      scope.stop();
    });

    it('forgets who unlocked when it relocks', () => {
      const sofia = adult('sofia');
      withMember({}, [sofia]);
      const scope = effectScope();
      scope.run(() => {
        const lock = useWallLock();
        lock.onVerified(sofia as never);
        vi.advanceTimersByTime(RELOCK_AFTER_MS + 1);
        expect(lock.isLocked.value).toBe(true);
        expect(lock.unlockedBy.value).toBeNull();
      });
      scope.stop();
    });
  });

  it('stays locked when the challenge is cancelled', () => {
    withMember();
    const scope = effectScope();
    scope.run(() => {
      const lock = useWallLock();
      lock.requestUnlock();
      lock.onCancelled();
      expect(lock.isLocked.value).toBe(true);
      expect(lock.challengeOpen.value).toBe(false);
    });
    scope.stop();
  });
});
