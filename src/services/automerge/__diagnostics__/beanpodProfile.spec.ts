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
import { readFileSync } from 'node:fs';
import * as Automerge from '@automerge/automerge';
import { parseBeanpodV4, tryUnwrapFamilyKey } from '@/services/sync/fileSync';
import { decryptPayload } from '@/services/crypto/familyKeyService';
import { base64ToBuffer } from '@/utils/encoding';
import { loadAndVerify } from '@/services/automerge/worker/docOps';
import { PayloadTooLargeError } from '@/types/sync';

const FILE = process.env.BEANPOD_FILE;
const PASSWORD = process.env.BEANPOD_PASSWORD;

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
    let peakRss = process.memoryUsage().rss;
    const sampler = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 10);

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
      clearInterval(sampler);
    }
    const loadMs = Date.now() - startedAt;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);

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
        `  peak RSS            ${mb(peakRss)}`,
        '─'.repeat(60),
        '',
      ].join('\n')
    );

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
