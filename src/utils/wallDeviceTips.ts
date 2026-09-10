/**
 * The three high-level lines the Settings wall card shows before you mount a
 * tablet, chosen by OS family and by whether the browser can hold the screen
 * awake by itself.
 *
 * Deliberately a `utils` function taking its inputs as arguments rather than a
 * composable: it touches no Vue API and is not reactive, so a `use*` name in
 * `composables/` would misdescribe it and invite someone to add a `ref` it does
 * not need. Injecting both inputs also means its test needs no module mocking,
 * just a six-row table.
 *
 * It returns KEYS, not resolved strings, so a typo is a compile error and the
 * card keeps calling `t()` where every other card does. The detail behind each
 * line lives in the `set-up-the-beanie-wall` help article; these are signposts,
 * not instructions, and the card is deliberately not the place for the full
 * checklist.
 */

import type { UIStringKey } from '@/services/translation/uiStrings';
import type { DevicePlatform } from '@/services/sync/capabilities';

export function wallDeviceTipKeys(
  platform: DevicePlatform,
  wakeLockSupported: boolean
): UIStringKey[] {
  // Where the browser can hold the screen awake, the OS timeout is a backstop.
  // Where it cannot, that timeout is the only thing that will keep a wall lit,
  // which is a materially different instruction and has to read like one.
  //
  // ⚠️ But note what this input is and is not. `platform` is safe to state as a
  // fact about the reader, because an iPhone and an iPad share the same word
  // ("Guided Access"), so the answer holds whether they are at the tablet or on
  // their phone. `wakeLockSupported` has NO such property: it describes the
  // browser reading this card, which may not be the browser that will run the
  // wall. So it may only ever change the EMPHASIS of the line, never assert
  // something about "this device". Both strings are written to be true wherever
  // they are read; keep it that way.
  const screen: UIStringKey = wakeLockSupported
    ? 'wall.setup.tips.screenBacked'
    : 'wall.setup.tips.screenOnly';

  const lockToApp: UIStringKey =
    platform === 'ios'
      ? 'wall.setup.tips.guidedAccess'
      : platform === 'android'
        ? 'wall.setup.tips.screenPinning'
        : 'wall.setup.tips.lockGeneric';

  return [screen, lockToApp, 'wall.setup.tips.power'];
}
