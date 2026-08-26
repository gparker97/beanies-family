// Start every supported share-target adapter, and stop them on teardown (#64).
//
// The ONE call site is `App.vue`. Keeping the registry + lifecycle here is what keeps
// `App.vue` — already a very large component — to a two-line diff, and what stops platform
// branching accumulating in the app shell.

import { onMounted, onUnmounted } from 'vue';
import { SHARE_ADAPTERS } from '@/services/share';
import { ingestSharedDocuments } from './useSharedDocumentIngest';
import { reportError } from '@/utils/errorReporter';

export function useShareTargets(): void {
  const teardowns: Array<() => void> = [];

  onMounted(() => {
    for (const adapter of SHARE_ADAPTERS) {
      try {
        if (!adapter.isSupported()) continue;
        teardowns.push(
          adapter.start((files, meta) => {
            void ingestSharedDocuments(files, meta);
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
