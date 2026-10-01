import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALARMING_PREFIXES } from '../alarms.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tf = readFileSync(join(here, '../../../modules/billing/main.tf'), 'utf8');

describe('alarmed log prefixes are pinned to modules/billing/main.tf', () => {
  for (const [name, prefix] of Object.entries(ALARMING_PREFIXES)) {
    it(`${name}: "${prefix}" has a metric filter`, () => {
      assert.ok(tf.includes(prefix), `main.tf must contain the exact prefix ${prefix}`);
    });
  }
});
