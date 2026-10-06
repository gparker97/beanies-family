/**
 * Attribution twin-drift guard (#118) — client parser vs the registry Lambda's validator.
 *
 * The Lambda cannot import `@beanies/brand/attribution` (every Lambda is its own zip), so
 * `infrastructure/lambda/registry/index.mjs` carries a copy of the key list and the value rule.
 * Copy-pasted fixture strings in two test files do not catch a change on one side; this import
 * does, in the same direction as `telemetryAllowlistDrift.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ATTRIBUTION_KEYS, ATTRIBUTION_VALUE_RE } from '@beanies/brand/attribution';
import { HEARD_VIA_IDS } from '@beanies/brand/heardVia';
// @ts-expect-error — no type declarations for the Lambda source.
import * as registryLambda from '../../../infrastructure/lambda/registry/index.mjs';
// @ts-expect-error — no type declarations for the Lambda source.
import { realEmail as lambdaRealEmail } from '../../../infrastructure/lambda/registry/owner.mjs';
import { realEmail } from '../email';

describe('attribution twins (#118)', () => {
  it('the Lambda allowlists exactly the shared keys, in the same order', () => {
    expect(registryLambda.ATTRIBUTION_KEYS).toEqual([...ATTRIBUTION_KEYS]);
  });

  it('the Lambda applies exactly the shared value rule', () => {
    expect((registryLambda.ATTRIBUTION_VALUE_RE as RegExp).source).toBe(
      ATTRIBUTION_VALUE_RE.source
    );
    expect((registryLambda.ATTRIBUTION_VALUE_RE as RegExp).flags).toBe(ATTRIBUTION_VALUE_RE.flags);
  });
});

/**
 * The survey id allowlist twin. Read as source text (not imported) so it pins the literal in the
 * Lambda file whether or not that file exports it.
 */
describe('registry twins', () => {
  it('the Lambda allowlists exactly the survey heardVia ids, in the same order', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'infrastructure/lambda/registry/index.mjs'),
      'utf8'
    );
    const match = /HEARD_VIA_IDS\s*=\s*\[([^\]]*)\]/.exec(src);
    expect(match, 'HEARD_VIA_IDS literal not found in the registry Lambda').not.toBeNull();
    const ids = [...match![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(ids).toEqual([...HEARD_VIA_IDS]);
  });
});

/**
 * The owner-email filter twin (registry owner sync). The client sends
 * `ownerEmail: realEmail(rosterOwner.email)` and the Lambda's `owner.mjs` re-applies its own
 * `realEmail` to every stamp, so a placeholder can never latch. If the two rules drift, the
 * client's in-sync comparison and the server's stored value disagree and the owner sync
 * re-sends every session. One table, both functions, identical answers.
 */
describe('registry owner email twin', () => {
  const table: Array<[string, string | null | undefined]> = [
    ['valid', 'user@example.com'],
    ['padded', '  user@example.com  '],
    ['uppercase', 'User@Example.COM'],
    ['placeholder temp', '1717171717@temp.beanies.family'],
    ['placeholder setup', 'pending-abc@setup.local'],
    ['uppercase placeholder', 'Pending-ABC@Setup.LOCAL'],
    ['padded placeholder', '  1717171717@temp.beanies.family '],
    ['empty', ''],
    ['null', null],
    ['no at', 'no-at'],
    ['255 chars', 'a'.repeat(243) + '@example.com'],
  ];

  it('the 255-char row really is 255 chars', () => {
    expect(table.find(([name]) => name === '255 chars')![1]!.length).toBe(255);
  });

  it.each(table)('client and Lambda agree on %s', (_name, input) => {
    expect((lambdaRealEmail as (s: unknown) => string | null)(input)).toBe(realEmail(input));
  });
});
