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
/* global Buffer */
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { promisify } from 'node:util';
import { createGunzip, createBrotliDecompress } from 'node:zlib';

const lookupAll = promisify(dnsLookup);

const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2000;

/** Blocked IPv4 ranges, as [firstOctetTest, predicate] over the four octets. */
function isBlockedIpv4(a, b) {
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

/** True when an address must never be connected to. Handles IPv4, IPv6 and v4-in-v6. */
export function isBlockedAddress(addr, family) {
  if (typeof addr !== 'string' || addr.length === 0) return true;
  if (family === 4) {
    const o = addr.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    return isBlockedIpv4(o[0], o[1]);
  }
  const lower = addr.toLowerCase();
  // IPv4-mapped / -compatible (::ffff:169.254.169.254) — screen the embedded v4.
  // Done by string split rather than a regex: the obvious pattern nests quantifiers and
  // trips the ReDoS lint, and this is both faster and easier to be sure of.
  const tail = lower.slice(lower.lastIndexOf(':') + 1);
  if (tail.includes('.')) return isBlockedAddress(tail, 4);
  if (lower === '::' || lower === '::1') return true; // unspecified, loopback
  const head = lower.split(':')[0];
  if (
    head.startsWith('fe8') ||
    head.startsWith('fe9') ||
    head.startsWith('fea') ||
    head.startsWith('feb')
  )
    return true; // fe80::/10 link-local
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 unique-local
  if (head.startsWith('ff')) return true; // ff00::/8 multicast
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
  if (url.username || url.password)
    return { ok: false, code: 'blocked', blockReason: 'credentials' };
  if (url.port && url.port !== '443') return { ok: false, code: 'blocked', blockReason: 'port' };
  return { ok: true, url };
}

/** Resolve a hostname and refuse if ANY returned address is non-public. */
async function resolvePublicAddress(hostname) {
  let answers;
  try {
    answers = await lookupAll(hostname, { all: true });
  } catch {
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
function readCapped(res, maxBytes) {
  return new Promise((resolve) => {
    const encoding = String(res.headers['content-encoding'] || 'identity').toLowerCase();
    let stream = res;
    if (encoding === 'gzip') stream = res.pipe(createGunzip());
    else if (encoding === 'br') stream = res.pipe(createBrotliDecompress());
    else if (encoding !== 'identity') {
      res.destroy();
      return resolve({ ok: false, code: 'blocked', blockReason: 'encoding' });
    }

    const chunks = [];
    let total = 0;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      res.destroy();
      resolve(v);
    };
    stream.on('data', (c) => {
      total += c.length;
      // Counted on DECODED output, so a gzip/brotli bomb is cut at the cap rather than
      // being allowed through because its TRANSFER size was small.
      if (total > maxBytes) return done({ ok: false, code: 'too_large' });
      chunks.push(c);
    });
    stream.on('end', () => done({ ok: true, body: Buffer.concat(chunks) }));
    stream.on('error', () => done({ ok: false, code: 'fetch_failed' }));
  });
}

/** One request to a pinned address. Returns the raw response for the caller to interpret. */
function requestPinned(url, address, family, timeoutMs) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        // THE PIN. Hand the connection the address we already validated so the kernel
        // cannot re-resolve to a private one between the check and the connect.
        lookup: (_hostname, _opts, cb) => cb(null, address, family),
        headers: {
          // Identify honestly; some sites 403 an unknown agent, and we would rather be
          // refused than pretend to be a browser.
          'User-Agent': 'beanies.family recipe reader (+https://beanies.family)',
          Accept: '*/*',
          'Accept-Encoding': 'gzip, br',
        },
        timeout: timeoutMs,
      },
      (res) => resolve({ ok: true, res })
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, code: 'timeout' });
    });
    req.on('error', () => resolve({ ok: false, code: 'fetch_failed' }));
    req.end();
  });
}

/**
 * Fetch one URL under every guard. Follows up to MAX_REDIRECTS hops, RE-SCREENING each one
 * (a public host redirecting to 169.254.169.254 is the classic bypass).
 *
 * @returns {{ok:true, body:Buffer, contentType:string, finalUrl:string}
 *          |{ok:false, code:string, blockReason?:string}}
 */
export async function guardedFetch(rawUrl, { maxBytes, timeoutMs = 8000 } = {}) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const screened = screenUrl(current);
    if (!screened.ok) return screened;
    const resolved = await resolvePublicAddress(screened.url.hostname);
    if (!resolved.ok) return resolved;

    const attempt = await requestPinned(screened.url, resolved.address, resolved.family, timeoutMs);
    if (!attempt.ok) return attempt;
    const res = attempt.res;

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
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
      return { ok: false, code: 'fetch_failed' };
    }

    const read = await readCapped(res, maxBytes);
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
