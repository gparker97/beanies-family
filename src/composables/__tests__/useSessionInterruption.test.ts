import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimInterruption,
  wasInterrupted,
  __resetSessionInterruptionForTests,
} from '../useSessionInterruption';

describe('useSessionInterruption', () => {
  beforeEach(() => {
    __resetSessionInterruptionForTests();
  });

  it('starts un-claimed', () => {
    expect(wasInterrupted()).toBe(false);
  });

  it('lets the first caller win', () => {
    expect(claimInterruption('onboarding')).toBe(true);
    expect(wasInterrupted()).toBe(true);
  });

  it('rejects a different second caller', () => {
    expect(claimInterruption('notifications')).toBe(true);
    expect(claimInterruption('feedback')).toBe(false);
    expect(claimInterruption('install')).toBe(false);
  });

  it('is idempotent for the same id (a re-fired watch can re-check and still show)', () => {
    expect(claimInterruption('pwa-reinstall')).toBe(true);
    expect(claimInterruption('pwa-reinstall')).toBe(true);
  });

  it('resets per tab-load (test reset mirrors a full reload)', () => {
    expect(claimInterruption('auth-prompt')).toBe(true);
    __resetSessionInterruptionForTests();
    expect(wasInterrupted()).toBe(false);
    expect(claimInterruption('feedback')).toBe(true);
  });
});
