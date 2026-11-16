// @vitest-environment node
/**
 * Travel segment titles on two devices. One field decides the display (`customTitle`); the
 * stored `title` is a best-effort copy for older builds that this build never reads. So
 * whatever the stored `title` ends as after a merge, both devices show the same title.
 */
import { describe, it, expect } from 'vitest';
import { materializeCollection } from '../docOps';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';
import { foldIndex } from '../counterFields';
import type { MutationOp } from '../protocol';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';
import { segmentDisplayTitle, withSettledTitles } from '@/utils/vacation';

const seedVacation = {
  id: 'v1',
  activityId: 'a1',
  name: 'Guangzhou',
  tripType: 'fly_and_stay',
  assigneeIds: ['m1'],
  travelSegments: [
    {
      id: 's-out',
      type: 'flight_outbound',
      title: 'Departure Flight',
      status: 'booked',
      departureAirport: 'Singapore (SIN)',
      arrivalAirport: 'Guangzhou (CAN)',
    },
    {
      id: 's-ret',
      type: 'flight_return',
      title: 'flight',
      status: 'booked',
      departureAirport: 'Guangzhou (CAN)',
      arrivalAirport: 'Singapore (SIN)',
    },
  ],
  accommodations: [],
  transportation: [],
  ideas: [],
  createdBy: 'm1',
  createdAt: '2026-11-16T00:00:00.000Z',
  updatedAt: '2026-11-16T00:00:00.000Z',
} as unknown as FamilyVacation;

const read = (doc: Doc): FamilyVacation => {
  const found = materializeCollection(doc, 'vacations', foldIndex(doc)).find(([id]) => id === 'v1');
  return JSON.parse(JSON.stringify(found![1])) as FamilyVacation;
};
const segOf = (v: FamilyVacation, id: string): VacationTravelSegment =>
  v.travelSegments.find((s) => s.id === id)!;

/**
 * The store's segment write: merge the patch onto the segment this device holds, settle the
 * stored titles (`withSettledTitles`, as `updateVacation` does), and send the whole array with
 * the held array as the reconciler's base. JSON round-trip = the plain, undefined-free patch.
 */
const writeSegment = (
  held: FamilyVacation,
  segmentId: string,
  patch: Partial<VacationTravelSegment>,
  settle = true
): MutationOp => {
  const next = held.travelSegments.map((s) => (s.id === segmentId ? { ...s, ...patch } : s));
  const input = settle ? withSettledTitles({ travelSegments: next }) : { travelSegments: next };
  return {
    op: 'patch',
    collection: 'vacations',
    id: 'v1',
    patch: JSON.parse(JSON.stringify(input)),
    base: JSON.parse(JSON.stringify({ travelSegments: held.travelSegments })),
  };
};

const start = () =>
  fork(seeded([{ op: 'set', collection: 'vacations', id: 'v1', entity: seedVacation }]));

describe('travel segment titles on two devices', () => {
  it('A types a custom title while B changes an airport: both show the custom title', () => {
    const { a, b } = start();
    const held = read(a);
    const a1 = apply(a, writeSegment(held, 's-out', { customTitle: 'To Grandma' }));
    const b1 = apply(b, writeSegment(held, 's-out', { departureAirport: 'Hong Kong (HKG)' }));
    const after = converge(a1, b1);

    for (const doc of [after.a, after.b]) {
      const seg = segOf(read(doc), 's-out');
      expect(seg.customTitle).toBe('To Grandma');
      expect(seg.departureAirport).toBe('Hong Kong (HKG)');
      // Whatever the stored copy ended as, the display is the custom title.
      expect(['To Grandma', 'HKG → CAN']).toContain(seg.title);
      expect(segmentDisplayTitle(seg)).toBe('To Grandma');
    }
    expect(read(after.a)).toEqual(read(after.b));
  });

  it('both devices settle the same stale sibling at once: the stored title is one string', () => {
    const { a, b } = start();
    const held = read(a);
    // Each edits s-out; each save also settles s-ret ("flight" → "CAN → SIN").
    const a1 = apply(a, writeSegment(held, 's-out', { notes: 'window seats' }));
    const b1 = apply(b, writeSegment(held, 's-out', { bookingReference: 'QJSRKE' }));
    const after = converge(a1, b1);

    const merged = read(after.a);
    expect(read(after.b)).toEqual(merged);
    expect(segOf(merged, 's-ret').title).toBe('CAN → SIN');
    expect(segOf(merged, 's-out').title).toBe('SIN → CAN');
    expect(segOf(merged, 's-out')).toMatchObject({
      notes: 'window seats',
      bookingReference: 'QJSRKE',
    });
  });

  it('an older build rewriting title (carrying customTitle through) leaves the custom title shown', () => {
    const { a, b } = start();
    const withCustom = apply(a, writeSegment(read(a), 's-out', { customTitle: 'To Grandma' }));
    const synced = converge(withCustom, b);
    // The older build knows nothing of `customTitle`: it changes an airport and writes the
    // route into `title` itself, sending the whole segment it read (so the field rides along).
    const older = apply(
      synced.b,
      writeSegment(
        read(synced.b),
        's-out',
        { departureAirport: 'Hong Kong (HKG)', title: 'HKG → CAN' },
        false
      )
    );
    const after = converge(synced.a, older);
    const seg = segOf(read(after.a), 's-out');
    expect(seg.title).toBe('HKG → CAN');
    expect(seg.customTitle).toBe('To Grandma');
    expect(segmentDisplayTitle(seg)).toBe('To Grandma');
  });
});
