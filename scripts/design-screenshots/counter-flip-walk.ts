import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoute } from '../../e2e/helpers/navigation';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { cleanupRegistry } from '../../e2e/helpers/cleanup';
import { ui } from '../../e2e/helpers/ui-strings';
import { TransactionsPage } from '../../e2e/page-objects/TransactionsPage';
import { AccountsPage } from '../../e2e/page-objects/AccountsPage';
import * as Automerge from '@automerge/automerge';
import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * NOT A TEST: the #117 writer-flip browser walk (plan
 * `~/projects/beanies-ops/docs/plans/2026-10-04-crdt-counters-117-writer-flip.md`, Testing Plan
 * item 10). Lives OUTSIDE `e2e/specs/` on purpose (ADR-007 budget; see capture.ts). The design
 * config only matches `*capture.ts`, so run it with a config whose `testMatch` names this file
 * and whose `baseURL` points at a dev server started from THIS checkout:
 *
 *   npx vite --port 5199 --strictPort &
 *   npx playwright test -c <config with testMatch /counter-flip-walk\.ts/, baseURL :5199>
 *
 * Devices are browser contexts on one family document. Changes travel as raw Automerge change
 * bytes between workers (dev-only `docClient.exportSnapshot` / `applyChanges`); every compaction,
 * adoption, rebase and restore goes through the REAL worker entry points (`compactDoc`,
 * `mergeRemoteEnvelope` with a `baseline` or `user-file` basis), so the lineage guard and the
 * Counter carry pass run exactly as on a device. Counter writes are turned on per realm through
 * `docClient.setCounterWrites(true, 'persisted')` (and the persisted policy key, so a reload or a
 * new tab boots on). Every balance ADJUSTMENT is a real-UI transaction (Transactions page, add
 * modal): an Accounts-page balance edit is an absolute set by design (`useAdjustBalance`), so it
 * cannot sum across devices; the Accounts page is where every balance is READ (the card's figure)
 * and where the step (e) dirty edit is made (a rename through the account edit modal).
 *
 * Steps (Testing Plan 10): (a) both adjust, merge, sum; (b) A compacts, dirty B rebases, B's
 * adjustment survives; (c) a second tab on B before a compaction, both dirty, both adopt (the
 * concurrent case): B's own adjustment lands once; (d) reload A mid-session, adjust, compact from
 * B, A rebases, A's pre-reload adjustment survives; (e) restore an earlier file on A, pre-restore
 * B with one unsynced adjustment adopts (baseline rule), then compact from A and B rebases: the
 * number does not move; (f) policy off -> on -> off: increments stop and resume, no jump.
 */

const SHOTS =
  process.env.WALK_SHOTS ??
  '/tmp/claude-1000/-home-greg-projects-beanies-family/d4e19b36-d9b3-463e-adea-647f5e47a83b/scratchpad/walk';
const ACCOUNT = 'Shared Checking';
const START = 1000;
const COUNTER_POLICY_KEY = 'beanies:counterWrites'; // STORAGE_KEYS.COUNTER_WRITES

type Account = { id: string; name: string; balance: number; currency: string };
type Data = {
  accounts: Account[];
  transactions: { id: string; description: string; amount: number; type: string }[];
};
type CounterRebase = {
  carries: number;
  skipped: number;
  superseded: number;
  mode: string;
  fresh: boolean;
};
type CounterStats = {
  keys: number;
  conflicts: number;
  carryConflicts: number;
  malformed: number;
  ledgerKeys: number;
  ledgerOldest: number | null;
};
type Outcome = {
  action: string;
  replayed?: number;
  conflicts?: number;
  counterRebase?: CounterRebase;
  counterStats?: CounterStats;
};
type Basis = { kind: 'baseline' | 'user-file'; heads: string[] | null };

const RESULTS: string[] = [];
const TERMINUS: string[] = [];
const say = (line: string) => {
  RESULTS.push(line);
  console.log(`[walk] ${line}`);
};

// ─── devices ────────────────────────────────────────────────────────────────

function baseURL(): string {
  return (test.info().project.use.baseURL as string | undefined) ?? 'http://localhost:5199';
}

/** Boot-time init shared by every realm: beanie mode off, and the persisted Counter policy ON so
 *  `installCounterWritesPolicy` retains `true` at boot (a reload or new tab included). */
async function initRealm(page: Page) {
  await page.addInitScript((key) => {
    (window as unknown as Record<string, unknown>).__e2e_beanie_off = true;
    try {
      localStorage.setItem(key, 'true');
    } catch {
      /* storage blocked: arm() still posts the policy explicitly */
    }
  }, COUNTER_POLICY_KEY);
}

/** The merge-terminus lines (`[telemetry:*] pod-lineage — <where> <action>` with its detail),
 *  echoed to the console in dev because no ingest URL is set. */
function wireConsole(page: Page, tag: string) {
  page.on('pageerror', (e) => console.log(`[${tag} pageerror] ${e.message}`));
  page.on('console', async (m) => {
    const text = m.text();
    if (
      process.env.WALK_DEBUG &&
      (m.type() === 'error' || /loadFamilyData|path[123]|init/i.test(text))
    )
      console.log(`[${tag} ${m.type()}] ${text.slice(0, 400)}`);
    if (!/pod-lineage|pod-rebase|counter-policy|compaction/.test(text)) return;
    let detail = '';
    try {
      const args = m.args();
      if (args.length > 1) detail = JSON.stringify(await args[1]!.jsonValue());
    } catch {
      /* page navigated mid-read */
    }
    const line = `[${tag}] ${text.split(' JSHandle')[0]} ${detail}`;
    if (/counter_carries|carry_conflicts|rebase_mode/.test(detail)) TERMINUS.push(line);
    console.log(line);
  });
}

async function newDevice(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ baseURL: baseURL() });
  const page = await ctx.newPage();
  await initRealm(page);
  await mockRegistry(page);
  return { ctx, page };
}

/** A second tab in `ctx` (same browser profile = same device) holding `bin`, booted through the
 *  real App.vue Path 3 seed restore, exactly as a reload restores a memory-provider pod. */
async function openTab(ctx: BrowserContext, bin: Uint8Array): Promise<Page> {
  const page = await ctx.newPage();
  await initRealm(page);
  await mockRegistry(page);
  await page.addInitScript((b64) => {
    if (sessionStorage.getItem('__walkSeeded')) return;
    sessionStorage.setItem('__walkSeeded', '1');
    sessionStorage.setItem('e2e_auto_auth', 'true');
    sessionStorage.setItem('__e2eSeedDoc', b64);
  }, Buffer.from(bin).toString('base64'));
  await page.goto('/accounts', { waitUntil: 'commit' });
  await ready(page);
  return page;
}

/**
 * Give the realm a family key (the E2E pod may not hold one after a reload) and turn Counter
 * writes on through the real setter. `setCounterWrites` retains the value and posts it only when
 * a key is set, so the key goes first.
 */
async function arm(page: Page, on = true) {
  await page.evaluate(async (on) => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    const { useSyncStore } = await import('/src/stores/syncStore.ts');
    const { getActiveFamilyId } = await import('/src/services/indexeddb/database.ts');
    const { generateFamilyKey } = await import('/src/services/crypto/familyKeyService.ts');
    const w = window as unknown as Record<string, unknown>;
    let key =
      (w.__walkKey as CryptoKey | undefined) ?? (useSyncStore().familyKey as CryptoKey | null);
    if (!key) key = await generateFamilyKey();
    w.__walkKey = key;
    const familyId = getActiveFamilyId() ?? 'walk-family';
    w.__walkFamilyId = familyId;
    await dc.setFamilyKey(key, familyId);
    await dc.setCounterWrites(on, 'persisted');
  }, on);
}

async function setPolicy(page: Page, on: boolean) {
  await page.evaluate(async (on) => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    await dc.setCounterWrites(on, 'persisted');
  }, on);
}

/** The signed-in layout has settled (App.vue shows `app-content` once `isLoadingData` clears).
 *  On a timeout, save what the realm is actually showing before failing. */
async function ready(page: Page, timeout = 60000) {
  try {
    await page
      .getByTestId('app-content')
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout });
  } catch (e) {
    await page.screenshot({ path: `${SHOTS}/debug-not-ready-${Date.now()}.png` }).catch(() => {});
    const flags = await page
      .evaluate(async () => {
        const { useAuthStore } = await import('/src/stores/authStore.ts');
        const { default: router } = await import('/src/router/index.ts');
        const a = useAuthStore();
        return {
          isAuthenticated: a.isAuthenticated,
          needsAuth: a.needsAuth,
          needsPodSetup: a.needsPodSetup,
          route: router.currentRoute.value.fullPath,
          ls: Object.fromEntries(
            Object.entries(localStorage).filter(([k]) => /pod|auth|family/i.test(k))
          ),
        };
      })
      .catch((err) => String(err));
    console.log(`[walk-debug] not ready: ${JSON.stringify(flags)}`);
    throw e;
  }
}

// ─── reads ──────────────────────────────────────────────────────────────────

async function exportData(page: Page): Promise<Data> {
  return page.evaluate(() =>
    (window as unknown as { __e2eDataBridge: { exportData(): Data } }).__e2eDataBridge.exportData()
  );
}

async function account(page: Page): Promise<Account> {
  const d = await exportData(page);
  const a = d.accounts.find((x) => x.name.startsWith(ACCOUNT));
  if (!a) throw new Error('walk account missing');
  return a;
}

async function nav(page: Page, path: string) {
  await page.evaluate(async (p) => {
    const { default: router } = await import('/src/router/index.ts');
    await router.push(p);
  }, path);
  await ready(page);
  await page.waitForTimeout(300);
}

/** The balance a person sees: the Accounts page card figure for the walk account. */
async function visibleBalance(page: Page): Promise<number> {
  await nav(page, '/accounts');
  const reveal = page.getByRole('button', { name: 'Show financial figures' });
  if (await reveal.isVisible().catch(() => false)) await reveal.click();
  const card = page.getByTestId('account-card').filter({ hasText: ACCOUNT }).first();
  await card.waitFor({ state: 'visible' });
  const text = (await card.locator('.text-2xl').first().innerText()).trim();
  const n = Number(text.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) throw new Error(`unparseable balance "${text}"`);
  return n;
}

/** Assert the visible card figure AND the projection on every listed device. */
async function expectBalance(step: string, devices: [string, Page][], want: number) {
  for (const [name, p] of devices) {
    const seen = await visibleBalance(p);
    const proj = (await account(p)).balance;
    say(`${step} ${name}: visible=${seen} projection=${proj} (want ${want})`);
    expect(seen, `${step} ${name} visible`).toBe(want);
    expect(proj, `${step} ${name} projection`).toBe(want);
  }
}

async function snap(page: Page): Promise<Uint8Array> {
  const b64 = await page.evaluate(async () => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    const { bufferToBase64 } = await import('/src/utils/encoding.ts');
    const { binary } = await dc.exportSnapshot();
    return bufferToBase64(binary);
  });
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

async function heads(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    return (await dc.getHeads()).heads as string[];
  });
}

/** The walk account's Counter keys (`counterDeltas`), its fold-ledger entries and the lineage. */
function counterShape(bin: Uint8Array, accountId: string) {
  const d = Automerge.load(bin) as unknown as {
    counterDeltas?: Record<string, unknown>;
    foldedCounters?: Record<string, unknown>;
    podLineage?: { seq?: number; restoreSeq?: number };
  };
  const short = (k: string) =>
    k.replace(`accounts/${accountId}/balance`, '').replace(/([0-9a-f]{6})[0-9a-f]{26}/g, '$1');
  const live: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.counterDeltas ?? {})) {
    if (!k.startsWith(`accounts/${accountId}/`)) continue;
    live[short(k)] = Number((v as { value?: number })?.value ?? v);
  }
  const ledger: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.foldedCounters ?? {})) {
    if (k.startsWith(`accounts/${accountId}/`)) ledger[short(k)] = v;
  }
  return {
    seq: d.podLineage?.seq ?? 0,
    restoreSeq: d.podLineage?.restoreSeq,
    live,
    liveSum: Object.values(live).reduce((s, n) => s + n, 0),
    ledger,
  };
}

async function shape(page: Page) {
  return counterShape(await snap(page), (await account(page)).id);
}

// ─── exchange / lineage ─────────────────────────────────────────────────────

function missing(from: Uint8Array, to: Uint8Array): Uint8Array[] {
  const have = new Set(
    Automerge.getAllChanges(Automerge.load(to)).map((c) => Automerge.decodeChange(c).hash)
  );
  return Automerge.getAllChanges(Automerge.load(from)).filter(
    (c) => !have.has(Automerge.decodeChange(c).hash)
  );
}

async function applyTo(page: Page, changes: Uint8Array[]) {
  if (changes.length === 0) return;
  await page.evaluate(
    async (list) => {
      const dc = await import('/src/services/automerge/worker/docClient.ts');
      const { base64ToBuffer } = await import('/src/utils/encoding.ts');
      await dc.applyChanges(list.map((b) => new Uint8Array(base64ToBuffer(b))));
      const { useSyncStore } = await import('/src/stores/syncStore.ts');
      await useSyncStore().reloadAllStores();
    },
    changes.map((c) => Buffer.from(c).toString('base64'))
  );
}

/** Same-lineage sync: every device receives exactly the changes it lacks from every other. */
async function exchange(label: string, devices: [string, Page][]) {
  const snaps = await Promise.all(devices.map(([, p]) => snap(p)));
  const notes: string[] = [];
  for (let i = 0; i < devices.length; i++) {
    const incoming: Uint8Array[] = [];
    const seen = new Set<string>();
    for (let j = 0; j < devices.length; j++) {
      if (i === j) continue;
      for (const c of missing(snaps[j]!, snaps[i]!)) {
        const h = Automerge.decodeChange(c).hash;
        if (!seen.has(h)) {
          seen.add(h);
          incoming.push(c);
        }
      }
    }
    await applyTo(devices[i]![1], incoming);
    notes.push(`${devices[i]![0]}+${incoming.length}`);
  }
  say(`${label} exchange: ${notes.join(' ')}`);
}

async function compact(page: Page, label: string) {
  const r = await page.evaluate(async () => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    const out = await dc.compactDoc();
    const { useSyncStore } = await import('/src/stores/syncStore.ts');
    await useSyncStore().reloadAllStores();
    return out;
  });
  const s = await shape(page);
  say(
    `${label} compact: changes ${r.changesBefore}->${r.changesAfter} ledger=${JSON.stringify(r.ledger ?? null)} seq=${s.seq} restoreSeq=${s.restoreSeq ?? '-'} live=${JSON.stringify(s.live)} ledgerEntries=${JSON.stringify(s.ledger)}`
  );
}

/** Deliver `bin` to `page` through the worker's real merge entry point, as a file. */
async function deliver(page: Page, bin: Uint8Array, basis: Basis, where: string): Promise<Outcome> {
  const out = await page.evaluate(
    async ({ b64, basis, where }) => {
      const dc = await import('/src/services/automerge/worker/docClient.ts');
      const { base64ToBuffer, bufferToBase64 } = await import('/src/utils/encoding.ts');
      const { encryptPayload } = await import('/src/services/crypto/familyKeyService.ts');
      const w = window as unknown as Record<string, unknown>;
      const key = w.__walkKey as CryptoKey;
      const familyId = w.__walkFamilyId as string;
      const enc = await encryptPayload(key, new Uint8Array(base64ToBuffer(b64)));
      const envelope = {
        version: '4.0',
        familyId,
        familyName: 'Counter Walk',
        keyId: 'walk',
        wrappedKeys: {},
        passkeyWrappedKeys: {},
        inviteKeys: {},
        encryptedPayload: bufferToBase64(enc),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await dc.mergeRemoteEnvelope(envelope as any, familyId, basis as any);
      dc.logMergeTerminus(where, res, familyId);
      const { useSyncStore } = await import('/src/stores/syncStore.ts');
      await useSyncStore().reloadAllStores();
      return {
        action: res.action,
        replayed: res.replayed,
        conflicts: res.conflicts,
        counterRebase: res.counterRebase,
        counterStats: res.counterStats,
      };
    },
    { b64: Buffer.from(bin).toString('base64'), basis, where }
  );
  say(`${where}: ${JSON.stringify(out)}`);
  return out as Outcome;
}

// ─── real-UI writes ─────────────────────────────────────────────────────────

async function adjust(page: Page, description: string, amount: number) {
  await nav(page, '/transactions');
  await new TransactionsPage(page).addTransaction({
    type: amount >= 0 ? 'income' : 'expense',
    account: ACCOUNT,
    description,
    amount: Math.abs(amount),
  });
}

/** A rename through the Accounts page edit modal: a real, non-money dirty edit. */
async function renameAccount(page: Page, name: string) {
  await nav(page, '/accounts');
  await page
    .getByTestId('account-card')
    .filter({ hasText: ACCOUNT })
    .first()
    .getByTestId('edit-account-btn')
    .click();
  const modal = page.locator('[role="dialog"]').last();
  await modal.getByPlaceholder(ui('modal.accountName')).fill(name);
  await modal.getByRole('button', { name: ui('modal.saveAccount') }).click();
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
}

async function shot(page: Page, name: string, dark = false) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
}

// ─── the walk ───────────────────────────────────────────────────────────────

test('counter flip walk: two devices, writes on', async ({ page: a, browser }) => {
  test.setTimeout(1_200_000);
  await initRealm(a);
  wireConsole(a, 'A');

  // Setup: A creates the family and the account (absolute START); B is a second browser profile
  // brought onto A's document.
  await gotoRoute(a, '/');
  await bypassLoginIfNeeded(a, { familyName: 'Counter Walk' });
  await gotoRoute(a, '/accounts'); // full reload: drops the memory provider's background save
  await ready(a);
  await arm(a);
  await new AccountsPage(a).addAccount({ name: ACCOUNT, type: 'checking', balance: START });

  const devB = await newDevice(browser);
  const b = devB.page;
  wireConsole(b, 'B');
  await gotoRoute(b, '/');
  await bypassLoginIfNeeded(b, { familyName: 'Counter Walk B' });
  const binA0 = Buffer.from(await snap(a)).toString('base64');
  await b.evaluate(async (bin) => {
    const dc = await import('/src/services/automerge/worker/docClient.ts');
    const { base64ToBuffer } = await import('/src/utils/encoding.ts');
    await dc.loadSnapshot(new Uint8Array(base64ToBuffer(bin)));
    // B's persisted session names B's scratch-family owner, who is not in A's roster, so the
    // session-integrity bind (#77) would end it on the reload. Boot B on the E2E auto-auth alone.
    localStorage.removeItem('beanies_auth_session');
  }, binA0);
  await gotoRoute(b, '/accounts');
  await ready(b);
  await arm(b);
  const AB: [string, Page][] = [
    ['A', a],
    ['B', b],
  ];
  await expectBalance('setup', AB, START);

  // (a) both devices adjust one account, merge, both show the sum.
  await adjust(a, 'A pocket money', 10);
  await adjust(b, 'B birthday gift', 20);
  say(`(a) pre-merge A=${(await account(a)).balance} B=${(await account(b)).balance}`);
  await exchange('(a)', AB);
  await expectBalance('(a)', AB, START + 30);
  const shA = await shape(a);
  say(`(a) A counter keys ${JSON.stringify(shA.live)} (sum ${shA.liveSum} minor units)`);
  expect(Object.keys(shA.live).length, '(a) one Counter key per device').toBe(2);

  // (b) A compacts; B, dirty on the old lineage, adopts and rebases; B's adjustment survives.
  let baseB = await heads(b);
  await compact(a, '(b) A');
  await adjust(b, 'B offline lunch money', 5);
  const outB = await deliver(
    b,
    await snap(a),
    { kind: 'baseline', heads: baseB },
    '(b) B adopts A gen'
  );
  expect(outB.action).toBe('rebased');
  expect(outB.counterRebase?.carries, '(b) counter_carries').toBe(1);
  await exchange('(b)', AB);
  await expectBalance('(b)', AB, START + 35);

  // (c) a second tab on B BEFORE the next compaction; both tabs dirty; both adopt the same
  // compaction without having merged each other's carry (the concurrent case).
  await adjust(b, 'B tab-1 chores', 7);
  const b2 = await openTab(devB.ctx, await snap(b));
  wireConsole(b2, 'B2');
  await arm(b2);
  await expectBalance('(c) B2 opened', [['B2', b2]], START + 42);
  await adjust(b2, 'B tab-2 chores', 11);
  baseB = await heads(a); // the last state B and B2 both share with the family file
  await compact(a, '(c) A');
  const c1 = await deliver(
    b,
    await snap(a),
    { kind: 'baseline', heads: baseB },
    '(c) B adopts A gen'
  );
  const c2 = await deliver(
    b2,
    await snap(a),
    { kind: 'baseline', heads: baseB },
    '(c) B2 adopts A gen'
  );
  expect(c1.action).toBe('rebased');
  expect(c2.action).toBe('rebased');
  await expectBalance('(c) B after own rebase', [['B', b]], START + 42);
  await expectBalance('(c) B2 after own rebase', [['B2', b2]], START + 53);
  const ABB: [string, Page][] = [...AB, ['B2', b2]];
  await exchange('(c)', ABB);
  await expectBalance('(c)', ABB, START + 53); // +7 counted once, never 1060
  const cStats = await deliver(
    b,
    await snap(a),
    { kind: 'baseline', heads: await heads(b) },
    '(c) B plain merge'
  );
  const cc = cStats.counterStats?.carryConflicts ?? 0;
  say(
    `(c) carry_superseded=${(c1.counterRebase?.superseded ?? 0) + (c2.counterRebase?.superseded ?? 0)} carry_conflicts=${cc}`
  );
  expect(cc, '(c) carry_conflicts <= 1').toBeLessThanOrEqual(1);
  say(`(c) B counter shape ${JSON.stringify(await shape(b))}`);
  for (const [n, p] of [
    ['B-tab1', b],
    ['B-tab2', b2],
  ] as const) {
    await visibleBalance(p);
    await shot(p, `c-${n}`);
    await shot(p, `c-${n}`, true);
  }
  await cleanupRegistry(b2);
  await b2.close();

  // Set-up for (e): B adjusts and syncs, so the "earlier file" A will restore holds a live key.
  await adjust(b, 'B savings top-up', 6);
  await exchange('(e-prep)', AB);
  await expectBalance('(e-prep)', AB, START + 59);
  const earlierFile = await snap(a);
  say(
    `(e-prep) earlier file shape ${JSON.stringify(counterShape(earlierFile, (await account(a)).id))}`
  );

  // (d) reload A mid-session (new actor), adjust, compact from B, A rebases.
  const baseA = await heads(a);
  await adjust(a, 'A before reload', 3);
  await gotoRoute(a, '/accounts');
  await ready(a);
  await arm(a);
  await expectBalance('(d) A after reload', [['A', a]], START + 62);
  await adjust(a, 'A after reload', 4);
  await compact(b, '(d) B');
  const dOut = await deliver(
    a,
    await snap(b),
    { kind: 'baseline', heads: baseA },
    '(d) A adopts B gen'
  );
  expect(dOut.action).toBe('rebased');
  await exchange('(d)', AB);
  await expectBalance('(d)', AB, START + 66);

  // (e) restore the earlier file on A; B (pre-restore, one unsynced adjustment) adopts.
  const baseBe = await heads(b);
  await adjust(b, 'B unsynced before restore', 2);
  const restore = await deliver(
    a,
    earlierFile,
    { kind: 'user-file', heads: await heads(a) },
    '(e) A restores earlier file'
  );
  expect(restore.action).toBe('adopted');
  const restored = await shape(a);
  say(`(e) A restored generation seq=${restored.seq} restoreSeq=${restored.restoreSeq}`);
  expect(restored.restoreSeq, '(e) restoreSeq stamped').toBe(restored.seq);
  await expectBalance('(e) A after restore', [['A', a]], START + 59);
  const eOut = await deliver(
    b,
    await snap(a),
    { kind: 'baseline', heads: baseBe },
    '(e) B adopts restored gen'
  );
  expect(eOut.action).toBe('rebased');
  expect(eOut.counterRebase?.mode, '(e) rebase_mode').toBe('baseline');
  await exchange('(e)', AB);
  await expectBalance('(e) only the unsynced +2 lands', AB, START + 61);
  for (const [n, p] of AB) {
    await visibleBalance(p);
    await shot(p, `e-restored-${n}`);
    await shot(p, `e-restored-${n}`, true);
  }
  // ...then compact from A, B makes a dirty (non-money) edit and rebases: the number holds.
  const baseBe2 = await heads(b);
  await compact(a, '(e) A');
  await renameAccount(b, `${ACCOUNT} (family)`);
  const eOut2 = await deliver(
    b,
    await snap(a),
    { kind: 'baseline', heads: baseBe2 },
    '(e) B rebases onto post-restore compaction'
  );
  expect(eOut2.action).toBe('rebased');
  await exchange('(e2)', AB);
  await expectBalance('(e) after compaction + rebase', AB, START + 61);
  expect((await account(a)).name).toBe(`${ACCOUNT} (family)`);
  for (const [n, p] of AB) {
    await visibleBalance(p);
    await shot(p, `e-after-compaction-${n}`);
  }

  // (f) the policy off -> on -> off through the setter: increments stop and resume, no jump.
  let want = START + 61;
  for (const on of [false, true, false]) {
    const before = await shape(a);
    await setPolicy(a, on);
    await expectBalance(`(f) policy ${on ? 'on' : 'off'} set`, [['A', a]], want);
    await adjust(a, `A policy ${on ? 'on' : 'off'}`, 1);
    want += 1;
    await expectBalance(`(f) policy ${on ? 'on' : 'off'} +1`, [['A', a]], want);
    const after = await shape(a);
    const grew = after.liveSum - before.liveSum;
    say(
      `(f) policy ${on ? 'on' : 'off'}: Counter growth ${grew} minor units, live=${JSON.stringify(after.live)}`
    );
    expect(grew, `(f) Counter growth with policy ${on ? 'on' : 'off'}`).toBe(on ? 100 : 0);
  }
  await exchange('(f)', AB);
  await expectBalance('(f)', AB, want);

  console.log(
    `\n===== RESULTS =====\n${RESULTS.join('\n')}\n===== MERGE TERMINUS =====\n${TERMINUS.join('\n')}\n`
  );
  await cleanupRegistry(b);
  await devB.ctx.close();
});
