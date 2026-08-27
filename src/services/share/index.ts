// The share-target adapter registry (#64).
//
// A fourth platform is ONE file plus one entry here. There is deliberately no
// `if (platform === …)` chain anywhere in the app: `useShareTargets` starts every supported
// adapter and they all end at the same `ingestSharedDocuments` call.

import { androidShareAdapter } from './androidShareAdapter';
import { iosOpenInAdapter } from './iosOpenInAdapter';
import { iosShareAdapter } from './iosShareAdapter';
import { pwaShareAdapter } from './pwaShareAdapter';
import type { ShareAdapter } from './types';

// iOS appears TWICE on purpose: the platform has two independent delivery mechanisms and
// only one of them can open the app. See the header of `iosOpenInAdapter`.
export const SHARE_ADAPTERS: readonly ShareAdapter[] = [
  androidShareAdapter,
  iosOpenInAdapter,
  iosShareAdapter,
  pwaShareAdapter,
];

export type { ShareAdapter } from './types';
