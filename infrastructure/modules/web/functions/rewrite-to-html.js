/**
 * CloudFront Function — viewer-request rewriter for the Astro static site.
 *
 * Astro (with `build.format: 'file'` and `trailingSlash: 'never'`) emits
 * flat `.html` files: `/blog/slug.html`. Clean URLs like `/blog/slug` must
 * be rewritten to `/blog/slug.html` before reaching S3, otherwise S3
 * returns 403.
 *
 * Rules:
 *   - "/"              → "/index.html"
 *   - "/path/"         → "/path/index.html"   (trailing slash → dir index)
 *   - "/path"          → "/path.html"         (clean URL → html file)
 *   - "/path.ext"      → "/path.ext"          (has extension → pass through)
 *
 * CloudFront Functions runtime: cloudfront-js-2.0 (ES 2020). No network,
 * no external modules, 1ms CPU limit.
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/' || uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
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
