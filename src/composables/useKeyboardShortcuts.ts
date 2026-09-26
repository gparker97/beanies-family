/**
 * Single-key keyboard shortcuts for one surface (the deal pile's K / S / 1-9 / arrows / U).
 *
 * One `window` keydown listener for the life of the calling scope, removed by
 * `onScopeDispose`. Keys are matched on `event.key` lowercased, so `K` and `k` are one
 * shortcut and `ArrowLeft` is `arrowleft`.
 *
 * A key is ignored, and the browser's default kept, when:
 *  - `enabled` is false;
 *  - it is a held-down repeat, already handled (`defaultPrevented`), or has Ctrl / Meta /
 *    Alt (a browser or OS shortcut, never ours);
 *  - someone is typing (`isTextEntryFocused`);
 *  - a modal or drawer is open (`hasOpenOverlays`) or any Escape layer is (popovers and
 *    menus register there), so a shortcut never acts on the page behind them.
 * `preventDefault()` runs only when a handler ran.
 *
 * Failure modes: attaching or detaching the listener can throw in a sandboxed frame that
 * lost `window`; that is caught with a warn and the shortcuts simply don't work. A handler
 * that throws or rejects is caught per key, logged with `[tag]`, and reported through
 * `onError`. This composable never toasts: store failures already toast where they happen.
 */
import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue';
import { hasOpenOverlays } from '@/utils/overlayStack';
import { hasOpenEscapeLayer } from '@/composables/useEscapeClose';
import { isTextEntryFocused } from '@/utils/isTextEntryFocused';

export type ShortcutMap = Record<string, () => unknown>;

export function useKeyboardShortcuts(
  map: ShortcutMap,
  options: {
    enabled: MaybeRefOrGetter<boolean>;
    tag: string;
    onError?: (key: string, err: unknown) => void;
  }
): void {
  const { tag, onError } = options;

  function onKeydown(event: KeyboardEvent): void {
    if (!toValue(options.enabled)) return;
    if (event.repeat || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    const fn = map[key];
    if (!fn) return;
    if (isTextEntryFocused() || hasOpenOverlays() || hasOpenEscapeLayer()) return;
    event.preventDefault();
    Promise.resolve()
      .then(fn)
      .catch((err: unknown) => {
        console.error(`[${tag}] shortcut "${key}" failed`, err);
        onError?.(key, err);
      });
  }

  try {
    window.addEventListener('keydown', onKeydown);
  } catch (err) {
    console.warn(`[${tag}] could not attach the shortcut listener:`, err);
    return;
  }
  onScopeDispose(() => {
    try {
      window.removeEventListener('keydown', onKeydown);
    } catch (err) {
      console.warn(`[${tag}] could not detach the shortcut listener:`, err);
    }
  });
}
