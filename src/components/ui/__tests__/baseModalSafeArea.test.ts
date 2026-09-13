/**
 * Every viewport-height overlay must stay clear of the notch and home indicator.
 *
 * This has now been missed twice. `BaseSidePanel` got safe-area insets when its
 * close button turned out to be unreachable on a notched iPhone; `BaseModal` —
 * which every modal tier in the app wraps — did not, so the same close button sat
 * under the status bar in every fullscreen modal. The overlay has only `p-4`
 * (16px) around it, against a status-bar inset of roughly 47-59px.
 *
 * ⚠️ Why part of this reads the SOURCE rather than the rendered DOM: happy-dom
 * validates `padding` strictly and discards any value containing `env()`, so an
 * inset padding rule is literally absent from the test DOM (verified: it drops
 * both `env(...)` and `calc(env(...))`, while permitting them on `max-height`).
 * The rule is also a no-op on the web, where `env()` is 0. So there is no runtime
 * surface in CI on which this mistake is visible — which is exactly how it shipped
 * twice. A source assertion is the only thing that can catch the third.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

const h = vi.hoisted(() => ({ mobile: { value: true } as { value: boolean } }));
vi.mock('@/composables/useBreakpoint', () => ({ useBreakpoint: () => ({ isMobile: h.mobile }) }));
vi.mock('@/composables/useFullscreenOverlay', () => ({ useFullscreenOverlay: () => {} }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import BaseModal from '../BaseModal.vue';

const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf-8');

function mountModal(props: Record<string, unknown> = {}) {
  return mount(BaseModal, {
    props: { open: true, title: 'Hello', ...props },
    global: { stubs: { BeanieIcon: true, Teleport: true, Transition: false } },
  });
}
const dialogStyle = (w: ReturnType<typeof mountModal>) =>
  w.find('[role="dialog"]').attributes('style') ?? '';

beforeEach(() => {
  h.mobile = ref(true) as unknown as { value: boolean };
});

describe('a WINDOWED modal cannot reach the notch', () => {
  // Height-bounded rather than padded: padding a centred card would inset the
  // card's own contents. Renderable, because happy-dom permits env() here.
  it('🔴 subtracts both insets from its max height', () => {
    const style = dialogStyle(mountModal());
    expect(style).toContain('max-height');
    expect(style).toContain('safe-area-inset-top');
    expect(style).toContain('safe-area-inset-bottom');
  });

  it('🔴 carries no inset-blind max-height class to fight with it', () => {
    // The rule it replaced was `max-h-[calc(100vh-2rem)]`, which ignored the
    // insets. Two rules would win by source order rather than by intent.
    expect(mountModal().find('[role="dialog"]').classes().join(' ')).not.toContain('100vh');
  });

  it('is what a DESKTOP modal gets even when fullscreenMobile is set', () => {
    h.mobile = ref(false) as unknown as { value: boolean };
    expect(dialogStyle(mountModal({ fullscreenMobile: true }))).toContain('max-height');
  });

  it('is NOT what a fullscreen mobile modal gets', () => {
    // Anti-vacuity for the branch: proves the two shapes are actually distinct.
    expect(dialogStyle(mountModal({ fullscreenMobile: true }))).not.toContain('max-height');
  });

  it('🔴 never pads the SHELL, whose background would show through the band', () => {
    // The regression this replaced: a white/`surface-raised` strip across the top
    // and bottom of PhotoViewer's near-black, edge-to-edge photo view, and a
    // mismatched strip under every form modal's footer.
    const style = dialogStyle(mountModal({ fullscreenMobile: true }));
    expect(style).not.toContain('padding-top');
    expect(style).not.toContain('padding-bottom');
  });
});

describe('every full-height overlay declares its safe-area inset', () => {
  // See the file header for why this reads source. Each entry is a surface that
  // spans the viewport and puts something tappable at an edge.
  //
  // ⚠️ Each pattern binds the inset to the DECLARATION that consumes it, never
  // just to the token. Matching the bare token is not enough: deleting
  // `BaseModal`'s fullscreen padding leaves `safe-area-inset-top` in the file
  // anyway — in the windowed max-height and in the docstring — so a token-only
  // check passed the mutation that removed the fix. (It did; that is why this is
  // written as it is.)
  const SURFACES: Array<[file: string, needs: RegExp[]]> = [
    // The reported bug: the header X in a fullscreen modal.
    [
      'components/ui/BaseModal.vue',
      [
        // On the HEADER and FOOTER, never the shell: the shell paints its own
        // background, so an inset band there takes the wrong colour over any
        // consumer that paints its body (PhotoViewer, every BeanieFormModal).
        /fullscreenHeaderStyle[\s\S]{0,240}?paddingTop:\s*'calc\(1rem \+ env\(safe-area-inset-top/,
        /fullscreenFooterStyle[\s\S]{0,240}?paddingBottom:\s*'calc\(1rem \+ env\(safe-area-inset-bottom/,
      ],
    ],
    // Its sibling, fixed earlier — kept here so the pair cannot drift apart again.
    [
      'components/ui/BaseSidePanel.vue',
      [/paddingTop:\s*'env\(safe-area-inset-top/, /paddingBottom:\s*'env\(safe-area-inset-bottom/],
    ],
    // `inset-y-0` drawer whose close button is absolutely positioned at top-3, so
    // the inset has to ride on the button (absolute ignores parent padding).
    [
      'components/common/MobileHamburgerMenu.vue',
      [/top:\s*'calc\(0\.75rem \+ env\(safe-area-inset-top/],
    ],
    // Anchored 56px from the top, which is LESS than a notched inset.
    ['components/common/GlobalSearch.vue', [/paddingTop:\s*'env\(safe-area-inset-top/]],
    // Bottom-anchored beside QuickAddFab, which already accounts for the indicator.
    ['components/common/MobileNavBeanStack.vue', [/env\(safe-area-inset-bottom, 0px\) \+ 92px/]],
    // The FIRST screen of a fresh install, and the App Review path: a `fixed;
    // inset: 0` overlay with Back/Skip/Next on the bottom edge. Missed by the
    // first sweep because it is not a BaseModal/BaseSidePanel consumer.
    [
      'components/onboarding/OnboardingWizard.vue',
      [/padding:\s*env\(safe-area-inset-top/, /env\(safe-area-inset-bottom, 0px\)\)/],
    ],
    // The only CTA on a shared-recipe landing page, pinned to the bottom edge.
    ['pages/SharedRecipePage.vue', [/env\(safe-area-inset-bottom, 0px\)/]],
  ];

  it.each(SURFACES)('%s', (file, needs) => {
    const text = src(file);
    for (const pattern of needs) expect(text).toMatch(pattern);
  });

  it('🔴 the two bottom-anchored siblings use the SAME offset expression', () => {
    // `QuickAddFab` and `MobileNavBeanStack` hang off the same nav from the same
    // edge. The stack used a bare `92px` and sat over the home indicator.
    const expr = 'env(safe-area-inset-bottom, 0px) + 92px';
    expect(src('components/common/QuickAddFab.vue')).toContain(expr);
    expect(src('components/common/MobileNavBeanStack.vue')).toContain(expr);
  });
});
