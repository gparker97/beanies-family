/**
 * Plausible analytics — privacy-friendly, gated on VITE_PLAUSIBLE_DOMAIN.
 *
 * No-op silently when the env var is unset (vanilla self-host stays fully
 * offline by default). Replaces the static <script> tag that previously lived
 * in index.html, which leaked self-host page views to greg's Plausible site.
 *
 * Failure handling: every path logs `[analytics]` prefix + Error. Analytics
 * is non-critical — it never blocks the app, and we never toast users about
 * it.
 */

import { features } from '@/config/features';

export function initAnalytics(): void {
  if (!features.analytics) return;

  try {
    const queue: PlausibleQueue =
      window.plausible ??
      (function (...args: unknown[]) {
        (queue.q = queue.q ?? []).push(args);
      } as PlausibleQueue);
    queue.init =
      queue.init ??
      function (i: object) {
        queue.o = i || {};
      };
    window.plausible = queue;
    queue.init({});

    const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://plausible.io/js/pa-${domain}.js`;
    script.onerror = (err) => {
      console.warn(
        '[analytics] Plausible script failed to load — analytics disabled for this session.',
        { domain, err }
      );
    };
    document.head.appendChild(script);
  } catch (err) {
    console.warn(
      '[analytics] failed to initialize Plausible — analytics disabled for this session.',
      err
    );
  }
}
