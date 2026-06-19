import { describe, it, expect } from 'vitest';
import { markFamilyJustCreated, consumeFamilyJustCreated } from '../newFamilyFlag';

describe('newFamilyFlag (whats-new seed signal — 2026-06-19)', () => {
  it('defaults to false when nothing was created', () => {
    // consume any leftover from a prior test first
    consumeFamilyJustCreated();
    expect(consumeFamilyJustCreated()).toBe(false);
  });

  it('is true exactly once after marking, then resets (one-shot)', () => {
    markFamilyJustCreated();
    expect(consumeFamilyJustCreated()).toBe(true);
    // Second consume returns false — a returning-user load must NOT re-trigger
    // the what's-new seed.
    expect(consumeFamilyJustCreated()).toBe(false);
  });
});
