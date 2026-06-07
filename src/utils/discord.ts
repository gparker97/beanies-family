// Single source of truth for the Discord community link + the one tracked
// open-path used by every in-app surface (onboarding card, community nudge,
// Settings card, nav item). The URL points at the stable `${MARKETING_URL}/discord`
// redirect (an Astro page) so the actual invite can change with a small web
// deploy — never an app/PWA release, and never a dead link baked into a bundle.

import { openExternal } from './openExternal';
import { MARKETING_URL } from './marketing';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

export const DISCORD_URL = `${MARKETING_URL}/discord`;

/** Where a Discord open was triggered from — drives Plausible segmentation. */
export type DiscordSurface = 'onboarding' | 'nudge' | 'settings' | 'nav' | 'announcement';

/**
 * Open the Discord community and record which surface drove it.
 *
 * Order is load-bearing: `openExternal` MUST run synchronously inside the
 * originating user gesture (its own doc), so we navigate FIRST, then fire
 * analytics. The navigation is wrapped so a (practically unreachable — it's a
 * void anchor click) failure surfaces a toast rather than failing silently.
 * The `plausible?.()` call is bare optional-chaining, matching the repo-wide
 * convention (the stub no-ops; it never throws).
 */
export function openDiscord(surface: DiscordSurface): void {
  try {
    openExternal(DISCORD_URL);
  } catch (err) {
    console.error('[discord] openExternal failed — link not opened', err);
    const store = useTranslationStore();
    showToast('error', store.t('discord.openFailedTitle'), store.t('discord.openFailedBody'), {
      surface: 'discord-open',
      error: err,
    });
  }
  window.plausible?.('discord_join_click', { props: { surface } });
}
