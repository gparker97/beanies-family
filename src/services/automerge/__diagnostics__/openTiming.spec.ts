/**
 * How long does a cached open wait before the first paint, and does that wait grow with the
 * document? (2026-11-15, plan `2026-11-15-instant-open-and-no-needless-reloads.md`.)
 *
 * The open paints from a small projection snapshot while the full Automerge rebuild of the cached
 * document runs behind it. A store loader that awaits a document write queues that write behind
 * the rebuild in the serial worker FIFO, so the paint waits for the whole rebuild whenever a
 * load-time writer has work (a daily list due its reset, an overdue repeating to-do). This spec
 * measures that on a large SYNTHETIC family:
 *
 *  1. builds a family document through the real worker (`mutate`), then bloats its HISTORY the
 *     way the real file grew: many small changes, each its own change, that rewrite the same
 *     timestamp fields (a wall tablet's periodic stamp) and create then delete to-dos (churn);
 *  2. writes it to the real per-family cache (encrypted base row + envelope) and flushes, which
 *     also persists the real projection snapshot, exactly as a previous session leaves it. The
 *     document holds a DAILY recurring list last reset yesterday, still ticked;
 *  3. tears the realm down as a new app process would (the cache DB is kept), and performs the
 *     real open: `syncStore.loadFromPersistenceCache` with real Pinia stores and the real
 *     docClient over the inline bridge. The executor is only OBSERVED (timestamps), never held.
 *
 * Reported per size, in one line: `OPEN_TIMING {...}` with `paintMs` (open start to
 * `onEarlyPaint`), `authoritativeMs` (to the rebuild's reply, the authoritative document landing),
 * `openResolvedMs` (to the open resolving, the stores re-hydrated), `resetWriteMs` (to the daily
 * reset's write landing in the projection), and the document's changes, ops and bytes.
 *
 * ⚠️ The inline bridge runs the worker's code ON THIS THREAD, so absolute numbers are not device
 * numbers, and a synchronous rebuild blocks the main thread here where a real worker would not.
 * The SHAPE is the result: whether the paint waits for the rebuild, and whether it grows with
 * the document.
 *
 * ── Running it ───────────────────────────────────────────────────────────────
 *
 *   OPEN_TIMING=1 OPEN_TIMING_CHANGES=2000,10000 \
 *     npx vitest run src/services/automerge/__diagnostics__/openTiming.spec.ts
 *
 * `OPEN_TIMING_CHANGES` is a comma list of history sizes (changes added on top of the seeded
 * family; default 10000, a rebuild of a few seconds here); each runs as its own family. The
 * owner's real file is ~36,700 changes / 6.8M ops; 36000 here is ~5.6M ops and takes a few
 * minutes to generate (text-object writes cost ~0.3 ms each in wasm). A tiny warm-up open runs first so module loading is not
 * charged to the first measured size. Without `OPEN_TIMING=1` it SKIPS, visibly.
 *
 * The same file runs on code from before `loadMaintenance.ts` existed (found with
 * `import.meta.glob`, so its absence is not an import error); the code label is `new` when that
 * module is present, else `old`, and can be overridden with `OPEN_TIMING_CODE`.
 *
 * All names and data are invented.
 */
import 'fake-indexeddb/auto';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { GlobalSettings } from '@/types/models';

const ENABLED = process.env.OPEN_TIMING === '1';
const SIZES = (process.env.OPEN_TIMING_CHANGES ?? '10000')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);

if (!ENABLED) {
  process.stdout.write(
    [
      '',
      '⚠ open timing SKIPPED: OPEN_TIMING=1 not set.',
      '',
      '    OPEN_TIMING=1 OPEN_TIMING_CHANGES=2000,10000 \\',
      '      npx vitest run src/services/automerge/__diagnostics__/openTiming.spec.ts',
      '',
    ].join('\n')
  );
}

const mockGlobalSettings: GlobalSettings = {
  id: 'global_settings',
  theme: 'system',
  language: 'en',
  lastActiveFamilyId: null,
  exchangeRates: [],
  exchangeRateAutoUpdate: true,
  exchangeRateLastFetch: null,
  isTrustedDevice: false,
  trustedDevicePromptShown: false,
};

// The app-level boundaries only (global settings DB, registry, Drive sync). The doc layer, the
// per-family cache (fake-indexeddb) and every store are real.
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ ...mockGlobalSettings }),
  getGlobalSettings: vi.fn(async () => ({ ...mockGlobalSettings })),
  saveGlobalSettings: vi.fn(async (p: Partial<GlobalSettings>) => ({
    ...mockGlobalSettings,
    ...p,
  })),
  setGlobalTheme: vi.fn(),
  setGlobalLanguage: vi.fn(),
  setLastActiveFamilyId: vi.fn(),
  updateGlobalExchangeRates: vi.fn(),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'family-bench', activeFamilyName: 'Bench' }),
}));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => 'family-bench'),
  getDatabase: vi.fn(async () => ({})),
  closeDatabase: vi.fn(async () => {}),
}));
vi.mock('@/services/registry/registryService', () => ({
  addRegistryEntryObserver: () => () => {},
  registerFamily: vi.fn(async () => {}),
  registerFamilyOrThrow: vi.fn(async () => {}),
  removeFamily: vi.fn(async () => {}),
  lookupFamily: vi.fn(async () => null),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getSyncCapabilities: () => ({ hasFileSystemAccess: true }),
  canAutoSync: () => true,
  supportsFileSystemAccess: () => true,
  isNative: () => false,
}));
vi.mock('@/services/sync/syncService', async () => ({
  ...(await import('../../sync/__mocks__/syncService')),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  inlineExecutor,
  setInlineSignalHandler,
  __resetInlineBridgeForTesting,
} from '@/services/automerge/worker/inlineBridge';
import * as docClient from '@/services/automerge/worker/docClient';
import { __resetApplyAndProjectForTesting } from '@/services/automerge/worker/applyAndProject';
import { __resetCacheForTesting } from '@/services/automerge/worker/cache';
import { getById, resetProjection } from '@/services/automerge/projection';
import { importFamilyKey } from '@/services/crypto/familyKeyService';
import type { CollectionName } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import { addDaysYmd, localToday } from '@/utils/date';
import { useSyncStore } from '@/stores/syncStore';

// Present only on the new code. A glob is empty when the file is absent, never an import error.
type LoadMaintenance = typeof import('../loadMaintenance');
const maintenanceModules = import.meta.glob('../loadMaintenance.ts');
const maintenanceLoader = Object.values(maintenanceModules)[0] as
  (() => Promise<LoadMaintenance>) | undefined;
const CODE = process.env.OPEN_TIMING_CODE ?? (maintenanceLoader ? 'new' : 'old');

const KEY_BYTES = new Uint8Array(32).fill(11);
const KEY_B64 = btoa(String.fromCharCode(...KEY_BYTES));
const TS = '2024-03-01T08:00:00.000Z';
const today = localToday();
const yesterday = addDaysYmd(today, -1);
const LIST_ID = 'list-daily-chores';
const WALL_ID = 'member-wall';

/** An invented family with one daily list due its reset and one overdue repeating to-do. */
function familyEntities(): Array<[CollectionName, Record<string, unknown>]> {
  const member = (id: string, name: string, role: string, color: string) => ({
    id,
    name,
    email: `${id}@example.test`,
    role,
    color,
    passwordHash: 'h',
    createdAt: TS,
    updatedAt: TS,
  });
  const out: Array<[CollectionName, Record<string, unknown>]> = [
    ['familyMembers', member('owner', 'Robin Example', 'owner', '#F15D22')],
    ['familyMembers', member('member-sam', 'Sam Example', 'member', '#2C3E50')],
    ['familyMembers', member('member-kit', 'Kit Example', 'member', '#AED6F1')],
    ['familyMembers', member('member-ivy', 'Ivy Example', 'member', '#E67E22')],
    ['familyMembers', member(WALL_ID, 'Kitchen Wall', 'member', '#888888')],
    [
      'lists',
      {
        id: LIST_ID,
        title: 'Morning Routine',
        emoji: '🧹',
        category: 'home',
        ownerId: 'owner',
        lifecycle: 'recurring',
        frequency: 'daily',
        lastResetDate: yesterday,
        completed: false,
        items: ['Make bed', 'Brush teeth', 'Feed the fish', 'Pack school bag'].map((text, i) => ({
          id: `item-${i}`,
          text,
          completed: true,
          completedBy: 'member-kit',
          completedAt: `${yesterday}T07:3${i}:00.000Z`,
          createdAt: TS,
        })),
        createdBy: 'owner',
        createdAt: TS,
        updatedAt: TS,
      },
    ],
    [
      'todos',
      {
        id: 'todo-recycling',
        title: 'Recycling out',
        completed: false,
        createdBy: 'owner',
        dueDate: addDaysYmd(today, -20),
        repeat: {
          rule: { unit: 'week', interval: 1, end: { kind: 'never' } },
          anchor: addDaysYmd(today, -60),
        },
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  ];
  // Some ordinary data so the projection (and the snapshot) is not trivially small.
  for (let i = 0; i < 120; i++) {
    out.push([
      'todos',
      {
        id: `todo-${i}`,
        title: `Errand number ${i}`,
        description: 'Invented to-do for the open-timing bench',
        completed: i % 3 === 0,
        createdBy: 'owner',
        dueDate: addDaysYmd(today, (i % 30) + 1),
        createdAt: TS,
        updatedAt: TS,
      },
    ]);
  }
  for (let i = 0; i < 12; i++) {
    out.push([
      'lists',
      {
        id: `list-${i}`,
        title: `Shopping ${i}`,
        emoji: '🛒',
        category: 'shopping',
        ownerId: 'owner',
        completed: false,
        items: Array.from({ length: 8 }, (_, j) => ({
          id: `l${i}-${j}`,
          text: `Thing ${j}`,
          completed: false,
          createdAt: TS,
        })),
        createdBy: 'owner',
        createdAt: TS,
        updatedAt: TS,
      },
    ]);
  }
  return out;
}

function envelopeFor(familyId: string): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId,
    familyName: 'Bench Family',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
  } as unknown as BeanpodFileV4;
}

const actor = (byte: string) => byte.repeat(16);

let stageStart = performance.now();
/** Progress on stderr, so a slow or stuck stage names itself. */
function stage(name: string): void {
  const now = performance.now();
  process.stderr.write(`[open-timing] ${name} (+${Math.round(now - stageStart)}ms)\n`);
  stageStart = now;
}

/** The wall tablet's periodic stamp fields, rewritten together in each stamp change. */
const STAMP_FIELDS = [
  'updatedAt',
  'lastSeenAt',
  'calendarCheckedAt',
  'choresCheckedAt',
  'weatherCheckedAt',
  'photosCheckedAt',
  'heartbeatAt',
];

/**
 * Add `n` changes on top of `binary`, each its own change, from two devices: a wall tablet that
 * re-stamps the same seven timestamp fields (4 of every 5 changes), and a phone that creates a
 * to-do and deletes it in a later change (the other 1 of 5). Each string is written as a text
 * object, as a plain-string assignment made them before the scalar writer (#124), so a stamp
 * change is ~175 ops (the owner's file averages ~185 ops per change).
 *
 * Written through the low-level handle (`getBackend` + `fork`/`putObject`/`commit`) because
 * `Automerge.change` costs ~4 ms per change here (proxy + patch materialisation), which made a
 * real-sized history take minutes to generate. The bytes produced are ordinary changes.
 * Returns the whole document's binary.
 */
function bloat(binary: Uint8Array, n: number): Uint8Array {
  const base = Automerge.load(binary);
  const root = Automerge.getBackend(base);
  const tablet = root.fork(actor('aa'));
  const phone = root.fork(actor('bb'));
  const objOf = (h: typeof root, parent: string, key: string): string => {
    const id = h.get(parent, key);
    if (typeof id !== 'string') throw new Error(`no object at ${parent}/${key}`);
    return id;
  };
  const wall = objOf(tablet, objOf(tablet, '_root', 'familyMembers'), WALL_ID);
  const todos = objOf(phone, '_root', 'todos');
  const t0 = Date.parse(TS);
  let churn = 0;
  for (let i = 0; i < n; i++) {
    const iso = new Date(t0 + i * 300_000).toISOString();
    const time = Math.floor((t0 + i * 300_000) / 1000);
    if (i % 5 !== 4) {
      for (const f of STAMP_FIELDS) tablet.putObject(wall, f, iso);
      tablet.commit(null, time);
    } else if (churn % 2 === 0) {
      const id = `churn-${churn}`;
      const t = phone.putObject(todos, id, {});
      phone.putObject(t, 'id', id);
      phone.putObject(t, 'title', 'Temporary reminder to sign the permission slip');
      phone.putObject(t, 'description', 'Created and later deleted, as people do');
      phone.put(t, 'completed', false);
      phone.putObject(t, 'createdBy', 'member-sam');
      phone.putObject(t, 'dueDate', today);
      phone.putObject(t, 'createdAt', iso);
      phone.putObject(t, 'updatedAt', iso);
      phone.commit(null, time);
      churn++;
    } else {
      phone.delete(todos, `churn-${churn - 1}`);
      phone.commit(null, time);
      churn++;
    }
  }
  tablet.merge(phone);
  const out = tablet.save();
  tablet.free();
  phone.free();
  Automerge.free(base);
  return out;
}

/** The realm a fresh app process has: no doc, no key, no projection, the cache DB on disk. */
function freshRealm(): void {
  docClient.__resetDocClientForTesting();
  __resetApplyAndProjectForTesting();
  __resetInlineBridgeForTesting();
  __resetCacheForTesting();
  resetProjection();
}

/** Build the family, bloat its history, and leave it in the per-family cache with a snapshot. */
async function seed(
  familyId: string,
  n: number
): Promise<{ changes: number; ops: number; bytes: number; generationMs: number }> {
  const start = performance.now();
  setActivePinia(createPinia());
  await installInlineBackend();
  const fk = await importFamilyKey(KEY_BYTES);
  await docClient.setFamilyKey(fk, familyId);
  for (const [collection, entity] of familyEntities()) {
    await docClient.mutate({ op: 'set', collection, id: entity.id as string, entity });
  }
  stage(`seed ${familyId}: family written`);
  const { binary } = await docClient.exportSnapshot();
  const bloated = bloat(binary, n);
  stage(`seed ${familyId}: ${n} history changes generated`);
  // Installed as the live document (the DEV/E2E seed path: load + full projection push).
  await docClient.loadSnapshot(bloated);
  stage(`seed ${familyId}: history installed`);
  // Name the cache for this document, then write the envelope, the base and the snapshot.
  await docClient.openCache(familyId);
  await docClient.persistEnvelope(envelopeFor(familyId));
  await docClient.flush();
  stage(`seed ${familyId}: cache + snapshot written`);
  const { binary: finalBinary } = await docClient.exportSnapshot();
  const doc = Automerge.load(finalBinary);
  const st = Automerge.stats(doc);
  Automerge.free(doc);
  freshRealm();
  return {
    changes: st.numChanges,
    ops: st.numOps,
    bytes: finalBinary.byteLength,
    generationMs: Math.round(performance.now() - start),
  };
}

interface OpenResult {
  snapshotHit: boolean;
  paintMs: number | null;
  snapshotReplyMs: number | null;
  authoritativeMs: number | null;
  openResolvedMs: number;
  resetWriteMs: number | null;
  mutatesIssuedBeforePaint: number;
  mutatesTotal: number;
  loadPhaseViolations: string[] | null;
  openSuccess: boolean;
}

/** The real open, observed. Nothing is held: every call goes straight to the inline executor. */
async function timedOpen(familyId: string): Promise<OpenResult> {
  setActivePinia(createPinia());
  localStorage.clear();
  const maintenance = maintenanceLoader ? await maintenanceLoader() : null;
  maintenance?.__resetLoadMaintenanceForTesting();
  maintenance?.clearStoresAuthoritative();

  const r: Omit<OpenResult, 'openResolvedMs' | 'openSuccess' | 'loadPhaseViolations'> = {
    snapshotHit: false,
    paintMs: null,
    snapshotReplyMs: null,
    authoritativeMs: null,
    resetWriteMs: null,
    mutatesIssuedBeforePaint: 0,
    mutatesTotal: 0,
  };
  let t0 = 0;
  const since = () => Math.round(performance.now() - t0);
  const resetLanded = () =>
    (getById('lists', LIST_ID) as { lastResetDate?: string } | undefined)?.lastResetDate === today;

  docClient.setInlineExecutor(async (method, args) => {
    if (method === 'mutate') {
      r.mutatesTotal++;
      if (r.paintMs === null) r.mutatesIssuedBeforePaint++;
    }
    const reply = await inlineExecutor(method, args);
    if (method === 'loadProjectionSnapshot') r.snapshotReplyMs = since();
    if (method === 'initAndLoadCache') r.authoritativeMs = since();
    if (method === 'mutate' && r.resetWriteMs === null && resetLanded()) r.resetWriteMs = since();
    return reply;
  });
  setInlineSignalHandler(docClient.receiveSignal);
  docClient.forceInlineMode();

  t0 = performance.now();
  const res = await useSyncStore().loadFromPersistenceCache(KEY_B64, familyId, {
    preservePermissionState: true,
    onEarlyPaint: () => {
      r.paintMs = since();
      r.snapshotHit = true;
    },
  });
  const openResolvedMs = since();
  stage(`open ${familyId}: resolved (success=${res.success})`);
  // The reset lands during the open on old code, after it (maintenance) on new code.
  // Polled as well as checked on each write's reply, in case its delta lands after the reply.
  const deadline = performance.now() + 60_000;
  while (r.resetWriteMs === null && performance.now() < deadline) {
    if (resetLanded()) r.resetWriteMs = since();
    else await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (r.resetWriteMs === null) {
    const shown = getById('lists', LIST_ID) as { lastResetDate?: string } | undefined;
    process.stderr.write(
      `[open-timing] reset not seen: projection lastResetDate=${shown?.lastResetDate} ` +
        `today=${today} mutates=${r.mutatesTotal} authoritative=${maintenance?.storesAuthoritative.value}\n`
    );
  }
  // Read, NOT taken: the global setup's `afterEach` (src/test/setup.ts, new code) must still
  // see a load-phase write and fail this test for it.
  stage(`open ${familyId}: reset ${r.resetWriteMs === null ? 'NOT landed' : 'landed'}`);
  // Let the rest of the maintenance run finish, so nothing of this open leaks into the next.
  if (maintenance) await maintenance.__whenLoadMaintenanceIdleForTesting();
  await docClient.flush();
  const violations = maintenance
    ? [...((globalThis as { __beaniesLoadPhaseWrites?: string[] }).__beaniesLoadPhaseWrites ?? [])]
    : null;
  return { ...r, openResolvedMs, openSuccess: res.success, loadPhaseViolations: violations };
}

describe.skipIf(!ENABLED)(`open timing (${CODE} code)`, () => {
  it('warm-up (module loading is not charged to the first measured size)', async () => {
    await seed('family-bench-warmup', 20);
    const r = await timedOpen('family-bench-warmup');
    expect(r.openSuccess).toBe(true);
    expect(r.resetWriteMs).not.toBeNull();
    freshRealm();
  }, 180_000);

  for (const n of SIZES) {
    it(`measures a cached open over ~${n} history changes`, async () => {
      const familyId = `family-bench-${n}`;
      const size = await seed(familyId, n);
      const r = await timedOpen(familyId);
      const line = {
        code: CODE,
        changesAdded: n,
        changes: size.changes,
        ops: size.ops,
        bytes: size.bytes,
        generationMs: size.generationMs,
        snapshotHit: r.snapshotHit,
        paintMs: r.paintMs,
        snapshotReplyMs: r.snapshotReplyMs,
        authoritativeMs: r.authoritativeMs,
        openResolvedMs: r.openResolvedMs,
        resetWriteMs: r.resetWriteMs,
        mutatesIssuedBeforePaint: r.mutatesIssuedBeforePaint,
        mutatesTotal: r.mutatesTotal,
        loadPhaseViolations: r.loadPhaseViolations,
        openSuccess: r.openSuccess,
      };
      process.stdout.write(`\nOPEN_TIMING ${JSON.stringify(line)}\n`);
      expect(r.openSuccess).toBe(true);
      expect(r.snapshotHit).toBe(true);
      expect(r.resetWriteMs).not.toBeNull();
      freshRealm();
    }, 900_000);
  }
});
