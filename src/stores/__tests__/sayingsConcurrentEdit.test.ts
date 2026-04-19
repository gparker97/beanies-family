// @vitest-environment node
/**
 * Concurrent-edit contract for SayingItem — the per-phase CRDT test
 * required by the Pod plan. Verifies Automerge merge semantics hold
 * for the sayings collection so two devices editing different
 * sayings about the same member both land cleanly after sync.
 *
 * Mirrors the existing pattern in
 * `src/services/automerge/__tests__/automergeRepository.test.ts` —
 * save binary, fork via `Automerge.load`, mutate both sides, merge.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { initDoc, resetDoc, saveDoc, mergeDoc, getDoc } from '@/services/automerge/docService';
import {
  createSaying,
  getAllSayings,
  updateSaying,
} from '@/services/automerge/repositories/sayingRepository';
import type { FamilyDocument } from '@/types/automerge';

const MEMBER_ID = 'member-neil';

describe('sayings — concurrent edits merge cleanly', () => {
  beforeEach(() => {
    resetDoc();
    initDoc();
  });

  it('two devices adding different sayings for the same member converge', async () => {
    // Seed a saying that exists on both sides before the fork.
    const seed = await createSaying({
      memberId: MEMBER_ID,
      words: 'I am the captain now',
      saidOn: '2026-03-01',
    });

    // Fork: doc B starts as a snapshot of doc A.
    const forked = Automerge.load<FamilyDocument>(saveDoc());

    // Side A — add saying via the repo (hits the live doc).
    const fromA = await createSaying({
      memberId: MEMBER_ID,
      words: 'I said it first',
      saidOn: '2026-03-02',
    });

    // Side B — add a different saying via direct Automerge.change.
    const bChanged = Automerge.change(forked, (d) => {
      d.sayings['b-saying'] = {
        id: 'b-saying',
        memberId: MEMBER_ID,
        words: 'From the other device',
        saidOn: '2026-03-02',
        createdAt: '2026-03-02T00:00:00Z',
        updatedAt: '2026-03-02T00:00:00Z',
      };
    });

    // Merge B into A.
    mergeDoc(bChanged);

    const all = await getAllSayings();
    const ids = all.map((s) => s.id).sort();
    expect(ids).toContain(seed.id);
    expect(ids).toContain(fromA.id);
    expect(ids).toContain('b-saying');
    expect(all).toHaveLength(3);
  });

  it('two devices editing DIFFERENT fields on the same saying converge without loss', async () => {
    // Shared seed both sides will edit.
    const seed = await createSaying({
      memberId: MEMBER_ID,
      words: 'Placeholder',
      saidOn: '2026-03-01',
    });

    const forked = Automerge.load<FamilyDocument>(saveDoc());

    // Side A edits the `place` field.
    await updateSaying(seed.id, { place: 'kitchen' });

    // Side B edits the `context` field on its fork.
    const bChanged = Automerge.change(forked, (d) => {
      const s = d.sayings[seed.id];
      if (s) s.context = 'right before dinner';
    });

    mergeDoc(bChanged);

    const merged = getDoc().sayings[seed.id];
    expect(merged).toBeDefined();
    // Automerge's default CRDT behavior keeps both writes because they
    // touch disjoint fields — this is the critical guarantee we rely on.
    expect(merged!.place).toBe('kitchen');
    expect(merged!.context).toBe('right before dinner');
    expect(merged!.words).toBe('Placeholder');
  });

  it('delete-on-one-side + edit-on-other-side does not resurrect the saying', async () => {
    const seed = await createSaying({
      memberId: MEMBER_ID,
      words: 'To be deleted',
    });

    const forked = Automerge.load<FamilyDocument>(saveDoc());

    // Side A deletes the saying.
    // (Automerge delete on a map key drops the entry.)
    const { changeDoc } = await import('@/services/automerge/docService');
    changeDoc((d) => {
      delete d.sayings[seed.id];
    });
    expect(getDoc().sayings[seed.id]).toBeUndefined();

    // Side B edits the same saying — classic "edited the deleted one"
    // race. Automerge's convention: delete wins, edits on the deleted
    // key are dropped (the map no longer contains the key).
    const bChanged = Automerge.change(forked, (d) => {
      const s = d.sayings[seed.id];
      if (s) s.words = 'I edited on B';
    });

    mergeDoc(bChanged);

    // The delete wins — edited saying does not come back.
    expect(getDoc().sayings[seed.id]).toBeUndefined();
  });
});
