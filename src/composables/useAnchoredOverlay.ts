import { computed, ref, watch, type Ref } from 'vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useFullscreenOverlay } from '@/composables/useFullscreenOverlay';
import {
  KEYBOARD_INSET_MIN_PX,
  useVisualViewportInset,
} from '@/composables/useVisualViewportInset';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * The behaviour of a surface anchored to the FAB's corner (#119): a viewport-blocking card on
 * phones, a non-modal chat-window card at 768px and up, lifted above an on-screen keyboard.
 *
 * It knows nothing about quick-add, so the next anchored surface reuses it. The host renders
 * the dim (phone only) and the card; this decides which overlay contract applies:
 *
 *  - PHONE (`isMobile`): `useFullscreenOverlay` (Escape + body scroll lock + the overlay
 *    stack), because the card and its dim block the viewport. Registering in the overlay stack
 *    is what keeps `openQuickAdd`'s refusal rule and `hasOpenOverlays()` behaving as they did
 *    with BaseModal, and it inherits any future overlay-universal hardening.
 *  - DESKTOP: `useEscapeClose` only. The page stays usable and scrollable behind the card, so
 *    no scroll lock and no overlay registration (`useFullscreenOverlay`'s own docblock draws
 *    exactly this line). `isAppQuiet()` still sees it through `hasOpenEscapeLayer()`.
 *
 * `phoneOpen` and `desktopOpen` never both hold, so Escape registers once; a breakpoint change
 * while open hands the registration across.
 *
 * It also remembers `document.activeElement` at open and restores it on close when it is still
 * in the document, so a keyboard user returns to the FAB rather than to `<body>`.
 *
 * Keyboard telemetry (once per open, on the host's surface): `applied` the first time the
 * inset crosses `KEYBOARD_INSET_MIN_PX`, `unsupported` when a phone has no `visualViewport`.
 */
export function useAnchoredOverlay(
  isOpen: Ref<boolean>,
  close: () => void,
  opts: { surface: string }
): {
  isMobile: Readonly<Ref<boolean>>;
  inset: Readonly<Ref<number>>;
} {
  const { isMobile } = useBreakpoint();

  const phoneOpen = computed(() => isOpen.value && isMobile.value);
  const desktopOpen = computed(() => isOpen.value && !isMobile.value);

  useFullscreenOverlay(phoneOpen, close);
  useEscapeClose(desktopOpen, close);

  const { inset, supported } = useVisualViewportInset(isOpen, { surface: opts.surface });

  // --- Focus remember / restore ---------------------------------------------
  const restoreFocusTo = ref<HTMLElement | null>(null);

  function restoreFocus(): void {
    const el = restoreFocusTo.value;
    restoreFocusTo.value = null;
    if (!el || !el.isConnected) return;
    try {
      el.focus();
    } catch (err) {
      // Not user-visible beyond focus landing on <body>; a console line is the right weight.
      console.warn('[useAnchoredOverlay] could not restore focus on close:', err);
    }
  }

  // --- Keyboard telemetry, once per open ------------------------------------
  let keyboardLogged = false;

  function logKeyboard(stage: 'applied' | 'unsupported'): void {
    keyboardLogged = true;
    logEvent({
      level: 'info',
      surface: opts.surface,
      message: 'keyboard avoidance',
      context: {
        action: 'keyboard_avoidance',
        stage,
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
      },
    });
  }

  watch(
    isOpen,
    (open) => {
      if (open) {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        restoreFocusTo.value = active instanceof HTMLElement ? active : null;
        keyboardLogged = false;
        if (!supported && isMobile.value) logKeyboard('unsupported');
      } else {
        restoreFocus();
      }
    },
    { immediate: true }
  );

  watch(inset, (px) => {
    if (isOpen.value && !keyboardLogged && px >= KEYBOARD_INSET_MIN_PX) logKeyboard('applied');
  });

  return { isMobile, inset };
}
