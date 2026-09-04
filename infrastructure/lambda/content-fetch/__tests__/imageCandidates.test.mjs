import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { collectImageCandidates, findMeta, findTagAttr } from '../modes/page.mjs';
import { sniffImageType } from '../modes/image.mjs';
import { asciiLower } from '../asciiLower.mjs';

const BASE = 'https://food.test/recipes/cake';

/** The production call shape — `lower` is computed once by the caller. */
const collect = (html, jsonld = null, finalUrl = BASE) =>
  collectImageCandidates(html, asciiLower(html), finalUrl, jsonld);

const meta = (prop, content) => `<meta property="${prop}" content="${content}">`;

describe('collectImageCandidates — the ladder', () => {
  test('reads each author-declared source', () => {
    const cases = [
      [meta('og:image', 'https://cdn.test/og.jpg'), 'og_image', 'https://cdn.test/og.jpg'],
      [
        meta('og:image:secure_url', 'https://cdn.test/secure.jpg'),
        'og_secure',
        'https://cdn.test/secure.jpg',
      ],
      [meta('twitter:image', 'https://cdn.test/tw.jpg'), 'twitter', 'https://cdn.test/tw.jpg'],
      [
        meta('twitter:image:src', 'https://cdn.test/tws.jpg'),
        'twitter_src',
        'https://cdn.test/tws.jpg',
      ],
      [
        '<link rel="image_src" href="https://cdn.test/legacy.jpg">',
        'link_rel',
        'https://cdn.test/legacy.jpg',
      ],
    ];
    for (const [html, source, url] of cases) {
      assert.deepEqual(collect(html), [{ url, source }]);
    }
  });

  test('reads the JSON-LD image and thumbnail rungs from the normalised node', () => {
    const jsonld = { imageUrl: 'https://cdn.test/ld.jpg', thumbnailUrl: 'https://cdn.test/th.jpg' };
    assert.deepEqual(collect('<html></html>', jsonld), [
      { url: 'https://cdn.test/ld.jpg', source: 'jsonld' },
      { url: 'https://cdn.test/th.jpg', source: 'thumbnail' },
    ]);
  });

  test('honours ladder order, structured data first', () => {
    const html = `${meta('twitter:image', 'https://cdn.test/tw.jpg')}${meta('og:image', 'https://cdn.test/og.jpg')}`;
    const got = collect(html, { imageUrl: 'https://cdn.test/ld.jpg' });
    assert.deepEqual(
      got.map((c) => c.source),
      ['jsonld', 'og_image', 'twitter']
    );
  });

  test('THE REGRESSION: a JSON-LD recipe with no image still yields the page og:image', () => {
    // This is defect #2 from the bug report. The JSON-LD branch used to return before
    // og:image was ever read, so a Recipe node without an `image` key produced nothing at
    // all while the page's own og:image sat in the same HTML.
    const html = meta('og:image', 'https://cdn.test/og.jpg');
    const jsonld = { imageUrl: '', thumbnailUrl: '' };
    assert.deepEqual(collect(html, jsonld), [
      { url: 'https://cdn.test/og.jpg', source: 'og_image' },
    ]);
  });

  test('THE REGRESSION: a third-party CDN host is kept, not dropped', () => {
    // Defect #1 — the same-registrable-domain bound. `cdn.sndimg.com` on a `food.test` page
    // is the shape that silently lost nearly every real dish photo.
    const html = meta('og:image', 'https://cdn.sndimg.com/hero.jpg');
    assert.deepEqual(collect(html), [
      { url: 'https://cdn.sndimg.com/hero.jpg', source: 'og_image' },
    ]);
  });

  test('deduplicates the same URL across rungs', () => {
    const same = 'https://cdn.test/one.jpg';
    const html = `${meta('og:image', same)}${meta('twitter:image', same)}`;
    assert.deepEqual(collect(html), [{ url: same, source: 'og_image' }]);
  });

  test('caps at five candidates', () => {
    const html = [
      meta('og:image', 'https://cdn.test/1.jpg'),
      meta('og:image:secure_url', 'https://cdn.test/2.jpg'),
      meta('twitter:image', 'https://cdn.test/3.jpg'),
      meta('twitter:image:src', 'https://cdn.test/4.jpg'),
      '<link rel="image_src" href="https://cdn.test/5.jpg">',
    ].join('');
    const jsonld = { imageUrl: 'https://cdn.test/0.jpg', thumbnailUrl: 'https://cdn.test/6.jpg' };
    assert.equal(collect(html, jsonld).length, 5);
  });

  test('decodes &amp;-escaped CDN query strings', () => {
    // Yoast/Next.js write `&amp;` in attribute values. Fetched literally the CDN sees a param
    // named `amp;w` and 404s, so the photo silently never attaches.
    const html = meta('og:image', 'https://cdn.test/i?url=%2Fdish.jpg&amp;w=1200');
    assert.equal(collect(html)[0].url, 'https://cdn.test/i?url=%2Fdish.jpg&w=1200');
  });

  test('absolutises root-relative and protocol-relative URLs', () => {
    assert.equal(
      collect(meta('og:image', '/img/dish.jpg'))[0].url,
      'https://food.test/img/dish.jpg'
    );
    assert.equal(
      collect(meta('og:image', '//cdn.test/dish.jpg'))[0].url,
      'https://cdn.test/dish.jpg'
    );
  });

  test('drops anything screenUrl would reject, so the client never sees it', () => {
    const html = [
      // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the point of the test
      meta('og:image', 'http://cdn.test/insecure.jpg'), // not https
      meta('twitter:image', 'https://user:pw@cdn.test/creds.jpg'), // credentials
      meta('twitter:image:src', 'https://cdn.test:8443/port.jpg'), // non-443
    ].join('');
    assert.deepEqual(collect(html), []);
  });

  test('yields nothing rather than throwing on an imageless page', () => {
    assert.deepEqual(collect('<html><body>no pictures here</body></html>'), []);
    assert.deepEqual(collect(''), []);
  });

  test('DOCUMENTED LIMITATION: <base href> is ignored, resolution is against finalUrl', () => {
    // Deliberate. `<base>` is attacker-authored on an untrusted page, and honouring it would
    // let that page redirect relative resolution to a host of its choosing — the exact
    // aim-our-egress concern the domain bound was originally guarding against.
    const html = `<base href="https://evil.test/"><meta property="og:image" content="/dish.jpg">`;
    assert.equal(collect(html)[0].url, 'https://food.test/dish.jpg');
  });
});

describe('findTagAttr / findMeta', () => {
  test('findMeta still reads og:image (regression on the extraction)', () => {
    const html = '<meta property="og:image" content="https://x.test/a.jpg">';
    assert.equal(findMeta(html, 'og:image'), 'https://x.test/a.jpg');
  });

  test('the QUOTED needle stops og:image swallowing og:image:secure_url', () => {
    // Load-bearing for every ladder rung: an unquoted needle would make the og:image row
    // match its own sibling and collapse two rungs into one.
    const html = meta('og:image:secure_url', 'https://cdn.test/secure.jpg');
    assert.equal(findMeta(html, 'og:image'), '');
    assert.equal(findMeta(html, 'og:image:secure_url'), 'https://cdn.test/secure.jpg');
  });

  test('single-quoted attributes are matched too', () => {
    assert.equal(
      findMeta("<meta property='og:image' content='https://x.test/q.jpg'>", 'og:image'),
      'https://x.test/q.jpg'
    );
  });

  test('DOCUMENTED LIMITATION: an unquoted property is not matched', () => {
    assert.equal(
      findMeta('<meta property=og:image content="https://x.test/a.jpg">', 'og:image'),
      ''
    );
  });

  test('reads a non-meta tag and a non-content attribute', () => {
    const html = '<link rel="image_src" href="https://x.test/l.jpg">';
    assert.equal(
      findTagAttr(html, asciiLower(html), '<link', 'image_src', 'href='),
      'https://x.test/l.jpg'
    );
  });

  test('an unterminated tag terminates the scan instead of hanging', () => {
    assert.equal(findMeta('<meta property="og:image" content="x', 'og:image'), '');
  });
});

describe('sniffImageType', () => {
  const pad = (head) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)]);

  test('accepts the pre-existing formats', () => {
    assert.equal(sniffImageType(pad([0xff, 0xd8, 0xff])), 'image/jpeg');
    assert.equal(
      sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/png'
    );
    assert.equal(
      sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
      'image/webp'
    );
  });

  test('accepts AVIF across its three brands', () => {
    for (const brand of ['avif', 'avis', 'mif1']) {
      const buf = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from(brand)]);
      assert.equal(sniffImageType(buf), 'image/avif', brand);
    }
  });

  test('accepts both GIF versions', () => {
    assert.equal(sniffImageType(pad('GIF87a')), 'image/gif');
    assert.equal(sniffImageType(pad('GIF89a')), 'image/gif');
  });

  test('still rejects SVG — an image by content-type, a script container by capability', () => {
    assert.equal(sniffImageType(pad('<svg xmlns="http://www.w3.org/2000/svg">')), null);
  });

  test('rejects short, empty and non-image buffers', () => {
    assert.equal(sniffImageType(Buffer.alloc(4)), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
    assert.equal(sniffImageType(null), null);
    assert.equal(sniffImageType(pad('<!DOCTYPE html><html>')), null);
  });
});
