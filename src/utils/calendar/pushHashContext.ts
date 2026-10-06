/**
 * The ONE builder of the push-hash context, shared by the reconcile engine and the
 * one-time import (#94).
 *
 * It matters that both use the SAME builder. The import records `lastPushedHash` on
 * every link precisely so the next reconcile sees the hashes agree and does nothing;
 * a context built two ways (a different resolver, a different zone) would push every
 * imported event straight back to Google, and for an ADOPTED event that push
 * rewrites the family's real event body.
 *
 * Re-reads the home zone (and the device zone under it) on every call: a device that
 * crossed zones, or a family that just set `homeTimeZone`, gets it on the next pass.
 * Must be called within a store action (Pinia active).
 */

import { useSettingsStore } from '@/stores/settingsStore';
import type { HomeTimeZoneSource } from '@/utils/timeZone';
import type { PushHashContext } from './activityToGoogleEvent';
import { makeMemberNameResolver } from './memberNames';

export interface ResolvedPushHashContext extends PushHashContext {
  /** The zone to STAMP on pushed events (the resolved home zone, any source). */
  timeZone: string;
  source: HomeTimeZoneSource;
  /** The stored zone is unknown to this engine (still hashed and pushed as-is). */
  invalidStored: boolean;
}

export function makePushHashContext(): ResolvedPushHashContext {
  const home = useSettingsStore().resolveHomeTimeZoneNow();
  return {
    memberName: makeMemberNameResolver(),
    hashZone: home.hashZone,
    timeZone: home.zone,
    source: home.source,
    invalidStored: home.invalidStored,
  };
}
