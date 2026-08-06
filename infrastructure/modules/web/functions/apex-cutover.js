/**
 * Apex CloudFront Function — runs on viewer-request at the apex distribution
 * AFTER the Phase C cutover. Combines two responsibilities so we stay within
 * CloudFront's "one function per event type per cache behavior" limit:
 *
 * 1. 301 any authenticated PWA path (`/dashboard`, `/login`, etc.) to
 *    `https://app.beanies.family` preserving path + querystring.
 * 2. 301 legacy `/beanstalk*` URLs to `/blog*` (keeps inbound links alive).
 * 3. Rewrite clean Astro URLs to their `.html` paths so S3 finds the file
 *    (Astro emits flat .html files; without rewriting, `/blog/foo` 403s).
 *
 * This function supersedes apex-redirects.js (Phase A, never attached) and
 * rewrite-to-html.js (Phase A, attached to staging only). It is the single
 * function attached to the apex distribution post-cutover.
 *
 * Runtime: cloudfront-js-2.0 (ES 2020). No network, no modules, 1ms CPU.
 */

// prettier-ignore
var APP_PATHS = [
  '/dashboard',
  '/accounts',
  '/transactions',
  '/assets',
  '/goals',
  '/reports',
  '/forecast',
  '/family',
  '/nook',
  '/activities',
  '/travel',
  '/todo',
  '/budgets',
  '/settings',
  '/oauth',
  '/login',
  '/join',
  '/welcome',
];

function isAppPath(path) {
  for (var i = 0; i < APP_PATHS.length; i++) {
    var p = APP_PATHS[i];
    if (path === p || path.indexOf(p + '/') === 0) return true;
  }
  return false;
}

function buildQueryString(qs) {
  var parts = [];
  for (var k in qs) {
    if (!Object.prototype.hasOwnProperty.call(qs, k)) continue;
    var v = qs[k];
    if (v.multiValue) {
      for (var j = 0; j < v.multiValue.length; j++) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v.multiValue[j].value));
      }
    } else {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v.value));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location },
      'cache-control': { value: 'public, max-age=3600' },
    },
  };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var qs = buildQueryString(request.querystring || {});

  // 0. /.well-known/* files (apple-app-site-association, assetlinks.json) are
  //    served VERBATIM and are frequently EXTENSIONLESS. They must never be
  //    redirected or rewritten to `.html` — a rewrite 404s the file. The AASA is
  //    the iOS Universal Link association: if it 404s, iOS never verifies the
  //    link, so Universal Links (incl. the native Google OAuth return at
  //    /oauth/native) fall back to opening in an in-app Safari sheet instead of
  //    the app. Must run BEFORE the /oauth app-path redirect below too.
  if (uri.indexOf('/.well-known/') === 0) {
    return request;
  }

  // 1. Legacy /beanstalk* → /blog*
  if (uri === '/beanstalk' || uri.indexOf('/beanstalk/') === 0) {
    var newUri = uri.replace(/^\/beanstalk/, '/blog');
    return redirect('https://beanies.family' + newUri + qs);
  }

  // 1b. Legacy /home → / (was a Vue route; Astro serves the homepage at /)
  if (uri === '/home' || uri === '/home/') {
    return redirect('https://beanies.family/' + qs);
  }

  // 2. Authenticated PWA paths → app.beanies.family
  if (isAppPath(uri)) {
    return redirect('https://app.beanies.family' + uri + qs);
  }

  // 3. Astro static-site URL handling.
  //    Astro is built with `format: 'file'` + `trailingSlash: 'never'`, so
  //    output is flat .html files (e.g. /blog.html, /guides/foo.html). The
  //    only literal index.html is at the bucket root.
  //
  //    - '/'              → rewrite to /index.html
  //    - '/path/'         → 301 to /path  (preserving query string; aligns
  //                         with trailingSlash:'never' canonical). Rewriting
  //                         to /path/index.html would 404 since Astro emits
  //                         path.html, not path/index.html.
  //    - '/path'          → rewrite to /path.html for S3 lookup
  //    - '/path.ext'      → pass through
  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }
  if (uri.endsWith('/')) {
    return redirect('https://beanies.family' + uri.slice(0, -1) + qs);
  }
  var lastSlash = uri.lastIndexOf('/');
  var lastSegment = uri.slice(lastSlash + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = uri + '.html';
  }
  return request;
}
