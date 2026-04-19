/**
 * Auto-opens a form modal when the route arrives with `?add=1` and
 * clears the query so the modal doesn't reopen on route re-evaluation
 * or browser back/forward. Used by each Bean-detail content tab so the
 * hero's "＋ Add Something" menu can deep-link straight into the
 * matching add flow.
 *
 * The caller owns the ref that represents "modal is open" — we just
 * flip it to `true` once, then strip the flag from the URL.
 */
import { watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Ref } from 'vue';

export function useAutoOpenOnQuery(modalOpen: Ref<boolean>, flag = 'add'): void {
  const route = useRoute();
  const router = useRouter();

  watch(
    () => route.query[flag],
    (value) => {
      if (value === '1' || value === 'true') {
        modalOpen.value = true;
        // Clear the flag — preserves the rest of the route (memberId,
        // tab) but replaces the history entry so browser back doesn't
        // reopen the modal.
        const next = { ...route.query };
        delete next[flag];
        void router.replace({ query: next });
      }
    },
    { immediate: true }
  );
}
