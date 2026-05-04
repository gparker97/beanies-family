import { describe, it, expect } from 'vitest';
import { isChunkLoadError } from './hardReload';

describe('isChunkLoadError', () => {
  it('matches Chrome/Edge dynamic import failure', () => {
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: https://app.beanies.family/assets/FamilyNookPage-DZK3iJ0T.js'
        )
      )
    ).toBe(true);
  });

  it('matches Firefox dynamic import failure', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('matches Safari module script failure', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it("matches Vue Router's stale-chunk fallback shape", () => {
    // Caught 2026-05-04 from a stale tab three deploys behind HEAD. Vue
    // Router throws this when the lazy import() resolves but the result
    // isn't a valid module with a default export — typically because
    // CloudFront served the SPA's 404 HTML for a rotated chunk filename.
    expect(isChunkLoadError(new Error('Couldn\'t resolve component "default" at "/pod"'))).toBe(
      true
    );
    expect(isChunkLoadError(new Error('Couldn\'t resolve component "default" at "/nook"'))).toBe(
      true
    );
  });

  it('does not match unrelated errors', () => {
    expect(isChunkLoadError(new Error('TypeError: Cannot read property of undefined'))).toBe(false);
    expect(isChunkLoadError(new Error('NetworkError: Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(new Error('Incorrect password'))).toBe(false);
  });

  it('handles non-Error inputs gracefully', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });
});
