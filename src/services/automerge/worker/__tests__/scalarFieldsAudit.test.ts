/**
 * #124 R2: the field-classification audit (plan `2026-10-20-scalar-strings-124.md`).
 *
 * The scalar writer (`docValue`) writes a string as a one-op `str` scalar when its field is
 * structural (`SCALAR_FIELDS` or an `Id`/`Ids`/`At` suffix) and as collaborative text when it
 * is prose (`TEXT_FIELDS`). A name in neither is a decision nobody made, so this test fails on
 * every such string leaf in the shared seed (`auditSeed.ts`), naming the file to edit. It walks
 * with the writer's own rule (`classify(key, container)`: own key, else the container's name),
 * so the audit and the writer cannot disagree about a leaf.
 */
import { describe, expect, it } from 'vitest';
import { COLLECTION_NAMES } from '@/types/automerge';
import { SCALAR_FIELDS, TEXT_FIELDS, classify } from '../scalarStrings';
import { walkSeed } from './auditSeed';

/**
 * Collections whose entities are dynamic-keyed maps of strings (`notificationReads`: memberId →
 * (notificationId → readAt)), so the COLLECTION name classifies the values. Every other
 * collection name must stay unclassified: a whole-entity `docValue(collection, entity)` passes
 * it as the container, and a classified name would silently decide every unclassified key.
 */
const DYNAMIC_MAP_COLLECTIONS: ReadonlySet<string> = new Set(['notificationReads']);

interface Leaf {
  label: string;
  field: string;
}

function unclassifiedLeaves(): { leaves: number; bad: Map<string, Leaf> } {
  const bad = new Map<string, Leaf>();
  let leaves = 0;
  walkSeed(({ value, label, key, container }) => {
    if (typeof value !== 'string') return;
    leaves++;
    if (classify(key, container) !== 'unclassified') return;
    // An element (no own key) is decided by its container; name what to classify.
    const field = typeof key === 'string' ? key : (container ?? '?');
    bad.set(label, { label, field });
  });
  return { leaves, bad };
}

describe('scalar-field classification audit (#124 R2)', () => {
  it('walks a non-trivial seed (guards against a silently empty audit)', () => {
    expect(unclassifiedLeaves().leaves).toBeGreaterThan(200);
  });

  it('every string field in the seed is classified as scalar or text', () => {
    const { bad } = unclassifiedLeaves();
    expect(
      [...bad.values()].map(
        ({ label, field }) =>
          `${label}: add '${field}' to SCALAR_FIELDS or TEXT_FIELDS in scalarStrings.ts`
      )
    ).toEqual([]);
  });

  it('SCALAR_FIELDS and TEXT_FIELDS are disjoint', () => {
    expect([...SCALAR_FIELDS].filter((name) => TEXT_FIELDS.has(name))).toEqual([]);
  });

  it('no TEXT_FIELDS name is made scalar by a suffix (the suffix would silently win)', () => {
    expect([...TEXT_FIELDS].filter((name) => classify(name) !== 'text')).toEqual([]);
  });

  it('the prose names the plan pins stay text', () => {
    for (const name of ['title', 'name', 'note', 'notes', 'description', 'diagnosedBy', 'emoji']) {
      expect(classify(name), name).toBe('text');
    }
  });

  it('a collection name is unclassified unless its entities are dynamic maps of strings', () => {
    const classified = COLLECTION_NAMES.filter(
      (name) => !DYNAMIC_MAP_COLLECTIONS.has(name) && classify(name) !== 'unclassified'
    );
    expect(classified).toEqual([]);
    for (const name of DYNAMIC_MAP_COLLECTIONS) expect(classify(name), name).toBe('scalar');
  });
});
