// @vitest-environment node
/**
 * #117 Phase 1: independent merge validation on realistic data, with seeded random concurrency.
 *
 * The implementers' unit tests prove each fix on a minimal fixture. This spec asks the question
 * those cannot: on a REALISTIC family document, written to the way the app writes it, do two
 * devices that edit concurrently always converge, and does every edit either device made
 * survive the merge (apart from the residuals the plan accepts and names)?
 *
 * Plan: `docs/plans/2026-10-01-crdt-merge-safe-writes.md`. ADR-039.
 *
 * ── How writes reach the document ──────────────────────────────────────────────
 *
 * Through the REAL repositories (`createAutomergeRepository`, `saveSettings`, `patchOp`). Only
 * the two main-thread edges are replaced: `docClient.mutate` applies the op with the real
 * worker `applyMutation` to the active device's document, and the projection reads that same
 * document. So every op carries exactly the `base` the app would attach (`pickBase` of the
 * device's own view of the patched keys), and the store-shaped helpers below mirror the store
 * code they name (listStore.toggleItem, vacationStore.toggleVote, activityStore
 * .toggleDutyCompletion, goalsStore contribution append).
 *
 * ── Layers ─────────────────────────────────────────────────────────────────────
 *
 *  1. Scenario merges on the demo family (fixture-only).
 *  2. Seeded chaos: N rounds of 1-4 random writes per device, then converge, with five invariants.
 *  3. Format: save/load round trip; a pre-#117 (`d[name] = {}`) pod is left untouched.
 *  4. Compaction rebase through the real `compactDoc` and `mergeRemoteEnvelope`.
 *  5. Old-build interop: a whole-value writer merged with a reconciling writer (reported).
 *
 * ── Running it ─────────────────────────────────────────────────────────────────
 *
 *   npx vitest run src/services/automerge/__diagnostics__/crdt117Chaos.spec.ts
 *
 * Env:
 *   CRDT_CHAOS_ITERATIONS  chaos rounds (default 40, so the normal suite stays fast; use 300+)
 *   CRDT_CHAOS_SEED        LCG seed (default 117)
 *   BEANPOD_FILE + BEANPOD_PASSWORD  run layers 2-4 against a real pod instead of the demo
 *                          family (as `beanpodProfile.spec.ts`). Layers 1 and 5 use the demo
 *                          family's ids and skip. With a real pod nothing but counts and op
 *                          kinds is printed, and failure messages carry paths, never values.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- a diagnostic that walks arbitrary documents */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as Automerge from '@automerge/automerge';

// ── The two main-thread edges, pointed at the active device's document ─────────
const sim = vi.hoisted(() => ({
  doc: null as unknown,
  notes: [] as Array<{ action: string; kind?: string; count: number }>,
  ops: 0,
}));

vi.mock('@/services/automerge/worker/docClient', () => ({
  mutate: async (op: unknown) => {
    const { applyMutation } = await import('@/services/automerge/worker/docOps');
    const r = applyMutation(sim.doc as never, op as never);
    sim.doc = r.doc;
    sim.notes.push(...r.notes);
    sim.ops++;
    return r.result;
  },
}));

vi.mock('@/services/automerge/projection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/automerge/projection')>();
  const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return {
    ...actual,
    getById: (c: string, id: string) => plain((sim.doc as any)?.[c]?.[id]),
    list: (c: string) => Object.values(plain((sim.doc as any)?.[c] ?? {}) as object),
    getSettings: () => plain((sim.doc as any)?.settings ?? null) ?? null,
  };
});

const { createAutomergeRepository, patchOp } =
  await import('@/services/automerge/automergeRepository');
const { saveSettings } = await import('@/services/automerge/repositories/settingsRepository');
const { mutate } = await import('@/services/automerge/worker/docClient');
const docOps = await import('@/services/automerge/worker/docOps');
const { migrateDoc, applyMutation, saveDoc, loadDoc, countRootConflicts, registerNamedOp } = docOps;
const { buildRebaseOps, getHeads, buildFullProjection } = docOps;
const { attachPhotoNamedHandler } = await import('@/services/automerge/worker/photoOps');
const { KEY_FIELDS, MERGE_FIELDS } = await import('@/services/automerge/worker/reconcile');
const { converge, materialise } = await import('@/services/automerge/worker/__tests__/twoDevices');
const { materializeFixture } = await import('@/services/demo/demoFixture');
const { COLLECTION_NAMES } = await import('@/types/automerge');
const ap = await import('@/services/automerge/worker/applyAndProject');
const { generateFamilyKey, encryptPayload, decryptPayload } =
  await import('@/services/crypto/familyKeyService');
const { bufferToBase64, base64ToBuffer } = await import('@/utils/encoding');

import type { FamilyDocument, CollectionName } from '@/types/automerge';
import type { MutationOp } from '@/services/automerge/worker/protocol';

type Doc = Automerge.Doc<FamilyDocument>;
type Any = Record<string, any>;
interface Device {
  name: string;
  doc: Doc;
}

registerNamedOp('attachPhotoToEntity', attachPhotoNamedHandler);

const FILE = process.env.BEANPOD_FILE;
const PASSWORD = process.env.BEANPOD_PASSWORD;
const REAL_POD = Boolean(FILE && PASSWORD);
const ITERATIONS = Number(process.env.CRDT_CHAOS_ITERATIONS ?? 40);
const SEED = Number(process.env.CRDT_CHAOS_SEED ?? 117);

// Deterministic actors, so a seed replays the same merge tie-breaks (LWW orders by actor).
const ACTOR = { origin: '00'.repeat(16), a: 'aa'.repeat(16), b: 'bb'.repeat(16) };
const OWNER = 'demo-member-owner';
const NOW = '2026-10-01T09:00:00.000Z';

// ── Small utilities ────────────────────────────────────────────────────────────

const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v: unknown): v is Any => v !== null && typeof v === 'object' && !Array.isArray(v);
function canon(v: unknown): string | undefined {
  return JSON.stringify(v, (_k, x) =>
    isObj(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]])
        )
      : x
  );
}

/** Numerical-Recipes LCG: tiny, deterministic, good enough to pick ops. */
function lcg(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: readonly T[]): T | undefined =>
      xs.length ? xs[Math.floor(next() * xs.length)] : undefined,
  };
}
type Rng = ReturnType<typeof lcg>;

const repos = new Map<CollectionName, ReturnType<typeof createAutomergeRepository>>();
const repo = (c: CollectionName) => {
  let r = repos.get(c);
  if (!r) repos.set(c, (r = createAutomergeRepository(c)));
  return r;
};

/** Run `fn` with `dev` as the active device (the worker doc + the projection). Sequential only. */
async function on<T>(dev: Device, fn: () => Promise<T>): Promise<T> {
  sim.doc = dev.doc;
  try {
    return await fn();
  } finally {
    dev.doc = sim.doc as Doc;
  }
}

/** The active device's plain view of an entity (what the store would hold). */
const get = (c: CollectionName, id: string): Any | undefined => plain((sim.doc as any)?.[c]?.[id]);
const ids = (c: CollectionName): string[] => Object.keys((sim.doc as any)?.[c] ?? {});
const settingsNow = (): Any => plain((sim.doc as any)?.settings ?? {}) ?? {};

function fork(origin: Doc): { A: Device; B: Device } {
  return {
    A: { name: 'A', doc: Automerge.clone(origin, { actor: ACTOR.a }) },
    B: { name: 'B', doc: Automerge.clone(origin, { actor: ACTOR.b }) },
  };
}

// ── Store-shaped writes (each mirrors the named store method) ──────────────────

/** listStore.toggleItem (minus `deriveCompletion`'s list-level fields). */
async function toggleListItem(listId: string, itemId: string, by: string) {
  const list = get('lists', listId)!;
  const items = (list.items as Any[]).map((it) => {
    if (it.id !== itemId) return it;
    const completed = !it.completed;
    return {
      ...it,
      completed,
      completedBy: completed ? by : undefined,
      completedAt: completed ? new Date().toISOString() : undefined,
    };
  });
  return repo('lists').update(listId, { items } as never);
}
/** listStore.addItems. */
async function addListItem(listId: string, id: string, title: string) {
  const list = get('lists', listId)!;
  return repo('lists').update(listId, {
    items: [...(list.items as Any[]), { id, title, completed: false }],
  } as never);
}
async function removeListItem(listId: string, itemId: string) {
  const list = get('lists', listId)!;
  return repo('lists').update(listId, {
    items: (list.items as Any[]).filter((i) => i.id !== itemId),
  } as never);
}
async function renameListItem(listId: string, itemId: string, title: string) {
  const list = get('lists', listId)!;
  return repo('lists').update(listId, {
    items: (list.items as Any[]).map((i) => (i.id === itemId ? { ...i, title } : i)),
  } as never);
}
/** vacationStore.toggleVote: remove by key, add one. */
async function toggleVote(vacId: string, ideaId: string, memberId: string) {
  const vac = get('vacations', vacId)!;
  const ideas = (vac.ideas as Any[]).map((idea) => {
    if (idea.id !== ideaId) return idea;
    const votes = (idea.votes ?? []) as Any[];
    const has = votes.some((v) => v.memberId === memberId);
    return {
      ...idea,
      votes: has
        ? votes.filter((v) => v.memberId !== memberId)
        : [...votes, { memberId, votedAt: new Date().toISOString() }],
    };
  });
  return repo('vacations').update(vacId, { ideas } as never);
}
/** activityStore.toggleDutyCompletion. */
async function toggleDuty(actId: string, duty: 'dropoff' | 'pickup', date: string, by: string) {
  const act = get('activities', actId)!;
  const field = duty === 'dropoff' ? 'dropoffCompletions' : 'pickupCompletions';
  const current = (act[field] ?? []) as Any[];
  const next = current.some((c) => c.date === date)
    ? current.filter((c) => c.date !== date)
    : [...current, { date, completedBy: by, completedAt: new Date().toISOString() }];
  return repo('activities').update(actId, { [field]: next } as never);
}
/** goalsStore.updateGoal with a contribution (`appendContributionIfChanged`). */
async function contribute(goalId: string, delta: number, entryId: string, by: string) {
  const goal = get('goals', goalId)!;
  const entry = { id: entryId, amount: delta, at: new Date().toISOString(), updatedBy: by };
  return repo('goals').update(goalId, {
    currentAmount: goal.currentAmount + delta,
    manualContributions: [...(goal.manualContributions ?? []), entry],
  } as never);
}
const increment = (collection: CollectionName, id: string, field: string, delta: number) =>
  mutate({ op: 'increment', collection, id, field, delta, updatedAt: new Date().toISOString() });
const attachPhoto = (entityCollection: string, entityId: string, photoId: string) =>
  mutate({
    op: 'named',
    name: 'attachPhotoToEntity',
    args: { entityCollection, entityId, photoId },
  });
const loanPayment = (loanId: string, paymentAmount: number) =>
  mutate({
    op: 'named',
    name: 'applyLoanPayment',
    args: { loanId, paymentAmount, isRecurring: true },
  });

// ── The base document ──────────────────────────────────────────────────────────

/** Extra entities the demo fixture lacks, so every #117 shape is exercised from an EXISTING array. */
function enrichment(): Array<[CollectionName, Any]> {
  return [
    [
      'goals',
      {
        id: 'chaos-goal-history',
        memberId: null,
        name: 'Treehouse Fund',
        type: 'savings',
        targetAmount: 900,
        currentAmount: 120,
        currency: 'USD',
        priority: 'medium',
        isCompleted: false,
        manualContributions: [
          { id: 'chaos-contrib-0', amount: 120, at: NOW, updatedBy: OWNER, note: 'first beans' },
        ],
      },
    ],
    [
      'activities',
      {
        id: 'chaos-activity-duties',
        title: 'School Run',
        date: '2026-10-05',
        recurrence: 'daily',
        category: 'other_school',
        assigneeIds: ['demo-member-kid-a'],
        dropoffMemberId: OWNER,
        pickupMemberId: 'demo-member-partner',
        feeSchedule: 'none',
        reminderMinutes: 0,
        isActive: true,
        createdBy: OWNER,
        dropoffCompletions: [{ date: '2026-10-04', completedBy: OWNER, completedAt: NOW }],
        pickupCompletions: [],
      },
    ],
    [
      'assets',
      {
        id: 'chaos-asset-house',
        memberId: OWNER,
        type: 'real_estate',
        name: 'Bean Cottage',
        purchaseValue: 300000,
        currentValue: 340000,
        currency: 'USD',
        includeInNetWorth: true,
        loan: {
          hasLoan: true,
          loanAmount: 240000,
          outstandingBalance: 200000,
          interestRate: 4.5,
          monthlyPayment: 1300,
          loanTermMonths: 300,
          lender: 'Beanstalk Bank',
        },
      },
    ],
    [
      'recipes',
      {
        id: 'chaos-recipe-soup',
        name: 'Bean Soup',
        ingredients: ['beans', 'stock', 'salt', 'salt'],
        steps: ['soak the beans', 'simmer'],
      },
    ],
  ];
}

/** Build the base through the real creation path: `createWithId` (`stampNew`) + `saveSettings`. */
async function buildDemoBase(): Promise<Doc> {
  const dev: Device = {
    name: 'origin',
    doc: migrateDoc(Automerge.init<FamilyDocument>({ actor: ACTOR.origin })),
  };
  await on(dev, async () => {
    await repo('familyMembers').createWithId(OWNER, {
      name: 'Greg',
      email: 'owner@example.invalid',
      gender: 'male',
      ageGroup: 'adult',
      role: 'owner',
      color: '#F15D22',
      requiresPassword: true,
    } as never);
    const fixture = materializeFixture({ today: new Date(NOW), ownerMemberId: OWNER });
    for (const [col, items] of Object.entries(fixture)) {
      for (const e of items as Any[]) {
        const { id, createdAt: _c, updatedAt: _u, ...input } = e;
        await repo(col as CollectionName).createWithId(id, input as never);
      }
    }
    for (const [col, e] of enrichment()) {
      const { id, ...input } = e;
      await repo(col).createWithId(id, input as never);
    }
    await saveSettings({
      baseCurrency: 'USD',
      exchangeRates: [
        { from: 'USD', to: 'EUR', rate: 0.92, updatedAt: NOW },
        { from: 'USD', to: 'GBP', rate: 0.79, updatedAt: NOW },
      ],
      customInstitutions: ['Beanstalk Bank'],
      preferredCurrencies: ['USD', 'EUR'],
      aiApiKeys: { claude: 'test-not-a-real-key' },
    } as never);
  });
  return dev.doc;
}

async function loadRealPod(): Promise<Doc> {
  const { parseBeanpodV4, tryUnwrapFamilyKey } = await import('@/services/sync/fileSync');
  const envelope = parseBeanpodV4(readFileSync(FILE as string, 'utf8'));
  const { familyKey } = await tryUnwrapFamilyKey(envelope, PASSWORD as string);
  const binary = await decryptPayload(
    familyKey,
    new Uint8Array(base64ToBuffer(envelope.encryptedPayload))
  );
  const loaded = Automerge.load<FamilyDocument>(binary, { actor: ACTOR.origin });
  return migrateDoc(loaded);
}

// ── Shape extraction: nodes (entities + keyed elements) and leaves (scalars) ───

interface Meta {
  ancestors: string[]; // node paths, including the node that owns this leaf/node
  containers: string[]; // array / merge-map containers on the way down
}
interface Shape {
  nodes: Map<string, Meta>;
  dups: Set<string>;
  leaves: Map<string, string | undefined>;
  leafMeta: Map<string, Meta>;
  containers: Set<string>;
}

/** The reconciler's identity rule (`keyOf`): a string `id`, else the `KEY_FIELDS` entry. */
function elementKey(field: string, el: unknown): string | null {
  if (!isObj(el)) return null;
  if (typeof el.id === 'string') return `id:${el.id}`;
  const fields = KEY_FIELDS[field];
  if (fields && fields.every((f) => typeof el[f] === 'string'))
    return `k:${fields.map((f) => el[f]).join('|')}`;
  return null;
}

function shapeOf(doc: Doc): Shape {
  const s: Shape = {
    nodes: new Map(),
    dups: new Set(),
    leaves: new Map(),
    leafMeta: new Map(),
    containers: new Set(),
  };
  const root = Automerge.toJS(doc) as Any;
  const addNode = (p: string, meta: Meta) => {
    if (s.nodes.has(p)) s.dups.add(p);
    s.nodes.set(p, meta);
  };
  const walk = (o: Any, node: string, anc: string[], conts: string[], prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const leaf = `${node}#${prefix}${k}`;
      if (Array.isArray(v)) {
        const cont = leaf;
        s.containers.add(cont);
        const cs = [...conts, cont];
        const keys = v.map((el) => elementKey(k, el));
        if (v.length && keys.every((x) => x !== null)) {
          v.forEach((el, i) => {
            const p = `${node}/${prefix}${k}[${keys[i]}]`;
            addNode(p, { ancestors: [...anc, p], containers: cs });
            walk(el, p, [...anc, p], cs, '');
          });
        } else if (v.every((el) => el === null || typeof el !== 'object')) {
          const seen = new Map<string, number>();
          for (const el of v) {
            const j = canon(el)!;
            const n = seen.get(j) ?? 0;
            seen.set(j, n + 1);
            const p = `${node}/${prefix}${k}=${j}#${n}`;
            addNode(p, { ancestors: [...anc, p], containers: cs });
          }
        } else {
          // A keyless array of objects is a value (value identity in the reconciler).
          s.leaves.set(leaf, canon(v));
          s.leafMeta.set(leaf, { ancestors: anc, containers: conts });
        }
      } else if (isObj(v) && MERGE_FIELDS.has(k)) {
        const cont = leaf;
        s.containers.add(cont);
        walk(v, node, anc, [...conts, cont], `${prefix}${k}.`);
      } else {
        s.leaves.set(leaf, canon(v));
        s.leafMeta.set(leaf, { ancestors: anc, containers: conts });
      }
    }
  };
  for (const col of COLLECTION_NAMES) {
    for (const [id, e] of Object.entries((root[col] ?? {}) as Any)) {
      const p = `${col}/${id}`;
      addNode(p, { ancestors: [p], containers: [] });
      if (isObj(e)) walk(e, p, [p], [], '');
    }
  }
  if (isObj(root.settings)) {
    addNode('settings', { ancestors: ['settings'], containers: [] });
    walk(root.settings, 'settings', ['settings'], [], '');
  }
  return s;
}

function findUndefined(v: unknown, path = ''): string | null {
  if (v === undefined) return path || '<root>';
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findUndefined(v[i], `${path}[${i}]`);
      if (r) return r;
    }
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      const r = findUndefined(x, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

type Tally = Map<string, number>;
const bump = (t: Tally, k: string, n = 1) => t.set(k, (t.get(k) ?? 0) + n);
const fieldOf = (leaf: string) => leaf.slice(leaf.lastIndexOf('#') + 1).replace(/^.*\./, '');

/**
 * The merge invariants. (ii) union survival and (iii) one-sided scalar, with every accepted
 * residual classified explicitly into `residuals` instead of being silently excused.
 */
function checkMerge(originDoc: Doc, aDoc: Doc, bDoc: Doc, mDoc: Doc, residuals: Tally): string[] {
  const O = shapeOf(originDoc);
  const A = shapeOf(aDoc);
  const B = shapeOf(bDoc);
  const M = shapeOf(mDoc);
  const fails: string[] = [];
  const removedBy = (S: Shape, p: string) => O.nodes.has(p) && !S.nodes.has(p);
  const firstCreated = (conts: string[]) =>
    conts.some((c) => !O.containers.has(c) && A.containers.has(c) && B.containers.has(c));

  // (ii) union survival
  for (const [S, X, name] of [
    [A, B, 'A'],
    [B, A, 'B'],
  ] as const) {
    for (const [p, meta] of S.nodes) {
      if (M.nodes.has(p)) continue;
      if (removedBy(X, p)) continue; // the other device removed it: an expected removal
      if (meta.ancestors.some((x) => removedBy(X, x))) {
        bump(residuals, 'update-vs-remove (node lost with its removed parent)');
        continue;
      }
      if (firstCreated(meta.containers)) {
        bump(residuals, `first-creation (${p.split('/')[0]} ${fieldOf(meta.containers.at(-1)!)})`);
        continue;
      }
      fails.push(`(ii) ${name} held ${p}; the merged doc lost it`);
    }
  }
  for (const p of O.nodes.keys()) {
    if ((!A.nodes.has(p) || !B.nodes.has(p)) && M.nodes.has(p))
      bump(residuals, `observed: removed node resurrected (${p.split('/')[0]})`);
  }

  // (iii) a scalar changed on exactly one side keeps that side's value
  const leafKeys = new Set([...O.leaves.keys(), ...A.leaves.keys(), ...B.leaves.keys()]);
  for (const l of leafKeys) {
    const o = O.leaves.get(l);
    const a = A.leaves.get(l);
    const b = B.leaves.get(l);
    if (a === o && b === o) continue;
    const meta = A.leafMeta.get(l) ?? B.leafMeta.get(l) ?? O.leafMeta.get(l)!;
    if (meta.ancestors.some((x) => M.dups.has(x) || A.dups.has(x) || B.dups.has(x))) {
      bump(residuals, 'semantic-key duplicate (leaf owner duplicated)');
      continue;
    }
    const removedA = meta.ancestors.some((x) => removedBy(A, x));
    const removedB = meta.ancestors.some((x) => removedBy(B, x));
    if (removedA || removedB) {
      if ((removedA && b !== o) || (removedB && a !== o))
        bump(residuals, 'update-vs-remove (field edit on a removed item)');
      continue;
    }
    if (firstCreated(meta.containers)) {
      bump(residuals, `first-creation (${fieldOf(meta.containers.at(-1)!)})`);
      continue;
    }
    const m = M.leaves.get(l);
    if (a !== o && b !== o) {
      if (a === b) {
        if (m !== a) fails.push(`(iii) both sides wrote the same value at ${l}; merged differs`);
      } else {
        bump(residuals, `same-scalar both sides (${fieldOf(l)})`);
        if (m !== a && m !== b) fails.push(`(iii) ${l}: merged value is neither side's`);
      }
      continue;
    }
    const [side, want] = a !== o ? ['A', a] : ['B', b];
    if (m !== want) fails.push(`(iii) ${side} alone changed ${l}; merged does not hold its value`);
  }

  // (iv) no undefined anywhere in the materialised document
  const u = findUndefined(Automerge.toJS(mDoc));
  if (u) fails.push(`(iv) undefined at ${u}`);
  // root conflicts
  const rc = countRootConflicts(mDoc);
  if (rc !== 0) fails.push(`root conflicts: ${rc}`);
  return fails;
}

const redact = (msg: string) =>
  REAL_POD ? msg.replace(/\/[^/#[\]=]+/g, '/<id>').replace(/=[^#]*#/g, '=<v>#') : msg;

// ── Chaos op generators ────────────────────────────────────────────────────────

const SCALAR_COLLECTIONS: CollectionName[] = [
  'todos',
  'accounts',
  'transactions',
  'goals',
  'familyMembers',
  'medications',
  'sayings',
  'milestones',
  'recurringItems',
  'assets',
  'activities',
  'lists',
  'budgets',
  'vacations',
  'recipes',
];
const SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash']);
const DATES = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
const CATS = ['groceries', 'dining_out', 'utilities', 'streaming', 'clothing', 'gas', 'coffee'];
const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD'];
const INSTS = ['Beanstalk Bank', 'Pod Credit Union', 'Sprout Savings', 'Jar & Co'];
const AI = ['claude', 'openai', 'gemini'];

type Gen = (rng: Rng, mint: (p: string) => string) => Promise<string | null>;
const members = () => ids('familyMembers');

const GENS: Record<string, Gen> = {
  async scalarPatch(rng) {
    const col = rng.pick(SCALAR_COLLECTIONS.filter((c) => ids(c).length))!;
    const id = rng.pick(ids(col))!;
    const e = get(col, id)!;
    const keys = Object.keys(e).filter(
      (k) => !SKIP_FIELDS.has(k) && ['string', 'number', 'boolean'].includes(typeof e[k])
    );
    const k = rng.pick(keys);
    if (!k) return null;
    const v = e[k];
    const next =
      typeof v === 'string'
        ? `${v.slice(0, 40)}~${rng.int(1000)}`
        : typeof v === 'number'
          ? v + 1 + rng.int(50)
          : !v;
    await repo(col).update(id, { [k]: next } as never);
    return `scalarPatch ${col}.${k}`;
  },
  async listToggle(rng) {
    const listId = rng.pick(ids('lists').filter((l) => (get('lists', l)!.items ?? []).length));
    if (!listId) return null;
    const item = rng.pick(get('lists', listId)!.items as Any[])!;
    await toggleListItem(listId, item.id, rng.pick(members())!);
    return 'listToggle';
  },
  async listAdd(rng, mint) {
    const listId = rng.pick(ids('lists'));
    if (!listId) return null;
    await addListItem(listId, mint('item'), `thing ${rng.int(100)}`);
    return 'listAdd';
  },
  async listRemove(rng) {
    const listId = rng.pick(ids('lists').filter((l) => (get('lists', l)!.items ?? []).length));
    if (!listId) return null;
    await removeListItem(listId, rng.pick(get('lists', listId)!.items as Any[])!.id);
    return 'listRemove';
  },
  async listRename(rng) {
    const listId = rng.pick(ids('lists').filter((l) => (get('lists', l)!.items ?? []).length));
    if (!listId) return null;
    const item = rng.pick(get('lists', listId)!.items as Any[])!;
    await renameListItem(listId, item.id, `${item.title}*`);
    return 'listRename';
  },
  /** Two queued toggles built from ONE snapshot, applied in order on this device. */
  async listStaleDoubleTick(rng) {
    const listId = rng.pick(ids('lists').filter((l) => (get('lists', l)!.items ?? []).length >= 2));
    if (!listId) return null;
    const snap = get('lists', listId)!;
    const [x, y] = [...(snap.items as Any[])].sort(() => rng.next() - 0.5);
    const by = rng.pick(members())!;
    for (const target of [x!, y!]) {
      const items = (snap.items as Any[]).map((it) =>
        it.id === target.id
          ? { ...it, completed: !it.completed, completedBy: !it.completed ? by : undefined }
          : it
      );
      await mutate(
        patchOp('lists', listId, plain({ items }), {
          updatedAt: new Date().toISOString(),
          onMissing: 'skip',
          current: snap,
        })
      );
    }
    return 'listStaleDoubleTick';
  },
  async vote(rng) {
    const vacId = rng.pick(
      ids('vacations').filter((v) => (get('vacations', v)!.ideas ?? []).length)
    );
    if (!vacId) return null;
    const idea = rng.pick(get('vacations', vacId)!.ideas as Any[])!;
    await toggleVote(vacId, idea.id, rng.pick(members())!);
    return 'vote';
  },
  async duty(rng) {
    const actId = rng.pick(ids('activities'));
    if (!actId) return null;
    await toggleDuty(
      actId,
      rng.next() < 0.5 ? 'dropoff' : 'pickup',
      rng.pick(DATES)!,
      rng.pick(members())!
    );
    return 'duty';
  },
  async contribution(rng, mint) {
    const goalId = rng.pick(ids('goals'));
    if (!goalId) return null;
    await contribute(goalId, 5 + rng.int(100), mint('contrib'), rng.pick(members())!);
    return 'contribution';
  },
  async budgetCategory(rng) {
    const budgetId = rng.pick(ids('budgets'));
    if (!budgetId) return null;
    const cats = (get('budgets', budgetId)!.categories ?? []) as Any[];
    const r = rng.next();
    let next: Any[];
    if (r < 0.34) {
      const missing = CATS.filter((c) => !cats.some((x) => x.categoryId === c));
      const c = rng.pick(missing);
      if (!c) return null;
      next = [...cats, { categoryId: c, amount: 10 + rng.int(200) }];
    } else if (r < 0.67 && cats.length) {
      const drop = rng.pick(cats)!.categoryId;
      next = cats.filter((x) => x.categoryId !== drop);
    } else if (cats.length) {
      const c = rng.pick(cats)!.categoryId;
      next = cats.map((x) =>
        x.categoryId === c ? { ...x, amount: x.amount + 1 + rng.int(20) } : x
      );
    } else return null;
    await repo('budgets').update(budgetId, { categories: next } as never);
    return 'budgetCategory';
  },
  async balanceIncrement(rng) {
    const acc = rng.pick(ids('accounts'));
    if (!acc) return null;
    await increment('accounts', acc, 'balance', rng.int(200) - 100);
    return 'balanceIncrement';
  },
  async photoAttach(rng, mint) {
    const col = rng.pick(
      (['milestones', 'medications', 'activities', 'recipes'] as const).filter((c) => ids(c).length)
    );
    if (!col) return null;
    await attachPhoto(col, rng.pick(ids(col))!, mint('photo'));
    return `photoAttach ${col}`;
  },
  async loanPayment(rng) {
    const assetId = rng.pick(ids('assets').filter((a) => get('assets', a)!.loan?.hasLoan));
    if (!assetId) return null;
    await loanPayment(assetId, 1000 + rng.int(500));
    return 'loanPayment';
  },
  async loanEdit(rng) {
    const assetId = rng.pick(ids('assets').filter((a) => get('assets', a)!.loan?.hasLoan));
    if (!assetId) return null;
    const loan = get('assets', assetId)!.loan;
    const k = rng.pick(['interestRate', 'monthlyPayment', 'lender'] as const)!;
    const v = k === 'lender' ? `Lender ${rng.int(9)}` : (loan[k] ?? 0) + 1;
    await repo('assets').update(assetId, { loan: { ...loan, [k]: v } } as never);
    return `loanEdit ${k}`;
  },
  async rates(rng) {
    const rates = (settingsNow().exchangeRates ?? []) as Any[];
    const r = rng.next();
    let next: Any[];
    if (r < 0.4) {
      const to = rng.pick(
        CCY.filter((c) => c !== 'USD' && !rates.some((x) => x.from === 'USD' && x.to === c))
      );
      if (!to) return null;
      next = [
        ...rates,
        {
          from: 'USD',
          to,
          rate: +(0.5 + rng.next()).toFixed(3),
          updatedAt: new Date().toISOString(),
        },
      ];
    } else if (r < 0.7 && rates.length) {
      const drop = rng.pick(rates)!;
      next = rates.filter((x) => x !== drop);
    } else if (rates.length) {
      const hit = rng.pick(rates)!;
      next = rates.map((x) => (x === hit ? { ...x, rate: +(x.rate + 0.01).toFixed(3) } : x));
    } else return null;
    await saveSettings({ exchangeRates: next } as never);
    return 'rates';
  },
  async institutions(rng) {
    const cur = (settingsNow().customInstitutions ?? []) as string[];
    const add = rng.pick(INSTS.filter((i) => !cur.includes(i)));
    const next = add && rng.next() < 0.6 ? [...cur, add] : cur.filter((i) => i !== rng.pick(cur));
    await saveSettings({ customInstitutions: next } as never);
    return 'institutions';
  },
  async preferredCurrencies(rng) {
    const cur = (settingsNow().preferredCurrencies ?? []) as string[];
    const add = rng.pick(CCY.filter((i) => !cur.includes(i)));
    const next = add && rng.next() < 0.6 ? [...cur, add] : cur.filter((i) => i !== rng.pick(cur));
    await saveSettings({ preferredCurrencies: next } as never);
    return 'preferredCurrencies';
  },
  async aiKeys(rng) {
    const cur = { ...((settingsNow().aiApiKeys ?? {}) as Any) };
    const k = rng.pick(AI)!;
    if (cur[k] && rng.next() < 0.5) delete cur[k];
    else cur[k] = `test-key-${rng.int(1e6)}`;
    await saveSettings({ aiApiKeys: cur } as never);
    return 'aiKeys';
  },
  async todoCreate(rng, mint) {
    const id = mint('todo');
    await repo('todos').createWithId(id, {
      title: `chaos todo ${rng.int(1000)}`,
      assigneeIds: [rng.pick(members())!],
      completed: false,
      createdBy: rng.pick(members())!,
    } as never);
    return 'todoCreate';
  },
  async todoDelete(rng) {
    const id = rng.pick(ids('todos'));
    if (!id) return null;
    await repo('todos').remove(id);
    return 'todoDelete';
  },
};
const GEN_NAMES = Object.keys(GENS);

// ── The suite ──────────────────────────────────────────────────────────────────

let BASE: Doc;
beforeAll(async () => {
  BASE = REAL_POD ? await loadRealPod() : await buildDemoBase();
}, 120_000);

/** Fork, write on both (each its own ops), converge, run the invariants, return the merged pair. */
async function scenario(
  writeA: () => Promise<unknown>,
  writeB: () => Promise<unknown>,
  origin: Doc = BASE
) {
  const { A, B } = fork(origin);
  const notesBefore = sim.notes.length;
  await on(A, writeA);
  await on(B, writeB);
  const merged = converge(A.doc, B.doc);
  const residuals: Tally = new Map();
  const fails = checkMerge(origin, A.doc, B.doc, merged.a, residuals);
  const notes = sim.notes.slice(notesBefore);
  expect(notes.filter((n) => n.action === 'reconcile_verify_failed')).toEqual([]);
  expect(countRootConflicts(merged.a)).toBe(0);
  return { A, B, merged, m: Automerge.toJS(merged.a) as Any, fails, residuals, notes };
}

const LIST = 'demo-list-groceries';
const VAC = 'demo-vacation-seaside';
const IDEA = 'demo-idea-aquarium';
const PARTNER = 'demo-member-partner';
const KID = 'demo-member-kid-a';
const itemOf = (m: Any, id: string) => (m.lists[LIST].items as Any[]).find((i) => i.id === id);
const report: string[] = [];

describe.skipIf(REAL_POD)('layer 1: scenario merges on the demo family', () => {
  it('the base was built through createWithId: photo hosts born with photoIds: []', () => {
    const m = Automerge.toJS(BASE) as Any;
    expect(m.milestones['demo-milestone-1'].photoIds).toEqual([]);
    expect(m.recipes['chaos-recipe-soup'].photoIds).toEqual([]);
    expect(Object.keys(m.transactions)).toHaveLength(30);
    expect(countRootConflicts(BASE)).toBe(0);
  });

  it('list: tick on A + add on B', async () => {
    const r = await scenario(
      () => toggleListItem(LIST, 'demo-list-item-3', OWNER),
      () => addListItem(LIST, 'chaos-item-new', 'Eggs')
    );
    expect(itemOf(r.m, 'demo-list-item-3')?.completed).toBe(true);
    expect(itemOf(r.m, 'chaos-item-new')?.title).toBe('Eggs');
    expect(r.m.lists[LIST].items).toHaveLength(6);
    expect(r.fails).toEqual([]);
  });

  it('list: two devices tick different items of the same list from the identical base', async () => {
    const r = await scenario(
      () => toggleListItem(LIST, 'demo-list-item-3', OWNER),
      () => toggleListItem(LIST, 'demo-list-item-4', PARTNER)
    );
    expect(itemOf(r.m, 'demo-list-item-3')).toMatchObject({ completed: true, completedBy: OWNER });
    expect(itemOf(r.m, 'demo-list-item-4')).toMatchObject({
      completed: true,
      completedBy: PARTNER,
    });
    expect(r.fails).toEqual([]);
  });

  it('list: ONE device, two queued ticks built from the same stale snapshot (Law 3)', async () => {
    const dev: Device = { name: 'solo', doc: Automerge.clone(BASE, { actor: ACTOR.a }) };
    await on(dev, async () => {
      const snap = get('lists', LIST)!;
      for (const id of ['demo-list-item-3', 'demo-list-item-5']) {
        const items = (snap.items as Any[]).map((it) =>
          it.id === id ? { ...it, completed: true } : it
        );
        await mutate(patchOp('lists', LIST, { items }, { current: snap, onMissing: 'skip' }));
      }
    });
    const m = Automerge.toJS(dev.doc) as Any;
    expect(itemOf(m, 'demo-list-item-3')?.completed).toBe(true);
    expect(itemOf(m, 'demo-list-item-5')?.completed).toBe(true);
  });

  it('vote: two different members on one idea', async () => {
    const r = await scenario(
      () => toggleVote(VAC, IDEA, OWNER),
      () => toggleVote(VAC, IDEA, KID)
    );
    const votes = (r.m.vacations[VAC].ideas as Any[]).find((i) => i.id === IDEA)?.votes as Any[];
    expect(votes.map((v) => v.memberId).sort()).toEqual([KID, OWNER].sort());
    expect(r.fails).toEqual([]);
  });

  it('vote: same member on both devices, then un-vote on one: both copies gone', async () => {
    const r = await scenario(
      () => toggleVote(VAC, IDEA, OWNER),
      () => toggleVote(VAC, IDEA, OWNER)
    );
    const votesOf = (m: Any) =>
      ((m.vacations[VAC].ideas as Any[]).find((i) => i.id === IDEA)?.votes as Any[]).filter(
        (v) => v.memberId === OWNER
      );
    const dupCount = votesOf(r.m).length;
    report.push(
      `vote dup after concurrent same-member vote: ${dupCount} copies (residual: semantic-key duplicate)`
    );
    expect(dupCount).toBeGreaterThanOrEqual(1);
    const A = r.merged.a;
    const dev: Device = { name: 'A', doc: A };
    await on(dev, () => toggleVote(VAC, IDEA, OWNER));
    const again = converge(dev.doc, r.merged.b);
    expect(votesOf(Automerge.toJS(again.a) as Any)).toEqual([]);
    expect(votesOf(Automerge.toJS(again.b) as Any)).toEqual([]);
  });

  it('photo attach x2 on a recipe and a milestone (named attachPhotoToEntity)', async () => {
    const r = await scenario(
      async () => {
        await attachPhoto('recipes', 'chaos-recipe-soup', 'photo-a1');
        await attachPhoto('milestones', 'demo-milestone-1', 'photo-a2');
      },
      async () => {
        await attachPhoto('recipes', 'chaos-recipe-soup', 'photo-b1');
        await attachPhoto('milestones', 'demo-milestone-1', 'photo-b2');
      }
    );
    expect([...r.m.recipes['chaos-recipe-soup'].photoIds].sort()).toEqual(['photo-a1', 'photo-b1']);
    expect([...r.m.milestones['demo-milestone-1'].photoIds].sort()).toEqual([
      'photo-a2',
      'photo-b2',
    ]);
    expect(r.fails).toEqual([]);
  });

  it('duty: tick on two dates (existing completions array)', async () => {
    const r = await scenario(
      () => toggleDuty('chaos-activity-duties', 'dropoff', '2026-10-05', OWNER),
      () => toggleDuty('chaos-activity-duties', 'dropoff', '2026-10-06', PARTNER)
    );
    const dates = (r.m.activities['chaos-activity-duties'].dropoffCompletions as Any[]).map(
      (c) => c.date
    );
    expect(dates.sort()).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(r.fails).toEqual([]);
  });

  it('duty: tick on two dates where NO completions array exists yet (first-creation residual)', async () => {
    const r = await scenario(
      () => toggleDuty('demo-activity-1', 'pickup', '2026-10-05', OWNER),
      () => toggleDuty('demo-activity-1', 'pickup', '2026-10-06', PARTNER)
    );
    const dates = ((r.m.activities['demo-activity-1'].pickupCompletions ?? []) as Any[]).map(
      (c) => c.date
    );
    report.push(
      `duty first-creation (no array in base): merged dates = [${dates.join(', ')}] (documented residual: one lost)`
    );
    expect(dates.length).toBeGreaterThanOrEqual(1);
    expect(r.fails).toEqual([]); // the loss is classified as first-creation, not a failure
  });

  it('goal: contribution on both devices keeps both history entries', async () => {
    const r = await scenario(
      () => contribute('chaos-goal-history', 30, 'contrib-a', OWNER),
      () => contribute('chaos-goal-history', 50, 'contrib-b', PARTNER)
    );
    const g = r.m.goals['chaos-goal-history'];
    expect((g.manualContributions as Any[]).map((c) => c.id).sort()).toEqual(
      ['chaos-contrib-0', 'contrib-a', 'contrib-b'].sort()
    );
    report.push(
      `goal both-side contribution: currentAmount=${g.currentAmount} (sum of history = ${(g.manualContributions as Any[]).reduce((s, c) => s + c.amount, 0)}; Phase 2 residual)`
    );
    expect(r.fails).toEqual([]);
  });

  it('loan: field edit on A vs applyLoanPayment on B', async () => {
    const r = await scenario(
      async () => {
        const loan = get('assets', 'chaos-asset-house')!.loan;
        await repo('assets').update('chaos-asset-house', {
          loan: { ...loan, interestRate: 3.9 },
        } as never);
      },
      () => loanPayment('chaos-asset-house', 1300)
    );
    const loan = r.m.assets['chaos-asset-house'].loan;
    expect(loan.interestRate).toBe(3.9);
    expect(loan.outstandingBalance).toBeLessThan(200000);
    expect(r.fails).toEqual([]);
  });

  it('account: modal-shaped name edit on A vs balance increment on B', async () => {
    const r = await scenario(
      () => repo('accounts').update('demo-account-current', { name: 'Everyday Beans' } as never),
      () => increment('accounts', 'demo-account-current', 'balance', -40)
    );
    const acc = r.m.accounts['demo-account-current'];
    expect(acc.name).toBe('Everyday Beans');
    expect(acc.balance).toBeCloseTo(3200.55, 2);
    expect(r.fails).toEqual([]);
  });

  it('settings: rate add on both devices (patchSettings with base)', async () => {
    const add = (to: string, rate: number) => async () => {
      const rates = settingsNow().exchangeRates as Any[];
      await saveSettings({
        exchangeRates: [...rates, { from: 'USD', to, rate, updatedAt: NOW }],
      } as never);
    };
    const r = await scenario(add('JPY', 149), add('SGD', 1.29));
    const pairs = (r.m.settings.exchangeRates as Any[]).map((x) => x.to).sort();
    expect(pairs).toEqual(['EUR', 'GBP', 'JPY', 'SGD']);
    expect(r.fails).toEqual([]);
  });

  it('settings: rate removal on A vs addition on B', async () => {
    const r = await scenario(
      async () => {
        const rates = settingsNow().exchangeRates as Any[];
        await saveSettings({ exchangeRates: rates.filter((x) => x.to !== 'GBP') } as never);
      },
      async () => {
        const rates = settingsNow().exchangeRates as Any[];
        await saveSettings({
          exchangeRates: [...rates, { from: 'USD', to: 'AUD', rate: 1.5, updatedAt: NOW }],
        } as never);
      }
    );
    expect((r.m.settings.exchangeRates as Any[]).map((x) => x.to).sort()).toEqual(['AUD', 'EUR']);
    expect(r.fails).toEqual([]);
  });
});

describe('layer 2: seeded chaos', () => {
  it(`${ITERATIONS} rounds, seed ${SEED}: converge, union survival, one-sided scalars, no undefined, no verify failure`, async () => {
    const rng = lcg(SEED);
    const t0 = performance.now();
    let { A, B } = fork(BASE);
    let origin = BASE;
    let counter = 0;
    const residuals: Tally = new Map();
    const opTally: Tally = new Map();
    const failures: string[] = [];
    const notesStart = sim.notes.length;
    let totalOps = 0;
    for (let it = 0; it < ITERATIONS; it++) {
      const mint = (p: string) => `chaos-${p}-${it}-${counter++}`;
      const log: Record<string, string[]> = { A: [], B: [] };
      for (const dev of [A, B]) {
        const n = 1 + rng.int(4);
        for (let k = 0; k < n; k++) {
          let done: string | null = null;
          for (let tries = 0; tries < 6 && !done; tries++) {
            const g = rng.pick(GEN_NAMES)!;
            done = await on(dev, () => GENS[g]!(rng, mint));
          }
          if (done) {
            log[dev.name]!.push(done);
            bump(opTally, done.split(' ')[0]!);
            totalOps++;
          }
        }
      }
      const verifyFails = sim.notes
        .slice(notesStart)
        .filter((n) => n.action === 'reconcile_verify_failed');
      let merged: { a: Doc; b: Doc };
      try {
        merged = converge(A.doc, B.doc);
      } catch (e) {
        failures.push(
          `it ${it}: (i) did not converge: ${(e as Error).message.slice(0, 200)} | A=${log.A} B=${log.B}`
        );
        break;
      }
      const fails = checkMerge(origin, A.doc, B.doc, merged.a, residuals);
      if (verifyFails.length) fails.push(`(v) reconcile_verify_failed x${verifyFails.length}`);
      for (const f of fails)
        failures.push(
          redact(`seed ${SEED} it ${it}: ${f} | A=[${log.A.join(', ')}] B=[${log.B.join(', ')}]`)
        );
      A = { name: 'A', doc: merged.a };
      B = { name: 'B', doc: merged.b };
      origin = merged.a;
    }
    const ms = Math.round(performance.now() - t0);
    const notes: Tally = new Map();
    for (const n of sim.notes.slice(notesStart))
      bump(notes, `${n.action}${n.kind ? ` @${n.kind}` : ''}`, n.count);
    const fmt = (t: Tally) =>
      [...t]
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => `    ${v.toString().padStart(5)}  ${k}`)
        .join('\n') || '    (none)';
    process.stdout.write(
      [
        '',
        `── crdt117 chaos: seed ${SEED}, ${ITERATIONS} rounds, ${totalOps} writes, ${ms}ms (${REAL_POD ? 'real pod' : 'demo family'})`,
        '  writes by kind:',
        fmt(opTally),
        '  reconciler notes (action @ scope):',
        fmt(notes),
        '  classified residuals (excluded from (ii)/(iii), by design):',
        fmt(residuals),
        `  failures: ${failures.length}`,
        ...failures.slice(0, 15).map((f) => `    ${f}`),
        '',
      ].join('\n')
    );
    expect(failures).toEqual([]);
  }, 600_000);
});

describe('layer 3: format and round trip', () => {
  it('saveDoc -> loadDoc of a merged document equals its materialisation and heads', async () => {
    const r = await scenario(
      () =>
        REAL_POD ? GENS.rates!(lcg(1), (p) => p) : toggleListItem(LIST, 'demo-list-item-3', OWNER),
      () => (REAL_POD ? GENS.aiKeys!(lcg(2), (p) => p) : addListItem(LIST, 'chaos-rt', 'Rice'))
    );
    const loaded = loadDoc(saveDoc(r.merged.a));
    expect(materialise(loaded)).toEqual(materialise(r.merged.a));
    expect([...getHeads(loaded)].sort()).toEqual([...getHeads(r.merged.a)].sort());
  });

  it('a pre-#117 pod (collections created as d[name] = {} by a random actor) is left untouched', () => {
    const old = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      for (const name of COLLECTION_NAMES) (d as Any)[name] = {};
      (d as Any).settings = { id: 'app_settings', baseCurrency: 'USD', exchangeRates: [] };
      (d as Any).todos.t1 = { id: 't1', title: 'old pod todo', completed: false };
    });
    const loaded = loadDoc(saveDoc(old));
    expect([...getHeads(loaded)].sort()).toEqual([...getHeads(old)].sort());
    expect(Automerge.toJS(loaded)).toEqual(Automerge.toJS(old));
    expect(migrateDoc(loaded)).toBe(loaded); // nothing missing: same handle
    expect(countRootConflicts(loaded)).toBe(0);
  });

  it('a pod MISSING collections: two devices migrate it to the same heads, and merge without root conflict', () => {
    const old = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      for (const name of COLLECTION_NAMES.filter((n) => n !== 'recipes' && n !== 'sayings'))
        (d as Any)[name] = {};
    });
    const a = loadDoc(saveDoc(old));
    const b = loadDoc(saveDoc(old));
    expect([...getHeads(a)].sort()).toEqual([...getHeads(b)].sort());
    const a2 = applyMutation(Automerge.clone(a, { actor: ACTOR.a }), {
      op: 'set',
      collection: 'recipes',
      id: 'ra',
      entity: { id: 'ra', name: 'A', ingredients: [], steps: [] },
    }).doc;
    const b2 = applyMutation(Automerge.clone(b, { actor: ACTOR.b }), {
      op: 'set',
      collection: 'recipes',
      id: 'rb',
      entity: { id: 'rb', name: 'B', ingredients: [], steps: [] },
    }).doc;
    const m = converge(a2, b2);
    expect(Object.keys((Automerge.toJS(m.a) as Any).recipes).sort()).toEqual(['ra', 'rb']);
    expect(countRootConflicts(m.a)).toBe(0);
  });

  it('mixed fleet (documented): an old build creating the missing collection with {} conflicts at the root, and detection counts it', () => {
    const old = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      for (const name of COLLECTION_NAMES.filter((n) => n !== 'recipes')) (d as Any)[name] = {};
    });
    const newDev = applyMutation(Automerge.clone(loadDoc(saveDoc(old)), { actor: ACTOR.a }), {
      op: 'set',
      collection: 'recipes',
      id: 'rn',
      entity: { id: 'rn', name: 'new', ingredients: [], steps: [] },
    }).doc;
    const oldDev = Automerge.change(Automerge.clone(old, { actor: ACTOR.b }), (d) => {
      (d as Any).recipes = {};
      (d as Any).recipes.ro = { id: 'ro', name: 'old', ingredients: [], steps: [] };
    });
    const m = Automerge.merge(Automerge.clone(newDev), oldDev);
    const visible = Object.keys((Automerge.toJS(m) as Any).recipes ?? {});
    report.push(
      `mixed-fleet root race: countRootConflicts=${countRootConflicts(m)}, visible recipes=[${visible.join(', ')}]`
    );
    expect(countRootConflicts(m)).toBe(1);
  });
});

describe('layer 4: compaction rebase through compactDoc + mergeRemoteEnvelope', () => {
  async function envelopeFor(doc: Doc, key: CryptoKey) {
    return {
      version: '4.0' as const,
      familyId: 'fam',
      familyName: 'F',
      keyId: 'k',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: bufferToBase64(await encryptPayload(key, Automerge.save(doc))),
    };
  }

  /** Top-level fields the peer changed since the baseline that the target ALSO changed, differently
   * (what `threeWayFields` counts as a conflict), as `collection.field` (no ids, no values). */
  function bothChangedFields(before: Doc, now: Doc, target: Doc): string[] {
    const b = Automerge.toJS(before) as Any;
    const n = Automerge.toJS(now) as Any;
    const t = Automerge.toJS(target) as Any;
    const out = new Set<string>();
    const cmp = (label: string, x: Any = {}, y: Any = {}, z: Any = {}) => {
      for (const k of Object.keys(y)) {
        if (canon(x[k]) === canon(y[k]) || canon(y[k]) === canon(z[k])) continue;
        if (canon(x[k]) !== canon(z[k])) out.add(`${label}.${k}`);
      }
    };
    for (const col of COLLECTION_NAMES)
      for (const id of Object.keys(n[col] ?? {}))
        if (canon(b[col]?.[id]) !== canon(n[col][id]) && t[col]?.[id])
          cmp(col, b[col]?.[id], n[col][id], t[col][id]);
    cmp('settings', b.settings, n.settings, t.settings);
    return [...out].sort();
  }

  /** The peer's unsynced edits, on old history. Returns probes to find them after the rebase. */
  async function peerEdits(dev: Device) {
    return on(dev, async () => {
      const listId = ids('lists').find((l) => (get('lists', l)!.items ?? []).length >= 2);
      const accId = ids('accounts')[0];
      const probes: Array<(m: Any) => boolean> = [];
      if (listId) {
        const item =
          (get('lists', listId)!.items as Any[]).find((i) => !i.completed) ??
          get('lists', listId)!.items[0];
        const want = !item.completed;
        await toggleListItem(listId, item.id, members()[0]!);
        probes.push(
          (m) => (m.lists[listId].items as Any[]).find((i) => i.id === item.id)?.completed === want
        );
      }
      const rates = (settingsNow().exchangeRates ?? []) as Any[];
      await saveSettings({
        exchangeRates: [...rates, { from: 'USD', to: 'XPEER', rate: 7, updatedAt: NOW }],
      } as never);
      probes.push((m) => (m.settings.exchangeRates as Any[]).some((x) => x.to === 'XPEER'));
      if (accId) {
        await repo('accounts').update(accId, { name: 'Renamed offline' } as never);
        probes.push((m) => m.accounts[accId].name === 'Renamed offline');
      }
      return probes;
    });
  }

  /** The compactor's own edits after compacting, on fields the peer did not touch. */
  async function compactorEdits(dev: Device) {
    return on(dev, async () => {
      const todo = ids('todos')[0];
      const probes: Array<(m: Any) => boolean> = [];
      if (todo) {
        await repo('todos').update(todo, { title: 'edited after compaction' } as never);
        probes.push((m) => m.todos[todo].title === 'edited after compaction');
      }
      await saveSettings({ theme: 'dark' } as never);
      probes.push((m) => m.settings.theme === 'dark');
      return probes;
    });
  }

  it('the peer keeps its offline edits on the compacted lineage; conflicts are exactly the updatedAt collisions', async () => {
    const key = await generateFamilyKey();
    ap.reset();
    ap.configure({
      pushChunk() {},
      perf() {},
      cachePersistFailed() {},
      cacheReleased() {},
    } as never);
    await ap.setKey(key);

    // Compact exactly as the app does.
    ap.loadSnapshot(Automerge.save(BASE));
    ap.compactDoc();
    const compacted = Automerge.load<FamilyDocument>(ap.exportSnapshot().binary);
    expect(Automerge.getAllChanges(compacted).length).toBe(1);
    const target: Device = {
      name: 'compactor',
      doc: Automerge.clone(compacted, { actor: ACTOR.a }),
    };
    const compactorProbes = await compactorEdits(target);

    const baselineHeads = getHeads(BASE);
    const peer: Device = { name: 'peer', doc: Automerge.clone(BASE, { actor: ACTOR.b }) };
    const peerProbes = await peerEdits(peer);

    // (a) The pure composer + one applyMutation, as rebaseOntoRemote does. On a CLONE: on
    // 3.4.1 `Automerge.save` of a handle that a later `change` made outdated saves the NEWER
    // state (toJS still reads the old heads), so applying onto `target.doc` itself would leak
    // this replay into the envelope (b) sends, and (b) would then have nothing to rebase.
    const targetA = migrateDoc(Automerge.clone(target.doc));
    const ops = buildRebaseOps(peer.doc, baselineHeads, targetA);
    expect(ops).not.toBeNull();
    const clash = bothChangedFields(
      Automerge.view(peer.doc, baselineHeads) as Doc,
      peer.doc,
      target.doc
    );
    report.push(
      `rebase (a) composer: count=${ops!.count} conflicts=${ops!.conflicts}; fields both sides changed: [${clash.join(', ')}]`
    );
    // FOLLOW-UP: the rebase composer counts updatedAt collisions as conflicts; exclude them in a
    // later change. Until then `conflicts` must equal EXACTLY the number of `updatedAt`-only
    // collisions (both devices stamped the same entity/settings), and no user-data field may
    // collide. Precise, not weaker: any other conflict, or a missing one, fails here.
    const stampClashes = clash.filter((f) => f.endsWith('.updatedAt'));
    expect(clash.filter((f) => !f.endsWith('.updatedAt'))).toEqual([]);
    expect(ops!.conflicts).toBe(stampClashes.length);
    if (!REAL_POD) expect(stampClashes).toEqual(['settings.updatedAt']);
    const rebased = applyMutation(targetA, ops!.op as MutationOp).doc;
    const m1 = Automerge.toJS(rebased) as Any;
    expect(peerProbes.map((p) => p(m1))).toEqual(peerProbes.map(() => true));
    expect(compactorProbes.map((p) => p(m1))).toEqual(compactorProbes.map(() => true));
    expect(findUndefined(m1)).toBeNull();

    // (b) End to end: the worker's mergeRemoteEnvelope with a real envelope.
    ap.loadSnapshot(Automerge.save(peer.doc));
    const res = await ap.mergeRemoteEnvelope((await envelopeFor(target.doc, key)) as never, 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });
    expect(res.action).toBe('rebased');
    expect(res.replayed).toBe(ops!.count);
    expect(res.dirty).toBe(true);
    expect(res.conflicts ?? 0).toBe(stampClashes.length); // see the FOLLOW-UP above
    expect(res.rootConflicts?.added ?? 0).toBe(0);
    const m2 = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as Any;
    expect(peerProbes.map((p) => p(m2))).toEqual(peerProbes.map(() => true));
    expect(compactorProbes.map((p) => p(m2))).toEqual(compactorProbes.map(() => true));
    report.push(`rebase: replayed=${res.replayed} conflicts=${res.conflicts} action=${res.action}`);
  });

  it.skipIf(REAL_POD)(
    'documented: both sides changed the SAME list array -> counted conflict, saved copy stays',
    async () => {
      const compacted = Automerge.from(
        { ...(Automerge.toJS(BASE) as Any), podLineage: { id: 'L-NEW', seq: 1 } },
        { actor: ACTOR.a }
      ) as unknown as Doc;
      const target: Device = { name: 'compactor', doc: compacted };
      await on(target, () => toggleListItem(LIST, 'demo-list-item-5', PARTNER));
      const peer: Device = { name: 'peer', doc: Automerge.clone(BASE, { actor: ACTOR.b }) };
      await on(peer, () => toggleListItem(LIST, 'demo-list-item-3', OWNER));
      const ops = buildRebaseOps(peer.doc, getHeads(BASE), target.doc);
      const clash = bothChangedFields(
        Automerge.view(peer.doc, getHeads(BASE)) as Doc,
        peer.doc,
        target.doc
      );
      report.push(
        `rebase same-array both sides: conflicts=${ops?.conflicts} fields=[${clash.join(', ')}] op=${ops?.op ? 'present' : 'none'} (documented out-of-scope)`
      );
      // The array clash is the documented limitation; the updatedAt one is the FOLLOW-UP overcount
      // (the rebase composer counts updatedAt collisions as conflicts; exclude them in a later change).
      expect(clash).toEqual(['lists.items', 'lists.updatedAt']);
      expect(ops?.conflicts).toBe(2);
    }
  );
});

describe.skipIf(REAL_POD)('layer 5: old-build interop (mixed fleet), reported', () => {
  it('checker sensitivity: the invariants DO fail on a pre-#117 whole-array write on both devices', async () => {
    // Without this, a checker that silently passes everything would look exactly like a clean run.
    const { A, B } = fork(BASE);
    const wholeTick = (doc: Doc, itemId: string) =>
      Automerge.change(doc, (d) => {
        const items = plain((d as Any).lists[LIST].items) as Any[];
        (d as Any).lists[LIST].items = items.map((i) =>
          i.id === itemId ? { ...i, completed: true } : i
        );
      });
    A.doc = wholeTick(A.doc, 'demo-list-item-3');
    B.doc = wholeTick(B.doc, 'demo-list-item-4');
    const m = converge(A.doc, B.doc);
    const fails = checkMerge(BASE, A.doc, B.doc, m.a, new Map());
    expect(fails.some((f) => f.startsWith('(iii)') && f.includes('#completed'))).toBe(true);
  });

  it('whole-array writer (old build) vs reconciling writer (new build): no crash, no undefined, no root conflict', async () => {
    const lines: string[] = [];
    // (a) list items: old device assigns a whole array with one item added; new device ticks in place.
    {
      const { A: oldDev, B: newDev } = fork(BASE);
      oldDev.doc = Automerge.change(oldDev.doc, (d) => {
        const items = plain((d as Any).lists[LIST].items) as Any[];
        (d as Any).lists[LIST].items = [
          ...items,
          { id: 'old-item', title: 'Old build item', completed: false },
        ];
      });
      await on(newDev, () => toggleListItem(LIST, 'demo-list-item-3', OWNER));
      const m = converge(oldDev.doc, newDev.doc);
      const out = Automerge.toJS(m.a) as Any;
      expect(findUndefined(out)).toBeNull();
      expect(countRootConflicts(m.a)).toBe(0);
      lines.push(
        `items: old add kept=${!!itemOf(out, 'old-item')}, new tick kept=${itemOf(out, 'demo-list-item-3')?.completed === true}, count=${out.lists[LIST].items.length}`
      );
    }
    // (b) settings rates: old device replaces the array; new device adds in place.
    {
      const { A: oldDev, B: newDev } = fork(BASE);
      oldDev.doc = Automerge.change(oldDev.doc, (d) => {
        const rates = plain((d as Any).settings.exchangeRates) as Any[];
        (d as Any).settings.exchangeRates = [
          ...rates,
          { from: 'USD', to: 'OLD', rate: 1, updatedAt: NOW },
        ];
      });
      await on(newDev, async () => {
        const rates = settingsNow().exchangeRates as Any[];
        await saveSettings({
          exchangeRates: [...rates, { from: 'USD', to: 'NEW', rate: 2, updatedAt: NOW }],
        } as never);
      });
      const m = converge(oldDev.doc, newDev.doc);
      const out = Automerge.toJS(m.a) as Any;
      expect(findUndefined(out)).toBeNull();
      expect(countRootConflicts(m.a)).toBe(0);
      const tos = (out.settings.exchangeRates as Any[]).map((x) => x.to);
      lines.push(
        `rates: old kept=${tos.includes('OLD')}, new kept=${tos.includes('NEW')}, [${tos.join(', ')}]`
      );
    }
    // (c) old build edits a list item in place by assigning the whole item object; new build renames another.
    {
      const { A: oldDev, B: newDev } = fork(BASE);
      oldDev.doc = Automerge.change(oldDev.doc, (d) => {
        const items = (d as Any).lists[LIST].items;
        items[2] = { ...plain(items[2]), completed: true, completedBy: OWNER };
      });
      await on(newDev, () => renameListItem(LIST, 'demo-list-item-4', 'Penne'));
      const m = converge(oldDev.doc, newDev.doc);
      const out = Automerge.toJS(m.a) as Any;
      expect(findUndefined(out)).toBeNull();
      lines.push(
        `item replace vs rename: old tick kept=${itemOf(out, 'demo-list-item-3')?.completed === true}, new rename kept=${itemOf(out, 'demo-list-item-4')?.title === 'Penne'}`
      );
    }
    report.push(...lines.map((l) => `old-build interop ${l}`));
    process.stdout.write(
      ['', '── crdt117 report lines', ...report.map((l) => `  ${l}`), ''].join('\n')
    );
  });
});

// Keeps the full projection builder exercised on the final base (catches a doc the worker cannot stream).
describe('sanity', () => {
  it('the base streams as a full projection', () => {
    expect(buildFullProjection(BASE).length).toBeGreaterThan(0);
  });
});
