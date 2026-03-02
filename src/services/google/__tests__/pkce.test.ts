import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge } from '../pkce';

describe('PKCE utilities', () => {
  describe('generateCodeVerifier', () => {
    it('returns a 43-character base64url string', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toHaveLength(43);
    });

    it('is URL-safe (no +, /, or =)', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).not.toMatch(/[+/=]/);
    });

    it('generates unique values', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe('generateCodeChallenge', () => {
    it('returns a base64url string (no +, /, or =)', async () => {
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).not.toMatch(/[+/=]/);
      expect(challenge.length).toBeGreaterThan(0);
    });

    it('is deterministic for the same verifier', async () => {
      const verifier = 'test-verifier-for-deterministic-check-abc';
      const a = await generateCodeChallenge(verifier);
      const b = await generateCodeChallenge(verifier);
      expect(a).toBe(b);
    });

    it('produces different challenges for different verifiers', async () => {
      const a = await generateCodeChallenge('verifier-aaa');
      const b = await generateCodeChallenge('verifier-bbb');
      expect(a).not.toBe(b);
    });
  });
});
