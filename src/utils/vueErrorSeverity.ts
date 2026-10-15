/**
 * How bad a Vue `app.config.errorHandler` error is, from Vue's `info` string.
 *
 * In a production build `info` is `https://vuejs.org/error-reference/#runtime-<code>`; in dev it
 * is a phrase ("render function", "setup function", "mounted hook", ...). The code says WHERE the
 * throw happened, and that decides the impact:
 *
 *  - `'critical'`: the component itself broke and the person sees a blank or half-built surface.
 *    Setup (`0`), render (`1`), the async component loader (`13`), component update (`15`, Vue
 *    3.5), and the hooks that BRING a surface up: `bc c bm m` (creation and mount), `a` (a
 *    KeepAlive view coming back, its mount-equivalent), `sp` (server prefetch), and the
 *    render-path hooks `ec rtc rtg`.
 *  - `'error'`: the component is still on screen and working, or it is leaving, and one
 *    interaction or callback failed. Watchers (`2-4`), event handlers (`5-6`),
 *    vnode/directive/transition hooks (`7-9`), app handlers (`10-11`), ref functions (`12`), the
 *    scheduler (`14`), app unmount cleanup (`16`), the update hooks `bu u` (the previous render
 *    stays painted), and the hooks that TAKE a surface down: `bum um` (unmount) and `da` (a
 *    KeepAlive view being cached away). Nothing is blank because of those.
 *
 * Anything unrecognised is `'error'`: an unknown code must not page. So is a stale-chunk load
 * failure wherever it surfaces (most often the async component loader, `13`): it self-heals
 * through `router.onError` / `vite:preloadError`, the same `isChunkLoadError` the
 * `unhandledrejection` path already suppresses on.
 *
 * Codes from Vue's `ErrorCodes` and `LifecycleHooks` (packages/runtime-core/src/errorHandling.ts,
 * enums.ts); the dev phrases are `ErrorTypeStrings` from the same file.
 */

import { isChunkLoadError } from '@/utils/hardReload';

const CRITICAL_RUNTIME_CODES = new Set([
  // ErrorCodes: SETUP_FUNCTION, RENDER_FUNCTION, ASYNC_COMPONENT_LOADER, COMPONENT_UPDATE
  '0',
  '1',
  '13',
  '15',
  // LifecycleHooks that bring a surface up (see the header for why the rest are `'error'`)
  'bc',
  'c',
  'bm',
  'm',
  'a',
  'ec',
  'rtc',
  'rtg',
  'sp',
]);

/** Dev-build `info` phrases for the same critical codes (`ErrorTypeStrings`). */
const CRITICAL_DEV_PHRASES = new Set([
  'setup function',
  'render function',
  'async component loader',
  'component update',
  'beforeCreate hook',
  'created hook',
  'beforeMount hook',
  'mounted hook',
  'activated hook',
  'errorCaptured hook',
  'renderTracked hook',
  'renderTriggered hook',
  'serverPrefetch hook',
]);

const RUNTIME_PREFIX = '#runtime-';

export function vueErrorSeverity(info: string, err?: unknown): 'critical' | 'error' {
  if (typeof info !== 'string' || isChunkLoadError(err)) return 'error';
  const at = info.lastIndexOf(RUNTIME_PREFIX);
  if (at !== -1) {
    const code = info.slice(at + RUNTIME_PREFIX.length);
    return CRITICAL_RUNTIME_CODES.has(code) ? 'critical' : 'error';
  }
  // A bare code (some builds hand the code itself) or a dev phrase.
  const trimmed = info.trim();
  if (CRITICAL_RUNTIME_CODES.has(trimmed) || CRITICAL_DEV_PHRASES.has(trimmed)) return 'critical';
  return 'error';
}
