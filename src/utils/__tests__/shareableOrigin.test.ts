/**
 * The origin a link may be sent to someone else.
 *
 * This exists because the bug it prevents is invisible in every environment a developer
 * works in: `npm run dev` is `http://localhost`, the deployed PWA is
 * `https://app.beanies.family`, and Android sets `androidScheme: 'https'`. Three out of four
 * give the right answer. The fourth — the iOS Capacitor shell — fails only on a real device,
 * only in a message that has already been sent, and only for the person on the other end.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { shareableOrigin } from '../shareableOrigin';

const CANONICAL = 'https://app.beanies.family';

function withOrigin(origin: string | undefined) {
  if (origin === undefined) {
    // @ts-expect-error deliberately removing `location` to model a non-browser context
    delete globalThis.location;
    return;
  }
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: { origin },
  });
}

const original = globalThis.location;
afterEach(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    writable: true,
    value: original,
  });
});

describe('shareableOrigin', () => {
  it.each([
    ['the deployed PWA', 'https://app.beanies.family'],
    ['a local dev server', 'http://localhost:5173'],
    ['a preview deploy', 'https://preview.example.com'],
  ])('passes through %s unchanged', (_label, origin) => {
    withOrigin(origin);
    expect(shareableOrigin()).toBe(origin);
  });

  it('REPLACES the iOS Capacitor origin, which opens nothing on anyone else’s phone', () => {
    // `capacitor://app.beanies.family` is deliberate — it is what keeps the native WebView
    // serving local content — and it is a private scheme that exists only inside that app.
    withOrigin('capacitor://app.beanies.family');
    expect(shareableOrigin()).toBe(CANONICAL);
  });

  it.each([
    ['an opaque origin, which serialises as the literal string "null"', 'null'],
    ['a file:// document', 'file://'],
    ['the ionic scheme', 'ionic://app.beanies.family'],
  ])('falls back for %s', (_label, origin) => {
    // `"null"` is the one that matters: `new URL('null')` THROWS, so an implementation that
    // parsed the origin would die inside the share modal's computed — the single input the
    // fallback exists for would be the input that defeated it.
    withOrigin(origin);
    expect(() => shareableOrigin()).not.toThrow();
    expect(shareableOrigin()).toBe(CANONICAL);
  });

  it('falls back when there is no location at all', () => {
    withOrigin(undefined);
    expect(shareableOrigin()).toBe(CANONICAL);
  });
});
