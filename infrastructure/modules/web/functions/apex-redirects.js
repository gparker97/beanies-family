/**
 * CloudFront Function — runs on viewer-request at the apex distribution
 * AFTER the cutover. Two responsibilities:
 *
 * 1. 301 any authenticated-app path (`/dashboard`, `/login`, etc.) to
 *    `https://app.beanies.family` preserving the path + query.
 * 2. 301 legacy `/beanstalk` URLs to `/blog`.
 *
 * Anything else falls through to S3 (Astro static HTML).
 *
 * This function is NOT attached to any distribution in Phase A. It will be
 * attached to the apex distribution as part of the Phase C cutover, at which
 * point its behavior becomes live.
 *
 * CloudFront Functions run in a constrained JS environment (no `let` scope
 * in some older runtimes — the `cloudfront-js-2.0` runtime used here is
 * modern ECMAScript and supports `let`/`const` plus `Array.prototype.some`).
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
  // CloudFront passes querystring as an object keyed by param name.
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

  // Legacy /beanstalk* → /blog*
  if (uri === '/beanstalk' || uri.indexOf('/beanstalk/') === 0) {
    var newUri = uri.replace(/^\/beanstalk/, '/blog');
    return redirect('https://beanies.family' + newUri + qs);
  }

  // Authenticated PWA paths → app.beanies.family
  if (isAppPath(uri)) {
    return redirect('https://app.beanies.family' + uri + qs);
  }

  return request;
}
