import { ref, readonly } from 'vue';

// The CSS twin of this breakpoint is the `@media (width >= 768px)` block that flips
// `--fab-anchor-bottom` / `--fab-anchor-side` in src/style.css; keep the two in step
// (useAnchoredOverlay.test.ts asserts they agree).
const MOBILE_QUERY = '(max-width: 767px)';
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)';

const isMobile = ref(false);
const isTablet = ref(false);
const isDesktop = ref(true);

let initialized = false;
let mobileMedia: MediaQueryList | null = null;
let tabletMedia: MediaQueryList | null = null;

function update() {
  if (!mobileMedia || !tabletMedia) return;
  isMobile.value = mobileMedia.matches;
  isTablet.value = tabletMedia.matches;
  isDesktop.value = !mobileMedia.matches && !tabletMedia.matches;
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  mobileMedia = window.matchMedia(MOBILE_QUERY);
  tabletMedia = window.matchMedia(TABLET_QUERY);

  update();

  mobileMedia.addEventListener('change', update);
  tabletMedia.addEventListener('change', update);
}

/**
 * Safe to call outside a component or effect scope (`openQuickAdd` reads it from a click
 * handler): it registers nothing per call. The media listeners are shared singletons that live
 * for the app's lifetime, so there is nothing to dispose.
 */
export function useBreakpoint() {
  init();

  return {
    isMobile: readonly(isMobile),
    isTablet: readonly(isTablet),
    isDesktop: readonly(isDesktop),
  };
}
