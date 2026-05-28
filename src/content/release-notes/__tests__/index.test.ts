import { describe, it, expect } from 'vitest';
import {
  isSpotlightRelease,
  isWhatChangedRelease,
  getAllReleaseNotes,
  getLatestReleaseNote,
  type ReleaseNote,
} from '@/content/release-notes';

const feature = { title: { en: '', beanie: '' }, description: { en: '', beanie: '' } };
const note = (over: Partial<ReleaseNote> = {}): ReleaseNote => ({
  version: '2026.05.27',
  date: '2026-05-27',
  month: '27 may 2026',
  summary: { en: 'x', beanie: 'x' },
  ...over,
});

describe('isSpotlightRelease', () => {
  it('explicit spotlight:true → true', () => {
    expect(isSpotlightRelease(note({ spotlight: true }))).toBe(true);
  });

  it('explicit spotlight:false wins even when feature cards are present', () => {
    expect(isSpotlightRelease(note({ spotlight: false, features: [feature] }))).toBe(false);
  });

  it('feature cards → spotlight by default (curated releases auto-open)', () => {
    expect(isSpotlightRelease(note({ summary: undefined, features: [feature] }))).toBe(true);
  });

  it('brief summary-only note → NOT spotlight (badge only, never auto-opens)', () => {
    expect(isSpotlightRelease(note())).toBe(false);
  });
});

describe('isWhatChangedRelease (post-update toast "what changed?" link)', () => {
  it('spotlight + newer than last-toasted → true', () => {
    expect(isWhatChangedRelease(note({ spotlight: true }), '2026.05.20')).toBe(true);
  });

  it('spotlight but already toasted (same version) → false (no link on a note-less redeploy)', () => {
    expect(isWhatChangedRelease(note({ spotlight: true }), '2026.05.27')).toBe(false);
  });

  it('newer but minor summary-only note → false (only non-trivial releases link)', () => {
    expect(isWhatChangedRelease(note(), '2026.05.20')).toBe(false);
  });

  it('no latest note → false', () => {
    expect(isWhatChangedRelease(undefined, '')).toBe(false);
  });

  it('first run (empty marker) + spotlight → true (links once for the current release)', () => {
    expect(isWhatChangedRelease(note({ features: [feature] }), '')).toBe(true);
  });
});

describe('release registry', () => {
  it('merges all entries newest-first by date', () => {
    const all = getAllReleaseNotes();
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].date >= all[i].date).toBe(true);
    }
  });

  it('getLatestReleaseNote is the first (newest) entry', () => {
    expect(getLatestReleaseNote()).toBe(getAllReleaseNotes()[0]);
  });
});
