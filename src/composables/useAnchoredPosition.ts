import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

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
  /**
   * Which side of the anchor the popover opens on: `'below'` (default) under it, flipped up when
   * there is no room below; `'start'` beside it on the left, level with it and clamped to the
   * viewport, for a popover opened from a narrow right-hand rail so it covers the page beside
   * the rail rather than the rail itself. With no room on the left, `'start'` falls back to
   * `'below'`. Read on every `reposition()`, so a getter can follow a layout change.
   */
  side?: MaybeRefOrGetter<'below' | 'start'>;
  widthEstimate?: number;
  heightEstimate?: number;
}

/**
 * Fixed-position placement for a teleported popover: under its anchor (`align` edge), flipped
 * up when there is no room below but there is above, clamped to the viewport, and painted at
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
    side = 'below',
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

    // Beside the anchor, on its left, when there is room there.
    const GAP = 12;
    if (toValue(side) === 'start' && rect.left - width - GAP >= MARGIN) {
      const centred = rect.top + rect.height / 2 - height / 2;
      const top = Math.max(MARGIN, Math.min(centred, window.innerHeight - height - MARGIN));
      popoverStyle.value = {
        position: 'fixed',
        top: `${top}px`,
        left: `${rect.left - width - GAP}px`,
        zIndex,
      };
      return;
    }

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
      top: `${Math.max(MARGIN, top)}px`,
      left: `${left}px`,
      zIndex,
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
