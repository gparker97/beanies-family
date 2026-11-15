/**
 * Requirement 15: the clean-skip predicate. EACH condition alone must block the
 * skip, so every row below starts from an all-clean input and breaks exactly one
 * thing. A row that skipped would be a save that silently uploaded nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  decideCleanSkip,
  evaluateCleanSkip,
  type CleanSkipInputs,
  type CleanSkipLocal,
} from '../cleanSkip';

const LOCAL: CleanSkipLocal = {
  debouncePending: false,
  saveInFlight: false,
  mergeInFlight: false,
  savesHeld: false,
  offlineQueued: false,
  lastSaveFailed: false,
  remoteBlocked: false,
  baselineEnvelopeFp: 'fp-a',
};
const CLEAN: CleanSkipInputs = { ...LOCAL, headsClean: true, currentEnvelopeFp: 'fp-a' };

describe('decideCleanSkip', () => {
  it('skips when every condition holds', () => {
    expect(decideCleanSkip(CLEAN)).toEqual({ skip: true, reason: 'clean' });
  });

  it.each<[string, Partial<CleanSkipInputs>, string]>([
    ['a debounced save was armed', { debouncePending: true }, 'pending'],
    ['a save is in flight or queued', { saveInFlight: true }, 'in-flight'],
    ['a merge is in flight', { mergeInFlight: true }, 'merge-in-flight'],
    ['saves are held', { savesHeld: true }, 'held'],
    ['the offline queue holds a save', { offlineQueued: true }, 'queued-offline'],
    ['the last save failed', { lastSaveFailed: true }, 'failed-last'],
    ['the remote is latched blocked', { remoteBlocked: true }, 'remote-blocked'],
    ['the baseline has no envelope fingerprint', { baselineEnvelopeFp: null }, 'no-envelope-fp'],
    [
      'the heads differ from the baseline (or the probe failed)',
      { headsClean: false },
      'heads-differ',
    ],
    [
      'the current envelope could not be fingerprinted',
      { currentEnvelopeFp: null },
      'no-envelope-fp',
    ],
    ['the envelope differs from the baseline', { currentEnvelopeFp: 'fp-b' }, 'envelope-differs'],
  ])('does NOT skip when %s', (_label, change, reason) => {
    expect(decideCleanSkip({ ...CLEAN, ...change })).toEqual({ skip: false, reason });
  });

  it('two null fingerprints are not a match', () => {
    const verdict = decideCleanSkip({
      ...CLEAN,
      baselineEnvelopeFp: null,
      currentEnvelopeFp: null,
    });
    expect(verdict.skip).toBe(false);
  });
});

describe('evaluateCleanSkip', () => {
  const probes = (headsClean: boolean, fp: string | null) => ({
    headsClean: vi.fn(async () => headsClean),
    currentEnvelopeFp: vi.fn(async () => fp),
  });

  it('asks neither probe when a local fact already blocks (an armed save starts at once)', async () => {
    const p = probes(true, 'fp-a');
    await expect(evaluateCleanSkip({ ...LOCAL, debouncePending: true }, p)).resolves.toEqual({
      skip: false,
      reason: 'pending',
    });
    expect(p.headsClean).not.toHaveBeenCalled();
    expect(p.currentEnvelopeFp).not.toHaveBeenCalled();
  });

  it('does not hash the envelope when the heads already differ', async () => {
    const p = probes(false, 'fp-a');
    await expect(evaluateCleanSkip(LOCAL, p)).resolves.toEqual({
      skip: false,
      reason: 'heads-differ',
    });
    expect(p.currentEnvelopeFp).not.toHaveBeenCalled();
  });

  it('returns the predicate verdict once both probes answered', async () => {
    await expect(evaluateCleanSkip(LOCAL, probes(true, 'fp-a'))).resolves.toEqual({
      skip: true,
      reason: 'clean',
    });
    await expect(evaluateCleanSkip(LOCAL, probes(true, 'fp-b'))).resolves.toEqual({
      skip: false,
      reason: 'envelope-differs',
    });
  });
});
