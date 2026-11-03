import { ref, nextTick, type Ref } from 'vue';
import { useEscapeClose } from '@/composables/useEscapeClose';
import { useAnchoredPosition } from '@/composables/useAnchoredPosition';
import { useOutsideClick } from '@/composables/useOutsideClick';

// The z tier and the capture-phase flag live with the halves that use them; re-exported here
// because AssigneePickerButton, BaseCombobox, InfoHintBadge, SaveStatusIndicator, SortMenu and
// OverflowMenu import them from this module.
export { ANCHORED_POPOVER_Z_INDEX } from '@/composables/useAnchoredPosition';
export { OUTSIDE_CLICK_CAPTURE } from '@/composables/useOutsideClick';

/** Typing targets: arrow keys there step the field (a time input's hours), never rove the menu. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

export interface AnchoredPopoverOptions {
  /** The component root. Its rect anchors the menu; clicks inside it don't close it. */
  anchorRef: Ref<HTMLElement | undefined>;
  /** The trigger button. Focus returns here on Escape / select. */
  triggerRef: Ref<HTMLElement | undefined>;
  /** The teleported menu element. Clicks inside it don't close it. */
  popoverRef: Ref<HTMLElement | null>;
  /** Selector for the focusable menu rows, used for roving arrow-key focus. */
  itemSelector: string;
  /**
   * Row index to focus on open (e.g. the active option). Default: the first row; a negative
   * index also lands on the first row, so a caller with no match should name a row itself.
   */
  initialFocusIndex?: () => number;
  /** Used until the menu has rendered and can be measured. */
  widthEstimate?: number;
  heightEstimate?: number;
  /**
   * Which trigger edge the menu lines up with: `'end'` (default) right-aligns it, the menu
   * idiom; `'start'` left-aligns it, for a picker that drops down from its pill.
   */
  align?: 'start' | 'end';
}

/**
 * A menu popover anchored to a trigger: teleported + fixed-position so a
 * clipping/scrolling ancestor can't cut it off (the overflow-safe idiom proven
 * on AssigneePickerButton 2026-05-21), right-aligned to the trigger (`align`), flipped up
 * when there's no room below, clamped to the viewport, re-positioned on
 * scroll/resize, closed on Escape (`useEscapeClose`) and on a click outside
 * both the anchor and the teleported menu, with ArrowUp/ArrowDown roving focus.
 *
 * The caller owns the three template refs and renders the trigger and the
 * `<Teleport to="body">` menu itself, binding `popoverStyle` (which carries the
 * position AND the z tier, `ANCHORED_POPOVER_Z_INDEX`) and `onMenuKeydown` onto
 * the menu element. Arrow keys typed into a field inside the menu are left alone.
 *
 * Composed from `useAnchoredPosition` (placement, scroll/resize follow, z tier),
 * `useOutsideClick` (capture-phase outside click, listening only while open) and
 * `useEscapeClose`, plus the roving focus that only a menu needs.
 *
 * TODO(consolidation): consumers are SortMenu and OverflowMenu. BeanHero's add menu is the
 * next one to migrate. `TimePickerHost` consumes the two extracted halves directly (its
 * Escape comes from `useAnchoredOverlay`). AssigneePickerButton, BaseCombobox,
 * BeanieDatePicker, InfoHintBadge and SaveStatusIndicator still hand-copy the outside-click
 * idiom; fold each into `useOutsideClick` (and `useAnchoredPosition` where it positions a
 * teleported popover) when it is next touched, extending the options rather than forking.
 */
export function useAnchoredPopover(options: AnchoredPopoverOptions) {
  const {
    anchorRef,
    triggerRef,
    popoverRef,
    itemSelector,
    initialFocusIndex,
    widthEstimate = 208,
    heightEstimate = 156,
    align = 'end',
  } = options;

  const show = ref(false);
  const { popoverStyle, reposition } = useAnchoredPosition({
    anchorRef,
    popoverRef,
    active: show,
    align,
    widthEstimate,
    heightEstimate,
  });

  // The menu is teleported to <body>, so it's outside the anchor: both count as inside.
  useOutsideClick(show, [anchorRef, popoverRef], () => {
    show.value = false;
  });

  function menuItems(): HTMLElement[] {
    if (!popoverRef.value) return [];
    return Array.from(popoverRef.value.querySelectorAll<HTMLElement>(itemSelector));
  }

  function open() {
    show.value = true;
    nextTick(() => {
      reposition();
      // Move focus into the menu so keyboard users land on a row.
      const items = menuItems();
      const idx = Math.max(0, initialFocusIndex?.() ?? 0);
      items.at(idx)?.focus();
    });
  }

  function close(returnFocus = false) {
    show.value = false;
    if (returnFocus) nextTick(() => triggerRef.value?.focus());
  }

  function toggle() {
    if (show.value) close();
    else open();
  }

  function onMenuKeydown(e: KeyboardEvent) {
    // A field inside the menu keeps its own arrow keys.
    if (isEditableTarget(e.target)) return;
    const items = menuItems();
    if (items.length === 0) return;
    const currentIdx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[currentIdx < 0 ? 0 : (currentIdx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[
        currentIdx < 0 ? items.length - 1 : (currentIdx - 1 + items.length) % items.length
      ]?.focus();
    }
  }

  useEscapeClose(show, () => close(true));

  return { show, popoverStyle, open, close, toggle, onMenuKeydown };
}
