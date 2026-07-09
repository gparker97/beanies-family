/**
 * Synthetic cursor for the promo recording.
 *
 * Playwright's video capture renders no pointer and no click feedback, so a
 * raw recording reads as a glitchy screen-grab: buttons change state with
 * nothing visibly causing it. This injects a DOM cursor that follows the
 * programmatic mouse and pulses on click.
 *
 * Recording-only. Never imported by the app or the E2E suite.
 */
import type { Page } from '@playwright/test';

export async function installCursor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const draw = () => {
      if (document.getElementById('__promo_cursor')) return;
      const el = document.createElement('div');
      el.id = '__promo_cursor';
      el.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'width:22px',
        'height:22px',
        'border-radius:50%',
        'background:rgba(241,93,34,0.28)',
        'border:2px solid #F15D22',
        'box-shadow:0 2px 10px rgba(44,62,80,0.28)',
        'pointer-events:none',
        'z-index:2147483647',
        'transform:translate(-50%,-50%)',
        'transition:width .12s ease,height .12s ease,background .12s ease',
      ].join(';');
      document.body.appendChild(el);

      window.addEventListener(
        'mousemove',
        (e) => {
          el.style.left = `${e.clientX}px`;
          el.style.top = `${e.clientY}px`;
        },
        true
      );
      const pulse = (down: boolean) => {
        el.style.width = down ? '34px' : '22px';
        el.style.height = down ? '34px' : '22px';
        el.style.background = down ? 'rgba(241,93,34,0.5)' : 'rgba(241,93,34,0.28)';
      };
      window.addEventListener('mousedown', () => pulse(true), true);
      window.addEventListener('mouseup', () => pulse(false), true);
    };
    if (document.body) draw();
    else document.addEventListener('DOMContentLoaded', draw);
  });
}

/** Move the pointer in eased steps so the recorded motion reads as human. */
export async function glideTo(page: Page, x: number, y: number, steps = 24): Promise<void> {
  await page.mouse.move(x, y, { steps });
}

/** Glide onto an element's centre, then click it. */
export async function glideClick(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`glideClick: no bounding box for ${selector}`);
  await glideTo(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(220); // settle before the click reads on camera
  await page.locator(selector).first().click();
}
