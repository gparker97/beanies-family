import { ref, nextTick, onMounted, onUnmounted, type Ref } from 'vue';
import { useEscapeClose } from '@/composables/useEscapeClose';

/**
 * The z-index every anchored popover paints at: above every modal and drawer layer
 * (BaseModal `top` z-[250] and `gate` z-[260], BaseSidePanel up to z-[255], the onboarding
 * overlay at 200), below toasts (z-[270]) and the fatal / splash overlays (z-[300]). A
 * popover is transient and must show over whatever surface opened it: at a page-level tier
 * (z-50 / z-[70]) a picker opened inside the onboarding overlay rendered invisibly behind it.
 * It rides `popoverStyle`, so a consumer that binds the style cannot pick a different tier.
 */
export const ANCHORED_POPOVER_Z_INDEX = 265;

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
 * TODO(consolidation): consumers are SortMenu, OverflowMenu and TimePresetPicker. BeanHero's add
 * menu is the next one to migrate. AssigneePickerButton, BaseCombobox,
 * BeanieDatePicker, BeanieTimeInput and InfoHintBadge still carry their own copy
 * of this idiom (their anchoring differs: pickers/inputs, not menus); fold each
 * in when it's next touched, extending the options rather than forking.
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
  const popoverStyle = ref<Record<string, string>>({});

  function positionPopover() {
    if (!anchorRef.value) return;
    const rect = anchorRef.value.getBoundingClientRect();
    const height = popoverRef.value?.offsetHeight ?? heightEstimate;
    const width = popoverRef.value?.offsetWidth ?? widthEstimate;
    const MARGIN = 8;
    const spaceBelow = window.innerHeight - rect.bottom;

    // Flip up when there isn't room below but there is above.
    const dropUp = spaceBelow < height + 16 && rect.top > height + 16;
    const top = dropUp ? rect.top - height - 6 : rect.bottom + 6;

    // Anchor the menu to the trigger's `align` edge, then clamp to the viewport so a
    // trigger near the edge can't push the menu off-screen.
    let left = align === 'start' ? rect.left : rect.right - width;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    popoverStyle.value = {
      position: 'fixed',
      top: `${Math.max(MARGIN, top)}px`,
      left: `${left}px`,
      zIndex: String(ANCHORED_POPOVER_Z_INDEX),
    };
  }

  function menuItems(): HTMLElement[] {
    if (!popoverRef.value) return [];
    return Array.from(popoverRef.value.querySelectorAll<HTMLElement>(itemSelector));
  }

  function open() {
    show.value = true;
    nextTick(() => {
      positionPopover();
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
    // A field inside the menu (TimePresetPicker's custom time) keeps its own arrow keys.
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

  function onDocClick(e: MouseEvent) {
    const target = e.target as Node;
    // The menu is teleported to <body>, so it's outside the anchor — check it too.
    if (anchorRef.value?.contains(target) || popoverRef.value?.contains(target)) return;
    show.value = false;
  }

  function handleViewportChange() {
    if (show.value) positionPopover();
  }

  onMounted(() => {
    document.addEventListener('click', onDocClick);
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
  });
  onUnmounted(() => {
    document.removeEventListener('click', onDocClick);
    window.removeEventListener('scroll', handleViewportChange, true);
    window.removeEventListener('resize', handleViewportChange);
  });

  return { show, popoverStyle, open, close, toggle, onMenuKeydown };
}
