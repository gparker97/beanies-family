// Registration of the first-party native `InstallReferrer` plugin (Android only; see
// `InstallReferrerPlugin.java`). Community plugins stop at Capacitor 7, this app is on 8.

import { registerPlugin } from '@capacitor/core';

export interface InstallReferrerResult {
  /**
   * The Google Play install referrer string (`utm_source=...&utm_medium=...`), or `null` /
   * absent when Play had none (sideload, a store link without `referrer=`), or when this
   * device can never answer (`FEATURE_NOT_SUPPORTED`, `DEVELOPER_ERROR`, `PERMISSION_ERROR`).
   */
  referrer?: string | null;
  /**
   * When the install began, in epoch SECONDS (`ReferrerDetails.getInstallBeginTimestampSeconds`).
   * `0` or absent when Play does not know. Play keeps the referrer for the life of the
   * install, so this is how the caller tells a fresh install from an upgrade.
   */
  installBeginSeconds?: number;
}

export interface InstallReferrerPlugin {
  /**
   * REJECTS only on a failure that can clear on a later launch (`SERVICE_UNAVAILABLE`, a
   * disconnect, an exception during the read), which is not the same as "no referrer": the
   * caller retries on the next launch.
   */
  get(): Promise<InstallReferrerResult>;
}

export const InstallReferrer = registerPlugin<InstallReferrerPlugin>('InstallReferrer');
