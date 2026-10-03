/**
 * C6: what a destructive delete would lose. The rule these pin: an answer that cannot be
 * had reads as AT RISK, never as clean, because a wrong "clean" costs someone their work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  pushed: 'clean' as 'clean' | 'dirty',
  pushedThrows: false,
  blocked: null as { blockCode: string } | null,
  photos: 0,
  photosThrow: false,
  marker: false,
}));

vi.mock('@/services/sync/syncService', () => ({
  docPushedAgainst: vi.fn(async () => {
    if (h.pushedThrows) throw new Error('worker gone');
    return h.pushed;
  }),
  getRemoteBaselineHeadsFp: vi.fn(() => 'fp'),
  isRemoteBlocked: vi.fn(() => h.blocked),
}));
vi.mock('@/services/indexeddb/database', () => ({
  countQueuedPhotoUploads: vi.fn(async () => {
    if (h.photosThrow) throw new Error('idb');
    return h.photos;
  }),
  hasUnpushedAtSignOutMarker: vi.fn(() => h.marker),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import {
  combineUnsavedWork,
  hasUnsavedWork,
  measureFamilyAtRest,
  measureLiveFamily,
  NOTHING_UNSAVED,
} from '@/services/auth/unsavedWork';

beforeEach(() => {
  Object.assign(h, {
    pushed: 'clean',
    pushedThrows: false,
    blocked: null,
    photos: 0,
    photosThrow: false,
    marker: false,
  });
});

describe('measureLiveFamily', () => {
  it('a pushed document with no queued photos is clean', async () => {
    const r = await measureLiveFamily('fam-1');
    expect(r).toEqual(NOTHING_UNSAVED);
    expect(hasUnsavedWork(r)).toBe(false);
  });

  it('names each thing at risk: unpushed changes, queued photos, an unreadable file', async () => {
    h.pushed = 'dirty';
    h.photos = 3;
    h.blocked = { blockCode: 'payload' };
    const r = await measureLiveFamily('fam-1');
    expect(r).toEqual({ unsavedFamilies: 1, photoUploads: 3, remoteBlocked: true, unknown: false });
    expect(hasUnsavedWork(r)).toBe(true);
  });

  it('a probe that fails reads as at risk, never as clean', async () => {
    h.pushedThrows = true;
    expect(hasUnsavedWork(await measureLiveFamily('fam-1'))).toBe(true);
    h.pushedThrows = false;
    h.photosThrow = true;
    expect((await measureLiveFamily('fam-1')).unknown).toBe(true);
  });
});

describe('measureFamilyAtRest (forget family on the picker)', () => {
  it('the marker a sign-out left when it KEPT the database is the answer', async () => {
    h.marker = true;
    expect(await measureFamilyAtRest('fam-2')).toMatchObject({ unsavedFamilies: 1 });
  });

  it('queued photos alone are at risk', async () => {
    h.photos = 1;
    expect(hasUnsavedWork(await measureFamilyAtRest('fam-2'))).toBe(true);
  });
});

it('combineUnsavedWork adds counts and ORs the flags', () => {
  expect(
    combineUnsavedWork(
      { unsavedFamilies: 1, photoUploads: 2, remoteBlocked: false, unknown: true },
      { unsavedFamilies: 1, photoUploads: 1, remoteBlocked: true, unknown: false }
    )
  ).toEqual({ unsavedFamilies: 2, photoUploads: 3, remoteBlocked: true, unknown: true });
});
