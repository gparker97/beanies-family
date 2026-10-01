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
 * COVERAGE. The audit is only as good as its data. It walks the review-demo
 * fixture (`materializeFixture`, the richest seed) plus a small hand-written
 * SUPPLEMENT for keyless shapes the fixture lacks, plus a representative
 * `settings` singleton. The fixture seeds NOTHING for: photos, favorites,
 * memberNotes, allergies, medicationLogs, recipes, cookLogs, mealPlans,
 * emergencyContacts, notificationReads, calendarConnections, calendarEventLinks,
 * driveConnections, overlapAcknowledgments, listCycles, removedMembers,
 * responsibilityCards, responsibilityMoves, responsibilityCheckIns. The
 * supplement covers listCycles, responsibilityCards and the activity completions
 * only; the rest are NOT audited (their array-of-objects fields, if any, would
 * be missed). Extend the supplement when adding a collection with such a field.
 */
import { describe, it, expect } from 'vitest';
import { materializeFixture } from '@/services/demo/demoFixture';
import { COLLECTION_NAMES } from '@/types/automerge';
import { KEY_FIELDS } from '../reconcile';

type Json = unknown;
const isMap = (v: Json): v is Record<string, Json> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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

/** Keyless shapes the fixture does not seed (see COVERAGE above). */
const SUPPLEMENT: Record<string, Json[]> = {
  listCycles: [
    {
      id: 'cycle-1',
      items: [
        { title: 'Milk', done: true, by: 'm1' },
        { title: 'Eggs', done: false },
      ],
    },
  ],
  responsibilityCards: [
    {
      id: 'card-1',
      parts: [
        { key: 'main', holderId: 'm1' },
        { key: 'a', label: 'upstairs' },
      ],
    },
  ],
  activities: [
    {
      id: 'act-supp',
      dropoffCompletions: [
        { date: '2026-10-01', completedBy: 'm1', completedAt: '2026-10-01T08:00:00Z' },
      ],
      pickupCompletions: [
        { date: '2026-10-01', completedBy: 'm1', completedAt: '2026-10-01T15:00:00Z' },
      ],
    },
  ],
};

/** A representative settings singleton: the fixture seeds none. */
const SETTINGS_SAMPLE = {
  id: 'app_settings',
  baseCurrency: 'USD',
  displayCurrency: 'USD',
  exchangeRates: [
    { from: 'USD', to: 'EUR', rate: 0.9, updatedAt: '2026-10-01T00:00:00.000Z' },
    { from: 'USD', to: 'GBP', rate: 0.8, updatedAt: '2026-10-01T00:00:00.000Z' },
  ],
  aiApiKeys: {},
  preferredCurrencies: ['USD'],
  customInstitutions: ['Example Bank'],
};

interface Finding {
  path: string; // collection.entityId.a.b[]
  label: string; // collection.a.b[] (no entity id) for messages
  field: string;
  elements: Record<string, Json>[];
}

/** Collect every array whose elements are plain objects, recursively. */
function collect(value: Json, label: string, path: string, field: string, out: Finding[]): void {
  if (Array.isArray(value)) {
    const objs = value.filter(isMap);
    if (objs.length > 0) out.push({ path, label, field, elements: objs });
    // Recurse into elements (arrays of objects can hold nested arrays).
    for (const el of value) collect(el, `${label}[]`, `${path}[]`, field, out);
    return;
  }
  if (isMap(value)) {
    for (const [k, v] of Object.entries(value)) {
      collect(v, `${label}.${k}`, `${path}.${k}`, k, out);
    }
  }
}

function seedData(): Record<string, Json> {
  // JSON round-trip == what a materialised Automerge doc looks like.
  const fixture = materializeFixture({
    today: new Date('2026-08-20T09:00:00Z'),
    ownerMemberId: 'owner-member-id',
  });
  const merged: Record<string, Json> = { ...fixture, settings: SETTINGS_SAMPLE };
  for (const [name, extra] of Object.entries(SUPPLEMENT)) {
    merged[name] = [...((merged[name] as Json[] | undefined) ?? []), ...extra];
  }
  return JSON.parse(JSON.stringify(merged));
}

/** Collections the audit walks, with data (fixture or SUPPLEMENT). Keep in step with the header. */
const AUDITED_COLLECTIONS: readonly string[] = [
  'accounts',
  'activities',
  'assets',
  'budgets',
  'familyMembers',
  'goals',
  'listCycles',
  'lists',
  'medications',
  'milestones',
  'recurringItems',
  'responsibilityCards',
  'sayings',
  'todos',
  'transactions',
  'vacations',
];
/** Collections with NO seed data, so NOT audited (the header's list, minus the supplemented). */
const UNAUDITED_COLLECTIONS: readonly string[] = [
  'photos',
  'favorites',
  'memberNotes',
  'allergies',
  'medicationLogs',
  'recipes',
  'cookLogs',
  'mealPlans',
  'emergencyContacts',
  'notificationReads',
  'calendarConnections',
  'calendarEventLinks',
  'driveConnections',
  'overlapAcknowledgments',
  'removedMembers',
  'responsibilityMoves',
  'responsibilityCheckIns',
];

function findings(walked?: Set<string>): Finding[] {
  const data = seedData();
  const out: Finding[] = [];
  for (const name of [...COLLECTION_NAMES, 'settings']) {
    const col = data[name];
    if (name === 'settings') {
      collect(col, 'settings', 'settings', 'settings', out);
      continue;
    }
    if (!Array.isArray(col)) continue; // fixture shape: arrays of entities
    walked?.add(name);
    for (const entity of col) {
      const id = isMap(entity) && typeof entity.id === 'string' ? entity.id : '?';
      collect(entity, name, `${name}.${id}`, name, out);
    }
  }
  return out;
}

describe('keyless array-of-objects audit', () => {
  it('walks a non-trivial seed (guards against a silently empty audit)', () => {
    const f = findings();
    expect(f.length).toBeGreaterThan(5);
  });

  it('walks exactly AUDITED_COLLECTIONS, and AUDITED + UNAUDITED covers every collection', () => {
    const walked = new Set<string>();
    findings(walked);
    expect([...walked].sort()).toEqual([...AUDITED_COLLECTIONS].sort());
    // A new collection must be placed in exactly one list, so skipping it is a decision.
    expect([...AUDITED_COLLECTIONS, ...UNAUDITED_COLLECTIONS].sort()).toEqual(
      [...COLLECTION_NAMES].sort()
    );
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
