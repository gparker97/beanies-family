import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  avatarPhotoHooks,
  forEachBookingSegment,
  vacationPhotoHooks,
  vacationSegmentEntityId,
} from '../photoCollectionHooks';
import type { FamilyDocument } from '@/types/automerge';

/** Minimal doc with the two collections the hooks touch. */
function makeDoc(): FamilyDocument {
  return {
    vacations: {
      'vac-1': {
        id: 'vac-1',
        travelSegments: [
          {
            id: 'seg-flight',
            type: 'flight_outbound',
            title: 'f',
            status: 'pending',
            photoIds: ['p1', 'p2'],
          },
        ],
        accommodations: [{ id: 'seg-hotel', type: 'hotel', title: 'h', status: 'pending' }],
        transportation: [
          { id: 'seg-car', type: 'rental_car', title: 'c', status: 'pending', photoIds: ['p3'] },
        ],
        ideas: [],
      },
    },
    familyMembers: {
      m1: { id: 'm1', avatarPhotoId: 'avatar-1' },
      m2: { id: 'm2' }, // no avatar
    },
  } as unknown as FamilyDocument;
}

afterEach(() => vi.restoreAllMocks());

describe('forEachBookingSegment', () => {
  it('visits every segment across the three booking arrays', () => {
    const seen: string[] = [];
    forEachBookingSegment(makeDoc(), (s) => seen.push(s.id));
    expect(seen).toEqual(['seg-flight', 'seg-hotel', 'seg-car']);
  });
});

describe('vacationPhotoHooks.attach', () => {
  it('appends the photoId to the matching nested segment (composite key)', () => {
    const doc = makeDoc();
    vacationPhotoHooks.attach(doc, vacationSegmentEntityId('vac-1', 'seg-hotel'), 'p9');
    expect(doc.vacations['vac-1']!.accommodations[0]!.photoIds).toEqual(['p9']);
  });

  it('silently no-ops when the vacation is not in the doc yet (wizard create)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = makeDoc();
    vacationPhotoHooks.attach(doc, vacationSegmentEntityId('vac-missing', 'seg-x'), 'p9');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the vacation exists but the segment id is gone (id drift)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = makeDoc();
    vacationPhotoHooks.attach(doc, vacationSegmentEntityId('vac-1', 'seg-nope'), 'p9');
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('vacationPhotoHooks.collect', () => {
  it('gathers photoIds from every segment across all arrays', () => {
    expect([...vacationPhotoHooks.collect(makeDoc())].sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('avatarPhotoHooks', () => {
  it('collect yields each member avatarPhotoId (skipping members without one)', () => {
    expect([...avatarPhotoHooks.collect(makeDoc())]).toEqual(['avatar-1']);
  });

  it('attach is a no-op (avatars are set via the scalar, not pushed)', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc.familyMembers);
    avatarPhotoHooks.attach(doc, 'm1', 'whatever');
    expect(JSON.stringify(doc.familyMembers)).toBe(before);
  });
});
