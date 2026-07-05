import { describe, it, expect } from 'vitest';
// Raw source of the committed file (Vite ?raw import) + its parsed values — lets
// us assert the on-disk file is always in canonical generated form WITHOUT
// pinning the true/false values (the dev Feature Flags tool changes those
// legitimately, so a value-pinned test would break whenever a flag is toggled).
import committedRaw from '../featureFlags.committed?raw';
import { COMMITTED_FLAGS } from '../featureFlags.committed';
import { applyFlagWrite, generateCommittedSource } from '../featureFlagWrite';
import { FLAG_IDS, type DevFlag } from '../flagRegistry';

const allFalse = (): Record<DevFlag, boolean> =>
  Object.fromEntries(FLAG_IDS.map((id) => [id, false])) as Record<DevFlag, boolean>;

describe('config/featureFlagWrite', () => {
  it('the committed file on disk is in canonical generated form (format lock — value-agnostic)', () => {
    // Regenerating from the file's OWN current values must reproduce it exactly.
    // This catches format/prettier drift in the generator without pinning which
    // flags happen to be on, so toggling a flag never breaks this test.
    expect(generateCommittedSource(COMMITTED_FLAGS)).toBe(committedRaw);
  });

  it('emits keys sorted with the requested value', () => {
    const src = generateCommittedSource({ ...allFalse(), aiPhotoExtract: true });
    expect(src).toContain('aiPhotoExtract: true,');
    expect(src).toContain('aiTravelExtract: false,');
    // sorted: aiPhotoExtract before aiTravelExtract
    expect(src.indexOf('aiPhotoExtract')).toBeLessThan(src.indexOf('aiTravelExtract'));
  });

  it('applyFlagWrite flips exactly one flag and returns the next state + source', () => {
    const result = applyFlagWrite(allFalse(), 'aiPhotoExtract', true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextState).toEqual({
      aiPhotoExtract: true,
      aiTravelExtract: false,
      calendarClashNudge: false,
      docWorker: false,
      familyLists: false,
      googleCalendarSync: false,
    });
    expect(result.source).toContain('aiPhotoExtract: true,');
  });

  it('rejects an unknown flag (no throw, typed error)', () => {
    const result = applyFlagWrite(allFalse(), 'nope', true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Unknown feature flag/);
  });

  it('rejects a non-boolean enabled value', () => {
    const result = applyFlagWrite(allFalse(), 'aiPhotoExtract', 'yes');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/must be a boolean/);
  });

  it('rebuilds state from the registry — a stale/unknown key in current is dropped', () => {
    const stale = { aiPhotoExtract: false, aiTravelExtract: false, bogusOld: true } as Record<
      string,
      boolean
    >;
    const result = applyFlagWrite(stale, 'aiTravelExtract', true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextState).toEqual({
      aiPhotoExtract: false,
      aiTravelExtract: true,
      calendarClashNudge: false,
      docWorker: false,
      familyLists: false,
      googleCalendarSync: false,
    });
    expect(Object.keys(result.nextState)).not.toContain('bogusOld');
    expect(result.source).not.toContain('bogusOld');
  });

  it('is idempotent — regenerating from a produced state yields identical source', () => {
    const first = applyFlagWrite(allFalse(), 'aiPhotoExtract', true);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(generateCommittedSource(first.nextState)).toBe(first.source);
  });
});
