// @vitest-environment node
/**
 * #124 R7: how many ops does two years of one daily list cost, with the scalar writer OFF and
 * ON? The plan's acceptance number (ON ≤ 250k ops) comes from here.
 *
 * ── What it replays ──────────────────────────────────────────────────────────
 *
 * The 2026-10-05 workload, but through the REAL worker write path (`applyMutation`, the very
 * function the worker runs), with the op shapes the stores actually send:
 *  - a tick is `listStore.toggleItem` → `automergeRepository.update` → `patchOp`: a `patch` of
 *    the whole `items` array (+ `deriveCompletion`'s `cycleCelebrated`), its projection `base`,
 *    `updatedAt` and `onMissing: 'skip'`;
 *  - the nightly reset is `reconcileRecurringLists` → `listCycleRepository.archiveCycleAndReset`:
 *    ONE `batch` of the `ListCycle` snapshot `set` (the real `buildCycleSnapshot`) and the reset
 *    `patchOp` (every item unticked, `lastResetDate`, `cycleCelebrated: false`), gated by the
 *    real `computeRecurringReset`;
 *  - the sweep is `sweepExpiredCycles` → `deleteCycles`: a `batch` of `delete`s from the real
 *    `expiredCycleIds` (90 days).
 * One 10-item daily list; each day ~70% of the items are ticked, each by one of two member ids,
 * with a 24-char ISO `completedAt`. A seeded PRNG makes both runs replay the same days.
 *
 * ── Running it ───────────────────────────────────────────────────────────────
 *
 *   npx vitest run src/services/automerge/__diagnostics__/scalarStringsSim.spec.ts
 *
 * No fixture; `SCALAR_SIM_DAYS` (default 120, acceptance 730) sets the window. It prints one table (ops, changes, saved bytes, `Automerge.load` ms
 * for OFF and ON). `process.stdout.write`, never `console.log`: the output IS the artefact.
 * Load ms is a desktop figure (median of 3); phones are several times slower, and the RATIO is
 * the finding.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { FamilyList, FamilyListItem, ListCycle } from '@/types/models';
import { applyMutation, migrateDoc } from '@/services/automerge/worker/docOps';
import type { MutationOp, ProjectionDelta } from '@/services/automerge/worker/protocol';
import { isImmutableString, setScalarMint } from '@/services/automerge/worker/scalarStrings';
import { buildCycleSnapshot, expiredCycleIds } from '@/utils/listCycles';
import { computeRecurringReset } from '@/utils/listLifecycle';

type Doc = Automerge.Doc<FamilyDocument>;

// The plan's acceptance workload is two years (730 days), which replays in ~55 s because the
// shipped reconciler's canonicalEqual reads draft proxies through JSON (~4 ms per tick, same on
// main). The default suite runs a 120-day window so this spec costs ~9 s there; the acceptance
// run is `SCALAR_SIM_DAYS=730 npx vitest run <this file>`. The op budget scales with the window.
const FULL_DAYS = 730;
const DAYS = Number(process.env.SCALAR_SIM_DAYS ?? 120);
const ITEMS = 10;
const TICK_RATE = 0.7;
const LIST_ID = '7d1e9a52-3c4b-4f0e-9a1d-2b6c8e4f0a17';
const MEMBERS = ['0b9f4c2e-6a71-4d38-8e5f-1c2a3b4d5e6f', '5e2d8a10-9b47-4c6e-a3f1-7d8c9e0f1a2b'];
const START = Date.UTC(2024, 9, 20); // 2024-10-20, two years before this measurement

/** mulberry32: a tiny deterministic PRNG, so OFF and ON replay byte-identical workloads. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;

/** What main would hold for an entity: the JSON projection (`toPlain`). */
const plain = <T>(v: unknown): T => JSON.parse(JSON.stringify(v)) as T;

/** `pickBase`: the projection values for the patched keys, absent keys left absent. */
function baseFor(current: Record<string, unknown>, keys: readonly string[]) {
  const picked: Record<string, unknown> = {};
  for (const k of keys) if (current[k] !== undefined) picked[k] = current[k];
  return plain<Record<string, unknown>>(picked);
}

/** `patchOp` + `automergeRepository.update`'s split: top-level `undefined`s become deletes. */
function patchOp(current: FamilyList, input: Record<string, unknown>, now: string): MutationOp {
  const patch: Record<string, unknown> = {};
  const deleteKeys: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) deleteKeys.push(k);
    else patch[k] = v;
  }
  return {
    op: 'patch',
    collection: 'lists',
    id: current.id,
    patch: plain(patch),
    base: baseFor(current as unknown as Record<string, unknown>, Object.keys(patch)),
    ...(deleteKeys.length ? { deleteKeys } : {}),
    updatedAt: now,
    onMissing: 'skip',
  };
}

function itemId(i: number): string {
  return `${String(i).padStart(8, '0')}-1111-4222-8333-${'4'.repeat(12)}`;
}

function seedList(now: string): FamilyList {
  const items: FamilyListItem[] = Array.from({ length: ITEMS }, (_, i) => ({
    id: itemId(i),
    title: ['Brush teeth', 'Make bed', 'Feed the cat', 'Pack bag', 'Read 20 min'][i % 5]!,
    completed: false,
    createdAt: now,
  })) as FamilyListItem[];
  return {
    id: LIST_ID,
    title: 'Morning routine',
    emoji: '☀️',
    category: 'kids',
    ownerId: MEMBERS[0]!,
    items,
    lifecycle: 'recurring',
    frequency: 'daily',
    lastResetDate: now.slice(0, 10),
    cycleCelebrated: false,
    completed: false,
    createdBy: MEMBERS[0]!,
    createdAt: now,
    updatedAt: now,
  };
}

interface Run {
  doc: Doc;
  cyclesArchived: number;
  cyclesSwept: number;
  ms: number;
}

/** Replay the workload. The mint (or none) is installed by the caller. */
function replay(): Run {
  const t0 = performance.now();
  const rand = prng(124);
  let doc: Doc = migrateDoc(Automerge.init<FamilyDocument>());
  // Main's projection, kept the way the stores keep it: from each mutation's echoed delta
  // (plain JSON, which is all main ever sees), never by reading the document back.
  let list: FamilyList | undefined;
  const cycles = new Map<string, ListCycle>();
  const project = (d: ProjectionDelta): void => {
    if (d.kind === 'multi') return d.deltas.forEach(project);
    if (d.kind === 'upsert' && d.collection === 'lists') list = plain<FamilyList>(d.entity);
    if (d.kind === 'upsert' && d.collection === 'listCycles') {
      cycles.set(d.id, plain<ListCycle>(d.entity));
    }
    if (d.kind === 'remove' && d.collection === 'listCycles') cycles.delete(d.id);
  };
  const apply = (op: MutationOp) => {
    const out = applyMutation(doc, op);
    doc = out.doc;
    project(out.delta);
  };
  const listOf = (): FamilyList => list!;

  apply({ op: 'set', collection: 'lists', id: LIST_ID, entity: seedList(iso(START)) });
  let cyclesArchived = 0;
  let cyclesSwept = 0;

  for (let day = 0; day < DAYS; day++) {
    const dayMs = START + day * DAY_MS;
    // Ticks through the day: `toggleItem` on an open item.
    for (let i = 0; i < ITEMS; i++) {
      if (rand() >= TICK_RATE) continue;
      const list = listOf();
      const at = iso(dayMs + (7 * 60 + i * 37) * 60_000 + Math.floor(rand() * 59_000));
      const by = MEMBERS[rand() < 0.5 ? 0 : 1]!;
      const items = list.items.map((it) =>
        it.id !== itemId(i) ? it : { ...it, completed: true, completedBy: by, completedAt: at }
      );
      const allDone = items.every((it) => it.completed);
      const completion = allDone && !list.cycleCelebrated ? { cycleCelebrated: true } : {};
      apply(patchOp(list, { items, ...completion }, at));
    }

    // Midnight: `reconcileRecurringLists` on the next day.
    const nextMs = dayMs + DAY_MS;
    const today = ymd(nextMs);
    const list = listOf();
    const { shouldReset, nextResetDate } = computeRecurringReset(list, today);
    if (shouldReset) {
      const now = iso(nextMs + 60_000);
      const reset = {
        items: list.items.map((it) => ({
          ...it,
          completed: false,
          completedBy: undefined,
          completedAt: undefined,
        })),
        lastResetDate: nextResetDate,
        cycleCelebrated: false,
      };
      const snapshot = buildCycleSnapshot(list, nextResetDate, now);
      if (snapshot) {
        apply({
          op: 'batch',
          ops: [
            { op: 'set', collection: 'listCycles', id: snapshot.id, entity: plain(snapshot) },
            patchOp(list, reset, now),
          ],
        });
        cyclesArchived++;
      }
    }

    // `sweepExpiredCycles` (the same wake): the 90-day retention.
    const expired = expiredCycleIds([...cycles.values()], today);
    if (expired.length) {
      apply({
        op: 'batch',
        ops: expired.map((id): MutationOp => ({ op: 'delete', collection: 'listCycles', id })),
      });
      cyclesSwept += expired.length;
    }
  }
  return { doc, cyclesArchived, cyclesSwept, ms: performance.now() - t0 };
}

/** Every string-ish leaf of `toJS(doc)` under the collections, with its own key. */
function leaves(
  node: unknown,
  key: string,
  out: Array<{ key: string; wrapped: boolean }> = []
): Array<{ key: string; wrapped: boolean }> {
  if (typeof node === 'string') out.push({ key, wrapped: false });
  else if (isImmutableString(node)) out.push({ key, wrapped: true });
  else if (Array.isArray(node)) node.forEach((v) => leaves(v, key, out));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) leaves(v, k, out);
  }
  return out;
}

function measure(doc: Doc) {
  const stats = Automerge.stats(doc);
  const bytes = Automerge.save(doc);
  const loads: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    Automerge.load(bytes);
    loads.push(performance.now() - t);
  }
  loads.sort((a, b) => a - b);
  return {
    ops: stats.numOps,
    changes: stats.numChanges,
    bytes: bytes.byteLength,
    loadMs: loads[1]!,
  };
}

const ON_BUDGET_OPS = Math.ceil((250_000 * DAYS) / FULL_DAYS);

describe('scalar strings: a 2-year daily list, writer OFF vs ON (#124 R7)', () => {
  afterEach(() => setScalarMint(null));

  it('prints ops / bytes / load ms for both, and ON meets the plan budget', () => {
    setScalarMint(null);
    const off = replay();
    setScalarMint((s) => new Automerge.ImmutableString(s));
    const on = replay();
    setScalarMint(null);

    const mOff = measure(off.doc);
    const mOn = measure(on.doc);
    const kb = (b: number) => `${(b / 1024).toFixed(0)} KB`;
    const row = (name: string, m: typeof mOff, r: Run) =>
      `  ${name.padEnd(5)}${m.ops.toLocaleString().padStart(10)}` +
      `${m.changes.toLocaleString().padStart(10)}${kb(m.bytes).padStart(10)}` +
      `${`${m.loadMs.toFixed(0)} ms`.padStart(10)}${`${(r.ms / 1000).toFixed(1)} s`.padStart(10)}`;
    process.stdout.write(
      [
        '',
        `─── scalar strings sim: ${DAYS} days, ${ITEMS} items, ~${TICK_RATE * 100}% ticked ` +
          '─'.repeat(16),
        `  ${''.padEnd(5)}${'ops'.padStart(10)}${'changes'.padStart(10)}${'saved'.padStart(10)}` +
          `${'load'.padStart(10)}${'replay'.padStart(10)}`,
        row('OFF', mOff, off),
        row('ON', mOn, on),
        `  ON/OFF ops ${(mOn.ops / mOff.ops).toFixed(2)}x, bytes ` +
          `${(mOn.bytes / mOff.bytes).toFixed(2)}x, load ${(mOn.loadMs / mOff.loadMs).toFixed(2)}x` +
          `  (cycles archived ${on.cyclesArchived}, swept ${on.cyclesSwept})`,
        '─'.repeat(64),
        '',
      ].join('\n')
    );

    // The workload ran as designed: a reset every day, the 90-day sweep live, same in both.
    expect(off.cyclesArchived).toBe(DAYS);
    expect(on.cyclesArchived).toBe(DAYS);
    expect(on.cyclesSwept).toBe(off.cyclesSwept);
    expect(on.cyclesSwept).toBe(Math.max(0, DAYS - 90 - 1));
    // Both writers produce the same family data; only the encoding differs.
    expect(JSON.parse(JSON.stringify(on.doc))).toEqual(JSON.parse(JSON.stringify(off.doc)));

    // The plan's acceptance number, and the point of it.
    expect(mOn.ops).toBeLessThanOrEqual(ON_BUDGET_OPS);
    expect(mOn.ops).toBeLessThan(mOff.ops);

    // OFF is the shipped encoding: no ImmutableString anywhere.
    const offLeaves = leaves(Automerge.toJS(off.doc), '');
    expect(offLeaves.length).toBeGreaterThan(100);
    expect(offLeaves.filter((l) => l.wrapped)).toEqual([]);

    // ON: every structural leaf the workload writes is a scalar (all written after the mint).
    const STRUCTURAL = ['completedBy', 'completedAt', 'id', 'listId', 'by', 'endedOn', 'startedOn'];
    const onLeaves = leaves(Automerge.toJS(on.doc), '');
    for (const key of STRUCTURAL) {
      const these = onLeaves.filter((l) => l.key === key);
      if (key !== 'completedBy' && key !== 'completedAt') {
        expect(these.length, `${key} leaves present`).toBeGreaterThan(0);
      }
      expect(these.filter((l) => !l.wrapped).length, `${key} written as text`).toBe(0);
    }
    // And prose stays collaborative text.
    expect(onLeaves.filter((l) => l.key === 'title').every((l) => !l.wrapped)).toBe(true);
  }, 120_000);
});
