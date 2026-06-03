import { describe, it, expect } from 'vitest';

// Drift guard (see extractionPrompt.ts header): the client prompt copy MUST stay
// byte-identical to the Phase-1 spike copy, so spike results predict production. This
// test fails CI the moment PROMPT_VERSION, the JSON shape, the required keys, or the
// built messages diverge. When the server (Lambda) copy lands in Phase 2, add it here too.
import * as client from '../extractionPrompt';
// The authoritative spike copy (validated against real invitations in Gate 1).
// @ts-expect-error — spike is plain JS with no .d.ts; imported for runtime comparison only.
import * as spike from '../../../../scripts/spikes/extractionPrompt.mjs';

describe('extraction prompt drift guard (client vs spike)', () => {
  it('PROMPT_VERSION matches', () => {
    expect(client.PROMPT_VERSION).toBe(spike.PROMPT_VERSION);
  });

  it('EXTRACTION_JSON_SHAPE matches exactly', () => {
    expect(client.EXTRACTION_JSON_SHAPE).toEqual(spike.EXTRACTION_JSON_SHAPE);
  });

  it('REQUIRED_KEYS match (same keys, same order)', () => {
    expect([...client.REQUIRED_KEYS]).toEqual([...spike.REQUIRED_KEYS]);
  });

  it('buildExtractionMessages produces identical output', () => {
    const imageDataUrl = 'data:image/jpeg;base64,AAAA';
    const todayIso = '2026-06-03';
    expect(client.buildExtractionMessages(imageDataUrl, todayIso)).toEqual(
      spike.buildExtractionMessages(imageDataUrl, todayIso)
    );
  });
});
