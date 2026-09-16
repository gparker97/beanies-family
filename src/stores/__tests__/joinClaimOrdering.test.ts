/**
 * A join that does not complete must not leave the member marked as joined.
 *
 * ⚠️ THE BUG THIS PINS, reported from the field. "Joined" is not a stored flag — it is DERIVED as
 * `requiresPassword: !passwordHash && !pinHash`. `joinFamily` used to write that `pinHash` FIRST,
 * before the session, the registry mapping and the caller's sync, and the doc mutation schedules
 * a debounced autosave of its own. So a join that fell over anywhere after the PIN write left the
 * person marked joined in the pod owner's roster while never actually getting in, and the invite
 * UI then refused to offer them a link ever again.
 *
 * ⚠️ AND THE FIX THAT FAILED FIRST. The first attempt kept that order and added a compensating
 * `unclaimMember` in the catch. Two holes: the rollback can itself fail, and it cleared the
 * credentials while leaving the session authenticated and persisted. So the guarantee moved into
 * the ORDERING instead — the claim is now the last fallible write, and there is nothing to undo.
 *
 * Which is why these are ordering assertions. A test that only checks "the pinHash is cleared
 * after a failure" passes against both designs, including the one that shipped the bug.
 */
import { describe, it, expect } from 'vitest';
import { codeOfAuthStoreFn } from './helpers/authStoreSource';

const JOIN = ['async function joinFamily(', 'async function signInWithPasskey('] as const;
const UNCLAIM = ['async function unclaimMember(', 'async function resetMemberPassword('] as const;

describe('joinFamily writes the claim last, so a failure leaves the member invitable', () => {
  it('does every fallible step BEFORE applyPinReset', async () => {
    const fn = await codeOfAuthStoreFn(...JOIN);
    const registryWrite = fn.indexOf("registryDb.add('userFamilyMappings'");
    const claim = fn.indexOf('applyPinReset(');
    expect(registryWrite).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(-1);
    // The registry write is the riskiest IO in the function (IndexedDB, cross-family registry).
    // If it moves back below the claim, the original bug is back.
    expect(registryWrite).toBeLessThan(claim);
  });

  it('keeps no rollback, because there is nothing left to roll back', async () => {
    const fn = await codeOfAuthStoreFn(...JOIN);
    // Reintroducing either the flag or the compensating call means the ordering guarantee was
    // abandoned and the two holes above are back.
    expect(fn).not.toContain('claimWritten');
    expect(fn).not.toContain('unclaimMember(');
  });

  it('reports the failure rather than swallowing it', async () => {
    const fn = await codeOfAuthStoreFn(...JOIN);
    expect(fn).toMatch(/catch[\s\S]*reportError/);
  });

  it('binds identity with the call that cannot silently fail', async () => {
    // Same defect class as the recovery-kit path: `setCurrentMember` is a no-op when the roster
    // does not hold the id, which leaves every permission false until a reload.
    const fn = await codeOfAuthStoreFn(...JOIN);
    expect(fn).toContain('preselectSessionMember');
    expect(fn).not.toContain('setCurrentMember(');
  });
});

describe('unclaimMember gives a stuck member their invite back', () => {
  it('clears BOTH credential hashes, so `requiresPassword` derives true again', async () => {
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    // `requiresPassword` is `!passwordHash && !pinHash`; clearing only one leaves them claimed.
    expect(fn).toContain('pinHash: undefined');
    expect(fn).toContain('passwordHash: undefined');
  });

  it('bumps pinVersion forward rather than resetting it', async () => {
    // It is a monotonic fence other devices compare against; winding it back would make a stale
    // device's cached credential look current again.
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toMatch(/pinVersion:\s*\(member\.pinVersion \?\? 0\) \+ 1/);
  });

  it('checks the doc write landed instead of assuming it', async () => {
    // `familyStore.updateMember` runs inside `wrapAsync`, which catches and resolves — it returns
    // `null` on failure rather than throwing. Ignoring that reported success for a claim it had
    // not cleared.
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toMatch(/const updated = await familyStore\.updateMember\(/);
    expect(fn).toMatch(/if \(!updated\)[\s\S]*return \{ success: false/);
  });

  it('retires the envelope key material, not just the hashes', async () => {
    // The hashes only change what the roster DERIVES. The envelope wraps are what decrypt the
    // pod, and they are keyed separately — leaving them behind is an unclaim that undid the
    // label and none of the access.
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toContain('retireMemberKeyMaterial');
  });

  it('takes the device credentials with it', async () => {
    // A wrap that outlives the PIN it belonged to is the orphan class ADR-029 exists for.
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toContain('invalidateDeviceCredentials');
  });

  it('pushes the change to the family file', async () => {
    // Both writes only schedule a debounced autosave, and the very next thing the owner does is
    // mint a fresh invite against a roster the shared file has not seen.
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toContain('syncNowBounded');
  });

  it('is manager-gated with no bypass', async () => {
    const fn = await codeOfAuthStoreFn(...UNCLAIM);
    expect(fn).toContain('assertCanResetMember');
    // It briefly took a `reason`, so a caller passing `'join-failed'` skipped the gate on an
    // action that strips another member's access.
    expect(fn).not.toContain("reason === 'manual'");
    expect(fn).not.toContain("'join-failed'");
  });
});
