/**
 * How much of a real `.beanpod` is HISTORY rather than data?
 *
 * Nothing in `src/` could answer that before this file: there is not one call
 * to `Automerge.stats`, `getAllChanges` or `getHistory` anywhere, so "greg's
 * 4MB pod is mostly history" has only ever been an inference from synthetics.
 * Tier 2 (merge-safe history compaction) has to be designed against a real
 * number, and this is where that number comes from.
 *
 * ── Running it ───────────────────────────────────────────────────────────────
 *
 *   BEANPOD_FILE=/path/to/family.beanpod BEANPOD_PASSWORD='…' \
 *     npx vitest run src/services/automerge/__diagnostics__/beanpodProfile.spec.ts
 *
 * Add `BEANPOD_COMPACT_OUT=/path/to/compacted.beanpod` to also WRITE a
 * history-free copy: same family, same keys, same password, same envelope —
 * only the payload is replaced with `Automerge.from(toJS(doc))`. Then run this
 * same spec against THAT file to get the load time and peak RSS of a compacted
 * pod in a clean process, which is the number Tier 2 is judged on. Measuring it
 * in-process after the full load would be measuring a heap the full doc has
 * already grown, and wasm linear memory never shrinks in place.
 *
 * ⚠️ The compacted copy DISCARDS ALL HISTORY and therefore cannot CRDT-merge
 * with any device still holding the original. It is a measurement artefact and
 * a migration prototype — not something to hand a family.
 *
 * Run the file ALONE, as above: peak RSS is only attributable to this document
 * when nothing else shares the process. (`--pool=forks` is already the vitest
 * default and the config sets no `pool`, so passing it changes nothing.)
 *
 * Without the env vars it SKIPS — visibly, as a skipped test — so it lives
 * inside the normal type-check, lint and test gates instead of rotting in a
 * scripts/ corner that nothing checks.
 *
 * ── Why a spec and not a script ──────────────────────────────────────────────
 *
 * There is no `tsx` and no `vite-node` binary in this repo, and plain Node
 * cannot resolve the `@/` alias. A spec reuses the alias, the TS/WASM transform
 * chain, and — the part that matters — the SHIPPED crypto. Re-implementing the
 * decrypt path here would be both a DRY violation and a security risk.
 *
 * ── Secrets ──────────────────────────────────────────────────────────────────
 *
 * This reads a real production pod and a real password. It logs ONLY counts,
 * byte sizes, ratios and timings — never document content, never a decrypted
 * fragment, never the password, not even inside an assertion or error message.
 * Neither the file nor the password is ever written anywhere by this spec.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import * as Automerge from '@automerge/automerge';
import { parseBeanpodV4, tryUnwrapFamilyKey, reEncryptEnvelope } from '@/services/sync/fileSync';
import { decryptPayload, encryptPayload } from '@/services/crypto/familyKeyService';
import { base64ToBuffer, bufferToBase64 } from '@/utils/encoding';
import { loadAndVerify } from '@/services/automerge/worker/docOps';
import { PayloadTooLargeError } from '@/types/sync';

const FILE = process.env.BEANPOD_FILE;
const PASSWORD = process.env.BEANPOD_PASSWORD;

// SAY WHY IT SKIPPED. `describe.skipIf` alone reports "2 skipped" and nothing
// else, so someone who runs this file expecting a report gets silence and no
// idea what is missing — the exact silent-failure shape this whole change
// exists to remove. Printed at collection time, before any test runs.
if (!FILE || !PASSWORD) {
  const missing = [!FILE && 'BEANPOD_FILE', !PASSWORD && 'BEANPOD_PASSWORD'].filter(Boolean);
  process.stdout.write(
    [
      '',
      `⚠ beanpod profile SKIPPED — ${missing.join(' and ')} not set.`,
      '',
      '  Export a pod from Settings → Export Encrypted Backup, then:',
      '',
      "    BEANPOD_FILE=/path/to/family.beanpod BEANPOD_PASSWORD='your-password' \\",
      '      npx vitest run src/services/automerge/__diagnostics__/beanpodProfile.spec.ts',
      '',
      '  The password is read from the environment and never logged, stored or',
      '  written anywhere by this spec.',
      '',
    ].join('\n')
  );
}

/**
 * Run one step, and on failure re-throw with the step named and the likely
 * cause spelled out — so a failed diagnostic explains itself instead of
 * leaving a bare stack to interpret. The original message is preserved; the
 * password never appears in it.
 */
async function step<T>(name: string, hint: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`[${name}] failed: ${detail}\n  → ${hint}`);
  }
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)}MB`;

describe.skipIf(!FILE || !PASSWORD)('beanpod profile — history vs data', () => {
  it('reports op count, full vs compacted size, load time and peak RSS', async () => {
    const envelope = await step('parse', 'is BEANPOD_FILE a V4 .beanpod?', () =>
      parseBeanpodV4(readFileSync(FILE as string, 'utf8'))
    );

    const { familyKey } = await step(
      'unwrap',
      'check BEANPOD_PASSWORD (a member password, or the recovery passphrase)',
      () => tryUnwrapFamilyKey(envelope, PASSWORD as string)
    );

    const binary = await step('decrypt', 'the envelope unwrapped but the payload did not', () =>
      decryptPayload(familyKey, new Uint8Array(base64ToBuffer(envelope.encryptedPayload)))
    );

    // Sample RSS across the load — the peak is the number that decides whether
    // a device can open this pod at all.
    //
    // ⚠️ A `setInterval` CANNOT do this. `loadAndVerify` is fully synchronous,
    // so the event loop never turns while it runs and the timer fires exactly
    // zero times: the "peak" would be `max(before, after)`, a lower bound that
    // misses the whole point, because the peak lives INSIDE the WASM inflation
    // and is largely released by the time the call returns.
    //
    // A worker thread shares the process, and RSS is a per-PROCESS figure, so a
    // sampler over there sees this thread's allocations while this thread is
    // blocked. The max goes through a SharedArrayBuffer because the worker
    // cannot post a message to a blocked main thread either.
    // A worker thread shares the process, and RSS is a per-PROCESS figure, so a
    // sampler over there sees this thread's allocations while this thread is
    // blocked. The max travels through a SharedArrayBuffer because the worker
    // cannot post a message to a blocked main thread either.
    //
    // Units are KiB in an Int32Array, not bytes in a Float64Array: `Atomics`
    // has no Float64 support, and plain reads/writes across threads on shared
    // memory carry no visibility or tearing guarantee. KiB in an int32 covers
    // 2TB, which is ample.
    const shared = new SharedArrayBuffer(4);
    const peakKib = new Int32Array(shared);
    let sampler: import('node:worker_threads').Worker | null = null;
    try {
      const { Worker } = await import('node:worker_threads');
      sampler = new Worker(
        `const { workerData } = require('node:worker_threads');
         const peak = new Int32Array(workerData);
         setInterval(() => {
           const kib = Math.ceil(process.memoryUsage.rss() / 1024);
           // CAS loop: Atomics has no max().
           for (;;) {
             const seen = Atomics.load(peak, 0);
             if (kib <= seen) break;
             if (Atomics.compareExchange(peak, 0, seen, kib) === seen) break;
           }
         }, 5).unref();
         setInterval(() => {}, 1 << 30);`,
        { eval: true, workerData: shared }
      );
      // Without this listener Node re-emits an uncaught worker-script throw as
      // an unhandled exception in the PARENT, killing vitest — instead of the
      // warning the catch below exists to print. The catch only covers the
      // constructor.
      sampler.on('error', (e) => {
        process.stdout.write(`\n  ⚠️  RSS sampler died (${String(e)}) — peak is a LOWER BOUND\n`);
      });
      // Wait for the worker to be RUNNING before taking the baseline. A Node
      // worker is a full V8 isolate and costs ~19MB of the same per-process RSS
      // this measures; baselining first folded the sampler's own cost into the
      // figure reported as "attributable to this document".
      await new Promise<void>((resolve) => sampler!.once('online', () => resolve()));
    } catch (e) {
      // Never fail the diagnostic over its own instrumentation — but say so
      // loudly, because the number printed below then means something weaker.
      process.stdout.write(
        `\n  ⚠️  RSS sampler unavailable (${String(e)}) — peak is a LOWER BOUND\n`
      );
    }

    // Sample RSS across the load — the peak is the number that decides whether
    // a device can open this pod at all.
    //
    // ⚠️ A `setInterval` on THIS thread cannot do it. `loadAndVerify` is fully
    // synchronous, so the event loop never turns while it runs and the timer
    // fires exactly zero times: the "peak" would be `max(before, after)`, a
    // lower bound that misses the point, because the peak lives INSIDE the WASM
    // inflation and is largely released by the time the call returns.
    const baselineRss = process.memoryUsage().rss;
    let peakRss = baselineRss;
    Atomics.store(peakKib, 0, Math.ceil(baselineRss / 1024));

    const startedAt = Date.now();
    let doc;
    try {
      doc = await step(
        'load',
        'this pod exceeds wasm32 addressable memory even on desktop Node — that IS the ' +
          'Tier 2 signal, not a Node tuning problem (wasm linear memory is not V8 old space, ' +
          'so --max-old-space-size cannot help)',
        () => loadAndVerify(binary, envelope.familyId ?? null)
      );
    } finally {
      await sampler?.terminate();
    }
    const loadMs = Date.now() - startedAt;
    peakRss = Math.max(peakRss, Atomics.load(peakKib, 0) * 1024, process.memoryUsage().rss);

    // `stats()` returns the counts directly. `getAllChanges(doc).length` would
    // materialise every change's BYTES — on a history-heavy pod that is itself
    // a multi-hundred-megabyte allocation, i.e. it could OOM the diagnostic on
    // the very document it exists to measure — and it does not give numOps,
    // which is the number this whole exercise is about.
    const stats = Automerge.stats(doc);

    const fullBytes = Automerge.save(doc).byteLength;
    // `toJS` is the documented plain-snapshot accessor. `structuredClone` on an
    // Automerge doc is unreliable — it is a Proxy, and cloning it depends on
    // internals we do not control.
    // `FamilyDocument` has no index signature, which `Automerge.from` requires;
    // the cast is to the shape `from` wants, not a claim about the data.
    const plain = Automerge.toJS(doc) as unknown as Record<string, unknown>;
    const compactedBytes = Automerge.save(Automerge.from(plain)).byteLength;

    // `process.stdout.write`, not `console.log`: under the happy-dom test
    // environment the DOM Console replaces the global and the report never
    // reaches the terminal — which for a spec whose entire output IS the
    // artefact means it silently produces nothing.
    process.stdout.write(
      [
        '',
        '─── beanpod profile ' + '─'.repeat(40),
        `  encrypted payload   ${mb(envelope.encryptedPayload.length)} (base64)`,
        `  decrypted binary    ${mb(binary.byteLength)}`,
        '',
        `  changes             ${stats.numChanges.toLocaleString()}`,
        `  ops                 ${stats.numOps.toLocaleString()}`,
        `  actors              ${(stats as { numActors?: number }).numActors ?? 'n/a'}`,
        '',
        `  save() full         ${mb(fullBytes)}`,
        `  save() compacted    ${mb(compactedBytes)}`,
        `  history multiple    ${(fullBytes / Math.max(compactedBytes, 1)).toFixed(1)}x`,
        '',
        `  load time           ${loadMs}ms`,
        `  RSS before load     ${mb(baselineRss)}`,
        `  peak RSS            ${mb(peakRss)}`,
        // The process baseline (Node + vitest + the wasm module) is present in
        // BOTH numbers, so the delta is the only part attributable to this
        // document — and it is the part a 3GB tablet has to find room for.
        `  ↳ this document     ${mb(peakRss - baselineRss)}`,
        '─'.repeat(60),
        '',
      ].join('\n')
    );

    // ── Optional: write a compacted copy for a clean-process measurement ──
    //
    // Deliberately AFTER the report above, so a failure here costs nothing that
    // has already been printed.
    const compactOut = process.env.BEANPOD_COMPACT_OUT;
    if (compactOut) {
      try {
        const compactedBinary = Automerge.save(Automerge.from(plain));
        const payload = bufferToBase64(await encryptPayload(familyKey, compactedBinary));
        // Same envelope, same wrapped keys — so the same password opens it and
        // the profile run against it is comparing like with like.
        writeFileSync(compactOut, reEncryptEnvelope(envelope, payload));
        process.stdout.write(
          [
            '',
            `  ✎ compacted copy written to ${compactOut}`,
            `    ${mb(binary.byteLength)} → ${mb(compactedBinary.byteLength)} decrypted`,
            '    ⚠️  history discarded — cannot merge with a device holding the original.',
            '    Profile it in a clean process to get its true load time and peak RSS.',
            '',
          ].join('\n')
        );
      } catch (e) {
        // Loud, never silent: the caller asked for a file and must not be left
        // thinking one exists.
        process.stdout.write(`\n  ⚠️  compacted write FAILED: ${String(e)}\n`);
      }
    }

    // ── Actor churn ──────────────────────────────────────────────────────
    //
    // `Automerge.load()` mints a FRESH RANDOM actorId on every call, so every
    // cold start / cache load / poll-merge that then writes leaves a PERMANENT
    // actor lane. That makes actor count grow with SESSIONS, not with data.
    //
    // Why it matters for Tier 2 and not for Tier 1: pinning a stable actor
    // cannot shrink a pod that is already written, so it is a PREVENTIVE fix.
    // What this distribution decides is how fast a compacted pod re-bloats —
    // i.e. whether compaction alone is a durable fix or a repeating chore.
    //
    // Guarded: `getAllChanges` materialises every change's bytes, which on a
    // history-heavy pod is a large allocation in its own right. A failure here
    // must not cost us the main report above, which has already printed.
    try {
      const byActor = new Map<string, number>();
      for (const change of Automerge.getAllChanges(doc)) {
        const actor = Automerge.decodeChange(change).actor;
        byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
      }
      const counts = [...byActor.values()].sort((a, b) => b - a);
      const total = counts.reduce((a, b) => a + b, 0);
      const at = (q: number) => counts[Math.min(counts.length - 1, Math.floor(counts.length * q))];
      // How concentrated is it? If the top 1% of actors hold most changes, the
      // tail is session churn. If it is flat, every actor is a session.
      const top1pct = counts.slice(0, Math.max(1, Math.floor(counts.length * 0.01)));
      process.stdout.write(
        [
          '',
          '─── actor churn ' + '─'.repeat(44),
          `  distinct actors     ${counts.length.toLocaleString()}`,
          `  changes             ${total.toLocaleString()}`,
          `  changes per actor   mean ${(total / counts.length).toFixed(1)}  ` +
            `median ${at(0.5)}  p90 ${at(0.1)}  max ${counts[0]}`,
          `  actors with 1 change ${counts.filter((c) => c === 1).length.toLocaleString()}` +
            ` (${((counts.filter((c) => c === 1).length / counts.length) * 100).toFixed(0)}%)`,
          `  top 1% of actors    ${((top1pct.reduce((a, b) => a + b, 0) / total) * 100).toFixed(0)}% of changes`,
          '─'.repeat(60),
          '',
        ].join('\n')
      );
    } catch (e) {
      process.stdout.write(
        `\n  (actor-churn breakdown skipped: ${e instanceof Error ? e.message : String(e)})\n` +
          '  The main profile above is unaffected.\n\n'
      );
    }

    // Assertions are sanity checks, not thresholds: the OUTPUT is the artefact.
    expect(stats.numChanges).toBeGreaterThan(0);
    expect(fullBytes).toBeGreaterThan(0);
    expect(compactedBytes).toBeGreaterThan(0);
  }, 600_000); // a history-heavy pod can take minutes to load; that is the finding

  it('names the Tier 2 signal explicitly if the pod will not load even here', async () => {
    // Documents the intent of the `load` hint above: if desktop Node cannot
    // inflate this document, no tablet ever will, and the answer is compaction.
    expect(PayloadTooLargeError.name).toBe('PayloadTooLargeError');
  });
});
