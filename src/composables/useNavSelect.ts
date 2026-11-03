import { useRouter } from 'vue-router';
import { useFeedbackModal } from '@/composables/useFeedbackModal';
import { navigateTo } from '@/composables/usePlannerToday';
import type { NavItemDef } from '@/constants/navigation';
import { openExternal } from '@/utils/openExternal';

/**
 * What choosing a navigation target does, shared by every surface that offers
 * one (the `AppNavMenu` rows and peek chips, and the sidebar member card's
 * tools row): an external item opens its URL, anything else goes through
 * `navigateTo` (so choosing Calendar while already on it still lands on today),
 * and "Share feedback" opens the feedback modal rather than a route.
 */
export function useNavSelect() {
  const router = useRouter();
  const { openFeedback } = useFeedbackModal();

  function selectItem(item: NavItemDef) {
    if (item.external && item.externalUrl) openExternal(item.externalUrl);
    else navigateTo(router, item.path);
  }

  function selectFeedback() {
    openFeedback('nav');
  }

  return { selectItem, selectFeedback };
}
