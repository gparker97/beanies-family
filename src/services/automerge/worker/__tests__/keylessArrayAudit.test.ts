/**
 * Keyless-array audit (docs/plans/2026-10-01-crdt-merge-safe-writes.md,
 * Assumption 2 and section H; ADR-039).
 *
 * The reconciler (`reconcile.ts`) gives every array-of-objects item an identity:
 * a string `id`, else the `KEY_FIELDS` entry for the field name, else VALUE
 * identity (canonical JSON). Value identity is only safe for immutable value
 * objects; a mutable keyless item would be deleted and re-inserted on every edit
 * and concurrent edits would duplicate it. This test fails when a NEW
 * array-of-objects field appears in the data that has none of the three.
 *
 * COVERAGE. The audit is only as good as its data: the shared seed in `auditSeed.ts` (the
 * review-demo fixture plus a SUPPLEMENT for every collection and shape the fixture lacks, plus a
 * `settings` singleton), which the #124 scalar-field audit walks too. Every collection must have
 * data (pinned below). Extend the SUPPLEMENT when adding a collection with such a field.
 */
import { describe, it, expect } from 'vitest';
import { COLLECTION_NAMES } from '@/types/automerge';
import { KEY_FIELDS } from '../reconcile';
import { isMap, walkSeed, type Json } from './auditSeed';

/**
 * Array-of-object fields keyed by VALUE identity. Entry = field name (the same
 * granularity `KEY_FIELDS` uses) with the reason value identity is acceptable.
 * Do not add a mutable record here: give it an `id` or a `KEY_FIELDS` entry.
 */
const VALUE_IDENTITY_ALLOWLIST: Readonly<Record<string, string>> = {
  'listCycles.items':
    'ListCycleMark: an archived cycle is a history snapshot written whole once; marks are never edited individually.',
  'responsibilityCards.parts':
    'CardPart: the card record is always written whole (a record set), so a part is never patched in place.',
};

interface Finding {
  path: string; // collection.entityId.a.b[]
  label: string; // collection.a.b[] (no entity id) for messages
  field: string;
  elements: Record<string, Json>[];
}

/** Every array whose elements are plain objects, recursively (the shared seed walk). */
function findings(walked?: Set<string>): Finding[] {
  const out: Finding[] = [];
  walkSeed(({ value, label, path, field }) => {
    if (!Array.isArray(value)) return;
    const elements = value.filter(isMap);
    if (elements.length > 0) out.push({ path, label, field, elements });
  }, walked);
  return out;
}

describe('keyless array-of-objects audit', () => {
  it('walks a non-trivial seed (guards against a silently empty audit)', () => {
    const f = findings();
    expect(f.length).toBeGreaterThan(5);
  });

  it('walks every collection (the shared seed has data for each, so none goes unaudited)', () => {
    const walked = new Set<string>();
    findings(walked);
    expect([...walked].sort()).toEqual([...COLLECTION_NAMES].sort());
  });

  it('every array-of-objects field has an id, a KEY_FIELDS entry, or a value-identity allowlist line', () => {
    const bad = new Map<string, string>();
    for (const f of findings()) {
      const hasId = f.elements.every((e) => typeof e.id === 'string');
      if (hasId || f.field in KEY_FIELDS || f.label in VALUE_IDENTITY_ALLOWLIST) continue;
      bad.set(f.label, f.field);
    }
    expect(
      [...bad.entries()].map(
        ([label, field]) =>
          `${label}: array-of-objects field "${field}" has no string \`id\` on its items, ` +
          `no KEY_FIELDS entry (reconcile.ts) and no VALUE_IDENTITY_ALLOWLIST line. ` +
          `Add an \`id\` to the items, a KEY_FIELDS entry, or an allowlist line with a reason.`
      )
    ).toEqual([]);
  });

  it('every KEY_FIELDS key field is a string on the seeded elements (catches a stale table)', () => {
    const seen = new Set<string>();
    for (const f of findings()) {
      const fields = KEY_FIELDS[f.field];
      if (!fields) continue;
      seen.add(f.field);
      for (const el of f.elements) {
        for (const k of fields) {
          expect(typeof el[k], `${f.path} item missing string "${k}" (KEY_FIELDS.${f.field})`).toBe(
            'string'
          );
        }
      }
    }
    // Entries the seed never exercises cannot be checked; they are not failures.
    expect(seen.size).toBeGreaterThan(0);
  });

  it('allowlist has no stale entries (each is still present in the seed)', () => {
    const present = new Set(findings().map((f) => f.label));
    const stale = Object.keys(VALUE_IDENTITY_ALLOWLIST).filter((k) => !present.has(k));
    expect(stale).toEqual([]);
  });
});
