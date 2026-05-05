/**
 * CloudFront Function — viewer-request rewriter for the Astro static site.
 *
 * Astro (with `build.format: 'file'` and `trailingSlash: 'never'`) emits
 * flat `.html` files: `/blog/slug.html`. Clean URLs like `/blog/slug` must
 * be rewritten to `/blog/slug.html` before reaching S3, otherwise S3
 * returns 403/404. The only literal `index.html` is at the bucket root.
 *
 * Rules:
 *   - "/"              → "/index.html"
 *   - "/path/"         → 301 to "/path"   (preserve query string; aligns
 *                                          with trailingSlash:'never').
 *                                          Rewriting to /path/index.html
 *                                          would 404 — Astro emits
 *                                          path.html, not path/index.html.
 *   - "/path"          → "/path.html"     (clean URL → html file)
 *   - "/path.ext"      → "/path.ext"      (has extension → pass through)
 *
 * CloudFront Functions runtime: cloudfront-js-2.0 (ES 2020). No network,
 * no external modules, 1ms CPU limit.
 */

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

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/') {
    request.uri = '/index.html';
    return request;
  }

  if (uri.endsWith('/')) {
    var qs = buildQueryString(request.querystring || {});
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: uri.slice(0, -1) + qs },
        'cache-control': { value: 'public, max-age=3600' },
      },
    };
  }

  // If the last path segment has a dot, treat it as a file with an extension.
  var lastSlash = uri.lastIndexOf('/');
  var lastSegment = uri.slice(lastSlash + 1);
  if (lastSegment.indexOf('.') !== -1) {
    return request;
  }

  request.uri = uri + '.html';
  return request;
}
