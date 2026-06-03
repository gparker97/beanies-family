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

  it('EXTRACTION_JSON_SHAPE matches exactly across all three', () => {
    expect(client.EXTRACTION_JSON_SHAPE).toEqual(spike.EXTRACTION_JSON_SHAPE);
    expect(server.EXTRACTION_JSON_SHAPE).toEqual(spike.EXTRACTION_JSON_SHAPE);
  });

  it('REQUIRED_KEYS match (same keys, same order) across all three', () => {
    expect([...client.REQUIRED_KEYS]).toEqual([...spike.REQUIRED_KEYS]);
    expect([...server.REQUIRED_KEYS]).toEqual([...spike.REQUIRED_KEYS]);
  });

  it('buildExtractionMessages produces identical output across all three', () => {
    const expected = spike.buildExtractionMessages(imageDataUrl, todayIso);
    expect(client.buildExtractionMessages(imageDataUrl, todayIso)).toEqual(expected);
    expect(server.buildExtractionMessages(imageDataUrl, todayIso)).toEqual(expected);
  });
});
