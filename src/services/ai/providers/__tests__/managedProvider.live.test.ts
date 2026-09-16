/**
 * The SHIPPED provider, against the LIVE enclave and the DEPLOYED Lambda. Nothing mocked.
 *
 * ⚠️ OPT-IN ONLY. Skipped unless `BEANIES_LIVE_AI=1`, because it makes a real Tinfoil call
 * (real money) and writes a real usage row. CI must never run it.
 *
 *   BEANIES_LIVE_AI=1 npx vitest run src/services/ai/providers/__tests__/managedProvider.live.test.ts
 *
 * WHY IT EXISTS, given `scripts/spikes/sealed-extraction.mjs` already proves the wire contract:
 * that spike MIRRORS `managedProvider.run()` — it rebuilds the same sequence by hand. A mirror
 * proves the protocol, not the code we ship. The whole history of this feature is things that
 * were true of what we believed and false of what shipped: the sealed body omitted `model` and
 * every test passed, because the seal was mocked and the payload never asserted.
 *
 * So this calls the real exported `managedProvider.run` — real `verifyEnclave`, real
 * `sealForEnclave`, real `openSealed`, real network — and is the only thing in the repo that
 * exercises the shipped client path end to end.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { managedProvider as ManagedProvider } from '../managedProvider';

const LIVE = process.env.BEANIES_LIVE_AI === '1';

/** The client's own env vars, read the way the browser build would get them. */
function localEnv() {
  try {
    // `process.cwd()` is the repo root under vitest. A relative URL from `import.meta.url`
    // was tried and is brittle: the file sits five directories deep and the miscount failed
    // silently through the catch below, which reported "no credentials" for a path bug.
    const raw = readFileSync(`${process.cwd()}/.env.local`, 'utf8');
    const read = (key: string) => {
      const m = new RegExp(`^${key}=(.*)$`, 'm').exec(raw);
      return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined;
    };
    return {
      url: read('VITE_AI_EXTRACT_URL'),
      key: read('VITE_AI_EXTRACT_API_KEY'),
    };
  } catch (err) {
    // Say WHY rather than reporting a missing key for what may be a missing file.
    console.error('[live-test] could not read .env.local:', err);
    return { url: undefined, key: undefined };
  }
}

// Only touch the filesystem when this test will actually run. Reading at module load printed a
// console.error with a stack on every CI run, for a suite that is skipped there by design.
const env = LIVE ? localEnv() : { url: undefined, key: undefined };
if (LIVE && env.url && env.key) {
  vi.stubEnv('VITE_AI_EXTRACT_URL', env.url);
  vi.stubEnv('VITE_AI_EXTRACT_API_KEY', env.key);
}

let managedProvider: typeof ManagedProvider;

describe.skipIf(!LIVE)('managedProvider against the LIVE enclave (#49, ADR-030 Gate 3)', () => {
  beforeAll(async () => {
    if (!env.url || !env.key) {
      throw new Error('BEANIES_LIVE_AI=1 but .env.local has no VITE_AI_EXTRACT_URL / API_KEY');
    }
    ({ managedProvider } = await import('../managedProvider'));
  });

  it('extracts a real event through a genuinely sealed round trip', async () => {
    const result = await managedProvider.run('share', {
      source: {
        kind: 'text',
        text: "Ollie's class assembly is on Friday 3 October at 9:15am in the school hall.",
      },
      todayIso: new Date().toISOString().slice(0, 10),
      familyId: 'spike-sealed-extraction-do-not-bill',
    });

    expect(result.kind).toBe('event');
    expect(result.kind === 'event' && result.event.title.toLowerCase()).toContain('assembly');

    // ⚠️ THE CLAIM THIS FEATURE EXISTS TO MAKE. `verified` is true only when the provider
    // actually checked an AMD SEV-SNP attestation and took the HPKE key bound to that
    // measurement — it is not a passthrough of any server header. Before #49 this field was
    // defined and never set by anything.
    expect(result.attestation).toEqual({ enclave: 'inference.tinfoil.sh', verified: true });
  }, 60_000);
});
