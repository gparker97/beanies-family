/**
 * The client and the Lambda agree on three things, or the sealed arm breaks quietly (#49).
 *
 * This imports the REAL `.mjs` Lambda source rather than a copy, the precedent being
 * `extractionPromptDrift.test.ts`. A restatement here would be one more thing to keep in step,
 * which is the failure this test exists to prevent.
 *
 * The `srcHash` case is the load-bearing one. A divergence does not fail loudly: grants stop
 * matching, every correction is refused, and `GRANT_MISMATCH_PREFIX` fires — which is the one
 * alarm that means the FEATURE is broken rather than someone probing it. So it is asserted
 * against the server's own function, on both source kinds.
 */
import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain JS Lambda source, deliberately imported for parity rather than copied.
import { sourceFingerprint } from '../../../../infrastructure/lambda/ai-extract/correctionGrant.mjs';
// @ts-expect-error — as above.
import { SEALED_PROTOCOL } from '../../../../infrastructure/lambda/ai-extract/sealedForward.mjs';

import { sourceHash } from '../providers/managedProvider';
import type { ExtractionRequest } from '../types';

/**
 * The client's fingerprint — THE SHIPPED FUNCTION, not a restatement of it.
 *
 * ⚠️ This file used to re-state the rule here as ``sha256Hex(`i:${urls.join('\n')}`)`` and
 * compare THAT against the server, with a comment arguing that importing the provider would
 * "test the plumbing instead of the hashing rule". That argument is wrong, and it made the
 * load-bearing assertion in this file incapable of failing:
 *
 *   · the provider does not use `sha256Hex` at all. It uses `sha256HexOfParts(parts, '\n')`,
 *     a different primitive, chosen so the images arm does not build two extra multi-megabyte
 *     copies of the document on the main thread.
 *   · so the test compared a local copy of the OLD rule against the server. Both could agree
 *     perfectly while the function actually shipped to families diverged from both, which is
 *     precisely the failure this file exists to prevent: grants stop matching, every correction
 *     is refused, and `GRANT_MISMATCH_PREFIX` — the one alarm that means the feature is broken
 *     rather than someone probing it — starts firing.
 *
 * Constructing an `ExtractionRequest` is not "plumbing"; it is the input the provider is handed
 * in production. A parity test that does not call the shipped function is a parity test between
 * two things nobody runs.
 */
async function clientHash(
  source: { kind: 'text'; text: string } | { kind: 'images'; imageDataUrls: string[] }
) {
  return sourceHash({ source, todayIso: '2026-09-16' } as ExtractionRequest);
}

describe('client / Lambda contract parity', () => {
  it('hashes a TEXT source identically on both sides', async () => {
    const text = 'Ollie party Sat 2pm at the hall';
    expect(await clientHash({ kind: 'text', text })).toBe(sourceFingerprint({ text }));
  });

  it('hashes an IMAGE source identically on both sides', async () => {
    const imageDataUrls = ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'];
    expect(await clientHash({ kind: 'images', imageDataUrls })).toBe(
      sourceFingerprint({ imageDataUrls })
    );
  });

  it('hashes a single-image source identically, since the join is the easy thing to get wrong', async () => {
    const imageDataUrls = ['data:image/jpeg;base64,AAAA'];
    expect(await clientHash({ kind: 'images', imageDataUrls })).toBe(
      sourceFingerprint({ imageDataUrls })
    );
  });

  it('agrees on the protocol discriminator', () => {
    // A mismatch would make every sealed request look like an unknown protocol to the Lambda,
    // which the client then reports as the friendly "not set up yet" notice — a broken feature
    // wearing the costume of an undeployed one.
    expect(SEALED_PROTOCOL).toBe('ehbp-1');
  });

  it('agrees on the text bill bound', async () => {
    // `MAX_TEXT_CHARS` is not exported, so read it out of the source. Cruder than an import, but
    // the alternative is exporting a constant purely for a test, and this fails just as loudly.
    // A path from the repo root, not `import.meta.url`: under vitest that is not a file: URL.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('infrastructure/lambda/ai-extract/index.mjs', 'utf-8');
    const match = /const MAX_TEXT_CHARS = ([0-9_]+);/.exec(src);
    expect(match, 'MAX_TEXT_CHARS must still exist in the Lambda').toBeTruthy();

    // Against the CLIENT'S constant, read from its own source, not a literal restated here.
    // Pinning both sides to a number written in this file would let them drift together.
    const clientSrc = await fs.readFile('src/services/ai/providers/managedProvider.ts', 'utf-8');
    const clientMatch = /const MANAGED_TEXT_BILL_BOUND = ([0-9_]+);/.exec(clientSrc);
    expect(clientMatch, 'MANAGED_TEXT_BILL_BOUND must still exist in the client').toBeTruthy();

    expect(Number(clientMatch![1].replace(/_/g, ''))).toBe(Number(match![1].replace(/_/g, '')));
  });
});
