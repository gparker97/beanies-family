// Registration of the first-party native `WidgetBridge` plugin (#130, ADR-042): the one door
// between the app and the home-screen widgets. iOS: `ios/App/App/WidgetBridgePlugin.swift`
// (App Group file + WidgetCenter reload). Android: `WidgetBridgePlugin.java` (AtomicFile in
// `filesDir/widgets/` + `DayWidgetProvider.renderAll`). No web implementation: every caller
// gates on `isNative()` (`useWidgetSnapshot`, the `clearWidgetSnapshot` sign-out step).

import { registerPlugin } from '@capacitor/core';
import type { CircleShowOption, WidgetSize } from '@/types/widgetSnapshot';

/** How many widgets of each size are placed right now. Absent size = none placed. */
export type WidgetPlacements = Partial<Record<WidgetSize, number>> & {
  /**
   * iOS, from v3 (#134): how many lock-screen circles are placed per "Show" option (read
   * natively through `widgetConfigurationIntent(of:)`). Absent on Android and on older
   * builds; an absent option = none placed.
   */
  circle?: Partial<Record<CircleShowOption, number>>;
};

export interface WidgetPublishResult {
  placements: WidgetPlacements;
  /**
   * The widget's last recorded read failure, consumed (and cleared natively) by this call,
   * or absent when there was none. A fixed token grammar, never free text:
   * `read_failed` | `decode_failed;v=<n>` | `placements_failed;<token>` | `reload_failed;<token>`.
   * `homeWidgetEvents.emitReadOutcome` re-validates it before logging.
   */
  readOutcome?: string;
  /**
   * Android only: the `YYYY-MM-DD` day the placed widgets painted from this publish (the
   * provider's own pick of "today" from the snapshot), or absent when nothing dated was
   * painted. iOS paints from a timeline on its own clock and never reports one. The
   * publisher logs it as a day offset from the app's `today`, so a widget stuck on
   * yesterday is visible in the firehose without a device in hand.
   */
  renderedYmd?: string;
}

export interface WidgetBridgePlugin {
  /**
   * Write the snapshot JSON (a `WidgetSnapshot`) atomically and refresh every placed widget.
   *
   * REJECTS with `code`:
   * - `app_group_unavailable` (iOS): the App Group container is missing, i.e. the entitlement
   *   or the portal registration is wrong (runbook §6c). Nothing was written.
   * - `write_failed`: the file write failed. The previous snapshot (if any) is untouched.
   * - `reload_failed`: written, but the widgets could not be told to refresh.
   * A failure to read placements is NOT a reject: it resolves with empty placements and a
   * `placements_failed;...` `readOutcome`, because the snapshot is already on disk.
   */
  publish(options: { json: string }): Promise<WidgetPublishResult>;
  /**
   * Delete the snapshot (absent = success) and refresh the widgets, so they show
   * "open beanies". Rejects `write_failed` when the delete fails, and (Android) `reload_failed`
   * when the file is gone but re-rendering the placed widgets failed, so the launcher still
   * shows the last views. Either way family content may remain on the home screen; the
   * sign-out runner reports it, with the code and the reason in the error message.
   */
  clear(): Promise<void>;
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');
