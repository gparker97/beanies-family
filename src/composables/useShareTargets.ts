// Start every supported share-target adapter, and stop them on teardown (#64).
//
// The ONE call site is `App.vue`. Keeping the registry + lifecycle here is what keeps
// `App.vue` — already a very large component — to a two-line diff, and what stops platform
// branching accumulating in the app shell.

import { onMounted, onUnmounted } from 'vue';
import { Capacitor } from '@capacitor/core';
import { SHARE_ADAPTERS } from '@/services/share';
import { ingestSharedContent } from './useSharedDocumentIngest';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

export function useShareTargets(): void {
  const teardowns: Array<() => void> = [];

  onMounted(() => {
    const platform = Capacitor.getPlatform();
    let started = 0;

    for (const adapter of SHARE_ADAPTERS) {
      try {
        if (!adapter.isSupported()) continue;
        started++;
        teardowns.push(
          adapter.start((content, meta) => {
            void ingestSharedContent(content, meta);
          })
        );
      } catch (err) {
        // One adapter failing to start must not stop the others, and must not be silent.
        reportError({
          surface: 'share-target-ingest',
          message: `share adapter "${adapter.name}" failed to start`,
          severity: 'error',
          error: err,
          context: { action: 'threw', os: adapter.name },
        });
      }
    }

    // A NATIVE build with no share adapter is always a defect, never a device limitation:
    // both native adapters are gated on their plugin being registered, and a plugin that
    // fails to register answers `isPluginAvailable` with a plain false. That is silent at
    // every layer — the Swift compiles, the app launches, and the share simply does nothing.
    //
    // It cost two releases to find exactly once. This is the line that would have named it
    // in the first, so it is deliberately an ERROR rather than a warning.
    if (started === 0 && Capacitor.isNativePlatform()) {
      reportError({
        surface: 'share-target-ingest',
        message: `no share adapter is supported on ${platform} — is the ShareIntent plugin registered?`,
        severity: 'error',
        context: { action: 'no_url', os: platform },
      });
      return;
    }

    logEvent({
      level: 'info',
      surface: 'share-target-ingest',
      message: 'share adapters started',
      // The success-path counter, so the RATE of the failure above is measurable rather
      // than only its absence being noticeable.
      context: { action: 'start', os: platform, file_count: started },
    });
  });

  onUnmounted(() => {
    for (const stop of teardowns) {
      try {
        stop();
      } catch {
        // Teardown races app shutdown; a failure here has no user-visible consequence.
      }
    }
    teardowns.length = 0;
  });
}
