/**
 * Calendar drag and drop (#142): the binding's DOM listeners, attached to the view root (and
 * any teleported portal of it, e.g. the desktop month popover) and re-attached whenever
 * either element changes.
 *
 * - `pointerdown/move/up/cancel` in the CAPTURE phase, so the binding runs before the
 *   view's bubble-phase swipe (`useHorizontalSwipe`) and can stop what it owns.
 * - `dragstart` (capture) on a drag source is prevented: an avatar `<img>` inside a chip
 *   would otherwise start a native image drag and `pointercancel` the gesture.
 * - ONE non-passive `touchmove` on the root, from bind time: Chrome decides at `touchstart`
 *   whether a blocking listener covers a touch, so one added at lift (300 ms later) is not
 *   reliably consulted. The handler prevents scrolling only while lifted.
 * - `keydown` / `keyup` (capture) on the PORTAL only: a teleported panel's keys never bubble
 *   to the root, where the view binds `onKeydown` / `onKeyup` itself. A key the binding
 *   claims (`preventDefault`) stops there, so the panel's own roving arrow focus does not
 *   also move focus while the arrows step the drop target.
 * - `visibilitychange` on the document.
 */
import { getCurrentInstance, onMounted, onScopeDispose, watch, type Ref } from 'vue';

const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

export interface DragListeners {
  onPointer: (e: PointerEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onDragStart: (e: DragEvent) => void;
  onHidden: () => void;
  onKeydown: (e: KeyboardEvent) => void;
  onKeyup: (e: KeyboardEvent) => void;
}

const KEY_EVENTS = ['keydown', 'keyup'] as const;

export function useDragListeners(
  root: Ref<HTMLElement | null>,
  portal: Readonly<Ref<HTMLElement | null>> | undefined,
  on: DragListeners
): void {
  const pointer = on.onPointer as EventListener;
  const onVisibility = () => {
    if (document.hidden) on.onHidden();
  };
  const key = ((e: KeyboardEvent) => {
    (e.type === 'keydown' ? on.onKeydown : on.onKeyup)(e);
    if (e.defaultPrevented) e.stopPropagation();
  }) as EventListener;
  let attached: HTMLElement[] = [];
  let touchRoot: HTMLElement | null = null;
  let keyPortal: HTMLElement | null = null;

  function detach(): void {
    for (const el of attached) {
      for (const type of POINTER_EVENTS) el.removeEventListener(type, pointer, true);
      el.removeEventListener('dragstart', on.onDragStart, true);
    }
    touchRoot?.removeEventListener('touchmove', on.onTouchMove);
    for (const type of KEY_EVENTS) keyPortal?.removeEventListener(type, key, true);
    attached = [];
    touchRoot = null;
    keyPortal = null;
  }

  function sync(): void {
    const els = [root.value, portal?.value].filter((el): el is HTMLElement => !!el);
    if (els.length === attached.length && els.every((el, i) => attached.at(i) === el)) return;
    detach();
    for (const el of els) {
      for (const type of POINTER_EVENTS) el.addEventListener(type, pointer, true);
      el.addEventListener('dragstart', on.onDragStart, true);
    }
    touchRoot = root.value;
    touchRoot?.addEventListener('touchmove', on.onTouchMove, { passive: false });
    keyPortal = portal?.value ?? null;
    for (const type of KEY_EVENTS) keyPortal?.addEventListener(type, key, true);
    attached = els;
  }

  // In a component the template ref resolves at mount; in a bare effect scope, bind now.
  if (getCurrentInstance()) onMounted(sync);
  else sync();
  watch(() => [root.value, portal?.value], sync, { flush: 'post' });
  document.addEventListener('visibilitychange', onVisibility);
  onScopeDispose(() => {
    detach();
    document.removeEventListener('visibilitychange', onVisibility);
  });
}
