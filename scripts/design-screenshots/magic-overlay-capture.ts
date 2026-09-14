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
    <span aria-hidden="true" class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -top-4 -left-5 h-3.5 w-3.5"></span>
    <span aria-hidden="true" class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -top-2 -right-6 h-2.5 w-2.5" style="animation-delay: 0.65s"></span>
    <span aria-hidden="true" class="magic-sparkle text-terracotta-400 dark:text-terracotta-lift pointer-events-none -bottom-5 -left-3 h-2.5 w-2.5" style="animation-delay: 1.3s"></span>
    <span aria-hidden="true" class="magic-sparkle text-primary-500 dark:text-accent-lift pointer-events-none -right-4 -bottom-3 h-3 w-3" style="animation-delay: 1.95s"></span>
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

      // Mid-sweep, so the gradient band is actually inside the text rather than off its edge.
      await page.waitForTimeout(1400);
      await page.screenshot({ path: `scratch-shots/magic-overlay-${theme}-${w.name}.png` });
      // A padded crop around the card: the sparkles sit OUTSIDE it, so an element screenshot of
      // the card (or of its wrapper, whose box the absolute children do not grow) shows none of
      // them — which is the half of this change most likely to be silently wrong.
      const box = (await page.locator('#shotwrap .relative').first().boundingBox())!;
      await page.screenshot({
        path: `scratch-shots/magic-overlay-${theme}-${w.name}-card.png`,
        clip: { x: box.x - 40, y: box.y - 40, width: box.width + 80, height: box.height + 80 },
      });
    });
  }
