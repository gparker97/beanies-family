import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPOOL_MAX_AGE_MS, SPOOL_PREFIX, claimSpools, newSpoolKey, writeSpool } from '../logSpool';
import type { LogRecord } from '../logEvent';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');

function rec(message: string, ageMs = 60_000): LogRecord {
  return {
    level: 'info',
    surface: 's',
    message,
    timestamp: new Date(NOW - ageMs).toISOString(),
  };
}

describe('logSpool', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('keys are per instance under the prefix', () => {
    const a = newSpoolKey();
    const b = newSpoolKey();
    expect(a.startsWith(SPOOL_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('claims other keys oldest first, removes them, and skips its own', () => {
    const own = newSpoolKey();
    writeSpool(own, [rec('mine')]);
    writeSpool(SPOOL_PREFIX + 'x', [rec('newer', 1_000), rec('oldest', 90_000)]);
    writeSpool(SPOOL_PREFIX + 'y', [rec('middle', 30_000)]);

    const claim = claimSpools(own, NOW);

    expect(claim.records.map((r) => r.message)).toEqual(['oldest', 'middle', 'newer']);
    expect(claim.keys).toBe(2);
    expect(localStorage.getItem(SPOOL_PREFIX + 'x')).toBeNull();
    expect(localStorage.getItem(SPOOL_PREFIX + 'y')).toBeNull();
    expect(localStorage.getItem(own)).not.toBeNull();
  });

  it('drops events older than 7 days as stale', () => {
    writeSpool(SPOOL_PREFIX + 'x', [rec('fresh'), rec('old', SPOOL_MAX_AGE_MS + 1)]);
    const claim = claimSpools('own', NOW);
    expect(claim.records.map((r) => r.message)).toEqual(['fresh']);
    expect(claim.stale).toBe(1);
  });

  it('drops events dated far in the future as stale too (a device clock far ahead)', () => {
    writeSpool(SPOOL_PREFIX + 'x', [rec('fresh'), rec('future', -(SPOOL_MAX_AGE_MS + 1))]);
    const claim = claimSpools('own', NOW);
    expect(claim.records.map((r) => r.message)).toEqual(['fresh']);
    expect(claim.stale).toBe(1);
  });

  it('counts records with no parseable timestamp, non-objects and corrupt keys as malformed', () => {
    localStorage.setItem(
      SPOOL_PREFIX + 'x',
      JSON.stringify([rec('ok'), { message: 'no-ts' }, { timestamp: 'garbage' }, 'str', null])
    );
    localStorage.setItem(SPOOL_PREFIX + 'y', '{not json');
    localStorage.setItem(SPOOL_PREFIX + 'z', JSON.stringify({ events: [] }));

    const claim = claimSpools('own', NOW);

    expect(claim.records.map((r) => r.message)).toEqual(['ok']);
    expect(claim.malformed).toBe(4 + 1 + 1);
    expect(claim.keys).toBe(3);
    expect(localStorage.length).toBe(0);
  });

  it('skips a key it cannot remove, so it never replays on every launch', () => {
    writeSpool(SPOOL_PREFIX + 'x', [rec('stuck')]);
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const claim = claimSpools('own', NOW);
    expect(claim.records).toEqual([]);
    expect(claim.unremovable).toBe(1);
  });

  it('ignores keys without the prefix', () => {
    localStorage.setItem('other', JSON.stringify([rec('x')]));
    expect(claimSpools('own', NOW)).toMatchObject({ keys: 0, records: [] });
  });
});
