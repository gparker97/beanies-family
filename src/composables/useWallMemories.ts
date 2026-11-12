/**
 * The family memories viewer on the beanie wall (#140): ALL of its state, so the wall page
 * creates this once, provides it as `WALL_MEMORIES`, and gains almost nothing itself.
 *
 * Two ways in, one rule each:
 *  - a tap on a face that does nothing today (the chore board, a details sheet), via
 *    `WallFaceButton`, which calls `open` directly;
 *  - a SECOND tap on the only lit bean in the footer or a lane header. `opensOnTap` is the
 *    one place that rule lives, read by the page to route the tap and by the footer and the
 *    lane headers for `aria-haspopup`, so the gesture and its announcement cannot disagree.
 *
 * Four ways out, all through `close(kind)`: the Close button, Escape, the wall going to
 * sleep, and three minutes with nobody touching the wall. The idle close exists because a
 * wall is unattended most of the day, and a scrapbook left open by a child would otherwise
 * hide the schedule from everyone who walks past.
 *
 * `isOpen` is DERIVED (`enabled && opened`), so switching the viewer off can never leave it
 * open, without a watcher. Nothing is critical here: every event is firehose telemetry.
 */
import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';
import { onWallActivity } from '@/composables/useWallAutoSleep';
import { enabledScrapTypes } from '@/utils/wallMemories';
import type { WallMemberFocus } from '@/composables/useWallMemberFocus';
import type { WallMemoriesSettings } from '@/types/models';

const SURFACE = 'beanie-wall';

/** Long enough to read a few months; short enough that an unattended wall comes back. */
export const WALL_MEMORIES_IDLE_MS = 3 * 60_000;

/** Which door opened the viewer. Logged, so "did anyone find it" has an answer. */
export type WallMemoriesOpenSource =
  'face-chore' | 'face-sheet' | 'chip-second-tap' | 'lane-second-tap';

export type WallMemoriesCloseKind = 'button' | 'escape' | 'idle' | 'night';

/** Why the viewer opened onto nothing: every type switched off, or no memories yet. */
export type WallMemoriesEmptyDetail = 'types-off' | 'no-entries';

export interface UseWallMemoriesOptions {
  focus: Pick<WallMemberFocus, 'isOnlyFocused'>;
  /** The wall's night state. The viewer closes the moment it becomes true. */
  asleep: Ref<boolean>;
  settings: () => WallMemoriesSettings;
  /** Where activity is heard. Tests pass their own; the wall uses `window`. */
  target?: EventTarget;
}

export function useWallMemories(options: UseWallMemoriesOptions) {
  const opened = ref(false);
  const enabled = computed(() => options.settings().viewer);
  const isOpen = computed(() => enabled.value && opened.value);
  /** The memory types switched on. May be empty; the viewer shows its types-off state. */
  const types = computed(() => enabledScrapTypes(options.settings()));

  /** Where focus goes back to on close. Captured at open, never rendered. */
  let opener: HTMLElement | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let stopActivity: (() => void) | null = null;

  function clearIdle(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  }

  function armIdle(): void {
    clearIdle();
    idleTimer = setTimeout(() => close('idle'), WALL_MEMORIES_IDLE_MS);
  }

  function stopIdleWatch(): void {
    clearIdle();
    stopActivity?.();
    stopActivity = null;
  }

  /**
   * Open the viewer. `from` is the element to return focus to; it defaults to whatever has
   * focus now, which is the tapped button everywhere except Safari (which does not focus a
   * button on click), where the restore simply does nothing.
   */
  function open(source: WallMemoriesOpenSource, from?: Element | null): void {
    if (!enabled.value || opened.value || options.asleep.value) return;
    const candidate = from ?? (typeof document !== 'undefined' ? document.activeElement : null);
    opener = candidate instanceof HTMLElement ? candidate : null;
    opened.value = true;
    armIdle();
    stopActivity = onWallActivity(armIdle, options.target);
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_memories_open',
      context: { kind: source },
    });
  }

  function close(kind: WallMemoriesCloseKind): void {
    if (!opened.value) return;
    opened.value = false;
    stopIdleWatch();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_memories_close',
      context: { kind },
    });
    const target = opener;
    opener = null;
    // Not on night: the opener is under the night screen, and focus there would be a trap
    // for a keyboard user until the wall wakes.
    if (kind !== 'night' && target?.isConnected) target.focus();
  }

  /** True when a tap on this bean's chip or lane header opens the viewer instead of filtering. */
  function opensOnTap(memberId: string): boolean {
    return enabled.value && options.focus.isOnlyFocused(memberId);
  }

  /** The viewer opened onto nothing. Called by the viewer, once per open. */
  function reportEmpty(detail: WallMemoriesEmptyDetail): void {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_memories_empty',
      context: { detail },
    });
  }

  watch(options.asleep, (asleep) => {
    if (asleep) close('night');
  });

  onScopeDispose(stopIdleWatch);

  return { enabled, isOpen, types, open, close, opensOnTap, reportEmpty };
}

export type WallMemoriesContext = ReturnType<typeof useWallMemories>;
