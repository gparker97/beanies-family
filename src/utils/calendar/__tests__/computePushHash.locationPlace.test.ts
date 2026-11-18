import { describe, expect, it } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import { activityToGoogleEvent, computePushHash } from '../activityToGoogleEvent';
import { TEST_HASH_CTX } from './helpers/hashContext';

const MAP_CTX = {
  memberName: () => undefined,
  appOrigin: 'https://app.beanies.family',
  timeZone: 'Asia/Singapore',
};

const activity = (over: Partial<FamilyActivity> = {}): FamilyActivity =>
  ({
    id: 'a1',
    title: 'Piano',
    date: '2026-06-03',
    recurrence: 'none',
    category: 'music',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    startTime: '15:00',
    endTime: '16:00',
    location: '127 S Bridge Rd, Singapore 058285, block 48',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  }) as FamilyActivity;

describe('computePushHash and #150 locationPlace', () => {
  it('ignores locationPlace: picking a place for an unchanged string pushes nothing', () => {
    const plain = activity();
    const picked = activity({
      locationPlace: { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' },
    });
    expect(computePushHash(picked, TEST_HASH_CTX)).toBe(computePushHash(plain, TEST_HASH_CTX));
  });

  it('still changes with the location string (what Google shows)', () => {
    expect(computePushHash(activity({ location: 'Hall B' }), TEST_HASH_CTX)).not.toBe(
      computePushHash(activity(), TEST_HASH_CTX)
    );
  });

  it('pushes the location string, never the place object', () => {
    const body = activityToGoogleEvent(
      activity({
        locationPlace: { placeId: 'ChIJ127', name: '127 S Bridge Rd, Singapore 058285' },
      }),
      MAP_CTX
    );
    expect(body.location).toBe('127 S Bridge Rd, Singapore 058285, block 48');
    expect(JSON.stringify(body)).not.toContain('ChIJ127');
  });
});
