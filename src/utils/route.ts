/**
 * Returns true when `currentPath` is `itemPath` exactly, OR is a descendant
 * of `itemPath` (so `/pod/cookbook` activates the `/pod` parent item).
 *
 * Guards against two foot-guns:
 * - Empty inputs return `false` (callers don't have to null-check).
 * - The root path `/` only matches `/` exactly — without this guard,
 *   `'/anything'.startsWith('/')` would over-match every route.
 *
 * @example
 *   isRouteActive('/pod', '/pod')           // true — exact match
 *   isRouteActive('/pod/cookbook', '/pod')  // true — descendant
 *   isRouteActive('/pod', '/podium')        // false — different routes
 *   isRouteActive('/anywhere', '/')         // false — root guarded
 *   isRouteActive('/', '/')                 // true — exact root
 */
export function isRouteActive(currentPath: string, itemPath: string): boolean {
  if (!currentPath || !itemPath) return false;
  if (itemPath === '/') return currentPath === '/';
  if (currentPath === itemPath) return true;
  return currentPath.startsWith(`${itemPath}/`);
}
