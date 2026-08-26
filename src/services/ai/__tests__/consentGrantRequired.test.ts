/**
 * The ADR-030 consent gate is enforced by the TYPE SYSTEM (#64) — this file is the proof.
 *
 * `@ts-expect-error` is an assertion in both directions: the build fails if the marked line
 * compiles cleanly, so if someone ever makes `grant` optional again, THIS test breaks rather
 * than the gate silently becoming a convention. That matters here specifically: the project
 * shipped an entry point that skipped the gate once already, because "the caller enforces it"
 * lived in a comment.
 *
 * These assertions are compile-time. The runtime body only exists so the file is a test.
 */
import { describe, it, expect } from 'vitest';
import { extractEventFromDocument } from '../documentExtractionService';
import type { ConsentGrant } from '@/composables/useDocumentConsent';
import { __testConsentGrant } from '@/test/consentGrant';

const file = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });
const base = { tier: 'managed' as const, todayIso: '2026-01-01' };

describe('ConsentGrant is required to reach the extraction funnel (#64)', () => {
  it('does not compile without a grant', () => {
    // @ts-expect-error — `grant` is required; omitting it must be a build error.
    void (() => extractEventFromDocument(file(), base));
    expect(true).toBe(true);
  });

  it('does not accept a forged grant from application code', () => {
    // @ts-expect-error — the brand is a unique symbol, so a bare object cannot satisfy it.
    void (() => extractEventFromDocument(file(), { ...base, grant: {} }));
    // @ts-expect-error — nor can a string, a cast-free literal, or anything else nameable.
    void (() => extractEventFromDocument(file(), { ...base, grant: 'granted' }));
    expect(true).toBe(true);
  });

  it('compiles with a real grant', () => {
    const grant: ConsentGrant = __testConsentGrant;
    void (() => extractEventFromDocument(file(), { ...base, grant }));
    expect(true).toBe(true);
  });
});
