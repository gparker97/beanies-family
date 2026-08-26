/**
 * kind ↔ reader must be TOTAL and INJECTIVE (#64).
 *
 * The whole routing design rests on one registry entry per reader carrying its own
 * `shareKind`. If a fourth reader ever lands with a duplicated or missing kind, a shared
 * document would route to the wrong review modal — or to none — and nothing else in the
 * system would notice. This is the test that makes that a build-time failure.
 */
import { describe, it, expect } from 'vitest';
import { readerForShareKind, type MagicReader } from '../useMagicReader';
import type { ShareKind } from '@/types/magicPayload';

const KINDS: ShareKind[] = ['event', 'travel', 'recipe'];

describe('share kind ↔ magic reader mapping (#64)', () => {
  it('maps every kind to a reader', () => {
    for (const kind of KINDS) {
      expect(readerForShareKind(kind)).toBeTruthy();
    }
  });

  it('maps each kind to a DISTINCT reader', () => {
    const readers = KINDS.map(readerForShareKind);
    expect(new Set(readers).size).toBe(KINDS.length);
  });

  it('maps to the reader that actually owns each review surface', () => {
    const expected: Record<ShareKind, MagicReader> = {
      event: 'photo',
      travel: 'document',
      recipe: 'recipe',
    };
    for (const kind of KINDS) {
      expect(readerForShareKind(kind)).toBe(expected[kind]);
    }
  });

  it('throws rather than guessing for an unmapped kind', () => {
    expect(() => readerForShareKind('invoice' as ShareKind)).toThrow(/No magic reader/);
  });
});
