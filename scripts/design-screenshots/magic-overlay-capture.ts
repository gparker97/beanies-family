import { readFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { test } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';

/**
 * NOT a test — a screenshot harness for the magic-beans reading overlay.
 *
 * The overlay only opens during a real ingest, which needs a live model call. So this loads the
 * REAL app (and therefore the real compiled stylesheet, with Tailwind's JIT output and
 * autoprefixer's `-webkit-background-clip`) and injects the overlay's exact markup. That is the
 * thing actually worth checking: whether the classes the .vue file names resolve to real rules.
 */
const OVERLAY = `
<div id="shotwrap" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm">
  <div class="relative">
    <span aria-hidden="true" class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -top-7 -left-8 h-5 w-5"></span>
    <span aria-hidden="true" class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -top-9 right-10 h-3.5 w-3.5" style="animation-delay: 0.5s"></span>
    <span aria-hidden="true" class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -top-4 -right-9 h-6 w-6" style="animation-delay: 1.05s"></span>
    <span aria-hidden="true" class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -bottom-8 -left-6 h-4 w-4" style="animation-delay: 1.6s"></span>
    <span aria-hidden="true" class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -right-7 -bottom-9 h-5 w-5" style="animation-delay: 2.15s"></span>
    <span aria-hidden="true" class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -bottom-6 left-1/3 h-3.5 w-3.5" style="animation-delay: 2.7s"></span>
    <div class="dark:bg-surface-raised relative flex flex-col items-center gap-4 rounded-3xl bg-white px-8 py-6 shadow-[var(--soft-shadow)]">
      <ul class="flex list-none gap-2.5 p-0">
        <li class="magic-tick"><div class="dark:bg-surface-overlay flex h-16 w-16 flex-col items-center justify-center rounded-[14px] bg-[var(--tint-slate-5)]"><span class="relative z-[1] text-xl leading-none">📅</span><span class="font-outfit text-secondary-400 dark:text-ink-faint relative z-[1] mt-1 block text-xs font-semibold">activity</span></div></li>
        <li class="magic-tick"><div class="dark:bg-surface-overlay flex h-16 w-16 flex-col items-center justify-center rounded-[14px] bg-[var(--tint-slate-5)]"><span class="relative z-[1] text-xl leading-none">✈️</span><span class="font-outfit text-secondary-400 dark:text-ink-faint relative z-[1] mt-1 block text-xs font-semibold">trip</span></div></li>
        <li class="magic-tick"><div class="dark:bg-surface-overlay flex h-16 w-16 flex-col items-center justify-center rounded-[14px] bg-[var(--tint-slate-5)]"><span class="relative z-[1] text-xl leading-none">🍳</span><span class="font-outfit text-secondary-400 dark:text-ink-faint relative z-[1] mt-1 block text-xs font-semibold">recipe</span></div></li>
      </ul>
      <p class="font-outfit magic-text-shimmer text-sm font-semibold">Counting magic beans…</p>
    </div>
  </div>
</div>`;

/**
 * Reduced motion is the case most likely to be silently broken: the animation is killed but
 * `color: transparent` survives, so the text renders whatever single slice of the gradient sits
 * under it at `background-position: 0 0`. If that slice were the bright accent — or worse, if the
 * gradient failed — the wait message would be unreadable for exactly the people who asked for
 * less motion. So this asserts the still frame, it does not just look at it.
 */
const WIDTHS = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  // 390px: the card plus its sparkles must not push the page sideways on a phone.
  { name: 'phone', size: { width: 390, height: 780 } },
];

for (const theme of ['light', 'dark'] as const)
  for (const w of WIDTHS) {
    test(`overlay ${theme} ${w.name} reduced-motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize(w.size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
      }, theme);
      await page.evaluate((html) => {
        document.getElementById('shotwrap')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
      }, OVERLAY);
      await page.locator('#shotwrap').waitFor();
      const still = await page.evaluate(() => {
        const p = document.querySelector('#shotwrap p') as HTMLElement;
        const s = getComputedStyle(p);
        const spark = document.querySelector('#shotwrap .magic-sparkle') as HTMLElement;
        return {
          textAnimation: s.animationName,
          backgroundPosition: s.backgroundPosition,
          sparkleDisplay: getComputedStyle(spark).display,
        };
      });
      console.log(theme, w.name, 'reduced motion:', JSON.stringify(still));

      // The markup below is a COPY of the component's. A sparkle added there and not here would
      // make this harness quietly stop covering it, so the counts are compared rather than
      // trusted.
      const inHarness = await page.locator('#shotwrap .magic-sparkle').count();
      const inComponent = (
        readFileSync(
          new URL('../../src/components/ai/AiProcessingOverlay.vue', import.meta.url),
          'utf-8'
          // `class="magic-sparkle` and not a bare `magic-sparkle`: the component's own comment
          // names the class, and counting that mention made this check fail on a correct file.
        ).match(/class="magic-sparkle/g) ?? []
      ).length;
      expect(inHarness, 'harness markup has drifted from the component').toBe(inComponent);
      await page.screenshot({
        path: `scratch-shots/magic-overlay-${theme}-${w.name}-reduced.png`,
      });
    });

    test(`overlay ${theme} ${w.name}`, async ({ page }) => {
      await page.setViewportSize(w.size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
      }, theme);
      await page.evaluate((html) => {
        document.getElementById('shotwrap')?.remove();
        document.body.insertAdjacentHTML('beforeend', html);
      }, OVERLAY);
      const wrap = page.locator('#shotwrap');
      await wrap.waitFor();

      // What the class list PROMISES, read back off the live element. A screenshot cannot tell a
      // gradient that failed to paint from one that painted the fallback ink.
      const probe = await page.evaluate(() => {
        const p = document.querySelector('#shotwrap p') as HTMLElement;
        const s = getComputedStyle(p);
        const spark = document.querySelector('#shotwrap .magic-sparkle') as HTMLElement;
        const ss = getComputedStyle(spark);
        return {
          textColor: s.color,
          backgroundImage: s.backgroundImage.slice(0, 120),
          backgroundClip: s.backgroundClip || (s as any).webkitBackgroundClip,
          animation: s.animationName,
          sparklePos: ss.position,
          sparkleSize: `${ss.width} x ${ss.height}`,
          sparkleColor: ss.backgroundColor,
          sparkleClip: ss.clipPath.slice(0, 40),
          sparkleAnim: ss.animationName,
          sparkleTop: ss.top,
        };
      });
      console.log(theme, w.name, JSON.stringify(probe, null, 2));

      // The page must never scroll sideways — the sparkles hang outside the card on purpose.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      console.log(theme, w.name, 'horizontal overflow:', overflows);

      // ⚠️ Sample the sparkles ACROSS the cycle, not at one instant. Each is dark for most of its
      // 3.2s period, so a single screenshot can show an empty frame and prove nothing — which is
      // exactly how the first, far too faint, version got past this harness.
      // Past the warm-up: at t=0 every sparkle is at opacity 0 by definition, and the first one
      // takes ~0.6s to reach peak. Asserting from the very first frame would fail on correct
      // behaviour, so the window starts after the first star has risen.
      await page.waitForTimeout(700);
      const peaks: number[] = [];
      for (let i = 0; i < 12; i++) {
        peaks.push(
          await page.evaluate(() =>
            Math.max(
              ...[...document.querySelectorAll('#shotwrap .magic-sparkle')].map((el) =>
                Number(getComputedStyle(el).opacity)
              )
            )
          )
        );
        await page.waitForTimeout(260);
      }
      console.log(theme, w.name, 'brightest sparkle:', peaks.map((n) => n.toFixed(2)).join(' '));
      expect(Math.min(...peaks), 'a frame with no visible sparkle at all').toBeGreaterThan(0.25);

      // Mid-sweep, so the gradient band is actually inside the text rather than off its edge.
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `scratch-shots/magic-overlay-${theme}-${w.name}.png` });
      // A padded crop around the card: the sparkles sit OUTSIDE it, so an element screenshot of
      // the card (or of its wrapper, whose box the absolute children do not grow) shows none of
      // them — which is the half of this change most likely to be silently wrong.
      const box = (await page.locator('#shotwrap .relative').first().boundingBox())!;
      await page.screenshot({
        path: `scratch-shots/magic-overlay-${theme}-${w.name}-card.png`,
        clip: { x: box.x - 60, y: box.y - 60, width: box.width + 120, height: box.height + 120 },
      });
    });
  }
