import { ref, readonly, onScopeDispose } from 'vue';

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

export function useBreakpoint() {
  init();

  onScopeDispose(() => {
    // Listeners are shared singletons — don't remove them
    // They'll persist for the app lifetime which is fine
  });

  return {
    isMobile: readonly(isMobile),
    isTablet: readonly(isTablet),
    isDesktop: readonly(isDesktop),
  };
}
