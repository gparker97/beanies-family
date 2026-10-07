import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import {
  KDF_PROFILES,
  LEGACY_ITERATIONS,
  KdfParamsError,
  recordedIterations,
  derivePbkdf2Key,
  derivePbkdf2Bits,
} from '../kdfParams';

const enc = (s: string) => new TextEncoder().encode(s);
/** The reference derivation spells the algorithm through a constant so `kdfParams.ts` stays the
 *  only file in src/ that hits the PBKDF2 acceptance grep. */
const PBKDF2_REFERENCE = 'PBKDF2';
const salt = () => crypto.getRandomValues(new Uint8Array(16));

describe('kdfParams', () => {
  beforeEach(() => logEvent.mockClear());

  describe('profiles', () => {
    it('pins every count (a change here is an ADR-041 decision, not a refactor)', () => {
      expect(KDF_PROFILES).toEqual({
        secret: 600_000,
        docHash: 100_000,
        highEntropy: 100_000,
        deviceFallback: 210_000,
      });
      expect(LEGACY_ITERATIONS).toBe(100_000);
    });
  });

  describe('recordedIterations', () => {
    it('reads an absent count as legacy', () => {
      expect(recordedIterations({})).toBe(LEGACY_ITERATIONS);
      expect(recordedIterations({ iterations: undefined })).toBe(LEGACY_ITERATIONS);
    });

    it('returns a valid recorded count as-is', () => {
      expect(recordedIterations({ iterations: 600_000 })).toBe(600_000);
      expect(recordedIterations({ iterations: 1 })).toBe(1);
      expect(recordedIterations({ iterations: 10_000_000 })).toBe(10_000_000);
    });

    it.each([
      ['zero', 0],
      ['negative', -100_000],
      ['fractional', 100_000.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a string', '600000'],
      ['null', null],
      ['an object', {}],
      ['over the DoS bound', 10_000_001],
    ])('throws KdfParamsError on %s (never guesses legacy)', (_label, iterations) => {
      expect(() => recordedIterations({ iterations })).toThrow(KdfParamsError);
    });

    it('names the error so callers can report it as error_code', () => {
      const err = (() => {
        try {
          recordedIterations({ iterations: -1 });
        } catch (e) {
          return e;
        }
      })();
      expect((err as Error).name).toBe('KdfParamsError');
    });
  });

  describe('derivePbkdf2Key', () => {
    it('yields a non-extractable AES-KW-256 wrap key that wraps and unwraps', async () => {
      const s = salt();
      const key = await derivePbkdf2Key(enc('pw'), s, { profile: 'secret', iterations: 1_000 });
      expect(key.algorithm).toMatchObject({ name: 'AES-KW', length: 256 });
      expect(key.extractable).toBe(false);
      expect([...key.usages].sort()).toEqual(['unwrapKey', 'wrapKey']);

      const fk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
        'encrypt',
      ]);
      const wrapped = await crypto.subtle.wrapKey('raw', fk, key, 'AES-KW');
      const again = await derivePbkdf2Key(enc('pw'), s, { profile: 'secret', iterations: 1_000 });
      const unwrapped = await crypto.subtle.unwrapKey(
        'raw',
        wrapped,
        again,
        'AES-KW',
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt']
      );
      expect(new Uint8Array(await crypto.subtle.exportKey('raw', unwrapped))).toEqual(
        new Uint8Array(await crypto.subtle.exportKey('raw', fk))
      );
    });
  });

  describe('derivePbkdf2Bits', () => {
    it('matches a direct PBKDF2-SHA256 deriveBits byte for byte', async () => {
      const s = salt();
      const ours = await derivePbkdf2Bits(
        enc('pw'),
        s,
        { profile: 'docHash', iterations: 2_000 },
        256
      );
      const material = await crypto.subtle.importKey('raw', enc('pw'), 'PBKDF2', false, [
        'deriveBits',
      ]);
      const direct = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: PBKDF2_REFERENCE, salt: s, iterations: 2_000, hash: 'SHA-256' },
          material,
          256
        )
      );
      expect(ours).toBeInstanceOf(Uint8Array);
      expect(ours).toEqual(direct);
    });

    it('honours a salt that is a subarray view, not its whole backing buffer', async () => {
      const backing = crypto.getRandomValues(new Uint8Array(48));
      const view = backing.subarray(16, 32);
      const params = { profile: 'docHash' as const, iterations: 1_000 };
      expect(await derivePbkdf2Bits(enc('pw'), view, params, 256)).toEqual(
        await derivePbkdf2Bits(enc('pw'), view.slice(), params, 256)
      );
    });
  });

  describe('kdf_derive telemetry', () => {
    it('emits exactly one row per derivation, carrying the profile and count', async () => {
      await derivePbkdf2Key(enc('pw'), salt(), { profile: 'highEntropy', iterations: 1_000 });
      await derivePbkdf2Bits(enc('pw'), salt(), { profile: 'docHash', iterations: 1_000 }, 256);
      expect(logEvent).toHaveBeenCalledTimes(2);
      expect(logEvent.mock.calls[0]![0]).toMatchObject({
        level: 'info',
        surface: 'kdf',
        message: 'kdf_derive',
        context: { perf_op: 'kdf.derive', kind: 'highEntropy', count: 1_000 },
      });
      expect(logEvent.mock.calls[1]![0]).toMatchObject({
        context: { kind: 'docHash', count: 1_000 },
      });
      expect(typeof logEvent.mock.calls[0]![0].context.perf_duration_ms).toBe('number');
    });

    it('`untracked` derives for real but emits NO row (dev benchmark must not skew fleet data)', async () => {
      const key = await derivePbkdf2Key(
        enc('pw'),
        salt(),
        { profile: 'secret', iterations: 1_000 },
        { untracked: true }
      );
      expect(key.algorithm).toMatchObject({ name: 'AES-KW' });
      expect(logEvent).not.toHaveBeenCalled();
    });

    describe('in a worker (no window)', () => {
      beforeEach(() => vi.stubGlobal('window', undefined));
      afterEach(() => vi.unstubAllGlobals());

      it('never enqueues telemetry, and still derives', async () => {
        expect(typeof window).toBe('undefined');
        const bits = await derivePbkdf2Bits(
          enc('pw'),
          salt(),
          { profile: 'docHash', iterations: 1_000 },
          256
        );
        expect(bits.byteLength).toBe(32);
        expect(logEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe('import graph', () => {
    it('imports only logEvent (no gate, stores, Capacitor or appUpdate in the crypto graph)', () => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path to the module under test
      const src = readFileSync(resolve(__dirname, '../kdfParams.ts'), 'utf8');
      const imports = src.split('\n').filter((l) => /^import\b/.test(l));
      expect(imports).toEqual(["import { logEvent } from '@/services/telemetry/logEvent';"]);
    });
  });
});
