/* global Buffer */
/**
 * The ONLY outbound request in the content-fetch Lambda (#72).
 *
 * Fetching a user-supplied URL server-side is a textbook SSRF vector, and this is the app's
 * first user-controlled outbound request — which is exactly why it lives in its own Lambda
 * rather than inside the inference proxy that holds the Tinfoil key.
 *
 * A bare `fetch(` anywhere else under `infrastructure/lambda/content-fetch/` is a
 * review-blocking defect; the unit suite asserts it by source grep.
 *
 * WHY node:https RATHER THAN fetch: DNS rebinding. A pre-flight `dns.lookup` proves the
 * hostname resolved to a public address, but global `fetch` then resolves it AGAIN when it
 * connects, so an attacker-controlled DNS server can answer public-then-private and walk
 * straight past the check. `https.request` accepts a `lookup` hook, which lets us PIN the
 * connection to the address we already validated. Without that pin the guard is decorative.
 *
 * RESIDUAL RISK, stated plainly: pinning is best-effort. It does not stop an attack from a
 * public address that is itself sensitive, and it would be defeated by attaching this Lambda
 * to a VPC. So the posture is defence-in-depth, not a single control: the Lambda has NO VPC
 * attachment, an IAM role with logging and nothing else, and no secrets in its environment
 * beyond its own soft key. Lambda has no EC2-style IMDS, so 169.254.169.254 yields nothing.
 * Given that, the realistic worst case of a total bypass is "fetch a public URL" — which is
 * already the accepted semi-open-proxy risk documented in the module header.
 */
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { promisify } from 'node:util';
import { createGunzip, createBrotliDecompress } from 'node:zlib';
import { isIPv4, isIPv6 } from 'node:net';

const lookupAll = promisify(dnsLookup);

const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2000;
/**
 * Wall-clock budget for a WHOLE fetch, redirects included.
 *
 * NOT a per-socket timeout. `https.request`'s `timeout` is an INACTIVITY timer that re-arms
 * on every byte and on every redirect hop, so 4 hops × 8s = 32s worst case — more than
 * double the Lambda's own 15s ceiling. A slowloris origin dripping one byte every 7s never
 * trips an idle timer at all. When the Lambda dies mid-invocation the caller gets a raw
 * gateway 502 with no CORS headers and no `code`, so the whole typed taxonomy is bypassed.
 * A deadline computed once and spent down per hop is the only thing that actually bounds it.
 */
const DEFAULT_TOTAL_BUDGET_MS = 9000;
/** Fail-CLOSED default. See the note on `maxBytes` in guardedFetch. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Request headers.
 *
 * A plain "beanies.family recipe reader" User-Agent is refused with 403 by most large
 * recipe sites (verified against allrecipes.com and seriouseats.com from AWS). Their bot
 * protection reads the UA before anything else, so an honest one means the feature simply
 * does not work on the sites people actually use.
 *
 * We therefore send a normal browser header set. This is a deliberate, documented choice,
 * not an attempt to hide: we still identify beanies.family in the UA comment, we send no
 * cookies or credentials, we fetch one page the USER explicitly asked for, and we store the
 * result in their own private cookbook. What we do not do is claim to be something we are
 * not while pretending otherwise in the code.
 *
 * Sites that block by IP range rather than UA will still refuse us, and that is correctly
 * surfaced to the user as `site_refused` rather than hidden.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/126.0.0.0 Safari/537.36 beanies.family/1.0 (+https://beanies.family)',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Accept-Encoding': 'gzip, br',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

/** Blocked IPv4 ranges, by first two octets. */
function isBlockedIpv4Octets(a, b) {
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a >= 224 // multicast + reserved
  );
}

/**
 * Expand an IPv6 textual address to its 8 groups of 16 bits.
 *
 * String-matching IPv6 is a trap: `::1` and `0:0:0:0:0:0:0:1` are the SAME address, as are
 * `::ffff:127.0.0.1` and `::ffff:7f00:1`. A screen that recognises only the compressed
 * spellings depends on the resolver's text formatting rather than on the address value, and
 * every other spelling walks straight through. Parsing to numbers removes the whole class.
 *
 * @returns {number[]|null} 8 groups, or null when unparseable.
 */
export function expandIpv6(addr) {
  if (typeof addr !== 'string') return null;
  let s = addr.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes the last two groups.
  let tailGroups = [];
  const lastColon = s.lastIndexOf(':');
  const tail = lastColon === -1 ? '' : s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return null;
    const o = tail.split('.').map(Number);
    tailGroups = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    s = s.slice(0, lastColon + 1) + '0:0';
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part) =>
    part === ''
      ? []
      : part.split(':').map((g) => {
          if (!/^[0-9a-f]{1,4}$/.test(g)) return NaN;
          return Number.parseInt(g, 16);
        });
  const head = parse(halves[0]);
  const back = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...back].some((n) => Number.isNaN(n))) return null;

  let groups;
  if (halves.length === 2) {
    const fill = 8 - head.length - back.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill(0), ...back];
  } else {
    groups = head;
  }
  if (tailGroups.length) groups = [...groups.slice(0, 6), ...tailGroups];
  return groups.length === 8 ? groups : null;
}

/**
 * True when an address must never be connected to. Handles IPv4, IPv6 and v4-in-v6.
 *
 * `_family` is accepted but UNUSED: the family reported by the resolver is a hint, and
 * trusting it would mean a v6-labelled dotted-quad skipped the v4 rules. The address text
 * itself is authoritative, so it is classified with `isIPv4`/`isIPv6` here instead. The
 * parameter stays because every caller has one to hand.
 */
export function isBlockedAddress(addr, _family) {
  if (typeof addr !== 'string' || addr.length === 0) return true;

  if (isIPv4(addr)) {
    const o = addr.split('.').map(Number);
    return isBlockedIpv4Octets(o[0], o[1]);
  }
  if (!isIPv6(addr)) return true; // not an address at all → refuse

  const g = expandIpv6(addr);
  if (!g) return true;

  const allZero = g.every((x) => x === 0);
  if (allZero) return true; // :: unspecified
  const isLoopback = g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
  if (isLoopback) return true; // ::1 in ANY spelling

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — screen the embedded v4 by VALUE.
  const v4Mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  const v4Compat = g.slice(0, 6).every((x) => x === 0);
  if (v4Mapped || v4Compat) {
    return isBlockedIpv4Octets(g[6] >> 8, g[6] & 0xff);
  }
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) both embed a v4 address.
  if (g[0] === 0x0064 && g[1] === 0xff9b) return isBlockedIpv4Octets(g[6] >> 8, g[6] & 0xff);
  if (g[0] === 0x2002) return isBlockedIpv4Octets(g[1] >> 8, g[1] & 0xff);

  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Screen a URL's shape. Returns the parsed URL or a typed refusal — never throws, so the
 * caller has one shape to branch on.
 */
export function screenUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, code: 'bad_url' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, code: 'bad_url' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, code: 'bad_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, code: 'blocked', blockReason: 'scheme' };
  if (url.username || url.password) {
    return { ok: false, code: 'blocked', blockReason: 'credentials' };
  }
  if (url.port && url.port !== '443') return { ok: false, code: 'blocked', blockReason: 'port' };
  return { ok: true, url };
}

/**
 * Resolve a hostname and refuse if ANY returned address is non-public.
 *
 * `budgetMs` is not optional in spirit: `getaddrinfo` has no cancellation, and against a
 * blackholed NS it blocks for the resolver default (~5s for A, ~5s for AAAA) before a single
 * packet is sent. Across hops that spends the whole 9s budget and then some, blowing the 15s
 * Lambda ceiling — which returns a raw CORS-less 502 outside the typed taxonomy this module
 * exists to preserve, while holding one of only five concurrency slots. The endpoint is
 * publicly callable, so that is a cheap denial of service.
 *
 * The lookup itself cannot be cancelled, so we race it: the orphaned resolution completes
 * into nothing and the invocation returns a typed `timeout` on schedule.
 */
async function resolvePublicAddress(hostname, budgetMs) {
  let answers;
  try {
    answers = await Promise.race([
      lookupAll(hostname, { all: true }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('dns_timeout')), Math.max(250, budgetMs)).unref?.()
      ),
    ]);
  } catch (err) {
    if (err?.message === 'dns_timeout') return { ok: false, code: 'timeout' };
    return { ok: false, code: 'blocked', blockReason: 'dns' };
  }
  if (!Array.isArray(answers) || answers.length === 0) {
    return { ok: false, code: 'blocked', blockReason: 'dns' };
  }
  // ALL, not "the first": a hostname answering with one public and one private address
  // would otherwise be a trivial bypass depending on resolver ordering.
  for (const a of answers) {
    if (isBlockedAddress(a.address, a.family)) {
      return { ok: false, code: 'blocked', blockReason: 'private_ip' };
    }
  }
  return { ok: true, address: answers[0].address, family: answers[0].family };
}

/** Read a response body with a cap counted on DECODED bytes, aborting the moment it trips. */
function readCapped(res, maxBytes, budgetMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      res.destroy();
      resolve(v);
    };

    // Declared before the stream wiring so both error handlers can clear the body timer.
    let clearBodyTimer = () => {};
    const finishOnError = () => {
      clearBodyTimer();
      done({ ok: false, code: 'fetch_failed' });
    };

    const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase();
    let stream = res;
    if (encoding === 'gzip') stream = res.pipe(createGunzip());
    else if (encoding === 'br') stream = res.pipe(createBrotliDecompress());
    else if (encoding !== 'identity') {
      return done({ ok: false, code: 'blocked', blockReason: 'encoding' });
    }

    // BIND 'error' ON THE SOURCE TOO. `.pipe()` does NOT forward source errors, and its
    // internal handler skips forwarding once the destination has its own listener. With a
    // listener only on the decompressor, a mid-body reset — ordinary CDN flakiness, or a
    // hostile `Content-Length: 100000` followed by 20 bytes and RST — emits 'error' on an
    // emitter with zero listeners, which is an UNCAUGHT exception that kills the whole
    // invocation and returns a CORS-less 502 outside the typed taxonomy.
    res.on('error', () => finishOnError());
    if (stream !== res) stream.on('error', () => finishOnError());

    // The body read is the phase a slowloris actually exploits: headers arrive in 50ms,
    // then one byte every 7s. Nothing else bounds it — `end`/`error`/`maxBytes` never fire —
    // so without this the invocation runs to the Lambda's ceiling and dies, returning a raw
    // CORS-less 502 outside the typed taxonomy while pinning one of 5 concurrency slots.
    const bodyKiller = setTimeout(
      () => done({ ok: false, code: 'timeout' }),
      Math.max(250, budgetMs)
    );
    clearBodyTimer = () => clearTimeout(bodyKiller);
    const finish = (v) => {
      clearBodyTimer();
      done(v);
    };

    const chunks = [];
    let total = 0;
    stream.on('data', (c) => {
      total += c.length;
      // Counted on DECODED output, so a gzip/brotli bomb is cut at the cap rather than
      // being allowed through because its TRANSFER size was small.
      if (total > maxBytes) return finish({ ok: false, code: 'too_large' });
      chunks.push(c);
    });
    stream.on('end', () => finish({ ok: true, body: Buffer.concat(chunks) }));
  });
}

/** One request to a pinned address, bounded by the REMAINING wall-clock budget. */
/**
 * Headers for a POST — an ALLOWLIST, because this is the app's single hardened egress point.
 *
 * The previous `{...BROWSER_HEADERS, ...post.headers}` let a caller set anything. Three ways
 * that goes wrong, in descending order of severity:
 *
 *  • `host` — the socket stays pinned to the IP validated for one hostname while the request
 *    addresses a different vhost, which makes the DNS screen's hostname decorative.
 *  • `cookie` / `authorization` — silently breaks this module's stated "we send no cookies or
 *    credentials".
 *  • `content-length` — taken as given and never checked against the bytes actually written,
 *    so a short value leaves the remainder on the socket for an intermediary to read as a
 *    pipelined request.
 *
 * Only `content-type` is a caller's business today. Everything else is derived here.
 *
 * Also drops the browser-NAVIGATION headers for a POST. `Sec-Fetch-Mode: navigate`,
 * `Sec-Fetch-Dest: document`, `Accept: text/html…` and `Upgrade-Insecure-Requests` describe a
 * page load, and no browser sends them on a JSON XHR — a shape that is itself a bot signal
 * on the one endpoint we POST to.
 */
const POST_HEADER_ALLOWLIST = new Set(['content-type']);

function postHeaders(post) {
  const headers = {
    // Title-Case keys, matching BROWSER_HEADERS — reading them back as lower-case returned
    // undefined and would have sent a POST with NO user-agent at all.
    'User-Agent': BROWSER_HEADERS['User-Agent'],
    'Accept-Language': BROWSER_HEADERS['Accept-Language'],
    Accept: 'application/json',
    'Accept-Encoding': BROWSER_HEADERS['Accept-Encoding'],
    // Set from the ACTUAL bytes, never from the caller. Node would otherwise fall back to
    // chunked transfer-encoding, which some fronts answer with 411.
    'Content-Length': String(Buffer.byteLength(post.body)),
  };
  for (const [k, v] of Object.entries(post.headers ?? {})) {
    if (POST_HEADER_ALLOWLIST.has(k.toLowerCase())) headers[k] = v;
  }
  return headers;
}

/**
 * Headers for an IMAGE fetch, optionally carrying a `Referer` (#86).
 *
 * Why a `Referer` at all: CDNs in front of recipe blogs routinely gate on it, so a request
 * with none looks like a scraper and gets a 403 — which surfaced to the user as "the photo
 * just didn't appear". Sending the page we were asked to read is both the honest value and
 * the one that passes.
 *
 * Why a NARROW option and not a headers bag: see POST_HEADER_ALLOWLIST above. The caller
 * supplies one URL string and nothing else; every other header is derived here, so a caller
 * still cannot reach `host`, `cookie`, `authorization` or `content-length`.
 *
 * The referer is held CONSTANT across redirect hops. A browser would recompute it per hop
 * under strict-origin-when-cross-origin; holding it is simpler, is what the hotlink check
 * actually reads, and can only ever be the page the user themselves opened.
 */
function imageHeaders(url, referer) {
  let site = 'none';
  if (referer) {
    try {
      // Real browsers report same-origin for the majority case — a WordPress hero at
      // `food.test/wp-content/dish.jpg` referred from `food.test/recipes/cake`. Hardcoding
      // cross-site there produced a Referer/Sec-Fetch-Site pairing no browser ever emits,
      // on exactly the CDNs that fingerprint these headers.
      site = new URL(referer).origin === url.origin ? 'same-origin' : 'cross-site';
    } catch {
      site = 'cross-site';
    }
  }
  return {
    'User-Agent': BROWSER_HEADERS['User-Agent'],
    'Accept-Language': BROWSER_HEADERS['Accept-Language'],
    'Accept-Encoding': BROWSER_HEADERS['Accept-Encoding'],
    // Image-first, and it already advertised AVIF before image mode could accept it (#86).
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    // A subresource load, not a navigation — so no Upgrade-Insecure-Requests here.
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': site,
    ...(referer ? { Referer: referer } : {}),
  };
}

function requestPinned(url, address, family, budgetMs, post, asImage, referer) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: post ? 'POST' : 'GET',
        // THE PIN. Hand the connection the address we already validated so the kernel
        // cannot re-resolve to a private one between the check and the connect.
        //
        // MUST honour `options.all`. Node 20 enables autoSelectFamily (Happy Eyeballs) by
        // default, which calls this hook with `{ all: true }` and then expects an ARRAY of
        // {address, family} back. Returning the three-argument form there yields
        // `ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined` and EVERY connection dies
        // instantly — which is exactly what happened in production while all 57 unit tests
        // passed, because none of them opens a real socket.
        lookup: (_hostname, opts, cb) =>
          opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family),
        // KEYED ON THE MODE, never on whether an optional courtesy value happens to be
        // present. Binding it to `referer` meant an image fetch with no usable pageUrl —
        // an old client mid-deploy, or a referer that failed screening — silently went out
        // with page-NAVIGATION headers (`Sec-Fetch-Dest: document`, `Accept: text/html…`),
        // which is a bot signal on precisely the CDNs this feature has to get past, and can
        // return an HTML interstitial that then reports as `not_image`.
        headers: post ? postHeaders(post) : asImage ? imageHeaders(url, referer) : BROWSER_HEADERS,
      },
      (res) => finish({ ok: true, res })
    );

    // HARD wall-clock stop for this hop, independent of socket activity. A slowloris origin
    // that dribbles bytes keeps an inactivity timer alive forever; this does not care.
    const killer = setTimeout(
      () => {
        req.destroy();
        finish({ ok: false, code: 'timeout' });
      },
      Math.max(250, budgetMs)
    );
    const clear = () => clearTimeout(killer);
    req.on('response', clear);
    req.on('error', () => {
      clear();
      finish({ ok: false, code: 'fetch_failed' });
    });
    if (post) req.write(post.body);
    req.end();
  });
}

/**
 * Fetch one URL under every guard. Follows up to MAX_REDIRECTS hops, RE-SCREENING each one
 * (a public host redirecting to 169.254.169.254 is the classic bypass).
 *
 * `post` (optional `{body, headers}`) switches the request to POST. Every guard still
 * applies — screening, the DNS pin, the byte cap and the deadline are all method-agnostic —
 * but redirects are refused outright, see below.
 *
 * `maxBytes` defaults rather than being required: an omitted option would make
 * `total > undefined` a NaN comparison that is always false, silently removing the size cap
 * in the one function whose entire job is failing closed.
 *
 * @returns {{ok:true, body:Buffer, contentType:string, finalUrl:string}
 *          |{ok:false, code:string, blockReason?:string}}
 */
export async function guardedFetch(
  rawUrl,
  {
    maxBytes = DEFAULT_MAX_BYTES,
    totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
    post,
    asImage = false,
    referer,
  } = {}
) {
  const deadline = Date.now() + totalBudgetMs;
  let current = rawUrl;

  // A referer that does not survive our own screen is DROPPED, not fatal. It is a courtesy
  // header: fetching without one may still succeed, whereas refusing the fetch guarantees the
  // user loses a photo over a header. Screened because it is caller-supplied and ends up on
  // the wire — an unscreened value is a way to smuggle a `javascript:` or credentialed URL
  // into a request log.
  // ⚠️ THE NORMALISED URL GOES ON THE WIRE, NOT THE CALLER'S STRING. `new URL()` silently
  // strips tab/CR/LF before parsing, so `https://food.test/r\r\nX: 1` PASSES this screen and
  // then makes `https.request` throw ERR_INVALID_CHAR synchronously inside requestPinned's
  // promise executor — rejecting out of a function contracted never to throw, bypassing the
  // whole typed taxonomy for a raw 500, and burning a DNS resolve plus one of five reserved
  // concurrency slots. Screening a value and sending a different one is the bug; send what
  // was screened.
  const screenedReferer = typeof referer === 'string' ? screenUrl(referer) : { ok: false };
  const safeReferer = screenedReferer.ok ? screenedReferer.url.toString() : undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { ok: false, code: 'timeout' };

    const screened = screenUrl(current);
    if (!screened.ok) return screened;
    const resolved = await resolvePublicAddress(screened.url.hostname, deadline - Date.now());
    if (!resolved.ok) return resolved;

    const attempt = await requestPinned(
      screened.url,
      resolved.address,
      resolved.family,
      deadline - Date.now(),
      post,
      asImage,
      safeReferer
    );
    if (!attempt.ok) return attempt;
    const res = attempt.res;

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      // SECURITY: never follow a redirect on a POST. Every hop is re-screened, but "public"
      // is not the same as "trusted" — replaying the body would hand whatever we posted to
      // a host the ORIGIN chose, and a 307/308 preserves the method by spec. The one caller
      // that posts (YouTube's InnerTube) never redirects, so this costs nothing real.
      if (post) return { ok: false, code: 'blocked', blockReason: 'post_redirect' };
      if (hop === MAX_REDIRECTS) return { ok: false, code: 'blocked', blockReason: 'redirects' };
      // Resolve relative Locations against the CURRENT url, then re-screen from the top.
      try {
        current = new URL(res.headers.location, screened.url).toString();
      } catch {
        return { ok: false, code: 'bad_url' };
      }
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      // Distinguish what the SITE said from what the NETWORK did. A dead link and a site
      // refusing our user-agent are both actionable for the user; a generic "something
      // went wrong" is not, and would send them to us instead of to their link.
      if (status === 404 || status === 410) return { ok: false, code: 'not_found' };
      if (status === 401 || status === 403 || status === 429 || status === 451) {
        return { ok: false, code: 'site_refused' };
      }
      return { ok: false, code: 'fetch_failed' };
    }

    // Hand the READ whatever budget is left, so the deadline covers the whole fetch rather
    // than expiring the moment headers land.
    const read = await readCapped(res, maxBytes, deadline - Date.now());
    if (!read.ok) return read;
    return {
      ok: true,
      body: read.body,
      contentType: String(res.headers['content-type'] || ''),
      finalUrl: screened.url.toString(),
    };
  }
  return { ok: false, code: 'blocked', blockReason: 'redirects' };
}
