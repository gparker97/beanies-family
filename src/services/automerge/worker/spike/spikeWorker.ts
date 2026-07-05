/**
 * ADR-032 spike worker — measurement only, NOT production code.
 *
 * Validates the core assumption behind Plan A (off-main-thread Automerge): that
 * running `Automerge.load` + materialize in a worker and posting the result to
 * the main thread — chunked per collection — keeps the main thread interactive,
 * i.e. the structured-clone RECEIVE is not itself a long task. Also validates
 * that a `CryptoKey` survives `postMessage` to a worker (the iOS unknown) and
 * that an entity-delta round-trip is sub-frame.
 *
 * Delete once the spike's numbers are recorded. See docs/plans/2026-07-05-automerge-web-worker.md.
 */
import * as Automerge from '@automerge/automerge';

type Txn = {
  id: string;
  accountId: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  category: string;
  date: string;
  description: string;
  isReconciled: boolean;
  createdAt: string;
  updatedAt: string;
};
type SpikeDoc = { transactions: Record<string, Txn>; activities: Record<string, Txn> };

let doc: Automerge.Doc<SpikeDoc> | null = null;
let savedBinary: Uint8Array | null = null;

const CATEGORIES = [
  'groceries',
  'rent',
  'salary',
  'utilities',
  'dining',
  'transport',
  'kids',
  'health',
];
const CURRENCIES = ['SGD', 'USD', 'GBP'];

function mkTxn(i: number): Txn {
  const now = new Date(2026, 0, 1 + (i % 500)).toISOString();
  return {
    id: `txn-${i}-${Math.random().toString(36).slice(2, 10)}`,
    accountId: `acct-${i % 12}`,
    type: i % 7 === 0 ? 'income' : 'expense',
    amount: Math.round(Math.random() * 500000) / 100,
    currency: CURRENCIES[i % CURRENCIES.length]!,
    category: CATEGORIES[i % CATEGORIES.length]!,
    date: now,
    description: `Transaction ${i} — ${CATEGORIES[i % CATEGORIES.length]} for the family`,
    isReconciled: i % 3 === 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Build a doc whose `Automerge.save()` reaches ~targetBytes, with real change history. */
function generate(targetBytes: number): {
  saveBytes: number;
  entityCount: number;
  buildMs: number;
} {
  const t0 = performance.now();
  let d = Automerge.init<SpikeDoc>();
  d = Automerge.change(d, (s) => {
    s.transactions = {};
    s.activities = {};
  });
  let i = 0;
  let bytes = 0;
  const MAX = 200_000; // hard cap
  // Add in batches (each its own change → grows op history like real usage).
  while (bytes < targetBytes && i < MAX) {
    d = Automerge.change(d, (s) => {
      for (let b = 0; b < 500; b++, i++) {
        const t = mkTxn(i);
        s.transactions[t.id] = t;
      }
    });
    // churn a fraction to add history (edits, not just inserts)
    if (i % 5000 === 0) {
      d = Automerge.change(d, (s) => {
        const keys = Object.keys(s.transactions).slice(-2000);
        for (const k of keys) s.transactions[k]!.isReconciled = true;
      });
    }
    savedBinary = Automerge.save(d);
    bytes = savedBinary.byteLength;
  }
  doc = d;
  savedBinary = Automerge.save(d);
  return {
    saveBytes: savedBinary.byteLength,
    entityCount: Object.keys(doc.transactions).length,
    buildMs: Math.round(performance.now() - t0),
  };
}

function post(msg: Record<string, unknown>): void {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; [k: string]: unknown };
  try {
    switch (msg.type) {
      case 'generate': {
        const info = generate((msg.targetBytes as number) ?? 2_000_000);
        // Time a fresh load of the saved binary (the cold-start cost).
        const tL = performance.now();
        Automerge.load<SpikeDoc>(savedBinary!);
        post({ type: 'generated', ...info, loadMs: Math.round(performance.now() - tL) });
        break;
      }
      case 'materializeChunked': {
        if (!doc) return post({ type: 'error', where: 'materializeChunked', message: 'no doc' });
        const chunkSize = (msg.chunkSize as number) ?? 2000;
        const tM = performance.now();
        const txns = Object.values(doc.transactions);
        const acts = Object.values(doc.activities);
        const materializeMs = Math.round(performance.now() - tM);
        let chunks = 0;
        // Sub-slice each collection so no single structured-clone deserialize is
        // large — yield to a macrotask between slices so the main thread can
        // paint/handle input. (setTimeout(0), not microtask, to truly yield.)
        for (const [name, items] of [
          ['transactions', txns],
          ['activities', acts],
        ] as const) {
          for (let s = 0; s < items.length; s += chunkSize) {
            post({ type: 'chunk', collection: name, items: items.slice(s, s + chunkSize) });
            chunks++;
            await new Promise((r) => setTimeout(r, 0));
          }
        }
        post({ type: 'chunkDone', materializeMs, chunks, chunkSize });
        break;
      }
      case 'materializeOneShot': {
        if (!doc) return post({ type: 'error', where: 'materializeOneShot', message: 'no doc' });
        const tM = performance.now();
        const all = {
          transactions: Object.values(doc.transactions),
          activities: Object.values(doc.activities),
        };
        const materializeMs = Math.round(performance.now() - tM);
        post({ type: 'oneShot', all, materializeMs });
        break;
      }
      case 'cryptoKeyTest': {
        const key = msg.key as CryptoKey;
        const sample = new Uint8Array((msg.sampleBytes as number) ?? 1_000_000);
        crypto.getRandomValues(sample.subarray(0, Math.min(65536, sample.length)));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const tE = performance.now();
        const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, sample);
        const encMs = Math.round(performance.now() - tE);
        const tD = performance.now();
        const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
        const decMs = Math.round(performance.now() - tD);
        post({
          type: 'cryptoKeyResult',
          ok: dec.byteLength === sample.byteLength,
          encMs,
          decMs,
          bytes: sample.byteLength,
        });
        break;
      }
      case 'deltaEcho': {
        if (!doc) return post({ type: 'error', where: 'deltaEcho', message: 'no doc' });
        const id = `txn-echo-${Math.random().toString(36).slice(2, 8)}`;
        const t = mkTxn(999999);
        t.id = id;
        doc = Automerge.change(doc, (s) => {
          s.transactions[id] = t;
        });
        // Delta = just the one entity (surgical), not the whole collection.
        post({
          type: 'deltaResult',
          delta: { collection: 'transactions', op: 'set', entity: t },
          echoTs: msg.echoTs,
        });
        break;
      }
      default:
        post({ type: 'error', message: `unknown ${msg.type}` });
    }
  } catch (err) {
    post({
      type: 'error',
      where: msg.type,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
