import { readonly, ref, watch, type Ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

/** The diagnostic surface for the FAB composer (#119); one CloudWatch filter isolates it. */
export const COMPOSER_SURFACE = 'quick-add-composer';

export type ComposerHandoffSource = 'paste' | 'camera' | 'file';

/**
 * One composer session per open of the quick-add surface (#119).
 *
 * "Is the composer part of this open?" is decided ONCE per open, here, and everything reads
 * that one answer (`composerShown`): whether the composer renders, the header variant, the
 * focus target, the `capture opened` denominator and the `dismissed` event. Two conditions
 * deciding rendering and logging separately disagreed for a Care & Safety picker open (the
 * composer rendered and stole focus while nothing was logged); the latch removes that class.
 *
 * WHY `openSeq` AND NOT `isOpen`. On desktop the surface is non-modal, so a page can re-open it
 * while it is already open (a Scrapbook scoped add). `isOpen` does not change then; `openSeq`
 * advances on every successful open. A re-open while a session is live ends that session first
 * (`dismissed`, unless something was handed off) and re-evaluates the latch, so a scoped
 * re-open shows the tiles only, exactly like a fresh scoped open.
 *
 * The latch is deliberately NOT re-evaluated mid-open: tapping an Everyday member tile after a
 * FAB open moves the quick-add stage to `picker`, and the composer (and its draft) stays.
 *
 * Both watchers use the default `pre` flush, so `startQuickAddItem()` setting the picker stage
 * synchronously right after `openQuickAdd()` is seen before the latch is evaluated.
 *
 * Telemetry lives here, with the state that decides it:
 *  - `composer sent`      { action: 'sent', kind }          from `markHandedOff`
 *  - `composer dismissed` { action: 'dismissed', detail }   a shown session ended unsent
 */
export function useComposerSession(
  isOpen: Readonly<Ref<boolean>>,
  openSeq: Readonly<Ref<number>>,
  opts: {
    /** Evaluated once per open: may this open show the composer? */
    composerAllowed: () => boolean;
    /** Called after every evaluated open, with the latch's answer (focus, the denominator). */
    onOpen?: (composerShown: boolean) => void;
  }
) {
  const composerShown = ref(false);
  const draft = ref('');
  const handedOff = ref(false);

  /** Ends a live session; logs `dismissed` when the composer was shown and nothing was sent. */
  function endSession(): void {
    if (composerShown.value && !handedOff.value) {
      logEvent({
        level: 'info',
        surface: COMPOSER_SURFACE,
        message: 'composer dismissed',
        context: { action: 'dismissed', detail: draft.value.trim() ? 'had_text' : 'empty' },
      });
    }
    composerShown.value = false;
    handedOff.value = false;
    draft.value = '';
  }

  watch(isOpen, (open) => {
    if (!open) endSession();
  });

  watch(openSeq, () => {
    if (!isOpen.value) return;
    endSession();
    composerShown.value = opts.composerAllowed();
    opts.onOpen?.(composerShown.value);
  });

  /**
   * The door committed a capture. Called from the host's `handoff` listener BEFORE it closes
   * the surface, so the close that follows is not counted as a dismissal. For camera/file it
   * means "the picker opened"; the file's fate continues under `magic-beans-capture`.
   */
  function markHandedOff(source: ComposerHandoffSource): void {
    handedOff.value = true;
    logEvent({
      level: 'info',
      surface: COMPOSER_SURFACE,
      message: 'composer sent',
      context: { action: 'sent', kind: source },
    });
  }

  return {
    composerShown: readonly(composerShown),
    draft,
    markHandedOff,
  };
}
