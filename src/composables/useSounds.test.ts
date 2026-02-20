import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSounds,
  setSoundEnabled,
  isSoundEnabled,
  playPop,
  playClink,
  playChime,
  playFanfare,
  playWhoosh,
  playBlink,
} from '@/composables/useSounds';

describe('useSounds', () => {
  beforeEach(() => {
    // Reset to enabled before each test
    setSoundEnabled(true);
  });

  it('returns all expected function names', () => {
    const sounds = useSounds();
    expect(sounds).toHaveProperty('playPop');
    expect(sounds).toHaveProperty('playClink');
    expect(sounds).toHaveProperty('playChime');
    expect(sounds).toHaveProperty('playFanfare');
    expect(sounds).toHaveProperty('playWhoosh');
    expect(sounds).toHaveProperty('playBlink');
    expect(sounds).toHaveProperty('setSoundEnabled');
    expect(sounds).toHaveProperty('isSoundEnabled');
  });

  it('sound functions do not throw when AudioContext is unavailable', () => {
    // happy-dom does not provide AudioContext, so these should silently no-op
    expect(() => playPop()).not.toThrow();
    expect(() => playClink()).not.toThrow();
    expect(() => playChime()).not.toThrow();
    expect(() => playFanfare()).not.toThrow();
    expect(() => playWhoosh()).not.toThrow();
    expect(() => playBlink()).not.toThrow();
  });

  it('setSoundEnabled(false) sets enabled to false', () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
  });

  it('setSoundEnabled(true) sets enabled to true', () => {
    setSoundEnabled(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('sound functions return early when disabled', () => {
    setSoundEnabled(false);
    // These should not throw even when disabled
    expect(() => playPop()).not.toThrow();
    expect(() => playClink()).not.toThrow();
    expect(() => playChime()).not.toThrow();
    expect(() => playFanfare()).not.toThrow();
    expect(() => playWhoosh()).not.toThrow();
    expect(() => playBlink()).not.toThrow();
  });
});
