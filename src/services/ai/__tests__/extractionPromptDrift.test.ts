import { describe, it, expect } from 'vitest';

// Drift guard (see extractionPrompt.ts header): the client prompt copy MUST stay
// byte-identical to the Phase-1 spike copy, so spike results predict production. This
// test fails CI the moment PROMPT_VERSION, the JSON shape, the required keys, or the
// built messages diverge. When the server (Lambda) copy lands in Phase 2, add it here too.
import * as client from '../extractionPrompt';
// The authoritative spike copy (validated against real invitations in Gate 1).
// @ts-expect-error — spike is plain JS with no .d.ts; imported for runtime comparison only.
import * as spike from '../../../../scripts/spikes/extractionPrompt.mjs';
// The server/managed copy that ships in the ai-extract Lambda.
// @ts-expect-error — Lambda source is plain JS with no .d.ts; imported for runtime comparison only.
import * as server from '../../../../infrastructure/lambda/ai-extract/extractionPrompt.mjs';

const imageDataUrl = 'data:image/jpeg;base64,AAAA';
const todayIso = '2026-06-03';

describe('extraction prompt drift guard (client vs spike vs server)', () => {
  it('PROMPT_VERSION matches across all three copies', () => {
    expect(client.PROMPT_VERSION).toBe(spike.PROMPT_VERSION);
    expect(server.PROMPT_VERSION).toBe(spike.PROMPT_VERSION);
  });

  it('EXTRACTION_JSON_SHAPE (event) matches exactly across all three', () => {
    expect(client.EXTRACTION_JSON_SHAPE).toEqual(spike.EXTRACTION_JSON_SHAPE);
    expect(server.EXTRACTION_JSON_SHAPE).toEqual(spike.EXTRACTION_JSON_SHAPE);
  });

  it('TRAVEL_JSON_SHAPE matches exactly across all three', () => {
    expect(client.TRAVEL_JSON_SHAPE).toEqual(spike.TRAVEL_JSON_SHAPE);
    expect(server.TRAVEL_JSON_SHAPE).toEqual(spike.TRAVEL_JSON_SHAPE);
  });

  // Per-task drift: required keys + built messages must match across the three copies
  // for every task in the registry. Adding a task automatically extends this guard.
  type TaskEntry = {
    requiredKeys: readonly string[];
    buildMessages: (imageDataUrl: string, todayIso: string) => unknown;
  };
  const tasks = (registry: Record<string, unknown>, task: string) => registry[task] as TaskEntry;

  for (const task of Object.keys(spike.EXTRACTION_TASKS as Record<string, unknown>)) {
    it(`task "${task}": REQUIRED keys + built messages match across all three`, () => {
      const s = tasks(spike.EXTRACTION_TASKS, task);
      const c = tasks(client.EXTRACTION_TASKS, task);
      const v = tasks(server.EXTRACTION_TASKS, task);
      expect([...c.requiredKeys]).toEqual([...s.requiredKeys]);
      expect([...v.requiredKeys]).toEqual([...s.requiredKeys]);

      const expected = s.buildMessages(imageDataUrl, todayIso);
      expect(c.buildMessages(imageDataUrl, todayIso)).toEqual(expected);
      expect(v.buildMessages(imageDataUrl, todayIso)).toEqual(expected);
    });
  }
});
