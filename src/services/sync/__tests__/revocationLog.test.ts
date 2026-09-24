/**
 * `logRecoveryKitsExhausted` (tracker #99) is a TRANSITION signal, not a heartbeat: a
 * family with every kit invalidated is reported once per device per session, re-armed
 * only when a kit is live again. Silent for families that never had a kit tombstoned.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import { logRecoveryKitsExhausted } from '../revocationLog';

const KIT = { salt: 's', wrapped: 'w', createdAt: '2026-09-24T00:00:00Z' };
const DEAD = { 'recoveryKeys:k1': { revokedAt: '2026-09-24T00:00:00Z' } };

beforeEach(() => vi.clearAllMocks());

describe('logRecoveryKitsExhausted', () => {
  it('is silent while a kit is live, and for families with no kit tombstone at all', () => {
    logRecoveryKitsExhausted(
      { familyId: 'f-live', recoveryKeys: { k2: KIT }, revokedKeys: DEAD },
      'merge'
    );
    logRecoveryKitsExhausted({ familyId: 'f-none', recoveryKeys: {}, revokedKeys: {} }, 'merge');
    logRecoveryKitsExhausted(
      { familyId: 'f-other', recoveryKeys: {}, revokedKeys: { 'member:m1': { revokedAt: 'x' } } },
      'pending'
    );
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('fires once per family per session, counts the tombstoned kits, and re-arms when a kit is live again', () => {
    const exhausted = { familyId: 'f-gone', recoveryKeys: {}, revokedKeys: DEAD };
    logRecoveryKitsExhausted(exhausted, 'merge');
    logRecoveryKitsExhausted(exhausted, 'merge');
    logRecoveryKitsExhausted(exhausted, 'pending');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'envelope-revocation',
        message: 'recovery_kits_exhausted',
        context: { action: 'recovery_kits_exhausted', stage: 'merge', count: 1 },
      })
    );

    // A new kit was minted: the family is fine, and a later exhaustion reports again.
    logRecoveryKitsExhausted({ ...exhausted, recoveryKeys: { k3: KIT } }, 'merge');
    logRecoveryKitsExhausted(exhausted, 'merge');
    expect(logEvent).toHaveBeenCalledTimes(2);

    // Another family is tracked separately.
    logRecoveryKitsExhausted({ ...exhausted, familyId: 'f-second' }, 'merge');
    expect(logEvent).toHaveBeenCalledTimes(3);
  });
});
