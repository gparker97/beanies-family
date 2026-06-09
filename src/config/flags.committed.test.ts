import { describe, it, expect, afterEach, vi } from 'vitest';

// Verify the production read path: with a flag committed `true`, isFlagEnabled
// returns true in PROD (not just dev). The committed map is a module-load import,
// so we mock it here (separate file — vi.mock is per-module) and assert the
// prod branch. The override path is covered in flags.test.ts.
vi.mock('./featureFlags.committed', () => ({
  COMMITTED_FLAGS: { aiPhotoExtract: true, aiTravelExtract: false },
}));

import { isFlagEnabled } from './flags';

describe('config/flags — committed prod state', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('a committed-true flag is enabled in production', () => {
    vi.stubEnv('DEV', false);
    expect(isFlagEnabled('aiPhotoExtract')).toBe(true);
  });

  it('a committed-false flag is disabled in production', () => {
    vi.stubEnv('DEV', false);
    expect(isFlagEnabled('aiTravelExtract')).toBe(false);
  });

  it('both flags are enabled in development regardless of committed state', () => {
    vi.stubEnv('DEV', true);
    expect(isFlagEnabled('aiPhotoExtract')).toBe(true);
    expect(isFlagEnabled('aiTravelExtract')).toBe(true);
  });
});
