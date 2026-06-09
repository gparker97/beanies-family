import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isFlagEnabled,
  setFlagOverride,
  clearFlagOverride,
  listFlags,
  type DevFlag,
} from './flags';
import { FLAG_IDS } from './flagRegistry';
import { COMMITTED_FLAGS } from './featureFlags.committed';

// Pin committed state so these tests are deterministic no matter what the dev
// Feature Flags tool has written to featureFlags.committed.ts (the real
// prod-value behaviour is covered in flags.committed.test.ts).
vi.mock('./featureFlags.committed', () => ({
  COMMITTED_FLAGS: { aiPhotoExtract: false, aiTravelExtract: false },
}));

// flags.ts reads import.meta.env.DEV at CALL time (not module load), so a plain
// static import + vi.stubEnv('DEV', …) takes effect on the next call — no
// vi.resetModules()/dynamic-import dance needed (unlike features.test.ts).

const FLAG: DevFlag = 'aiPhotoExtract';
const KEY = `beanies:flag:${FLAG}`;

describe('config/flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults ON in dev (no override)', () => {
    vi.stubEnv('DEV', true);
    expect(isFlagEnabled(FLAG)).toBe(true);
  });

  it('defaults OFF in prod (no override)', () => {
    vi.stubEnv('DEV', false);
    expect(isFlagEnabled(FLAG)).toBe(false);
  });

  it('localStorage override "true" forces ON even in prod', () => {
    vi.stubEnv('DEV', false);
    localStorage.setItem(KEY, 'true');
    expect(isFlagEnabled(FLAG)).toBe(true);
  });

  it('localStorage override "false" forces OFF even in dev', () => {
    vi.stubEnv('DEV', true);
    localStorage.setItem(KEY, 'false');
    expect(isFlagEnabled(FLAG)).toBe(false);
  });

  it('unrecognised override value falls back to the env default', () => {
    vi.stubEnv('DEV', true);
    localStorage.setItem(KEY, 'maybe');
    expect(isFlagEnabled(FLAG)).toBe(true);
  });

  it('setFlagOverride / clearFlagOverride round-trip', () => {
    vi.stubEnv('DEV', false);
    setFlagOverride(FLAG, true);
    expect(localStorage.getItem(KEY)).toBe('true');
    expect(isFlagEnabled(FLAG)).toBe(true);

    clearFlagOverride(FLAG);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(isFlagEnabled(FLAG)).toBe(false); // back to env default
  });

  it('falls back to the env default and warns when localStorage.getItem throws', () => {
    vi.stubEnv('DEV', true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(isFlagEnabled(FLAG)).toBe(true); // env default, no throw out of isFlagEnabled
    expect(warn).toHaveBeenCalled();
  });

  it('setFlagOverride warns (no throw) when localStorage.setItem throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => setFlagOverride(FLAG, true)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('listFlags returns one entry per registry flag with its committed state', () => {
    const flags = listFlags();
    expect(flags.map((f) => f.id)).toEqual([...FLAG_IDS]);
    for (const f of flags) {
      expect(f).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        committed: expect.any(Boolean),
      });
      // committed reflects the committed file's actual value (not pinned to a
      // specific true/false, so toggling a flag never breaks this test)
      expect(f.committed).toBe(COMMITTED_FLAGS[f.id] === true);
    }
  });
});
