/**
 * Single-key keyboard shortcuts for one surface (the deal pile's K / S / 1-9 / arrows / U).
 *
 * One `window` keydown listener for the life of the calling scope, removed by
 * `onScopeDispose`. Keys are matched on `event.key` lowercased, so `K` and `k` are one
 * shortcut and `ArrowLeft` is `arrowleft`.
 *
 * A handler runs synchronously and says whether it acted: `false` means "nothing to do
 * here" and the browser keeps its default (an arrow still scrolls, a letter still reaches
 * whatever wanted it); `true`, or a promise for async work, means it acted and the default
 * is prevented. A promise's rejection is caught like a throw.
 *
 * A key is ignored, and the browser's default kept, when:
 *  - `enabled` is false;
 *  - it is a held-down repeat, already handled (`defaultPrevented`), or has Ctrl / Meta /
 *    Alt (a browser or OS shortcut, never ours);
 *  - someone is typing (`isTextEntryFocused`);
 *  - focus sits on something outside `scope` other than the page itself (a sidebar link, a
 *    header toggle, a menu button): the key belongs to what has focus. Focus inside the
 *    scope, or on `<body>` (nothing focused), is ours. Without a `scope`, any focus is;
 *  - a modal or drawer is open (`hasOpenOverlays`) or any Escape layer is (popovers and
 *    menus register there), so a shortcut never acts on the page behind them.
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

/** `false`: not handled (default kept). `true` or a promise: handled (default prevented). */
export type ShortcutHandler = () => boolean | Promise<unknown>;
export type ShortcutMap = Record<string, ShortcutHandler>;

/** Focus on the page itself, or inside `scope`: the shortcut's to take. */
function focusIsOurs(scope: HTMLElement | null | undefined): boolean {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return true;
  return !scope || scope.contains(el);
}

export function useKeyboardShortcuts(
  map: ShortcutMap,
  options: {
    enabled: MaybeRefOrGetter<boolean>;
    tag: string;
    /** The surface's root element: keys count only with focus inside it, or on the page. */
    scope?: MaybeRefOrGetter<HTMLElement | null | undefined>;
    onError?: (key: string, err: unknown) => void;
  }
): void {
  const { tag, onError } = options;

  function fail(key: string, err: unknown): void {
    console.error(`[${tag}] shortcut "${key}" failed`, err);
    onError?.(key, err);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!toValue(options.enabled)) return;
    if (event.repeat || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typeof event.key !== 'string') return;
    const key = event.key.toLowerCase();
    const fn = map[key];
    if (!fn) return;
    if (isTextEntryFocused() || hasOpenOverlays() || hasOpenEscapeLayer()) return;
    if (!focusIsOurs(toValue(options.scope))) return;

    let result: boolean | Promise<unknown>;
    try {
      result = fn();
    } catch (err) {
      // It threw part-way through acting, so the key was ours: keep the default from firing.
      event.preventDefault();
      fail(key, err);
      return;
    }
    if (result === false) return;
    event.preventDefault();
    if (result instanceof Promise) result.catch((err: unknown) => fail(key, err));
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
