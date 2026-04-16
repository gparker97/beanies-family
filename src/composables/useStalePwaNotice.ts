import { ref, readonly } from 'vue';
import { noticeFlag } from '@/utils/notice';

const QUERY_PARAM = 'from-stale-pwa';
const NOTICE_KEY = 'stalePwa';

const flag = noticeFlag(NOTICE_KEY);
const shouldShow = ref(false);

let initialized = false;

/**
 * Detects users bounced in from the pre-cutover PWA shell at the apex origin.
 *
 * Flow:
 *  1. If URL has `?from-stale-pwa=1`, user was redirected from the old apex
 *     PWA. Activate the notice flag and strip the param from the URL.
 *  2. If already running as an installed PWA at app.beanies.family, they've
 *     successfully re-installed — clear the flag so the modal won't reappear.
 *  3. Expose reactive `shouldShow` + dismiss/analytics handlers.
 *
 * Module-scoped state — safe to call from multiple components; init runs once.
 */
export function useStalePwaNotice() {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true;

    const url = new URL(window.location.href);
    if (url.searchParams.get(QUERY_PARAM) === '1') {
      flag.activate();
      url.searchParams.delete(QUERY_PARAM);
      const cleaned =
        url.pathname +
        (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') +
        url.hash;
      window.history.replaceState({}, '', cleaned);
      window.plausible?.('pwa_stale_detected');
    }

    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) flag.clear();

    shouldShow.value = flag.isActive();
  }

  function dismiss() {
    flag.dismiss();
    shouldShow.value = false;
    window.plausible?.('pwa_stale_dismissed');
  }

  function trackInstallClicked() {
    window.plausible?.('pwa_stale_install_clicked');
  }

  return {
    shouldShow: readonly(shouldShow),
    dismiss,
    trackInstallClicked,
  };
}
