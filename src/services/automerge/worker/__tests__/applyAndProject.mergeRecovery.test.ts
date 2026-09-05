// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';

// Partial-mock docOps so we can make ONE `mergeDocs` call throw while keeping
// every other CRDT op real (the harness needs them). This lives in its own file
// because vi.mock is hoisted file-wide.
vi.mock('../docOps', async (importActual) => {
  const actual = await importActual<typeof import('../docOps')>();
  return { ...actual, mergeDocs: vi.fn(actual.mergeDocs) };
});

import {
  mergeDocs,
  migrateDoc,
  saveDoc,
  encryptDocPayload,
  applyMutation,
  decryptToDoc,
} from '../docOps';
import * as cache from '../cache';
import {
  configure,
  setKey,
  initAndLoadCache,
  mutate,
  mergeRemoteEnvelope,
  exportEncryptedPayload,
  __resetApplyAndProjectForTesting,
  type WorkerSink,
} from '../applyAndProject';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const FAMILY_ID = 'aap-merge-recovery';
const base = () => migrateDoc(Automerge.init<FamilyDocument>());
const envelopeFor = async (doc: Automerge.Doc<FamilyDocument>, key: CryptoKey) =>
  ({
    version: '4.0',
    familyId: FAMILY_ID,
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: await encryptDocPayload(doc, key),
  }) as unknown as BeanpodFileV4;

describe('applyAndProject — merge-throw recoverability (clone removal side-effect)', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    __resetApplyAndProjectForTesting();
    cache.__resetCacheForTesting();
    const sink: WorkerSink = { pushChunk() {}, perf() {}, cachePersistFailed() {} };
    configure(sink);
    key = await generateFamilyKey();
  });

  it('a mergeDocs throw rejects the RPC and leaves currentDoc coherent for a later mutate', async () => {
    const originBin = saveDoc(base());
    await cache.initPersistenceDB(FAMILY_ID);
    await cache.persistDocBinary(key, originBin);

    setKey(key);
    await initAndLoadCache(FAMILY_ID); // currentDoc = origin
    mutate({ op: 'set', collection: 'todos', id: 'l1', entity: { id: 'l1' } });

    const remote = applyMutation(Automerge.load<FamilyDocument>(originBin), {
      op: 'set',
      collection: 'todos',
      id: 'r1',
      entity: { id: 'r1' },
    }).doc;

    // The merge throws BEFORE currentDoc is reassigned → currentDoc stays intact.
    vi.mocked(mergeDocs).mockImplementationOnce(() => {
      throw new Error('boom-merge');
    });
    await expect(
      mergeRemoteEnvelope(await envelopeFor(remote, key), FAMILY_ID, {
        kind: 'baseline',
        heads: null,
      })
    ).rejects.toThrow('boom-merge');

    // A later mutate still succeeds against a coherent doc; l1 preserved, r1 never merged.
    const after = mutate({
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 5 },
    });
    expect(after.changed).toBe(true);

    const { payload } = await exportEncryptedPayload();
    const doc = await decryptToDoc(
      { encryptedPayload: payload, familyId: FAMILY_ID } as unknown as BeanpodFileV4,
      key
    );
    expect(Object.keys(doc.todos)).toEqual(['l1']);
    expect(doc.accounts.a1).toEqual({ id: 'a1', balance: 5 });
  });
});
