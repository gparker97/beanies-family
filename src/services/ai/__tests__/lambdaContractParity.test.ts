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

import {
  sourceFingerprint,
  SHARE_KINDS,
  // @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
} from '../../../../infrastructure/lambda/ai-extract/correctionGrant.mjs';
// @ts-expect-error — as above.
import { SEALED_PROTOCOL } from '../../../../infrastructure/lambda/ai-extract/sealedForward.mjs';
// @ts-expect-error — as above.
import { FREE_TASK_MAX_BYTES } from '../../../../infrastructure/lambda/ai-extract/meter.mjs';

import { EXTRACTION_TASKS } from '../extractionPrompt';
import {
  DEDUPE_MAX_PAYLOAD_BYTES,
  dedupePayload,
  dedupePayloadBytes,
  type DedupeLine,
} from '@/utils/dedupePayload';

import { sourceHash } from '../providers/managedProvider';
import { MAGIC_DESTINATION_KINDS } from '@/constants/magicDestinations';
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

  // ── Free tasks (#116) ─────────────────────────────────────────────────────────────────
  //
  // The Lambda makes a read free only when the SIZE it measured is inside the task's bound, so a
  // client whose worst case outgrows that bound is silently CHARGED for a feature labelled free.
  // These build the real sealed request, from the real prompt, and measure it the way the
  // Lambda does.

  it('every free task is a task the client actually has', () => {
    const free = [...(FREE_TASK_MAX_BYTES as Map<string, number>).keys()];
    expect(free.length).toBeGreaterThan(0);
    for (const task of free) expect(Object.keys(EXTRACTION_TASKS)).toContain(task);
  });

  it('the worst-case dedupe request fits under the free bound, with margin', () => {
    const bound = (FREE_TASK_MAX_BYTES as Map<string, number>).get('dedupe')!;
    const enc = (s: string) => new TextEncoder().encode(s).length;
    // `sealedForward.mjs` meters `Buffer.from(sealed, 'base64').length`: the EHBP ciphertext of
    // the JSON body `managedProvider` seals. EHBP adds a 4-byte length prefix and a 16-byte AEAD
    // tag (ehbp `encryptRequestWithContext`). The model id comes from the proxy; 128 bytes is a
    // generous stand-in for today's `gemma4-31b`.
    const SEAL_OVERHEAD = 4 + 16;
    const sealedBytes = (lines: DedupeLine[]) =>
      enc(
        JSON.stringify({
          model: 'm'.repeat(128),
          messages: EXTRACTION_TASKS.dedupe.buildMessages(
            { kind: 'text', text: dedupePayload(lines) },
            '2026-09-30'
          ),
          temperature: 0,
        })
      ) + SEAL_OVERHEAD;

    /** Add lines of `text` until the next one would cross the client's payload bound. */
    const fill = (text: string): DedupeLine[] => {
      const lines: DedupeLine[] = [];
      for (let i = 1; ; i++) {
        const next = [...lines, { id: `L${i}`, text }];
        if (dedupePayloadBytes(next) > DEDUPE_MAX_PAYLOAD_BYTES) return lines;
        lines.push(next[next.length - 1]!);
      }
    };

    // Quotes and backslashes are the worst: escaped once in the payload and AGAIN in the
    // request body, so they double. CJK is 3 UTF-8 bytes a character. Control characters
    // become six-byte escapes. Short lines maximise the per-line id overhead.
    const worst = [
      '"'.repeat(60),
      '\\'.repeat(60),
      '"\\'.repeat(40),
      '豆腐と鶏むね肉'.repeat(8),
      '\u0001\u2028'.repeat(20),
      'x',
      '2 "heaped" tbsp 醤油 \\ to taste',
    ];
    let largest = 0;
    for (const text of worst) {
      const lines = fill(text);
      expect(dedupePayloadBytes(lines)).toBeLessThanOrEqual(DEDUPE_MAX_PAYLOAD_BYTES);
      largest = Math.max(largest, sealedBytes(lines));
    }

    // The analytic ceiling the comment in meter.mjs derives: at most twice the payload, plus the
    // fixed prompt. It must hold for the measured cases, or the derivation is wrong.
    const fixed = sealedBytes([]);
    expect(largest).toBeLessThanOrEqual(2 * DEDUPE_MAX_PAYLOAD_BYTES + fixed);

    // At least 15% headroom above the worst case, so modest prompt growth still fits. When this
    // fails: raise FREE_TASK_MAX_BYTES in meter.mjs and deploy the Lambda BEFORE the client, or
    // lower DEDUPE_MAX_PAYLOAD_BYTES.
    expect(largest * 1.15).toBeLessThan(bound);
  });

  it('lets a correction name exactly the kinds the app can make (#113)', () => {
    // A kind the app offers but `SHARE_KINDS` lacks would 400 every correction to it; a kind
    // the Lambda accepts but the app lacks is a hint channel nothing uses.
    expect([...SHARE_KINDS]).toEqual(MAGIC_DESTINATION_KINDS);
  });
});
