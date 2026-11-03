import { onScopeDispose, watch, type Ref } from 'vue';

/**
 * Run a document-level outside-click check in the CAPTURE phase, before the clicked element's
 * own handler. In a real browser Vue's re-render runs as a microtask between one listener and the
 * next, so a bubble-phase document listener can see a target that has already left the DOM:
 * the old time picker's "+ Custom time" row swapped itself for the time input, `contains()` on the
 * detached row was false, and the list closed the moment it opened (2026-11-01). In the capture
 * phase nothing has reacted to the click yet, so the target is still where the person tapped.
 * A scripted `el.click()` does not flush Vue between listeners, which is why tests missed it.
 *
 * Re-exported from `useAnchoredPopover`, where its other importers find it.
 */
export const OUTSIDE_CLICK_CAPTURE = true;

/**
 * Call `onOutside` for a click that lands outside every one of `insideRefs`, while `active`.
 *
 * The document listener is attached only while `active` holds (in the capture phase, see
 * `OUTSIDE_CLICK_CAPTURE`) and detached when it drops, with `onScopeDispose` as the safety net
 * for a consumer unmounted while open. Pass every element that counts as inside, including a
 * teleported one: a `<Teleport>`ed popover is not inside the component root. An empty ref is
 * simply skipped.
 *
 * Consumers: `useAnchoredPopover` (SortMenu, OverflowMenu) and `TimePickerHost`. About seven
 * components still hand-copy this idiom (AssigneePickerButton, BaseCombobox, InfoHintBadge,
 * SaveStatusIndicator, BeanieDatePicker and others); fold each in here when it is next touched.
 *
 * Failure mode: `addEventListener` / `removeEventListener` throwing (a sandboxed frame that
 * lost its document) is caught and logged with a `[useOutsideClick]` prefix; the surface then
 * closes only through its other paths (Escape, its own buttons).
 */
export function useOutsideClick(
  active: Readonly<Ref<boolean>>,
  insideRefs: ReadonlyArray<Readonly<Ref<HTMLElement | null | undefined>>>,
  onOutside: (event: MouseEvent) => void
): void {
  let listening = false;

  function onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (target && insideRefs.some((r) => r.value?.contains(target))) return;
    onOutside(event);
  }

  function attach(): void {
    if (listening) return;
    try {
      document.addEventListener('click', onDocumentClick, OUTSIDE_CLICK_CAPTURE);
      listening = true;
    } catch (err) {
      console.warn('[useOutsideClick] could not attach the click listener:', err);
    }
  }

  function detach(): void {
    if (!listening) return;
    try {
      document.removeEventListener('click', onDocumentClick, OUTSIDE_CLICK_CAPTURE);
    } catch (err) {
      console.warn('[useOutsideClick] could not detach the click listener:', err);
    }
    listening = false;
  }

  watch(
    active,
    (on) => {
      if (on) attach();
      else detach();
    },
    { immediate: true }
  );

  onScopeDispose(detach);
}
