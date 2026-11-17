// @vitest-environment node
/**
 * The two view-only calendar collections (plan 2026-11-17, P3): `calendarViewAccounts` and
 * `viewedCalendars`. A pod written before they existed gains both through their STORED
 * migration changes (so every device creates the same map objects and writes from two devices
 * merge), and a pod that already holds them is left exactly as it is.
 */
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { COLLECTION_NAMES, type CollectionName, type FamilyDocument } from '@/types/automerge';
import { countRootConflicts, getHeads, migrateDoc } from '../docOps';
import { MIGRATION_CHANGES } from '../migrationChanges';
import type { MutationOp } from '../protocol';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';

type AnyRec = Record<string, unknown>;

const VIEW_ROOTS = ['calendarViewAccounts', 'viewedCalendars'] as const;

/** A pod written by the build before this change: every other collection, neither view map. */
const preViewPod = (): Doc =>
  Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
    for (const name of COLLECTION_NAMES) {
      if (!(VIEW_ROOTS as readonly string[]).includes(name)) (d as unknown as AnyRec)[name] = {};
    }
    (d as unknown as AnyRec).todos = { t1: { id: 't1', title: 'buy beans' } };
  });

const setOp = (collection: CollectionName, entity: AnyRec): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id as string,
  entity,
});

const storedActor = (name: (typeof VIEW_ROOTS)[number]) =>
  Automerge.decodeChange(Uint8Array.from(Buffer.from(MIGRATION_CHANGES[name], 'base64'))).actor;

const account = (id: string, accountEmail: string) => ({
  id,
  provider: 'google',
  accountEmail,
  refreshToken: `rt-${id}`,
  grantedScopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
});

describe('view-only calendar collections: migration', () => {
  it('a pod from before this change gains both collections, created by their stored changes', () => {
    const pod = preViewPod();
    expect(pod.calendarViewAccounts).toBeUndefined();
    expect(pod.viewedCalendars).toBeUndefined();

    const migrated = migrateDoc(pod);

    for (const name of VIEW_ROOTS) {
      expect(migrated[name]).toEqual({});
      // The map object belongs to the stored change's fixed actor, never this device's.
      expect(Automerge.getObjectId(migrated[name])!.split('@')[1]).toBe(storedActor(name));
    }
    expect(JSON.parse(JSON.stringify(migrated.todos))).toEqual({
      t1: { id: 't1', title: 'buy beans' },
    });
    expect(countRootConflicts(migrated)).toBe(0);
  });

  it('two devices migrating that pod write into ONE map per collection; both writes survive', () => {
    const { a, b } = fork(preViewPod());
    const a1 = apply(
      migrateDoc(a),
      setOp('calendarViewAccounts', account('va-a', 'mum@example.com')),
      setOp('viewedCalendars', { id: 'vc-a', viewAccountId: 'va-a', calendarId: 'x' })
    );
    const b1 = apply(
      migrateDoc(b),
      setOp('calendarViewAccounts', account('va-b', 'dad@example.com')),
      setOp('viewedCalendars', { id: 'vc-b', viewAccountId: 'va-b', calendarId: 'y' })
    );
    for (const name of VIEW_ROOTS) {
      expect(Automerge.getObjectId(a1[name])).toBe(Automerge.getObjectId(b1[name]));
    }

    const { a: merged } = converge(a1, b1);

    expect(Object.keys(merged.calendarViewAccounts).sort()).toEqual(['va-a', 'va-b']);
    expect(Object.keys(merged.viewedCalendars).sort()).toEqual(['vc-a', 'vc-b']);
    expect(countRootConflicts(merged)).toBe(0);
  });

  it('a pod that already holds both collections is unchanged (same handle, heads unchanged)', () => {
    const doc = seeded([setOp('calendarViewAccounts', account('va1', 'mum@example.com'))]);
    expect(doc.viewedCalendars).toEqual({});
    const heads = getHeads(doc);

    expect(migrateDoc(doc)).toBe(doc);
    expect(getHeads(doc)).toEqual(heads);
    expect(Object.keys(doc.calendarViewAccounts)).toEqual(['va1']);
  });
});
