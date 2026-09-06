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
import fs from 'node:fs';
import path from 'node:path';
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

describe('why the actor needs a lease (actorLease.ts)', () => {
  it('two realms writing under ONE actor cannot be merged — Automerge refuses', () => {
    // Pinned so the reason for the lease is executable, not folklore. If a
    // future Automerge starts tolerating this, the lease becomes optional and
    // this test says so.
    const ACTOR = 'abcdef0123456789abcdef0123456789';
    const bytes = Automerge.save(
      Automerge.from<{ items: Record<string, string> }>({ items: {} }, { actor: ACTOR })
    );
    let tabA = Automerge.load<{ items: Record<string, string> }>(bytes, { actor: ACTOR });
    let tabB = Automerge.load<{ items: Record<string, string> }>(bytes, { actor: ACTOR });
    tabA = Automerge.change(tabA, (d) => {
      d.items.a = 'from-A';
    });
    tabB = Automerge.change(tabB, (d) => {
      d.items.b = 'from-B';
    });
    expect(() => Automerge.merge(Automerge.clone(tabA), tabB)).toThrow(/duplicate seq/i);
  });
});

describe('there is ONE merge entry point, and it never nulls the document', () => {
  // Structural: driving a real worker respawn mid-RPC is not reachable from a
  // unit test, and the failure mode is silent — a cross-lineage merge that
  // persists and publishes.
  const src = fs.readFileSync(path.resolve(__dirname, '../docClient.ts'), 'utf8');
  const worker = fs.readFileSync(path.resolve(__dirname, '../applyAndProject.ts'), 'utf8');
  const mergeBody = () => {
    const fn = worker.slice(worker.indexOf('export async function mergeRemoteEnvelope'));
    const end = fn.indexOf('\n}\n');
    expect(end, 'mergeRemoteEnvelope body not found').toBeGreaterThan(-1);
    return fn.slice(0, end);
  };

  it('`adoptRemoteEnvelope` no longer exists — the basis decides', () => {
    // A second entry point with a boolean default is a decision nobody made,
    // and it was forgettable: a caller could reach a merge without ever stating
    // what it could prove about its own document.
    expect(src).not.toContain('function adoptRemoteEnvelope');
  });

  it('the merge REPLACES in one assignment — it never nulls the doc first', () => {
    // Nulling `currentDoc` up front sat before `headsOf(remote)` and before
    // `migrateDoc(remote)` (a real `Automerge.change`). Either can throw on a
    // low-memory device, and the worker was then left holding NO document while
    // main's projection still showed data: every mutate, save and getHeads
    // failed for the session.
    const body = mergeBody();
    expect(body).not.toContain('currentDoc = null');
    expect(body).toContain('if (installWholesale)');
  });

  it('the guard runs AFTER the decrypt', () => {
    // The only ordering this file can honestly assert from source. What the
    // guard then DECIDES is behaviour, and is covered by `lineageBasis.test.ts`
    // against a real worker — deliberately, because the previous version of
    // this test asserted the exact source line
    // (`let installWholesale = !currentDoc;`) that CAUSED a live cross-family
    // merge, so the correct fix broke the test and the bug was pinned in place.
    // Assert order here; assert outcomes there.
    const body = mergeBody();
    const decryptAt = body.indexOf('decryptToDoc');
    const guardAt = body.indexOf('guardLineage(');
    expect(decryptAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(decryptAt);
  });
});
