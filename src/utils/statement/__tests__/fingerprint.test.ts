import { describe, it, expect } from 'vitest';
import { fingerprintLines, statementFingerprint } from '../fingerprint';
import { sha256HexOfParts } from '@/utils/encoding';
import { line } from './fixtures';

describe('statementFingerprint', () => {
  it('is ONE formula: account, date, amount 2dp, direction, text part, ordinal', async () => {
    const l = line({ date: '2026-03-10', amount: 5, direction: 'out', description: 'SHOP #99' });
    expect(await statementFingerprint('acc', l, 0)).toBe(
      await sha256HexOfParts(['acc', '2026-03-10', '5.00', 'out', 'shop', '0'], '\0')
    );
  });

  it('uses the reference in place of the description, never of the date or amount', async () => {
    const a = line({ date: '2026-03-10', reference: '4412', description: 'ACH DEBIT A' });
    const b = line({ date: '2026-03-10', reference: '4412', description: 'ach debit (re-read)' });
    expect(await statementFingerprint('acc', a, 0)).toBe(await statementFingerprint('acc', b, 0));

    // The same 4-digit reference on another statement's date is a different line.
    const nextMonth = line({ date: '2026-04-10', reference: '4412', description: 'ACH DEBIT A' });
    expect(await statementFingerprint('acc', nextMonth, 0)).not.toBe(
      await statementFingerprint('acc', a, 0)
    );
    const otherAmount = line({ date: '2026-03-10', reference: '4412', amount: 11 });
    expect(await statementFingerprint('acc', otherAmount, 0)).not.toBe(
      await statementFingerprint('acc', a, 0)
    );
  });

  it('is keyed on the account', async () => {
    const l = line();
    expect(await statementFingerprint('a1', l, 0)).not.toBe(await statementFingerprint('a2', l, 0));
  });
});

describe('fingerprintLines', () => {
  const chase = () =>
    line({ date: '2026-03-02', amount: 5000, direction: 'out', description: 'ONLINE TRANSFER' });

  it('distinguishes three identical same-day lines by ordinal', async () => {
    const fps = await fingerprintLines('acc', [chase(), chase(), chase()]);
    expect(new Set(fps).size).toBe(3);
    expect(fps[2]).toBe(await statementFingerprint('acc', chase(), 2));
  });

  it('counts ordinals per identical group, in input order', async () => {
    const other = line({ description: 'COFFEE' });
    const fps = await fingerprintLines('acc', [chase(), other, chase()]);
    expect(fps[1]).toBe(await statementFingerprint('acc', other, 0));
    expect(fps[2]).toBe(await statementFingerprint('acc', chase(), 1));
  });

  it('is stable across a re-read of the same statement', async () => {
    const read = () => [chase(), line({ description: 'COFFEE' }), chase()];
    expect(await fingerprintLines('acc', read())).toEqual(await fingerprintLines('acc', read()));
  });
});
