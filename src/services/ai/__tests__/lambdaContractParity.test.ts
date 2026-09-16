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

import { sha256Hex } from '@/utils/encoding';

/**
 * The client's fingerprint, mirrored from `managedProvider.ts`.
 *
 * Deliberately re-stated here rather than exported from the provider: the provider computes it
 * from an `ExtractionRequest`, and pinning THAT shape would test the plumbing instead of the
 * hashing rule, which is the thing that has to match.
 */
async function clientHash(
  source: { kind: 'text'; text: string } | { kind: 'images'; imageDataUrls: string[] }
) {
  return source.kind === 'text'
    ? sha256Hex(`t:${source.text}`)
    : sha256Hex(`i:${source.imageDataUrls.join('\n')}`);
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
    expect(Number(match![1].replace(/_/g, ''))).toBe(32_000);
  });
});
