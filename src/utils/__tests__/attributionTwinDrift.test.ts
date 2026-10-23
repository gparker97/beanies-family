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
import {
  EXIT_REASON_IDS,
  EXIT_REASON_LABELS,
  EXIT_REASON_TEXT_IDS,
  EXIT_REASON_TEXT_MAX,
  sanitiseExitReasonText,
} from '@beanies/brand/exitReason';
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

/**
 * The exit-survey twin (2026-10-23): the delete drawer's reason ids, the ids that carry free
 * text, the stable Slack labels and the text cap, by import (the `ATTRIBUTION_KEYS` pattern), and
 * the text sanitiser by one table run through both functions (the `realEmail` pattern). The
 * client sanitises before sending and the Lambda again on arrival; if they drift, the Slack line
 * and the firehose disagree about what was said.
 */
describe('registry exit reason twin', () => {
  it('the Lambda allowlists exactly the shared reason ids, in the same order', () => {
    expect(registryLambda.EXIT_REASON_IDS).toEqual([...EXIT_REASON_IDS]);
  });

  it('the Lambda accepts free text for exactly the same ids', () => {
    expect(registryLambda.EXIT_REASON_TEXT_IDS).toEqual([...EXIT_REASON_TEXT_IDS]);
  });

  it('the Lambda prints exactly the shared Slack labels', () => {
    expect(registryLambda.EXIT_REASON_LABELS).toEqual({ ...EXIT_REASON_LABELS });
  });

  it('the Lambda caps the text at the same length', () => {
    expect(registryLambda.EXIT_REASON_TEXT_MAX).toBe(EXIT_REASON_TEXT_MAX);
  });

  const LONG = 'a'.repeat(199) + '\u{1F600}' + 'b';
  const table: Array<[string, unknown, string]> = [
    ['valid', 'calendar sync', 'calendar sync'],
    ['padded', '   calendar sync  ', 'calendar sync'],
    ['control chars', '\u0000cal\u0007en\u009Fdar\n\t', 'calendar'],
    ['a bidi override and isolate', 'abc\u202Edef\u2066ghi\u2069', 'abcdefghi'],
    // The LOWER bounds of both ranges, so a one-sided narrowing of either twin's class is caught.
    ['bidi range lower bounds', 'a\u202Ab\u202Bc\u2067d\u2068e', 'abcde'],
    [
      'a ZWJ family emoji',
      'for \u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
      'for \u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
    ],
    ['201 code points with an astral char', LONG, 'a'.repeat(199) + '\u{1F600}'],
    ['empty', '', ''],
    ['only controls', '\u0000\u202E \n', ''],
    ['null', null, ''],
    ['non-string', 42, ''],
  ];

  it('the 201-code-point row really is 201 code points (and 202 UTF-16 units)', () => {
    expect(Array.from(LONG)).toHaveLength(201);
    expect(LONG).toHaveLength(202);
  });

  it.each(table)('client and Lambda agree on %s', (_name, input, expected) => {
    const lambda = (registryLambda.sanitiseExitReasonText as (v: unknown) => string)(input);
    expect(sanitiseExitReasonText(input)).toBe(expected);
    expect(lambda).toBe(sanitiseExitReasonText(input));
  });

  it('the cap never leaves a lone surrogate', () => {
    const capped = sanitiseExitReasonText(LONG);
    // A high surrogate not followed by a low one, or a low one not preceded by a high one.
    expect(capped).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    );
    expect((registryLambda.sanitiseExitReasonText as (v: unknown) => string)(LONG)).toBe(capped);
  });
});
