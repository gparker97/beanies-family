/**
 * Where to send someone to install or update the app.
 *
 * ⚠️ ITS OWN MODULE, and that is the point. This one function is needed by the
 * update composable AND by `payloadFailureSurface.ts`, the app's single payload
 * chokepoint, which is required to import no composable and no plugin (see the
 * plan's R3.3). Living in `useAppUpdate.ts` it dragged `@capacitor/app`,
 * `useConfirm` and the telemetry queue into that chokepoint's module graph, and
 * in Phase B it would have dragged a native plugin in behind them. A record
 * lookup has no business carrying any of that.
 */
import { STORE_URL } from '@beanies/brand/nav';
import type { getPlatform } from '@/services/sync/capabilities';

/**
 * The store listing for a native platform, or `null` on web.
 *
 * ⚠️ THIS `null` IS THE WEB GUARANTEE. `surfacePayloadFatal` calls it with no
 * platform test of its own, so the browser gets no store link because the type
 * says so, not because a second guard remembered to.
 */
export function storeUrlFor(platform: ReturnType<typeof getPlatform>): string | null {
  return platform === 'web' ? null : STORE_URL[platform];
}
