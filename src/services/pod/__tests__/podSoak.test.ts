/**
 * The soak gate, as a pure table. No mocks — that is the point of extracting it.
 */
import { describe, it, expect } from 'vitest';
import { evaluateSoak, anyDeviceReportedTooLarge, REQUIRED_EPOCH } from '../podSoak';
import type { FamilyMember } from '@/types/models';

const TODAY = new Date('2026-09-06T12:00:00Z');
const member = (over: Partial<FamilyMember>): FamilyMember =>
  ({ id: 'm', name: 'Someone', email: '', role: 'member', color: '#000', ...over }) as FamilyMember;

describe('evaluateSoak', () => {
  it('passes when every recently-active member is on a current build', () => {
    const v = evaluateSoak(
      [
        member({ name: 'Greg', lastLoginAt: '2026-09-05', lineageEpoch: REQUIRED_EPOCH }),
        member({ name: 'Sam', lastLoginAt: '2026-08-20', lineageEpoch: REQUIRED_EPOCH }),
      ],
      { today: TODAY }
    );
    expect(v).toEqual({ ok: true, behind: [] });
  });

  it('REFUSES on an absent marker, because an old build writes none', () => {
    // ⚠️ The whole reason the gate is shaped as positive evidence. "Refuse while
    // any device is on an old build" can never match: an old build leaves no
    // trace to match on.
    const v = evaluateSoak([member({ name: 'Sam', lastLoginAt: '2026-09-01' })], { today: TODAY });
    expect(v.ok).toBe(false);
    expect(v.behind).toEqual(['Sam']);
  });

  it('names who is behind, so the message can be acted on', () => {
    const v = evaluateSoak(
      [
        member({ name: 'Greg', lastLoginAt: '2026-09-05', lineageEpoch: 1 }),
        member({ name: 'Sam', lastLoginAt: '2026-09-04', lineageEpoch: 0 }),
        member({ name: 'Alex', lastLoginAt: '2026-09-03' }),
      ],
      { today: TODAY }
    );
    expect(v.behind).toEqual(['Sam', 'Alex']);
  });

  it('ignores a member who has never signed in', () => {
    // A child's account created but never opened must not block their family
    // forever. No `lastLoginAt` means no evidence either way, not a refusal.
    const v = evaluateSoak([member({ name: 'Baby' })], { today: TODAY });
    expect(v.ok).toBe(true);
  });

  it('ignores a member outside the window', () => {
    const v = evaluateSoak([member({ name: 'Gone', lastLoginAt: '2026-06-01' })], { today: TODAY });
    expect(v.ok).toBe(true);
  });

  it('counts the window at DATE granularity, because lastLoginAt is date-only', () => {
    const inside = evaluateSoak([member({ name: 'Edge', lastLoginAt: '2026-08-07' })], {
      today: TODAY,
    });
    const outside = evaluateSoak([member({ name: 'Edge', lastLoginAt: '2026-08-06' })], {
      today: TODAY,
    });
    expect(inside.ok).toBe(false); // 30 days ago — still active, still counted
    expect(outside.ok).toBe(true); // 31 days ago — outside the window
  });

  it('survives a malformed date rather than throwing mid-gate', () => {
    const v = evaluateSoak([member({ name: 'Odd', lastLoginAt: 'not-a-date' })], { today: TODAY });
    expect(v.ok).toBe(true);
  });
});

describe('anyDeviceReportedTooLarge', () => {
  it('is true when a device could not open the pod for want of memory', () => {
    // A real failure outranks the size heuristic.
    expect(anyDeviceReportedTooLarge([member({ podTooLargeSeenAt: '2026-09-05' })])).toBe(true);
  });

  it('is false when nobody has hit it', () => {
    expect(anyDeviceReportedTooLarge([member({ lastLoginAt: '2026-09-05' })])).toBe(false);
  });
});
