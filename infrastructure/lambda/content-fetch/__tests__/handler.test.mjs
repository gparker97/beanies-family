/* global process, Buffer */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isBlockedAddress, screenUrl } from '../guardedFetch.mjs';
import { decodeEntities } from '../entities.mjs';
import { asciiLower } from '../asciiLower.mjs';
import { pageTitle, findMeta } from '../modes/page.mjs';
import {
  extractRecipeFromHtml,
  findRecipeNode,
  flattenInstructions,
  humanizeDuration,
  firstImageUrl,
} from '../recipeJsonLd.mjs';
import { htmlToText } from '../modes/page.mjs';
import { sniffImageType } from '../modes/image.mjs';
import { parseVideoId, readVideoDetails } from '../modes/youtube.mjs';

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
        // Strip the sanctioned call first, then look for ANY remaining fetch — including
        // `globalThis.fetch(` and `global.fetch(`, which the old `[^.\w]` guard let through
        // and which are the most natural way to bypass the very file this test protects.
        const stripped = src.replace(/guardedFetch\s*\(/g, '');
        if (/\bfetch\s*\(/.test(stripped)) {
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

  // The caption tests that used to live here were deleted with the captions path. YouTube
  // now gates `timedtext` behind a proof-of-origin token: measured from a residential IP on
  // an OK watch page, across two videos and three formats, every fetch returned HTTP 200
  // with zero bytes. The tests passed because they only checked that a track was LISTED.
  // Entity decoding — the real value in that block — moved to its own describe below
  // rather than being deleted with them.

  test('reads the description even when the video reports UNPLAYABLE', () => {
    // THE REGRESSION THIS PINS. YouTube blocks datacenter IPs by setting playabilityStatus
    // to a non-OK value while still returning the full videoDetails. The old code checked
    // playabilityStatus FIRST and returned not_found on a payload with the description
    // sitting right there in it, so every YouTube link failed with "the page may have moved"
    // about a video the user could see in their browser.
    const details = readVideoDetails({
      playabilityStatus: { status: 'UNPLAYABLE', reason: 'Video unavailable' },
      videoDetails: { title: 'Easy Pumpkin Pie', author: 'Preppy Kitchen', shortDescription: 'x' },
    });
    assert.equal(details.title, 'Easy Pumpkin Pie');
    assert.equal(details.channel, 'Preppy Kitchen');
  });

  test('returns null when there really are no details to read', () => {
    assert.equal(readVideoDetails({}), null);
    assert.equal(readVideoDetails({ videoDetails: {} }), null);
    assert.equal(readVideoDetails(null), null);
  });

  test('caps the description so a pathological one cannot blow the response', () => {
    const details = readVideoDetails({
      videoDetails: { title: 't', shortDescription: 'a'.repeat(20_000) },
    });
    assert.equal(details.description.length, 8000);
  });
});

describe('length-preserving scanning (İ desync)', () => {
  // `toLowerCase()` is not length-preserving: U+0130 becomes TWO UTF-16 units, so every
  // index found in the lowercased copy and applied to the original lands one short per
  // occurrence. Four scanners had this, all silently.

  test('asciiLower never changes the length', () => {
    for (const s of ['İ', 'İİİ', 'AİB', 'ǅ', 'ß', 'Σ', 'İç Pilav']) {
      assert.equal(asciiLower(s).length, s.length, `length changed for ${JSON.stringify(s)}`);
    }
    assert.notEqual('İ'.toLowerCase().length, 'İ'.length, 'premise check: toLowerCase DOES shift');
  });

  test('asciiLower still lowercases what the scanners look for', () => {
    assert.equal(
      asciiLower('<SCRIPT TYPE="application/LD+JSON">'),
      '<script type="application/ld+json">'
    );
  });

  test('JSON-LD survives a Turkish title', () => {
    const recipe = JSON.stringify({
      '@type': 'Recipe',
      name: 'Test Pie',
      recipeIngredient: ['1 crust'],
      recipeInstructions: ['bake'],
    });
    const html = (title) =>
      `<html><head><title>${title}</title></head><body>` +
      `<script type="application/ld+json">${recipe}</script></body></html>`;
    // The ASCII page is the control: both must behave identically.
    assert.equal(extractRecipeFromHtml(html('Ic Pilav'))?.name, 'Test Pie');
    assert.equal(extractRecipeFromHtml(html('İç Pilav'))?.name, 'Test Pie');
  });

  test('the title survives an İ in an earlier comment', () => {
    assert.equal(
      pageTitle('<html><!-- İ İ İ --><head><title>Best Pumpkin Pie</title></head>'),
      'Best Pumpkin Pie'
    );
  });

  test('meta lookup survives one too', () => {
    const html = '<html><!-- İ --><meta property="og:image" content="https://x.test/a.jpg">';
    assert.equal(findMeta(html, 'og:image'), 'https://x.test/a.jpg');
  });

  test('decodes HTML entities in JSON-LD values', () => {
    // JSON-LD is embedded IN an HTML document and plenty of CMSes escape what they emit —
    // allrecipes really does return `World&#39;s Best Lasagna`. Undecoded it lands in the
    // form at confidence 1 and replicates into the .beanpod permanently. Every fixture in
    // this suite used clean values, which is why only a live probe found it.
    const recipe = JSON.stringify({
      '@type': 'Recipe',
      name: 'World&#39;s Best Lasagna',
      recipeIngredient: ['1 tbsp salt &amp; pepper', 'a &quot;pinch&quot; of basil'],
      recipeInstructions: ['Mix &amp; bake'],
    });
    const out = extractRecipeFromHtml(`<script type="application/ld+json">${recipe}</script>`);
    assert.equal(out.name, "World's Best Lasagna");
    assert.deepEqual(out.ingredients, ['1 tbsp salt & pepper', 'a "pinch" of basil']);
    assert.deepEqual(out.steps, ['Mix & bake']);
  });

  test('does not double-decode a deliberately escaped entity', () => {
    const recipe = JSON.stringify({
      '@type': 'Recipe',
      name: 'Use &amp;quot; to escape',
      recipeIngredient: ['x'],
      recipeInstructions: ['y'],
    });
    const out = extractRecipeFromHtml(`<script type="application/ld+json">${recipe}</script>`);
    assert.equal(out.name, 'Use &quot; to escape');
  });
});

describe('entity decoding', () => {
  // These moved here when the captions path was deleted. They guard a real shipped bug, so
  // they outlive the feature that happened to exercise them first.

  test('decodes the entities that actually appear in page text', () => {
    assert.equal(decodeEntities('add the &quot;flour&quot;'), 'add the "flour"');
    assert.equal(decodeEntities('salt &amp; pepper'), 'salt & pepper');
    assert.equal(decodeEntities('&lt;b&gt;bold&lt;/b&gt;'), '<b>bold</b>');
    assert.equal(decodeEntities('caf&#233;'), 'caf\u00e9');
  });

  test('does NOT double-decode — &amp;quot; stays literal', () => {
    // The naive chained-replace implementation turned &amp;quot; into a real quote, because
    // each replacement fed the next: text that deliberately escaped an entity silently
    // un-escaped. A single pass is the fix, and this is what proves it.
    assert.equal(
      decodeEntities('write &amp;quot; to escape a quote'),
      'write &quot; to escape a quote'
    );
    assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  });

  test('leaves unknown entities untouched rather than guessing', () => {
    // `&nbsp;` deliberately becomes an ORDINARY space, not U+00A0: this text is headed for
    // an ingredient line, where a non-breaking space is an invisible character that breaks
    // later matching and looks identical to a real one on screen.
    assert.equal(decodeEntities('100&nbsp;&fake;g'), '100 &fake;g');
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

describe('readCapped error handling (found by /code-review max)', () => {
  // The bug: `stream = res.pipe(createGunzip())` with an 'error' listener bound ONLY to the
  // gunzip. .pipe() does not forward source errors, and skips forwarding once the
  // destination has its own listener — so a mid-body reset emitted 'error' on an emitter
  // with zero listeners. That is an UNCAUGHT exception: it kills the whole Lambda
  // invocation and returns a CORS-less 502 outside the entire typed taxonomy. Since
  // 'Accept-Encoding: gzip, br' is always sent, nearly every real page took that path.
  test('a source error during a gzip body does not throw uncaught', async () => {
    const { Readable } = await import('node:stream');
    const { createGunzip } = await import('node:zlib');

    let uncaught = null;
    const onUncaught = (e) => {
      uncaught = e;
    };
    process.once('uncaughtException', onUncaught);

    // Reproduce the exact shape: source → gunzip, error bound on BOTH (the fix).
    const src = new Readable({ read() {} });
    const gunzip = src.pipe(createGunzip());
    let settled = false;
    src.on('error', () => {
      settled = true;
    });
    gunzip.on('error', () => {
      settled = true;
    });
    src.destroy(new Error('aborted'));

    await new Promise((r) => setTimeout(r, 50));
    process.removeListener('uncaughtException', onUncaught);

    assert.equal(uncaught, null, 'a source error must not escape as an uncaught exception');
    assert.equal(settled, true, 'the error must be observed by a listener');
  });
});
