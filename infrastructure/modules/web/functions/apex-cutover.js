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

  // 3. Astro static-site URL rewrite (clean URL → .html on S3)
  if (uri === '/' || uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }
  var lastSlash = uri.lastIndexOf('/');
  var lastSegment = uri.slice(lastSlash + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = uri + '.html';
  }
  return request;
}
