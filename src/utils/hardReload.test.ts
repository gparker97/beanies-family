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

  it('matches destructure-of-null TypeError when a dynamic import resolves to null', () => {
    // Caught 2026-05-10 from greg's iPhone PWA mid-update. SW served a
    // response for the rotated chunk URL that Vite parsed as a null module
    // (instead of a fetch failure), so the standard chunk-load error
    // shapes never appeared and `vite:preloadError` didn't fire. Every
    // `const { foo } = await import(...)` then threw this V8/Firefox/modern-
    // WebKit shape, which previously slipped through to App.vue's init
    // catch as a generic TypeError → scary error overlay flashing
    // mid-update. Now recognized as the chunk-load symptom it actually is.
    expect(
      isChunkLoadError(
        new TypeError(
          "Cannot destructure property 'registerGoogleAccountAssertion' of '(intermediate value)' as it is null."
        )
      )
    ).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError("Cannot destructure property 'completeRedirectAuth' of 'mod' as it is null")
      )
    ).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError("Cannot destructure property 'foo' of 'bar' as it is undefined.")
      )
    ).toBe(true);
  });

  it('matches iOS Safari destructure-of-null phrasing', () => {
    // Caught 2026-05-13 from greg's iPhone 14 Safari (browser, not PWA)
    // after the Google Drive OAuth redirect-back. Safari uses a different
    // preposition for the same symptom ("from null or undefined value"
    // vs V8's "as it is null"), so the previous regex missed it and the
    // user got stuck in a "beans spilled" reload loop with no way out
    // except killing the browser. The broader regex matches both.
    expect(
      isChunkLoadError(
        new TypeError(
          "Cannot destructure property 'registerGoogleAccountAssertion' from null or undefined value"
        )
      )
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot destructure property 'foo' from null"))).toBe(
      true
    );
    expect(
      isChunkLoadError(new TypeError("Cannot destructure property 'bar' from undefined"))
    ).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isChunkLoadError(new Error('TypeError: Cannot read property of undefined'))).toBe(false);
    expect(isChunkLoadError(new Error('NetworkError: Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(new Error('Incorrect password'))).toBe(false);
    // Real null-deref bugs that aren't destructure-shaped should still
    // surface — we only catch the destructure-of-null shape because it's
    // the dependable symptom of an import-resolved-to-null.
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'foo')"))).toBe(
      false
    );
    expect(isChunkLoadError(new TypeError("null is not an object (evaluating 'x.y')"))).toBe(false);
  });

  it('handles non-Error inputs gracefully', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });
});
