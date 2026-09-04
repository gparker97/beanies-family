/**
 * The stable per-(device, family) actor.
 *
 * `Automerge.load()` mints a fresh random actorId on every call, which is why
 * one family's pod carries 4,214 actors with 45% of them holding a single
 * change. Pinning one stops that growth.
 *
 * The failure DIRECTION is the load-bearing part: this is a pure optimisation,
 * so it must never be able to stop a pod from opening.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const { deviceActorId, __resetDeviceActorForTesting } =
  await import('@/services/automerge/deviceActor');
const { __resetDeviceIdForTesting } = await import('@/utils/deviceId');

beforeEach(() => {
  __resetDeviceActorForTesting();
  __resetDeviceIdForTesting();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('deviceActorId', () => {
  it('is a valid Automerge actor: 32 lowercase hex characters', async () => {
    // Automerge requires an even-length lowercase hex string. A dashed UUID is
    // not one, which is why this is derived rather than reused.
    expect(await deviceActorId('fam-1')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is STABLE for the same (device, family)', async () => {
    const first = await deviceActorId('fam-1');
    __resetDeviceActorForTesting(); // drop the memo, keep the device id
    expect(await deviceActorId('fam-1')).toBe(first);
  });

  it('DIFFERS across families on the same device', async () => {
    // Two families sharing a lane would interleave their changes into one
    // sequence, which is exactly what the pinning is meant to avoid.
    expect(await deviceActorId('fam-1')).not.toBe(await deviceActorId('fam-2'));
  });

  it('differs across devices for the same family', async () => {
    const first = await deviceActorId('fam-1');
    localStorage.clear();
    __resetDeviceIdForTesting();
    __resetDeviceActorForTesting();
    expect(await deviceActorId('fam-1')).not.toBe(first);
  });

  it('returns null instead of THROWING when the digest is unavailable', async () => {
    // `crypto.subtle` is absent in a non-secure context and `digest` can reject.
    // A null actor means Automerge mints a random one — precisely today's
    // behaviour. Throwing here would make a preventive optimisation cause the
    // outage the compaction work exists to cure.
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValue(new Error('no subtle'));
    await expect(deviceActorId('fam-1')).resolves.toBeNull();
  });
});
