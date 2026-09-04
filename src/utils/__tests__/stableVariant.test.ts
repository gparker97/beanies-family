import { describe, it, expect } from 'vitest';
import { stableIndex, stableFraction } from '../stableVariant';

/**
 * The two scrapbook call sites this helper replaced, reproduced verbatim.
 *
 * These are the whole point of the suite: the refactor is only safe if it is
 * VALUE-IDENTICAL, because both drive visible rotations that users have already
 * seen. If someone "improves" the hash, these fail rather than the scrapbook
 * quietly reshuffling.
 */
function legacyHash(id: string): number {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(hash);
}
const legacyRotation = (id: string, scale = 5): number =>
  ((legacyHash(id) % 100) / 100) * scale - scale / 2;
const legacyTilt = (id: string): number => (legacyHash(id) % 2 === 0 ? -2.5 : 2.5);

const IDS = [
  '550e8400-e29b-41d4-a716-446655440000',
  'b1b2c3d4-0000-4000-8000-000000000001',
  'recipe-1',
  'recipe-2',
  '',
  'ünïcødé-seed',
  'a'.repeat(200),
];

describe('stableVariant', () => {
  describe('stableIndex', () => {
    it('is stable for a given seed', () => {
      for (const id of IDS) {
        expect(stableIndex(id, 4)).toBe(stableIndex(id, 4));
      }
    });

    it('stays inside the bucket range', () => {
      for (const id of IDS) {
        for (const buckets of [1, 2, 4, 7]) {
          const i = stableIndex(id, buckets);
          expect(i).toBeGreaterThanOrEqual(0);
          expect(i).toBeLessThan(buckets);
          expect(Number.isInteger(i)).toBe(true);
        }
      }
    });

    it('spreads across buckets rather than collapsing onto one', () => {
      const seen = new Set<number>();
      for (let i = 0; i < 200; i += 1) seen.add(stableIndex(`recipe-${i}`, 4));
      expect(seen.size).toBe(4);
    });

    it('never divides by zero or a negative bucket count', () => {
      expect(stableIndex('x', 0)).toBe(0);
      expect(stableIndex('x', -3)).toBe(0);
    });
  });

  describe('stableFraction', () => {
    it('is stable and within [0, 1)', () => {
      for (const id of IDS) {
        const f = stableFraction(id);
        expect(f).toBe(stableFraction(id));
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(1);
      }
    });
  });

  describe('value-identity with the inline hashes it replaced', () => {
    it('reproduces EveryoneSpread.rotationFor exactly', () => {
      for (const id of IDS) {
        expect(stableFraction(id) * 5 - 5 / 2).toBe(legacyRotation(id));
      }
    });

    it('reproduces ScrapbookSpine.inactiveTilt exactly', () => {
      for (const id of IDS) {
        expect(stableIndex(id, 2) === 0 ? -2.5 : 2.5).toBe(legacyTilt(id));
      }
    });
  });
});
