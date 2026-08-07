import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/**
 * apex-cutover.js is a CloudFront Functions script: a bare ES5 file with a
 * global `handler(event)` and NO module system (the runtime has neither
 * `require` nor `module`, and this repo is `"type": "module"`, so a
 * `module.exports` sniff appended to the file would be dead code).
 *
 * Evaluating the real source in a fresh VM context is the only way to test the
 * bytes CloudFront actually runs without adding anything to them. The
 * production file stays byte-identical to what ships, so this test can never
 * disagree with reality about the file's shape.
 */
// Resolved from the repo root (vitest's cwd) rather than `import.meta.url`:
// the suite runs under happy-dom, where import.meta.url is an http:// URL and
// fileURLToPath rejects it.
//
// The security config flags the non-literal readFileSync argument. It is a fixed
// repo-relative constant joined to cwd — no external, user, or network input
// reaches it — and this is a test-only read of a checked-in source file. The
// directive below must stay a SINGLE line: eslint-disable-next-line applies to
// the line immediately after the comment, so a wrapped justification would
// silently target the wrong line (which is exactly what happened first time).
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repo path, test-only read
const src = readFileSync(
  join(process.cwd(), 'infrastructure/modules/web/functions/apex-cutover.js'),
  'utf8'
);
const { handler } = runInNewContext(`${src}\n;({ handler })`);

/** Build a viewer-request event. `query` is a plain object of single values. */
const request = (uri, query = {}) => {
  const querystring = {};
  for (const [key, value] of Object.entries(query)) querystring[key] = { value };
  return { request: { uri, querystring } };
};

const APP = 'https://app.beanies.family';
const APEX = 'https://beanies.family';

describe('apex-cutover: /oauth/native is served by the apex, not redirected', () => {
  // This is the whole point of the exemption. A 301 here loads the PWA inside
  // the iOS browser sheet instead of reaching the bridge page.
  it('rewrites /oauth/native to its .html object rather than 301ing', () => {
    const result = handler(request('/oauth/native'));
    expect(result.statusCode).toBeUndefined();
    expect(result.uri).toBe('/oauth/native.html');
  });

  it('preserves the OAuth query string while doing so', () => {
    const result = handler(request('/oauth/native', { code: 'abc', state: 'xyz' }));
    expect(result.statusCode).toBeUndefined();
    expect(result.uri).toBe('/oauth/native.html');
    // The query rides on the request untouched — the function never rebuilds it
    // on the rewrite path, which is what keeps the auth code byte-identical.
    expect(result.querystring.code.value).toBe('abc');
    expect(result.querystring.state.value).toBe('xyz');
  });

  it('canonicalises the trailing-slash form to the exact path', () => {
    const result = handler(request('/oauth/native/'));
    expect(result.statusCode).toBe(301);
    expect(result.headers.location.value).toBe(`${APEX}/oauth/native`);
  });

  // Exact-match, not prefix: a prefix exemption would send these to the .html
  // rewrite and 403 from S3, since no such object exists.
  it('still redirects sub-paths under /oauth/native to the app', () => {
    const result = handler(request('/oauth/native/extra'));
    expect(result.statusCode).toBe(301);
    expect(result.headers.location.value).toBe(`${APP}/oauth/native/extra`);
  });

  it('still redirects look-alike paths to the app', () => {
    const result = handler(request('/oauth/nativexyz'));
    expect(result.statusCode).toBe(301);
    expect(result.headers.location.value).toBe(`${APP}/oauth/nativexyz`);
  });
});

describe('apex-cutover: everything else is unchanged', () => {
  it('still 301s /oauth/callback to the app', () => {
    const result = handler(request('/oauth/callback', { code: 'abc' }));
    expect(result.statusCode).toBe(301);
    expect(result.headers.location.value).toBe(`${APP}/oauth/callback?code=abc`);
  });

  it('still 301s ordinary app paths to the app', () => {
    expect(handler(request('/dashboard')).headers.location.value).toBe(`${APP}/dashboard`);
    expect(handler(request('/settings')).headers.location.value).toBe(`${APP}/settings`);
    expect(handler(request('/welcome')).headers.location.value).toBe(`${APP}/welcome`);
  });

  // Must stay ahead of every other branch — a rewrite here 404s the AASA and
  // silently breaks iOS Universal Link verification.
  it('passes /.well-known/* through verbatim, extensionless', () => {
    const result = handler(request('/.well-known/apple-app-site-association'));
    expect(result.statusCode).toBeUndefined();
    expect(result.uri).toBe('/.well-known/apple-app-site-association');
  });

  it('still 301s legacy /beanstalk* to /blog*', () => {
    expect(handler(request('/beanstalk/foo')).headers.location.value).toBe(`${APEX}/blog/foo`);
  });

  it('still 301s legacy /home to /', () => {
    expect(handler(request('/home')).headers.location.value).toBe(`${APEX}/`);
  });

  it('still rewrites Astro clean URLs to .html', () => {
    expect(handler(request('/blog/foo')).uri).toBe('/blog/foo.html');
    expect(handler(request('/guides/bar')).uri).toBe('/guides/bar.html');
  });

  it('still rewrites the root to /index.html', () => {
    expect(handler(request('/')).uri).toBe('/index.html');
  });

  it('still passes through paths that already have an extension', () => {
    expect(handler(request('/robots.txt')).uri).toBe('/robots.txt');
  });
});
