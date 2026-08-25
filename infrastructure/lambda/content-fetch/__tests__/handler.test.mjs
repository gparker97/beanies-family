/* global process, Buffer */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBlockedAddress, screenUrl } from '../guardedFetch.mjs';
import {
  extractRecipeFromHtml,
  findRecipeNode,
  flattenInstructions,
  humanizeDuration,
  firstImageUrl,
} from '../recipeJsonLd.mjs';
import { htmlToText } from '../modes/page.mjs';
import { sniffImageType } from '../modes/image.mjs';
import {
  parseVideoId,
  extractPlayerResponse,
  pickCaptionTrack,
  captionsXmlToText,
} from '../modes/youtube.mjs';

// Set BEFORE importing the handler: it reads the key into a module-level const.
process.env.CONTENT_FETCH_API_KEY = 'test-key';
process.env.CORS_ORIGINS = 'https://app.beanies.family';
const { handler } = await import('../index.mjs');

/** Is there real network here? The real-socket suite below is skipped when there is not. */
const ONLINE = await fetch('https://example.com/', { method: 'HEAD' })
  .then(() => true)
  .catch(() => false);

const HERE = dirname(fileURLToPath(import.meta.url));
const LAMBDA_DIR = join(HERE, '..');

describe('SSRF: address screen', () => {
  const blocked = [
    ['127.0.0.1', 4, 'loopback'],
    ['10.0.0.5', 4, 'RFC1918 /8'],
    ['172.16.0.1', 4, 'RFC1918 /12 lower bound'],
    ['172.31.255.255', 4, 'RFC1918 /12 upper bound'],
    ['192.168.1.1', 4, 'RFC1918 /16'],
    ['169.254.169.254', 4, 'cloud metadata'],
    ['100.64.0.1', 4, 'CGNAT'],
    ['0.0.0.0', 4, 'this network'],
    ['192.0.0.1', 4, 'IETF assignments'],
    ['198.18.0.1', 4, 'benchmarking'],
    ['224.0.0.1', 4, 'multicast'],
    ['::1', 6, 'v6 loopback'],
    ['fe80::1', 6, 'v6 link-local'],
    ['fd00::1', 6, 'v6 unique-local'],
    ['ff02::1', 6, 'v6 multicast'],
    ['::ffff:169.254.169.254', 6, 'v4-mapped metadata — the sneaky one'],
  ];
  for (const [addr, family, why] of blocked) {
    test(`blocks ${addr} (${why})`, () => assert.equal(isBlockedAddress(addr, family), true));
  }

  const allowed = [
    ['8.8.8.8', 4],
    ['1.1.1.1', 4],
    ['172.32.0.1', 4], // just OUTSIDE RFC1918 /12 — an off-by-one here blocks real hosts
    ['2606:4700::1111', 6],
  ];
  for (const [addr, family] of allowed) {
    test(`allows public ${addr}`, () => assert.equal(isBlockedAddress(addr, family), false));
  }

  test('blocks malformed input rather than passing it through', () => {
    assert.equal(isBlockedAddress('', 4), true);
    assert.equal(isBlockedAddress('999.1.1.1', 4), true);
    assert.equal(isBlockedAddress(null, 4), true);
  });
});

describe('SSRF: url screen', () => {
  test('https only', () => {
    assert.equal(screenUrl('https://ok.example/x').ok, true);
    assert.equal(screenUrl('http' + '://ok.example/x').blockReason, 'scheme');
    assert.equal(screenUrl('file:///etc/passwd').blockReason, 'scheme');
    assert.equal(screenUrl('gopher://x/').blockReason, 'scheme');
  });
  test('rejects embedded credentials', () => {
    assert.equal(screenUrl('https://user:pass@ok.example/').blockReason, 'credentials');
  });
  test('rejects a non-443 port, accepts an explicit :443', () => {
    assert.equal(screenUrl('https://ok.example:8443/').blockReason, 'port');
    assert.equal(screenUrl('https://ok.example:443/x').ok, true);
  });
  test('rejects unparseable and over-long urls', () => {
    assert.equal(screenUrl('not a url').code, 'bad_url');
    assert.equal(screenUrl(`https://ok.example/${'a'.repeat(2100)}`).code, 'bad_url');
    assert.equal(screenUrl(null).code, 'bad_url');
  });
});

describe('SSRF: the guard is the only way out', () => {
  test('no bare fetch( exists outside guardedFetch.mjs', () => {
    // The single most important invariant in this Lambda. A mode that reaches for global
    // fetch bypasses every screen above, and would look perfectly innocent in review.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.mjs') || entry === 'guardedFetch.mjs') continue;
        const src = readFileSync(full, 'utf8');
        if (/(^|[^.\w])fetch\s*\(/.test(src.replace(/guardedFetch\s*\(/g, ''))) {
          offenders.push(entry);
        }
      }
    };
    walk(LAMBDA_DIR);
    assert.deepEqual(offenders, [], `bare fetch( found in: ${offenders.join(', ')}`);
  });
});

describe('schema.org/Recipe parsing', () => {
  const wrap = (obj) =>
    `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

  test('finds a Recipe inside @graph', () => {
    const node = findRecipeNode({
      '@graph': [{ '@type': 'WebSite' }, { '@type': 'Recipe', name: 'X' }],
    });
    assert.equal(node.name, 'X');
  });

  test('handles @type as an ARRAY (legal, and common)', () => {
    const node = findRecipeNode({ '@type': ['NewsArticle', 'Recipe'], name: 'Y' });
    assert.equal(node.name, 'Y');
  });

  test('flattens HowToStep objects', () => {
    const steps = flattenInstructions([
      { '@type': 'HowToStep', text: 'Beat the butter.' },
      { '@type': 'HowToStep', text: 'Bake.' },
    ]);
    assert.deepEqual(steps, ['Beat the butter.', 'Bake.']);
  });

  test('flattens HowToSection groups — the shape naive parsers drop', () => {
    const steps = flattenInstructions([
      {
        '@type': 'HowToSection',
        name: 'For the cake',
        itemListElement: [{ '@type': 'HowToStep', text: 'Cream butter.' }],
      },
      { '@type': 'HowToStep', text: 'Drizzle.' },
    ]);
    assert.deepEqual(steps, ['Cream butter.', 'Drizzle.']);
  });

  test('flattens a newline-separated instruction string', () => {
    assert.deepEqual(flattenInstructions('One\nTwo\n\nThree'), ['One', 'Two', 'Three']);
  });

  test('humanizes ISO-8601 durations, passes prose through', () => {
    assert.equal(humanizeDuration('PT1H30M'), '1 hour 30 mins');
    assert.equal(humanizeDuration('PT45M'), '45 mins');
    assert.equal(humanizeDuration('PT1H'), '1 hour');
    assert.equal(humanizeDuration('1 hour 10 mins'), '1 hour 10 mins');
    assert.equal(humanizeDuration(undefined), '');
  });

  test('picks an image url from string, array or ImageObject', () => {
    assert.equal(firstImageUrl('https://x/a.jpg'), 'https://x/a.jpg');
    assert.equal(firstImageUrl(['https://x/a.jpg']), 'https://x/a.jpg');
    assert.equal(
      firstImageUrl({ '@type': 'ImageObject', url: 'https://x/b.jpg' }),
      'https://x/b.jpg'
    );
  });

  test('end-to-end from html, with exact quantities', () => {
    const r = extractRecipeFromHtml(
      wrap({
        '@type': 'Recipe',
        name: 'Lemon Drizzle',
        recipeIngredient: ['225g butter', '4 eggs'],
        recipeInstructions: [{ '@type': 'HowToStep', text: 'Bake it.' }],
        prepTime: 'PT20M',
        cookTime: 'PT45M',
        recipeYield: ['8', '8 servings'],
      })
    );
    assert.equal(r.name, 'Lemon Drizzle');
    assert.deepEqual(r.ingredients, ['225g butter', '4 eggs']);
    assert.equal(r.prepTime, '20 mins');
    assert.equal(r.cookTime, '45 mins');
    assert.equal(r.servings, '8 servings'); // the descriptive one, not the bare number
  });

  test('skips a malformed ld+json block and keeps looking', () => {
    const html =
      '<script type="application/ld+json">{ not json </script>' +
      wrap({ '@type': 'Recipe', name: 'Survivor', recipeIngredient: ['x'] });
    assert.equal(extractRecipeFromHtml(html).name, 'Survivor');
  });

  test('returns null when there is no Recipe', () => {
    assert.equal(extractRecipeFromHtml(wrap({ '@type': 'WebSite', name: 'Blog' })), null);
  });
});

describe('html → text reduction', () => {
  test('drops scripts/styles and keeps list structure as lines', () => {
    const t = htmlToText(
      '<html><head><style>.a{}</style><script>evil()</script></head>' +
        '<body><nav>Home</nav><ul><li>225g butter</li><li>4 eggs</li></ul>' +
        '<p>Bake it.</p><footer>Copyright</footer></body></html>'
    );
    assert.ok(!t.includes('evil'), 'script contents must not survive');
    assert.ok(!t.includes('Copyright'), 'footer must be dropped');
    assert.ok(t.includes('225g butter'));
    assert.ok(t.includes('4 eggs'));
    // Ingredients must stay on separate lines or they collapse into one run-on string.
    assert.ok(/225g butter\s*\n\s*4 eggs/.test(t), `lines not preserved:\n${t}`);
  });

  test('decodes entities, once and only once', () => {
    assert.equal(htmlToText('<p>salt &amp; pepper &#39;n spice</p>'), "salt & pepper 'n spice");
    // &amp;lt; must survive as the literal text &lt;, not become a real <.
    assert.equal(htmlToText('<p>use &amp;lt; for less-than</p>'), 'use &lt; for less-than');
  });
});

describe('image sniffing', () => {
  test('recognises jpeg / png / webp by magic bytes', () => {
    assert.equal(
      sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
      'image/jpeg'
    );
    assert.equal(
      sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
      'image/png'
    );
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
    assert.equal(sniffImageType(webp), 'image/webp');
  });

  test('REJECTS an SVG — the one usePhotos would let through', () => {
    // usePhotos accepts on `ACCEPTED_MIMES.includes(type) || /\.(jpe?g|png|...)$/.test(name)`,
    // so an image/svg+xml named dish.jpg passes it. Sniffing here is what stops it.
    assert.equal(
      sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
      null
    );
  });

  test('rejects html, empty and truncated buffers', () => {
    assert.equal(sniffImageType(Buffer.from('<!DOCTYPE html><html></html>')), null);
    assert.equal(sniffImageType(Buffer.alloc(0)), null);
    assert.equal(sniffImageType(Buffer.from([0xff, 0xd8])), null);
  });
});

describe('youtube harvesting', () => {
  test('parses every common url shape', () => {
    const ID = 'dQw4w9WgXcQ';
    for (const u of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=30s`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
    ]) {
      assert.equal(parseVideoId(u), ID, u);
    }
  });

  test('rejects non-youtube and malformed ids', () => {
    assert.equal(parseVideoId('https://vimeo.com/12345'), '');
    assert.equal(parseVideoId('https://www.youtube.com/watch?v=short'), '');
    assert.equal(parseVideoId('nonsense'), '');
  });

  test('brace-matches ytInitialPlayerResponse past nested braces in strings', () => {
    // A lazy /\{.*?\}/ truncates here, which is why this is brace-matched.
    const player = { videoDetails: { title: 'A {tricky} title', shortDescription: 'a}b{c' } };
    const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>`;
    const got = extractPlayerResponse(html);
    assert.equal(got.videoDetails.title, 'A {tricky} title');
    assert.equal(got.videoDetails.shortDescription, 'a}b{c');
  });

  test('prefers a creator track over the auto-generated one', () => {
    const track = pickCaptionTrack({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ kind: 'asr', baseUrl: 'https://auto' }, { baseUrl: 'https://human' }],
        },
      },
    });
    assert.equal(track.baseUrl, 'https://human');
  });

  test('falls back to the asr track when that is all there is', () => {
    const track = pickCaptionTrack({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [{ kind: 'asr', baseUrl: 'https://auto' }],
        },
      },
    });
    assert.equal(track.baseUrl, 'https://auto');
  });

  test('returns null when captions are disabled', () => {
    assert.equal(pickCaptionTrack({}), null);
    assert.equal(
      pickCaptionTrack({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } } }),
      null
    );
  });

  test('converts timedtext xml to plain text', () => {
    const xml =
      '<transcript><text start="0">add the &quot;flour&quot;</text><text start="2">then whisk</text></transcript>';
    assert.equal(captionsXmlToText(xml), 'add the "flour" then whisk');
  });

  test('does NOT double-decode — &amp;quot; stays literal', () => {
    // The naive chained-replace implementation turned &amp;quot; into a real quote, because
    // each replacement fed the next. Text that escaped an entity would silently un-escape.
    const xml =
      '<transcript><text start="0">write &amp;quot; to escape a quote</text></transcript>';
    assert.equal(captionsXmlToText(xml), 'write &quot; to escape a quote');
  });
});

describe('dispatcher', () => {
  const ev = (body, key = 'test-key') => ({
    requestContext: { http: { method: 'POST' } },
    headers: { 'x-api-key': key, origin: 'https://app.beanies.family' },
    body: JSON.stringify(body),
  });

  test('OPTIONS preflight', async () => {
    const r = await handler({ requestContext: { http: { method: 'OPTIONS' } }, headers: {} });
    assert.equal(r.statusCode, 204);
  });

  test('rejects a wrong api key', async () => {
    const r = await handler(ev({ mode: 'page', url: 'https://x.example' }, 'nope'));
    assert.equal(r.statusCode, 401);
  });

  test('rejects an unknown mode', async () => {
    const r = await handler(ev({ mode: 'nope', url: 'https://x.example' }));
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).code, 'bad_mode');
  });

  test('PROTOTYPE-CHAIN keys do not reach a mode', async () => {
    // MODES is a plain object literal, so MODES['constructor'] is truthy. A `!MODES[mode]`
    // guard would pass it straight through to an unhandled TypeError with no CORS headers.
    for (const mode of ['constructor', 'toString', '__proto__', 'valueOf', 'hasOwnProperty']) {
      const r = await handler(ev({ mode, url: 'https://x.example' }));
      assert.equal(r.statusCode, 400, mode);
      assert.equal(JSON.parse(r.body).code, 'bad_mode', mode);
      assert.ok(r.headers['Access-Control-Allow-Origin'], `${mode} lost CORS headers`);
    }
  });

  test('rejects a missing url', async () => {
    const r = await handler(ev({ mode: 'page' }));
    assert.equal(JSON.parse(r.body).code, 'bad_url');
  });

  test('refuses a non-https url WITHOUT making a request', async () => {
    const r = await handler(ev({ mode: 'page', url: 'http' + '://x.example/a' }));
    assert.equal(r.statusCode, 400);
    assert.equal(JSON.parse(r.body).blockReason, 'scheme');
  });

  test('refuses a link-local url', async () => {
    const r = await handler(
      ev({ mode: 'image', url: 'https://169.254.169.254/latest/meta-data/' })
    );
    assert.equal(JSON.parse(r.body).blockReason, 'private_ip');
  });

  test('every response carries CORS headers', async () => {
    const r = await handler(ev({ mode: 'nope', url: 'https://x.example' }));
    assert.equal(r.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
  });
});

describe('guardedFetch against a REAL socket', () => {
  // These 3 tests exist because 57 passing unit tests shipped a guardedFetch that failed
  // EVERY real request. The `lookup` pin returned the 3-arg form while Node 20's
  // autoSelectFamily (Happy Eyeballs) calls it with `{all:true}` and expects an ARRAY, so
  // every connection died with ERR_INVALID_IP_ADDRESS in ~20ms. Nothing that mocks the
  // socket can catch that — only actually opening one can.
  //
  // Network-dependent by design. Skipped when offline so an offline dev is not blocked
  // (ONLINE is resolved at module top level — `await` is not allowed in a describe body).

  test('fetches a real https host through the address pin', { skip: !ONLINE }, async () => {
    const { guardedFetch } = await import('../guardedFetch.mjs');
    const r = await guardedFetch('https://example.com/', { maxBytes: 1024 * 1024 });
    assert.equal(r.ok, true, `expected a successful fetch, got ${JSON.stringify(r)}`);
    assert.ok(r.body.length > 0, 'body must not be empty');
    assert.match(r.contentType, /text\/html/);
  });

  test('still refuses a private address on the real path', { skip: !ONLINE }, async () => {
    const { guardedFetch } = await import('../guardedFetch.mjs');
    const r = await guardedFetch('https://127.0.0.1/', { maxBytes: 1024 });
    assert.equal(r.ok, false);
    assert.equal(r.blockReason, 'private_ip');
  });

  test('enforces the size cap on a real body', { skip: !ONLINE }, async () => {
    const { guardedFetch } = await import('../guardedFetch.mjs');
    // example.com is ~1.2KB; a 100-byte cap must trip rather than silently truncating.
    const r = await guardedFetch('https://example.com/', { maxBytes: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'too_large');
  });
});
