import { onScopeDispose, ref, watch, type Ref } from 'vue';

/**
 * The z-index every anchored popover paints at: above every modal and drawer layer
 * (BaseModal `top` z-[250] and `gate` z-[260], BaseSidePanel up to z-[255], the onboarding
 * overlay at 200), below toasts (z-[270]) and the fatal / splash overlays (z-[300]). A
 * popover is transient and must show over whatever surface opened it: at a page-level tier
 * (z-50 / z-[70]) a picker opened inside the onboarding overlay rendered invisibly behind it.
 * It rides `popoverStyle`, so a consumer that binds the style cannot pick a different tier.
 *
 * Re-exported from `useAnchoredPopover`, where its importers find it.
 */
export const ANCHORED_POPOVER_Z_INDEX = 265;

export interface AnchoredPositionOptions {
  /** The element the popover hangs from. Empty → `reposition()` is a silent no-op. */
  anchorRef: Readonly<Ref<HTMLElement | null | undefined>>;
  /** The (teleported) popover; measured once rendered, the estimates are used until then. */
  popoverRef: Readonly<Ref<HTMLElement | null | undefined>>;
  /** While true, the popover follows its anchor on scroll and resize. */
  active: Readonly<Ref<boolean>>;
  /**
   * Which anchor edge the popover lines up with: `'end'` (default) right-aligns it, the menu
   * idiom; `'start'` left-aligns it, for a picker that drops down from its pill.
   */
  align?: 'start' | 'end';
  widthEstimate?: number;
  heightEstimate?: number;
}

/**
 * Fixed-position placement for a teleported popover: under its anchor (`align` edge), flipped
 * up when there is no room below but there is above, clamped to the viewport on every edge (a
 * card with room neither below nor above shifts up until its bottom fits; one taller than the
 * viewport is pinned to the top margin with a `maxHeight` of the room, so its own overflow
 * scrolls), and painted at
 * `ANCHORED_POPOVER_Z_INDEX`. Teleport + fixed is the overflow-safe idiom (proven on
 * AssigneePickerButton 2026-05-21): a clipping or scrolling ancestor cannot cut it off.
 *
 * Bind `popoverStyle` onto the popover element and call `reposition()` once it has rendered
 * (and whenever its size changes). Scroll (capture, so any scrolling ancestor counts) and
 * resize listeners reposition it while `active`; they are attached only then.
 *
 * The positioning half of `useAnchoredPopover`, extracted so `TimePickerHost` can place its
 * card without a second Escape registration (it gets Escape from `useAnchoredOverlay`).
 */
export function useAnchoredPosition(options: AnchoredPositionOptions) {
  const {
    anchorRef,
    popoverRef,
    active,
    align = 'end',
    widthEstimate = 208,
    heightEstimate = 156,
  } = options;

  const popoverStyle = ref<Record<string, string>>({});

  function reposition(): void {
    if (!anchorRef.value) return;
    const rect = anchorRef.value.getBoundingClientRect();
    const height = popoverRef.value?.offsetHeight ?? heightEstimate;
    const width = popoverRef.value?.offsetWidth ?? widthEstimate;
    const MARGIN = 8;
    const zIndex = String(ANCHORED_POPOVER_Z_INDEX);
    const room = window.innerHeight - 2 * MARGIN;
    // A card as tall as the viewport (or taller) is pinned to the margin and capped at the room
    // there, so its own overflow scrolls instead of running off the bottom of the screen.
    const cap: Record<string, string> = height >= room ? { maxHeight: `${room}px` } : {};
    /** Keep the whole card on screen: shift it up to fit, never above the top margin. */
    const fit = (top: number) =>
      Math.max(MARGIN, Math.min(top, window.innerHeight - height - MARGIN));

    const spaceBelow = window.innerHeight - rect.bottom;

    // Flip up when there isn't room below but there is above.
    const dropUp = spaceBelow < height + 16 && rect.top > height + 16;
    const top = dropUp ? rect.top - height - 6 : rect.bottom + 6;

    // Anchor to the `align` edge, then clamp to the viewport so an anchor near the edge
    // can't push the popover off-screen.
    let left = align === 'start' ? rect.left : rect.right - width;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    popoverStyle.value = {
      position: 'fixed',
      top: `${fit(top)}px`,
      left: `${left}px`,
      zIndex,
      ...cap,
    };
  }

  let listening = false;

  function attach(): void {
    if (listening) return;
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    listening = true;
  }

  function detach(): void {
    if (!listening) return;
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
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

  return { popoverStyle, reposition };
}
