import { useRouter } from 'vue-router';
import { useFeedbackModal } from '@/composables/useFeedbackModal';
import type { NavItemDef } from '@/constants/navigation';
import { openExternal } from '@/utils/openExternal';

/**
 * What choosing a navigation target does, shared by every surface that offers
 * one (the `AppNavMenu` rows and peek chips, and the sidebar member card's
 * tools row): an external item opens its URL, anything else is a router push,
 * and "Share feedback" opens the feedback modal rather than a route.
 */
export function useNavSelect() {
  const router = useRouter();
  const { openFeedback } = useFeedbackModal();

  function selectItem(item: NavItemDef) {
    if (item.external && item.externalUrl) openExternal(item.externalUrl);
    else void router.push(item.path);
  }

  function selectFeedback() {
    openFeedback('nav');
  }

  return { selectItem, selectFeedback };
}
