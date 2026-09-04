/**
 * The Automerge actorId for THIS device, in THIS family.
 *
 * `Automerge.load()` mints a fresh random actorId on every call, so the actor
 * count grows with SESSIONS rather than with data — greg's pod carries 4,214
 * actors for one family, 45% of which made exactly one change. Pinning a stable
 * actor stops that growth. It cannot shrink a pod that is already large (that is
 * the compaction half), but its benefit compounds from the day it ships.
 *
 * Derived, never stored: `SHA-256(deviceId + NUL + familyId)`, truncated to 128
 * bits of hex. Deterministic, per-(device, family) by construction, a valid
 * Automerge actor (even-length lowercase hex), and it adds no new storage, no
 * migration and no fallback ladder. A cleared localStorage produces a new device
 * id and therefore one new lane — the same cost as a re-install, which is right.
 *
 * ⚠️ Per (device, FAMILY), not per device. Two families on one device sharing a
 * lane would interleave their changes into one sequence. And deliberately NOT
 * the member id: two devices sharing a lane defeats the run-length compression
 * Automerge relies on.
 *
 * ⚠️ NEVER THROWS. `crypto.subtle` is absent in a non-secure context and
 * `digest` can reject. `null` means "no actor", the caller passes no init
 * options, and Automerge mints a random one — precisely today's behaviour. An
 * actor-derivation failure must never be able to stop a pod from opening: this
 * is a pure optimisation, and it must not cause the outage the compaction work
 * exists to cure.
 */
import { sha256Hex } from '@/utils/encoding';
import { getDeviceId } from '@/utils/deviceId';
import { logEvent } from '@/services/telemetry/logEvent';

/** 128 bits — 32 hex chars. Automerge wants even-length lowercase hex. */
const ACTOR_HEX_CHARS = 32;

const cache = new Map<string, string | null>();

export async function deviceActorId(familyId: string): Promise<string | null> {
  const cached = cache.get(familyId);
  if (cached !== undefined) return cached;

  let actor: string | null = null;
  try {
    const digest = await sha256Hex(`${getDeviceId()}\0${familyId}`);
    actor = digest.slice(0, ACTOR_HEX_CHARS);
  } catch (e) {
    // Never silent, never fatal. If the mint rate per session does not fall to
    // near zero once this ships, the pinning is not working and this is where
    // the answer will be.
    logEvent({
      level: 'warn',
      surface: 'device-actor',
      message: 'could not derive a stable actor — Automerge will mint a random one',
      context: { action: 'unstable' },
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
  cache.set(familyId, actor);
  logEvent({
    level: 'debug',
    surface: 'device-actor',
    message: actor ? 'stable device actor derived' : 'no stable device actor',
    context: { action: actor ? 'minted' : 'unstable', family_id: familyId },
  });
  return actor;
}

/** Test seam. */
export function __resetDeviceActorForTesting(): void {
  cache.clear();
}
