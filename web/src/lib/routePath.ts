/**
 * The route path of the page being rendered: `/`, `/privacy`, `/blog/<slug>`.
 *
 * With `build.format: 'file'`, Astro 7 reports `Astro.url.pathname` as the
 * output file (`/index.html`, `/privacy.html`) during the static build, where
 * Astro 5 reported the route (`/`, `/privacy`). Every check that compares the
 * current path against a route, and every canonical URL built from it, goes
 * through this so neither depends on the build format.
 */
export function routePath(url: URL): string {
  const path = url.pathname.replace(/\.html$/, '').replace(/\/index$/, '');
  return path === '' ? '/' : path;
}
