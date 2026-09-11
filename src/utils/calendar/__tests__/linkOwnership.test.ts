/**
 * The two predicates that stand between the one-time import (#94) and deleting a
 * family's real Google events.
 */
import { describe, it, expect } from 'vitest';

import { beaniesMayDelete, beaniesMayPush } from '../linkOwnership';
import type { CalendarEventLink } from '@/types/models';

const link = (origin?: CalendarEventLink['origin']): CalendarEventLink => ({
  id: 'c1:a1',
  connectionId: 'c1',
  activityId: 'a1',
  googleEventId: 'g1',
  lastPushedHash: 'h',
  lastPushedAt: '2026-09-11T00:00:00.000Z',
  origin,
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
});

describe('beaniesMayDelete', () => {
  it('allows deleting an event beanies created (no origin)', () => {
    expect(beaniesMayDelete(link(undefined))).toBe(true);
  });

  it('REFUSES for an adopted event, because the family had it before beanies did', () => {
    expect(beaniesMayDelete(link('adopted'))).toBe(false);
  });

  it('REFUSES for an external event, which belongs to whoever created it', () => {
    expect(beaniesMayDelete(link('external'))).toBe(false);
  });
});

describe('beaniesMayPush', () => {
  it('allows pushing an event beanies created', () => {
    expect(beaniesMayPush(link(undefined))).toBe(true);
  });

  it('ALLOWS pushing an adopted event, which is the point of adopting it', () => {
    // An adopted event is patched in place, so the family keeps exactly one copy.
    expect(beaniesMayPush(link('adopted'))).toBe(true);
  });

  it('refuses to push an external event', () => {
    expect(beaniesMayPush(link('external'))).toBe(false);
  });
});

describe('the two axes are genuinely independent', () => {
  // If these ever collapse into one boolean, adoption breaks: an adopted event must
  // be writable but not deletable, which a single flag cannot express.
  it('adopted is writable but NOT deletable', () => {
    expect(beaniesMayPush(link('adopted'))).toBe(true);
    expect(beaniesMayDelete(link('adopted'))).toBe(false);
  });
});
