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
 * #117 Phase 2 (`docs/plans/2026-10-03-crdt-counters-117-phase-2.md`, Testing §3): runs with
 * Counter writes ON. The projection edge and every read the checker asserts on are FOLDED
 * (`foldEntity`/`foldDoc`), as main sees them; the shape invariants (ii)-(v) read the RAW document,
 * where a Counter adjustment leaves the absolute untouched, and a sixth invariant checks that every
 * Counter field adds up across each merge. `counterStats` must report 0 conflicts and 0 malformed
 * keys after every merge.
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
 *  2. Seeded chaos: N rounds of 1-4 random writes per device, then converge, with six invariants;
 *     a third device joins half way through.
 *  3. Format: save/load round trip; a pre-#117 (`d[name] = {}`) pod is left untouched.
 *  4. Compaction rebase through the real `compactDoc` and `mergeRemoteEnvelope`.
 *  5. Old-build interop: a whole-value writer merged with a reconciling writer (reported).
 *  6. #117 writer flip: Counter carries across seeded compactions, reloads and restores, with
 *     the register, ledger and fold-equals-truth invariants (bounded when a residual counted).
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
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
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
  // #117 Phase 2: the projection holds FOLDED entities (the worker's materialisation funnel), so
  // every `base` a repository picks is in folded space, exactly as in the app.
  const { foldEntity, foldIndex } = await import('@/services/automerge/worker/counterFields');
  const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const entity = (c: string, id: string) =>
    foldEntity(c, id, plain((sim.doc as any)?.[c]?.[id]), foldIndex(sim.doc as any));
  return {
    ...actual,
    getById: entity,
    list: (c: string) => Object.keys((sim.doc as any)?.[c] ?? {}).map((id) => entity(c, id)),
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
const counterFields = await import('@/services/automerge/worker/counterFields');
const { COUNTER_FIELDS, setCounterWrites } = counterFields;
const { counterStats, fieldDecimals, foldDoc, foldEntity, foldIndex, sigma, toMinor } =
  counterFields;
/** The folded view main sees (the ledger generation is irrelevant to a read). */
const foldedView = (doc: Doc) => foldDoc(doc, (docOps.docLineage(doc)?.seq ?? 0) + 1);
const { materializeFixture } = await import('@/services/demo/demoFixture');
const { COLLECTION_NAMES } = await import('@/types/automerge');
const ap = await import('@/services/automerge/worker/applyAndProject');
const { generateFamilyKey, encryptPayload, decryptPayload } =
  await import('@/services/crypto/familyKeyService');
const { bufferToBase64, base64ToBuffer } = await import('@/utils/encoding');

import type { FamilyDocument, CollectionName } from '@/types/automerge';
import type { MutationOp } from '@/services/automerge/worker/protocol';
import type { CounterField } from '@/services/automerge/worker/counterFields';

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
const ACTOR = {
  origin: '00'.repeat(16),
  a: 'aa'.repeat(16),
  b: 'bb'.repeat(16),
  c: 'cc'.repeat(16),
};
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

/** The device `on` is running, so a generator can keep per-device state (its own Undo-able
 * contributions). */
let activeDevice = '';

/** Run `fn` with `dev` as the active device (the worker doc + the projection). Sequential only. */
async function on<T>(dev: Device, fn: () => Promise<T>): Promise<T> {
  sim.doc = dev.doc;
  activeDevice = dev.name;
  try {
    return await fn();
  } finally {
    dev.doc = sim.doc as Doc;
  }
}

/** The active device's plain view of an entity (what the store would hold): FOLDED. */
const get = (c: CollectionName, id: string): Any | undefined =>
  foldEntity(c, id, plain((sim.doc as any)?.[c]?.[id]), foldIndex(sim.doc as Doc));
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
/** goalsStore.updateGoal with a contribution (`appendContributionIfChanged`): the GoalModal full
 * edit, an ABSOLUTE amount (two of these concurrently is the set-vs-set residual). */
async function contribute(goalId: string, delta: number, entryId: string, by: string) {
  const goal = get('goals', goalId)!;
  const entry = { id: entryId, amount: delta, at: new Date().toISOString(), updatedBy: by };
  return repo('goals').update(goalId, {
    currentAmount: goal.currentAmount + delta,
    manualContributions: [...(goal.manualContributions ?? []), entry],
  } as never);
}
/** Contributions this device made through `quickContribute`, newest last: the only entries its
 * Undo toast can reach (the toast is on the contributing device only). */
const ownContributions = new Map<string, Array<{ goalId: string; id: string; amount: number }>>();

/** useContributeToGoal.contribute (the quick modal): the RELATIVE named op with its history entry
 * (`contributionEntry`), so the amount and the entry land in one change. */
async function quickContribute(goalId: string, amount: number, entryId: string, by: string) {
  const entry = { id: entryId, amount, at: new Date().toISOString(), updatedBy: by };
  const goal = (await mutate({
    op: 'named',
    name: 'applyGoalContribution',
    args: { id: goalId, delta: amount, contribution: entry },
  })) as Any;
  const landed = (goal.manualContributions as Any[] | undefined)?.find((c) => c.id === entryId);
  if (landed) {
    const own = ownContributions.get(activeDevice) ?? [];
    own.push({ goalId, id: entryId, amount: landed.amount });
    ownContributions.set(activeDevice, own);
  }
  return goal;
}
/** useContributeToGoal.undoContribution: reverse this device's latest quick contribution. */
async function quickUndo(): Promise<boolean> {
  const last = ownContributions.get(activeDevice)?.pop();
  if (!last) return false;
  await mutate({
    op: 'named',
    name: 'applyGoalContribution',
    args: { id: last.goalId, delta: -last.amount, undoContributionId: last.id },
  });
  return true;
}
/** Cents, as a transaction amount: `(n − half) / 100`, never 0. */
const cents = (rng: Rng, span: number) => (rng.int(span) - span / 2) / 100 || 0.01;

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
  /** Leaves holding a live Automerge conflict: every concurrent value, canonicalised. Collected
   * only for the MERGED document (`withConflicts`). A conflict there means two devices wrote the
   * leaf since the last converge: a later single write would have superseded an older one. */
  conflicted: Map<string, Set<string | undefined>>;
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

function shapeOf(doc: Doc, withConflicts = false): Shape {
  const s: Shape = {
    nodes: new Map(),
    dups: new Set(),
    leaves: new Map(),
    leafMeta: new Map(),
    containers: new Set(),
    conflicted: new Map(),
  };
  const root = Automerge.toJS(doc) as Any;
  const addNode = (p: string, meta: Meta) => {
    if (s.nodes.has(p)) s.dups.add(p);
    s.nodes.set(p, meta);
  };
  /** Record a leaf's live conflict, reading the document proxy that parallels `o`. */
  const noteConflict = (live: Any | undefined, k: string, leaf: string) => {
    if (!live) return;
    const values = Automerge.getConflicts(live as never, k);
    if (values && Object.keys(values).length > 1)
      s.conflicted.set(leaf, new Set(Object.values(values).map((x) => canon(plain(x)))));
  };
  const walk = (
    o: Any,
    node: string,
    anc: string[],
    conts: string[],
    prefix: string,
    live?: Any
  ) => {
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
            walk(el, p, [...anc, p], cs, '', live?.[k]?.[i]);
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
          noteConflict(live, k, leaf);
        }
      } else if (isObj(v) && MERGE_FIELDS.has(k)) {
        const cont = leaf;
        s.containers.add(cont);
        walk(v, node, anc, [...conts, cont], `${prefix}${k}.`, live?.[k]);
      } else {
        s.leaves.set(leaf, canon(v));
        s.leafMeta.set(leaf, { ancestors: anc, containers: conts });
        noteConflict(live, k, leaf);
      }
    }
  };
  for (const col of COLLECTION_NAMES) {
    for (const [id, e] of Object.entries((root[col] ?? {}) as Any)) {
      const p = `${col}/${id}`;
      addNode(p, { ancestors: [p], containers: [] });
      if (isObj(e)) walk(e, p, [p], [], '', withConflicts ? (doc as Any)[col]?.[id] : undefined);
    }
  }
  if (isObj(root.settings)) {
    addNode('settings', { ancestors: ['settings'], containers: [] });
    walk(
      root.settings,
      'settings',
      ['settings'],
      [],
      '',
      withConflicts ? (doc as Any).settings : undefined
    );
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
  const M = shapeOf(mDoc, true);
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
    if (m !== want) {
      // A NET-ZERO write on the other side (toggle then un-toggle in one round) leaves its value
      // equal to the origin, so value comparison calls this one-sided; but it is a real
      // concurrent write, and the merged leaf then holds a live conflict carrying BOTH values.
      // That is the accepted same-scalar residual, not a lost write. Without the conflict (a
      // genuinely one-sided write) the check stays strict.
      if (M.conflicted.get(l)?.has(want)) {
        bump(residuals, `same-scalar both sides, one net-zero (${fieldOf(l)})`);
        continue;
      }
      fails.push(`(iii) ${side} alone changed ${l}; merged does not hold its value`);
    }
  }

  // (iv) no undefined anywhere in the materialised document
  const u = findUndefined(Automerge.toJS(mDoc));
  if (u) fails.push(`(iv) undefined at ${u}`);
  // root conflicts
  const rc = countRootConflicts(mDoc);
  if (rc !== 0) fails.push(`root conflicts: ${rc}`);
  // (vi) Counter fields add up, and the map is healthy
  fails.push(...checkCounters(originDoc, aDoc, bDoc, mDoc), ...counterHealth(mDoc));
  return fails;
}

/**
 * (vi) #117 Phase 2: every Counter field ADDS UP across a merge. In unfloored minor units,
 * `M − O = (A − O) + (B − O)` for each Counter field the merged document holds, unless BOTH sides
 * wrote the raw absolute (set-vs-set: one absolute wins, the residual (iii) already classifies).
 * A set on one side and adjustments on the other still add up (probe j: set + delta). Reads
 * through `toJS`, as `shapeOf` does, so a handle a merge has since spent reads its own state.
 */
function checkCounters(originDoc: Doc, aDoc: Doc, bDoc: Doc, mDoc: Doc): string[] {
  const docs = [originDoc, aDoc, bDoc, mDoc].map((d) => Automerge.toJS(d) as Any);
  const ixs = docs.map((d) => foldIndex(d));
  const fails: string[] = [];
  for (const [collection, specs] of Object.entries(COUNTER_FIELDS)) {
    for (const id of Object.keys(docs[3]![collection] ?? {})) {
      for (const spec of specs as readonly CounterField[]) {
        const field = spec.abs.join('.');
        const raws = docs.map((d) => {
          const e = d[collection]?.[id];
          const parent = spec.abs.length === 1 ? e : e?.[spec.abs[0]];
          return parent?.[spec.abs[spec.abs.length - 1]!];
        });
        // Created or removed on a side, or not a loan there: nothing to add up.
        if (raws.some((v) => typeof v !== 'number')) continue;
        if (raws[1] !== raws[0] && raws[2] !== raws[0]) continue; // set-vs-set residual
        // Folded values (raw + Σ, unfloored), compared in minor units at the entity's scale.
        const [o, a, b, m] = raws.map(
          (raw, i) => (raw as number) + sigma(ixs[i]!, collection, id, field)
        );
        const d = fieldDecimals(spec, docs[3]![collection]?.[id]);
        if (toMinor(m! - o!, d) !== toMinor(a! - o! + (b! - o!), d)) {
          fails.push(
            `(vi) ${collection}/${id}#${field}: merged is not origin + both sides' adjustments`
          );
        }
      }
    }
  }
  return fails;
}

/** Counter health after a merge: no key written by two actors, none the fold cannot read. */
function counterHealth(doc: Doc): string[] {
  const { conflicts, malformed } = counterStats(doc);
  return [
    ...(conflicts ? [`counterStats.conflicts = ${conflicts}`] : []),
    ...(malformed ? [`counterStats.malformed = ${malformed}`] : []),
  ];
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
  async quickContribution(rng, mint) {
    const goalId = rng.pick(ids('goals'));
    if (!goalId) return null;
    await quickContribute(
      goalId,
      (500 + rng.int(10000)) / 100,
      mint('quick'),
      rng.pick(members())!
    );
    return 'quickContribution';
  },
  async quickUndo() {
    return (await quickUndo()) ? 'quickUndo' : null;
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
    await increment('accounts', acc, 'balance', cents(rng, 20000));
    return 'balanceIncrement';
  },
  /** The account modal's "set balance to X": an absolute, in folded space. */
  async balanceSet(rng) {
    const acc = rng.pick(ids('accounts'));
    if (!acc) return null;
    const now = get('accounts', acc)!.balance as number;
    await repo('accounts').update(acc, {
      balance: Math.round((now + cents(rng, 50000)) * 100) / 100,
    } as never);
    return 'balanceSet';
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
  setCounterWrites(true); // #117 Phase 2: every adjustment is a Counter
  // Each device's actor is the whole Counter writer (#117 writer flip). Layer 4 reloads B's
  // document inside `ap` under a fresh actor, so B's earlier keys are foreign to that session
  // and cross as carries like anyone's.
  BASE = REAL_POD ? await loadRealPod() : await buildDemoBase();
}, 120_000);
afterAll(() => setCounterWrites(null));

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
  for (const doc of [merged.a, merged.b]) {
    expect(counterStats(doc)).toMatchObject({ conflicts: 0, malformed: 0 });
  }
  // Folded, as main sees it: a balance reads baseline + every Counter adjustment.
  return { A, B, merged, m: foldedView(merged.a) as Any, fails, residuals, notes };
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

  it('residual: a tick-and-untick on A concurrent with a tick on B is a same-scalar clash, classified', async () => {
    // The seed-1/300-round finding: A's net-zero toggle leaves its value equal to the origin, so
    // a value-only check reads B's tick as one-sided. A's later op wins the clash here.
    const r = await scenario(
      async () => {
        await toggleListItem(LIST, 'demo-list-item-3', OWNER);
        await toggleListItem(LIST, 'demo-list-item-3', OWNER);
      },
      () => toggleListItem(LIST, 'demo-list-item-3', PARTNER)
    );
    expect(itemOf(r.m, 'demo-list-item-3')?.completed).toBe(false);
    expect(r.residuals.get('same-scalar both sides, one net-zero (completed)')).toBe(1);
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

  it('goal: quick contribution on both devices: both amounts and both entries land (was the Phase 2 residual)', async () => {
    const r = await scenario(
      () => quickContribute('chaos-goal-history', 30, 'contrib-a', OWNER),
      () => quickContribute('chaos-goal-history', 50.25, 'contrib-b', PARTNER)
    );
    const g = r.m.goals['chaos-goal-history'];
    const history = g.manualContributions as Any[];
    expect(history.map((c) => c.id).sort()).toEqual(
      ['chaos-contrib-0', 'contrib-a', 'contrib-b'].sort()
    );
    expect(g.currentAmount).toBe(200.25);
    expect(history.reduce((s, c) => s + c.amount, 0)).toBe(g.currentAmount);
    expect(r.fails).toEqual([]);
  });

  it('goal: an Undo on each device after the merge removes exactly its own entry and amount', async () => {
    const r = await scenario(
      () => quickContribute('chaos-goal-history', 30, 'contrib-a', OWNER),
      () => quickContribute('chaos-goal-history', 50, 'contrib-b', PARTNER)
    );
    const A: Device = { name: 'A', doc: r.merged.a };
    const B: Device = { name: 'B', doc: r.merged.b };
    await on(A, () =>
      mutate({
        op: 'named',
        name: 'applyGoalContribution',
        args: { id: 'chaos-goal-history', delta: -30, undoContributionId: 'contrib-a' },
      })
    );
    const again = converge(A.doc, B.doc);
    const g = (foldedView(again.b) as Any).goals['chaos-goal-history'];
    expect(g.currentAmount).toBe(170);
    expect((g.manualContributions as Any[]).map((c) => c.id).sort()).toEqual(
      ['chaos-contrib-0', 'contrib-b'].sort()
    );
  });

  it('residual: the GoalModal absolute edit on both devices keeps both entries but one amount', async () => {
    const r = await scenario(
      () => contribute('chaos-goal-history', 30, 'contrib-a', OWNER),
      () => contribute('chaos-goal-history', 50, 'contrib-b', PARTNER)
    );
    const g = r.m.goals['chaos-goal-history'];
    expect((g.manualContributions as Any[]).map((c) => c.id).sort()).toEqual(
      ['chaos-contrib-0', 'contrib-a', 'contrib-b'].sort()
    );
    expect([150, 170]).toContain(g.currentAmount);
    expect(r.residuals.get('same-scalar both sides (currentAmount)')).toBe(1);
    report.push(
      `goal both-side GoalModal edit: currentAmount=${g.currentAmount} (sum of history = ${(g.manualContributions as Any[]).reduce((s, c) => s + c.amount, 0)}; set-vs-set residual)`
    );
    expect(r.fails).toEqual([]);
  });

  it('loan: a payment on each device: both principals land', async () => {
    const r = await scenario(
      () => loanPayment('chaos-asset-house', 1300),
      () => loanPayment('chaos-asset-house', 1300)
    );
    // Each device: interest round2(200000 × 4.5% / 12) = 750, principal 550.
    expect(r.m.assets['chaos-asset-house'].loan.outstandingBalance).toBe(198900);
    expect(r.fails).toEqual([]);
  });

  it('account: cents on both devices sum exactly; a later increment after the merge stays exact', async () => {
    const start = (foldedView(BASE) as Any).accounts['demo-account-current'].balance as number;
    const r = await scenario(
      () => increment('accounts', 'demo-account-current', 'balance', -20.25),
      () => increment('accounts', 'demo-account-current', 'balance', -30.5)
    );
    const want = (toMinor(start, 2) - 5075) / 100; // USD: cents
    expect(r.m.accounts['demo-account-current'].balance).toBe(want);
    const A: Device = { name: 'A', doc: r.merged.a };
    await on(A, () => increment('accounts', 'demo-account-current', 'balance', -5.05));
    const later = converge(A.doc, r.merged.b);
    for (const doc of [later.a, later.b]) {
      expect((foldedView(doc) as Any).accounts['demo-account-current'].balance).toBe(
        (toMinor(start, 2) - 5580) / 100
      );
    }
    expect(r.fails).toEqual([]);
  });

  it('account: "set balance to X" on A vs a transaction on B merge to X + delta', async () => {
    const r = await scenario(
      () => repo('accounts').update('demo-account-current', { balance: 5000 } as never),
      () => increment('accounts', 'demo-account-current', 'balance', -40.25)
    );
    expect(r.m.accounts['demo-account-current'].balance).toBe(4959.75);
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
  it(`${ITERATIONS} rounds, seed ${SEED}: converge, union survival, one-sided scalars, no undefined, no verify failure, Counters add up`, async () => {
    const rng = lcg(SEED);
    const t0 = performance.now();
    ownContributions.clear(); // layer 1's devices share these names; their entries are not here
    let { A, B } = fork(BASE);
    // #117 Phase 2: a third device joins half way, forked from the converged pod with its own
    // actor, so its Counter keys are a third writer's and every later merge is three-way.
    let C: Device | null = null;
    const JOIN_AT = Math.max(1, Math.floor(ITERATIONS / 2));
    let origin = BASE;
    let counter = 0;
    const residuals: Tally = new Map();
    const opTally: Tally = new Map();
    const failures: string[] = [];
    const notesStart = sim.notes.length;
    let totalOps = 0;
    for (let it = 0; it < ITERATIONS; it++) {
      const mint = (p: string) => `chaos-${p}-${it}-${counter++}`;
      if (it === JOIN_AT) C = { name: 'C', doc: Automerge.clone(origin, { actor: ACTOR.c }) };
      const log: Record<string, string[]> = { A: [], B: [], C: [] };
      for (const dev of C ? [A, B, C] : [A, B]) {
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
      let next = { a: merged.a, b: merged.b, c: null as Doc | null };
      if (C) {
        // Three-way: A+B (checked above) as one side, C as the other, then B catches up.
        try {
          const abc = converge(merged.a, C.doc);
          fails.push(
            ...checkMerge(origin, merged.a, C.doc, abc.a, residuals).map((f) => `[C] ${f}`)
          );
          const b = docOps.mergeDocs(merged.b, abc.a).doc;
          expect([...getHeads(b)].sort()).toEqual([...getHeads(abc.a)].sort());
          next = { a: abc.a, b, c: abc.b };
        } catch (e) {
          failures.push(`it ${it}: (i) C did not converge: ${(e as Error).message.slice(0, 200)}`);
          break;
        }
      }
      for (const f of fails)
        failures.push(
          redact(
            `seed ${SEED} it ${it}: ${f} | A=[${log.A.join(', ')}] B=[${log.B.join(', ')}] C=[${log.C.join(', ')}]`
          )
        );
      A = { name: 'A', doc: next.a };
      B = { name: 'B', doc: next.b };
      if (C && next.c) C = { name: 'C', doc: next.c };
      origin = next.a;
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
        `── crdt117 chaos: seed ${SEED}, ${ITERATIONS} rounds, ${totalOps} writes, ${ms}ms (${REAL_POD ? 'real pod' : 'demo family'}; third device from round ${JOIN_AT})`,
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

describe('layer 6: Counter carries across compactions, reloads and restores (#117 writer flip)', () => {
  /**
   * Plan `docs/plans/2026-10-04-crdt-counters-117-writer-flip.md`, Testing §7. Three devices
   * and a Drive copy (the hub every sync goes through), on a small two-account pod. Each round
   * picks one move: ADJUST (a Counter increment on the device's own actor key), SYNC (merge on
   * the same lineage, or REBASE onto a newer one through the real `buildRebaseOps` +
   * `applyMutation`, landing under a fresh actor exactly as `applyAndProject` does), COMPACT
   * (the device syncs, then folds Drive as `compactDoc` does: `nextLineage` once, `foldDoc` at
   * that seq, `fromHeads` stamped), RELOAD (the device's document under a new actor, same
   * history: its earlier keys become foreign to it) and RESTORE (the device syncs, then installs
   * an earlier-generation Drive snapshot stamped `{ ...nextLineage, restoreSeq: seq }`, rolling
   * back everything saved after that file).
   *
   * The truth is what Drive SHOULD hold for each account: the start, plus every device's own
   * adjustments as each sync lands, reset to the restored file's fold on a restore. Invariants
   * after every move: no carry register is ever a `Counter`; no name holds two concurrent values
   * (`counterStats` conflicts and carry conflicts both 0) and no compaction reports a ledger
   * name collision; and the fold equals the truth whenever no rebase so far counted a residual
   * (`carry_skipped`), else |fold − truth| ≤ the magnitude of the counted residuals, so a double
   * count can never hide behind the bound.
   */
  it(`${ITERATIONS} rounds, seed ${SEED}: registers are integers, one value per name, the fold equals every device's own adjustments`, () => {
    const rng = lcg((SEED ^ 0x5eed) >>> 0);
    const actor = () =>
      Array.from({ length: 16 }, () => rng.int(256).toString(16).padStart(2, '0')).join('');
    const ACCS = ['chaos6-acc-1', 'chaos6-acc-2'];
    const START = 100_000; // minor units (USD cents)
    interface Dev {
      name: string;
      doc: Doc;
      baseline: string[];
      unsynced: Map<string, number>;
      unsyncedAbs: number;
    }

    let drive = migrateDoc(Automerge.init<FamilyDocument>({ actor: actor() }));
    for (const id of ACCS) {
      drive = applyMutation(drive, {
        op: 'set',
        collection: 'accounts',
        id,
        entity: { id, name: id, type: 'checking', currency: 'USD', balance: START / 100 },
      }).doc;
    }
    const truth = new Map(ACCS.map((id) => [id, START]));
    const history: Uint8Array[] = [saveDoc(drive)];
    const devs: Dev[] = ['D1', 'D2', 'D3'].map((name) => ({
      name,
      doc: Automerge.clone(drive, { actor: actor() }),
      baseline: getHeads(drive),
      unsynced: new Map(),
      unsyncedAbs: 0,
    }));
    const lineage = (doc: Doc) => docOps.docLineage(doc);
    const seqOf = (doc: Doc) => lineage(doc)?.seq ?? 0;
    const balance = (doc: Doc, id: string) =>
      toMinor(
        foldEntity('accounts', id, (Automerge.toJS(doc) as Any).accounts[id], foldIndex(doc))
          .balance as number,
        2
      );

    let lossBound = 0;
    const failures: string[] = [];
    const tally: Tally = new Map();
    /** What happened, round by round (counts, seqs and figures only): printed on a failure. */
    const trace: string[] = [];
    let firstFailAt = 0;
    const check = (it: number, move: string) => {
      const where = `seed ${SEED} it ${it} (${move})`;
      const live = (drive.counterDeltas ?? {}) as unknown as Record<string, unknown>;
      for (const [name, v] of Object.entries(live)) {
        const parsed = counterFields.parseCounterKey(name);
        if (!parsed?.carry) continue;
        if (v instanceof Automerge.Counter || typeof v !== 'number') {
          failures.push(`${where}: carry register ${name.slice(-24)} is not a plain integer`);
        }
        if (parsed.carry.seq > seqOf(drive)) {
          failures.push(`${where}: a register for a generation Drive has not reached`);
        }
      }
      const stats = counterStats(drive);
      if (stats.conflicts || stats.carryConflicts || stats.malformed) {
        failures.push(
          `${where}: counterStats conflicts=${stats.conflicts} carry=${stats.carryConflicts} malformed=${stats.malformed}`
        );
      }
      for (const id of ACCS) {
        const diff = balance(drive, id) - truth.get(id)!;
        if (lossBound === 0 ? diff !== 0 : Math.abs(diff) > lossBound) {
          failures.push(`${where}: ${id} fold − truth = ${diff} (bound ${lossBound})`);
        }
      }
    };

    const sync = (dev: Dev) => {
      const dl = lineage(drive);
      const ll = lineage(dev.doc);
      if ((dl?.id ?? null) === (ll?.id ?? null)) {
        const merged = docOps.mergeDocs(dev.doc, drive).doc;
        dev.doc = merged;
        drive = Automerge.clone(merged, { actor: actor() });
        bump(tally, 'sync merge');
      } else {
        const built = buildRebaseOps(dev.doc, dev.baseline, drive);
        if (!built) {
          failures.push(`seed ${SEED}: ${dev.name} rebase could not compose`);
          return;
        }
        if (built.blockedBy) {
          // The user-file adopt: the human chose the newer file, so the unsynced work is let go.
          bump(tally, `rebase blocked ${built.blockedBy}`);
          dev.doc = Automerge.clone(drive, { actor: actor() });
          dev.baseline = getHeads(drive);
          dev.unsynced.clear();
          dev.unsyncedAbs = 0;
          return;
        }
        const onto = Automerge.clone(drive, { actor: actor() }); // a fresh load, as the worker
        const out = built.op ? applyMutation(onto, built.op) : { doc: onto, carrySuperseded: 0 };
        dev.doc = out.doc;
        drive = Automerge.clone(out.doc, { actor: actor() });
        bump(tally, `rebase ${built.rebaseMode}${built.fresh ? ' fresh' : ''}`);
        trace.push(
          `  ${dev.name} rebase ${seqOf(dev.doc)}<-: mode=${built.rebaseMode} fresh=${built.fresh} carries=${built.counterCarries} skipped=${built.carrySkipped} superseded=${out.carrySuperseded} ops=${JSON.stringify(opsOfRebase(built.op))}`
        );
        bump(tally, 'carries', built.counterCarries);
        bump(tally, 'carry_skipped', built.carrySkipped);
        bump(tally, 'carry_superseded', out.carrySuperseded);
        // A skipped negative is either a stale copy (no loss) or a reloaded session's own
        // reversal (the documented residual): bound it by everything this device had unsynced.
        if (built.carrySkipped > 0) lossBound += dev.unsyncedAbs;
      }
      for (const [id, n] of dev.unsynced) truth.set(id, truth.get(id)! + n);
      dev.unsynced.clear();
      dev.unsyncedAbs = 0;
      dev.baseline = getHeads(drive);
      history.push(saveDoc(drive));
    };

    const opsOfRebase = (op: MutationOp | null): unknown[] =>
      (op === null ? [] : op.op === 'batch' ? op.ops : [op])
        .filter((o) => o.op === 'carry')
        .map((o) => (o.op === 'carry' ? `${o.id.slice(-1)}:${o.minor}${o.exact ? '!' : ''}` : ''));
    const onDriveLineage = (dev: Dev) =>
      (lineage(drive)?.id ?? null) === (lineage(dev.doc)?.id ?? null);

    for (let it = 0; it < ITERATIONS; it++) {
      const dev = rng.pick(devs)!;
      const roll = rng.int(100);
      let move: string;
      if (roll < 40) {
        move = 'adjust';
        const id = rng.pick(ACCS)!;
        const minor = rng.int(2001) - 1000 || 1;
        dev.doc = applyMutation(dev.doc, {
          op: 'increment',
          collection: 'accounts',
          id,
          field: 'balance',
          delta: minor / 100,
        }).doc;
        dev.unsynced.set(id, (dev.unsynced.get(id) ?? 0) + minor);
        dev.unsyncedAbs += Math.abs(minor);
      } else if (roll < 70) {
        move = 'sync';
        sync(dev);
      } else if (roll < 82) {
        move = 'compact';
        if (!onDriveLineage(dev)) {
          sync(dev); // catch up first; a device compacts only the pod it holds
        } else {
          sync(dev);
          const next = docOps.nextLineage(lineage(drive));
          const folded = foldDoc(drive, next.seq);
          if (folded.ledger.collisions > 0) {
            failures.push(
              `seed ${SEED} it ${it}: ledger name collision x${folded.ledger.collisions}`
            );
          }
          bump(tally, 'ledger_pruned', folded.ledger.pruned);
          drive = Automerge.from(
            { ...folded, podLineage: { ...next, fromHeads: getHeads(drive) } },
            { actor: actor() }
          ) as unknown as Doc;
          dev.doc = Automerge.clone(drive, { actor: actor() });
          dev.baseline = getHeads(drive);
          history.push(saveDoc(drive));
          bump(tally, 'compactions');
        }
      } else if (roll < 92) {
        move = 'reload';
        dev.doc = Automerge.clone(dev.doc, { actor: actor() });
        bump(tally, 'reloads');
      } else {
        move = 'restore';
        if (onDriveLineage(dev)) sync(dev);
        const older = history.map((bytes) => loadDoc(bytes)).filter((d) => seqOf(d) < seqOf(drive));
        const file = rng.pick(older);
        if (file && onDriveLineage(dev)) {
          const next = docOps.nextLineage(lineage(drive));
          drive = Automerge.change(Automerge.clone(file, { actor: actor() }), (d) => {
            (d as unknown as { podLineage: unknown }).podLineage = {
              ...next,
              restoreSeq: next.seq,
            };
          });
          for (const id of ACCS) truth.set(id, balance(file, id)); // rolled back to the file
          dev.doc = Automerge.clone(drive, { actor: actor() });
          dev.baseline = getHeads(drive);
          history.push(saveDoc(drive));
          bump(tally, 'restores');
        }
      }
      trace.push(
        `it ${it} ${dev.name} ${move}: drive seq=${seqOf(drive)} restoreSeq=${lineage(drive)?.restoreSeq ?? '-'} dev seq=${seqOf(dev.doc)} truth=${ACCS.map((id) => truth.get(id)).join('/')} fold=${ACCS.map((id) => balance(drive, id)).join('/')}`
      );
      const before = failures.length;
      check(it, move);
      if (before === 0 && failures.length > 0) firstFailAt = trace.length;
      if (failures.length > 10) break;
    }
    // Drain: every device syncs, so every adjustment has reached Drive.
    for (const dev of devs) sync(dev);
    check(ITERATIONS, 'drain');

    const fmt = (t: Tally) =>
      [...t]
        .sort((x, y) => (x[0] < y[0] ? -1 : 1))
        .map(([k, v]) => `    ${v.toString().padStart(5)}  ${k}`)
        .join('\n') || '    (none)';
    process.stdout.write(
      [
        '',
        `── crdt117 chaos layer 6: seed ${SEED}, ${ITERATIONS} rounds, Drive at generation ${seqOf(drive)}, loss bound ${lossBound}`,
        fmt(tally),
        `  failures: ${failures.length}`,
        ...failures.slice(0, 15).map((f) => `    ${f}`),
        ...(failures.length && !REAL_POD
          ? [
              '  trace (up to the first failure):',
              ...trace.slice(Math.max(0, firstFailAt - 40), firstFailAt),
            ]
          : []),
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

  it('a pre-#117 pod (collections created as d[name] = {} by a random actor) is untouched apart from the one deterministic counterDeltas creation', () => {
    const old = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      for (const name of COLLECTION_NAMES) (d as Any)[name] = {};
      (d as Any).settings = { id: 'app_settings', baseCurrency: 'USD', exchangeRates: [] };
      (d as Any).todos.t1 = { id: 't1', title: 'old pod todo', completed: false };
    });
    const loaded = loadDoc(saveDoc(old));
    // #117 Phase 2: the stored `counterDeltas` change (deps []) is the ONE addition, so the
    // old heads stay and exactly one concurrent head joins them. No collection is touched.
    expect(getHeads(loaded)).toEqual(expect.arrayContaining([...getHeads(old)]));
    expect(getHeads(loaded)).toHaveLength(getHeads(old).length + 1);
    expect(Automerge.toJS(loaded)).toEqual({ ...Automerge.toJS(old), counterDeltas: {} });
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

  it('the peer keeps its offline edits on the compacted lineage; updatedAt collisions are NOT conflicts', async () => {
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
    // C9d (data-layer audit 2026-10-03), the former FOLLOW-UP: the composer used to count
    // `updatedAt` collisions (both devices stamped the same entity/settings) as conflicts. It no
    // longer does, so with no user-data field colliding, `conflicts` must be exactly 0.
    const stampClashes = clash.filter((f) => f.endsWith('.updatedAt'));
    expect(clash.filter((f) => !f.endsWith('.updatedAt'))).toEqual([]);
    expect(ops!.conflicts).toBe(0);
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
    expect(res.conflicts ?? 0).toBe(0); // C9d: a stamp is never a conflict
    expect(res.rootConflicts?.added ?? 0).toBe(0);
    const m2 = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as Any;
    expect(peerProbes.map((p) => p(m2))).toEqual(peerProbes.map(() => true));
    expect(compactorProbes.map((p) => p(m2))).toEqual(compactorProbes.map(() => true));
    report.push(`rebase: replayed=${res.replayed} conflicts=${res.conflicts} action=${res.action}`);
  });

  it('compaction with unsynced increments (switch on): the peer adjustment lands exactly once', async () => {
    const key = await generateFamilyKey();
    ap.reset();
    ap.configure({
      pushChunk() {},
      perf() {},
      cachePersistFailed() {},
      cacheReleased() {},
    } as never);
    await ap.setKey(key);
    const ACC = 'demo-account-current';
    const GOAL = 'chaos-goal-history';
    const shown = (doc: Doc) => foldedView(doc) as Any;
    const start = shown(BASE);

    // The peer adjusts and that reaches Drive: its key is in the document the compactor folds.
    const peer: Device = { name: 'peer', doc: Automerge.clone(BASE, { actor: ACTOR.b }) };
    await on(peer, () => increment('accounts', ACC, 'balance', -1.11));
    const baselineHeads = getHeads(peer.doc);

    // The compactor folds it (the real compactDoc), then adjusts the same account on the new lineage.
    ap.loadSnapshot(Automerge.save(peer.doc));
    ap.compactDoc();
    const compacted = Automerge.load<FamilyDocument>(ap.exportSnapshot().binary);
    expect(Object.keys((compacted as Any).counterDeltas)).toEqual([]);
    expect(Object.keys((compacted as Any).foldedCounters ?? {})).toHaveLength(1);
    const target: Device = {
      name: 'compactor',
      doc: Automerge.clone(compacted, { actor: ACTOR.a }),
    };
    await on(target, () => increment('accounts', ACC, 'balance', -2.22));

    // The peer, still on the old lineage and offline, keeps adjusting on its OWN key (growth
    // past the ledger entry) and contributes to a goal it never adjusted before.
    await on(peer, () => increment('accounts', ACC, 'balance', -3.33));
    await on(peer, () => quickContribute(GOAL, 7.77, 'chaos-rebase-entry', OWNER));

    ap.loadSnapshot(Automerge.save(peer.doc));
    const res = await ap.mergeRemoteEnvelope((await envelopeFor(target.doc, key)) as never, 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });
    expect(res.action).toBe('rebased');
    // The peer's keys are foreign to the reloaded session (a fresh actor inside `ap`), and they
    // cross anyway: nobody owns a key. The -3.33 is a negative, carried because the session
    // holds every change the compactor folded (`fromHeads`): fresh.
    expect(res.counterRebase).toMatchObject({
      carries: 2,
      skipped: 0,
      mode: 'ledger',
      fresh: true,
    });
    expect(res.counterStats).toMatchObject({ conflicts: 0, malformed: 0, ledgerKeys: 1 });
    const out = Automerge.load<FamilyDocument>(ap.exportSnapshot().binary);
    expect(counterHealth(out)).toEqual([]);
    const m = shown(out);
    // -1.11 folded once, -2.22 the compactor's live key, -3.33 the carried growth, once.
    expect(m.accounts[ACC].balance).toBe(
      (toMinor(start.accounts[ACC].balance, 2) - 111 - 222 - 333) / 100
    );
    expect(m.goals[GOAL].currentAmount).toBe(
      (toMinor(start.goals[GOAL].currentAmount ?? 0, 2) + 777) / 100
    );
    expect(
      (m.goals[GOAL].manualContributions as Any[]).filter((c) => c.id === 'chaos-rebase-entry')
    ).toHaveLength(1);
    report.push(
      `rebase with Counters: replayed=${res.replayed} conflicts=${res.conflicts} counter_carries=${res.counterRebase?.carries} ledger_keys=${res.counterStats?.ledgerKeys}`
    );
  });

  it.skipIf(REAL_POD)(
    'C8: both sides changed the SAME id-keyed list array -> unioned through base, both edits kept',
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
        `rebase same-array both sides: conflicts=${ops?.conflicts} fields=[${clash.join(', ')}] op=${ops?.op ? 'present' : 'none'}`
      );
      // ⚠️ BEHAVIOUR CHANGED (C8/C9d, data-layer audit 2026-10-03): this used to be a counted
      // conflict (2, with the `updatedAt` overcount) that kept the saved copy and dropped the
      // peer's tick. The list's items carry ids, so the rebase now unions them through `base`.
      expect(clash).toEqual(['lists.items', 'lists.updatedAt']);
      expect(ops?.conflicts).toBe(0);
      const out = Automerge.toJS(
        applyMutation(migrateDoc(Automerge.clone(target.doc)), ops!.op as MutationOp).doc
      ) as Any;
      const itemOf = (m: Any, id: string) =>
        (m.lists[LIST].items as Any[]).find((i) => i.id === id);
      const peerM = Automerge.toJS(peer.doc) as Any;
      const targetM = Automerge.toJS(target.doc) as Any;
      expect(itemOf(out, 'demo-list-item-3')).toEqual(itemOf(peerM, 'demo-list-item-3'));
      expect(itemOf(out, 'demo-list-item-5')).toEqual(itemOf(targetM, 'demo-list-item-5'));
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

  it('checker sensitivity: (vi) fails when a Counter adjustment is missing from the merge', async () => {
    const { A, B } = fork(BASE);
    await on(A, () => increment('accounts', 'demo-account-current', 'balance', -20.25));
    await on(B, () => increment('accounts', 'demo-account-current', 'balance', -30.5));
    // A "merge" that kept only A's side must fail; the real merge must not.
    const lost = checkCounters(BASE, A.doc, B.doc, A.doc);
    expect(lost).toEqual([
      "(vi) accounts/demo-account-current#balance: merged is not origin + both sides' adjustments",
    ]);
    expect(checkCounters(BASE, A.doc, B.doc, converge(A.doc, B.doc).a)).toEqual([]);
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
