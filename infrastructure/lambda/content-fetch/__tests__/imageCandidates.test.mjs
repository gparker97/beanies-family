import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { collectImageCandidates, findMeta, findTagAttr } from '../modes/page.mjs';
import { sniffImageType } from '../modes/image.mjs';
import { asciiLower } from '../asciiLower.mjs';
import { screenUrl } from '../guardedFetch.mjs';

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

  test('an EMPTY value keeps scanning to the next tag', () => {
    // WordPress food blogs routinely emit two og:image tags — the theme's and the SEO
    // plugin's — and the first is often blank. Returning '' there reported "the page
    // declared no image" while the real hero sat in the very next tag.
    const html =
      '<meta property="og:image" content=""><meta property="og:image" content="https://cdn.test/hero.jpg">';
    assert.equal(findMeta(html, 'og:image'), 'https://cdn.test/hero.jpg');
    assert.deepEqual(collect(html), [{ url: 'https://cdn.test/hero.jpg', source: 'og_image' }]);
  });

  test('does NOT match an attribute name as a bare substring (data-content=)', () => {
    // `indexOf('content=')` also matches `data-content=`, and absolutize would launder the
    // junk value into a plausible same-origin URL that screenUrl cannot reject — shipping
    // as candidate #1 and burning one of only three client attempts.
    const html =
      '<meta property="og:image" data-content="junk-value" content="https://cdn.test/hero.jpg">';
    assert.equal(findMeta(html, 'og:image'), 'https://cdn.test/hero.jpg');
  });

  test('survives a non-ASCII attribute earlier in the tag', () => {
    // U+0130 lowercases to TWO UTF-16 units, so an offset found in a `toLowerCase()` copy
    // indexes one character off in the original and the quote guard fails. Ordinary on
    // Turkish recipe sites; it used to zero the whole ladder.
    const html =
      '<meta property="og:image" title="\u0130zmir K\u00f6fte" content="https://cdn.test/x.jpg">';
    assert.equal(findMeta(html, 'og:image'), 'https://cdn.test/x.jpg');
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

  test('accepts AVIF still and sequence brands', () => {
    for (const brand of ['avif', 'avis']) {
      const buf = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from(brand)]);
      assert.equal(sniffImageType(buf), 'image/avif', brand);
    }
  });

  test('REJECTS the generic mif1 brand, because an Apple HEIC also matches it', () => {
    // The sniffed mime NAMES the file, so accepting mif1 as AVIF would store a HEIC as
    // `dish-<id>.avif` — a filename that lies to every later reader. HEIC has its own
    // accepted type on the client; a genuine mif1-major AVIF just falls to the next rung.
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('mif1')]);
    assert.equal(sniffImageType(heic), null);
  });

  test('the high bit is NOT masked — latin1, never ascii', () => {
    // Node's 'ascii' decoder masks the high bit, so these bytes decode as 'RIFF'/'WEBP' and
    // every string-based magic check written that way matches 2^N sequences instead of one.
    const highBit = Buffer.from([0xd2, 0xc9, 0xc6, 0xc6, 0, 0, 0, 0, 0xd7, 0xc5, 0xc2, 0xd0]);
    assert.equal(sniffImageType(highBit), null);
    const ftypish = Buffer.concat([
      Buffer.alloc(4),
      Buffer.from([0xe6, 0xf4, 0xf9, 0xf0]),
      Buffer.from('avif'),
    ]);
    assert.equal(sniffImageType(ftypish), null);
    // GIF gets its OWN assertion rather than letting RIFF stand for the whole table: this
    // matcher was missed on the first pass and actually shipped to prod still masking the
    // high bit, which is precisely what a per-entry assertion would have caught.
    const gifish = Buffer.from([0xc7, 0xc9, 0xc6, 0xb8, 0xb9, 0xe1, 0, 0, 0, 0, 0, 0]);
    assert.equal(sniffImageType(gifish), null);
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

describe('the Referer is screened before it reaches the wire', () => {
  // guardedFetch's own request path needs a socket, so this pins the SCREEN — the part that
  // decides what may become a header — rather than mocking https.
  test('a CRLF-bearing referer is normalised, never passed through raw', () => {
    // `new URL()` silently strips tab/CR/LF, so this PASSES screening. Sending the raw string
    // afterwards made https.request throw ERR_INVALID_CHAR synchronously, rejecting out of a
    // function contracted never to throw and bypassing the whole typed error taxonomy.
    const raw = 'https://food.test/r\r\nX-Injected: 1';
    const screened = screenUrl(raw);
    assert.equal(screened.ok, true);
    const onTheWire = screened.url.toString();
    assert.ok(!onTheWire.includes('\r'));
    assert.ok(!onTheWire.includes('\n'));
    assert.notEqual(onTheWire, raw);
  });

  test('an unusable referer is rejected by the same screen the fetch uses', () => {
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- the point of the test
    assert.equal(screenUrl('http://food.test/r').ok, false);
    assert.equal(screenUrl('javascript:alert(1)').ok, false);
    assert.equal(screenUrl('https://u:p@food.test/r').ok, false);
  });
});
