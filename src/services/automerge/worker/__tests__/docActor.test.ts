// @vitest-environment node
/**
 * Pinning the actor must actually stop the churn — end to end, through the real
 * `docOps` load path rather than through a mock.
 *
 * The whole mechanism is invisible when it fails: a missed `setDocActor` looks
 * identical to working code, and the only symptom is an actor count that grows
 * slowly for weeks. So these assert the ACTOR COUNT in the saved document, which
 * is the thing the profiler measures on greg's real pod.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { setDocActor, resetDocActor, docInitOpts } from '../docActor';
import { loadDoc, saveDoc, applyMutation, migrateDoc } from '../docOps';

const ACTOR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const setBalance = (doc: Automerge.Doc<FamilyDocument>, id: string, balance: number) =>
  applyMutation(doc, { op: 'set', collection: 'accounts', id, entity: { id, balance } }).doc;

/** Distinct actors across the whole change log — the number that grows. */
const actorCount = (doc: Automerge.Doc<FamilyDocument>) =>
  new Set(Automerge.getAllChanges(doc).map((c) => Automerge.decodeChange(c).actor)).size;

beforeEach(() => resetDocActor());

describe('a pinned actor across repeated load cycles', () => {
  it('keeps ONE lane where the default mints one per load', () => {
    // The unpinned control first, so the assertion below is a comparison rather
    // than a claim. FOUR actors, not three: `init` mints one for the migrate
    // change, then each of the three loads mints another. That is the growth —
    // one lane per SESSION, on a document whose data never changed shape.
    let unpinned = migrateDoc(Automerge.init<FamilyDocument>());
    for (let i = 0; i < 3; i++) {
      unpinned = loadDoc(saveDoc(unpinned));
      unpinned = setBalance(unpinned, `a${i}`, i);
    }
    expect(actorCount(unpinned)).toBe(4);

    setDocActor(ACTOR);
    let pinned = migrateDoc(Automerge.init<FamilyDocument>(docInitOpts()));
    for (let i = 0; i < 3; i++) {
      pinned = loadDoc(saveDoc(pinned));
      pinned = setBalance(pinned, `a${i}`, i);
    }
    expect(actorCount(pinned)).toBe(1);
  });

  it('produces a SMALLER document for the same data', () => {
    // Actor lanes are not free: each one is a separate column in the encoding.
    // This is the whole reason the churn matters.
    const build = (actor: string | null) => {
      resetDocActor();
      if (actor) setDocActor(actor);
      let doc = migrateDoc(Automerge.init<FamilyDocument>(docInitOpts()));
      for (let i = 0; i < 8; i++) {
        doc = loadDoc(saveDoc(doc));
        doc = setBalance(doc, `a${i}`, i);
      }
      return saveDoc(doc).byteLength;
    };
    expect(build(ACTOR)).toBeLessThan(build(null));
  });
});

describe('docInitOpts', () => {
  it('returns undefined when no actor is set, so Automerge mints its own', () => {
    // A missing actor must NEVER stop a document from loading — that would make
    // an optimisation cause an outage.
    expect(docInitOpts()).toBeUndefined();
    expect(() => loadDoc(saveDoc(migrateDoc(Automerge.init<FamilyDocument>())))).not.toThrow();
  });

  it('carries the actor once set, and forgets it on reset', () => {
    setDocActor(ACTOR);
    expect(docInitOpts()).toEqual({ actor: ACTOR });
    resetDocActor();
    expect(docInitOpts()).toBeUndefined();
  });
});
