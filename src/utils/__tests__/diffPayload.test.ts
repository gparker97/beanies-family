import { describe, it, expect } from 'vitest';
import { diffPayload } from '@/utils/diffPayload';

describe('diffPayload', () => {
  describe('the core contract', () => {
    it('omits a field absent from `next` (untouched — leave it alone)', () => {
      const out = diffPayload({ a: 1, b: 2 }, { b: 2 });
      expect('a' in out).toBe(false);
    });

    it('omits a field whose value is unchanged', () => {
      expect(diffPayload({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual({});
    });

    it('includes a field whose value changed', () => {
      expect(diffPayload({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ b: 3 });
    });

    it('returns an empty object when nothing changed', () => {
      expect(Object.keys(diffPayload({ a: 1 }, { a: 1 }))).toHaveLength(0);
    });
  });

  describe('clears — the automergeRepository contract', () => {
    // `update` builds its delete list from Object.keys, so a cleared field must
    // be PRESENT-but-undefined. Omitting it would leave the old value in place.
    it('ASSIGNS undefined for a cleared field rather than omitting it', () => {
      const out = diffPayload({ note: 'hi' }, { note: undefined });
      expect('note' in out).toBe(true);
      expect(out.note).toBeUndefined();
    });

    it("normalises '' to undefined so a cleared text field deletes the key", () => {
      const out = diffPayload({ note: 'hi' }, { note: '' });
      expect('note' in out).toBe(true);
      expect(out.note).toBeUndefined();
    });

    it('normalises null to undefined — null would persist as a literal null', () => {
      const out = diffPayload({ note: 'hi' } as { note?: string | null }, { note: null });
      expect('note' in out).toBe(true);
      expect(out.note).toBeUndefined();
    });

    it("treats '' → undefined as no change (both mean absent)", () => {
      expect(diffPayload({ note: '' }, { note: undefined })).toEqual({});
    });

    it('does not emit a clear for a field that was already empty', () => {
      expect(diffPayload({ note: '' }, { note: '' })).toEqual({});
    });
  });

  describe('arrays are compared by value, not by reference', () => {
    it('omits an array with identical contents but a different identity', () => {
      expect(diffPayload({ daysOfWeek: [3] }, { daysOfWeek: [3] })).toEqual({});
    });

    it('includes an array whose contents changed', () => {
      expect(diffPayload({ daysOfWeek: [3] }, { daysOfWeek: [4] })).toEqual({ daysOfWeek: [4] });
    });

    it('includes an array whose length changed', () => {
      expect(diffPayload({ ids: ['a'] }, { ids: ['a', 'b'] })).toEqual({ ids: ['a', 'b'] });
    });

    it('detects a reordering (order is significant for daysOfWeek)', () => {
      expect(diffPayload({ d: [1, 2] }, { d: [2, 1] })).toEqual({ d: [2, 1] });
    });
  });

  describe('the occurrence-edit scenario this utility exists for', () => {
    // The regression that motivated it: a form seeded from the SERIES TEMPLATE
    // emitted `date` on every save, so a "just this item" edit that touched only
    // the pickup person silently rescheduled the occurrence.
    const baseline = {
      title: 'Piano Lesson',
      date: '2026-04-01',
      pickupMemberId: 'parent-2',
      daysOfWeek: [3],
    };

    it('omits `date` when the user only changed the pickup person', () => {
      const out = diffPayload(baseline, { ...baseline, pickupMemberId: 'parent-1' });
      expect(out).toEqual({ pickupMemberId: 'parent-1' });
      expect('date' in out).toBe(false);
    });

    it('includes `date` when the user genuinely moved the occurrence', () => {
      const out = diffPayload(baseline, { ...baseline, date: '2026-04-08' });
      expect(out).toEqual({ date: '2026-04-08' });
    });
  });

  describe('complexity budget (documented limits — deliberately NOT supported)', () => {
    // Guards the utility from growing into a general object-diff library.
    // Payloads are flat by design; nested objects fall back to JSON.stringify,
    // which is key-order sensitive. If this test ever needs changing, fix the
    // PAYLOAD shape rather than adding deep-equal machinery here.
    it('treats key-reordered nested objects as different (no deep-equal semantics)', () => {
      const out = diffPayload({ meta: { a: 1, b: 2 } }, { meta: { b: 2, a: 1 } });
      expect('meta' in out).toBe(true);
    });
  });
});
