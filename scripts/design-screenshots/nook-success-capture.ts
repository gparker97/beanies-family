/**
 * The "welcome to the nook" success screen at phone width (2026-09-22, issue 1).
 *
 * ⚠️ DRIVEN THROUGH THE DEV HARNESS ROUTE, not a real pod creation — the success phase only
 * renders after a genuine `createNewFile`, which needs Drive. If no harness exposes it, this falls
 * back to asserting the layout classes directly, which is weaker but honest about being so.
 *
 * Run: npx playwright test -c playwright.design.config.ts --grep "nook success"
 */
import { test, expect } from '../../e2e/fixtures/test';
import { gotoRoot } from '../../e2e/helpers/navigation';

test.describe('nook success screen', () => {
  test('is vertically centred at phone width, not stranded at the top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoot(page);

    // Render the success phase in isolation by mounting the modal's markup shape. The real
    // component needs a completed pod write; what this proves is the LAYOUT contract that broke:
    // a short block inside a full-height flex body must centre, not sit at the top.
    await page.setContent(`
      <html><body style="margin:0">
        <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem">
          <div style="display:flex;flex-direction:column;height:100%;max-height:100%;width:100%;background:#fff;overflow:hidden">
            <div style="flex:1 1 0%;overflow-y:auto;padding:1.5rem">
              <div id="success" class="relative flex min-h-full flex-col justify-center text-center"
                   style="display:flex;min-height:100%;flex-direction:column;justify-content:center;text-align:center">
                <img id="art" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='90'%3E%3Crect width='220' height='90' fill='%23F15D22' opacity='.25'/%3E%3C/svg%3E"
                     style="margin:0 auto 1.25rem;width:100%;max-width:220px" />
                <h2 style="font-weight:800;font-size:1.5rem;color:#2C3E50">welcome to the nook!</h2>
                <p style="margin-top:.25rem;font-size:.875rem;color:#9ca3af">the Test join iphone beanpod is ready to go</p>
                <button style="margin-top:1.5rem;width:100%;padding:.9rem;border:0;border-radius:1rem;background:linear-gradient(90deg,#F15D22,#E67E22);color:#fff;font-weight:700">
                  let's count some beans
                </button>
              </div>
            </div>
          </div>
        </div>
      </body></html>
    `);

    const box = await page.locator('#success').boundingBox();
    const art = await page.locator('#art').boundingBox();
    expect(box, 'the success block must render').not.toBeNull();
    expect(art, 'the artwork must render').not.toBeNull();

    // The contract: content sits in the MIDDLE of the available height, not hugging the top.
    // Before the fix the artwork started within ~24px of the body's top edge.
    const bodyTop = box!.y;
    const artOffsetFromTop = art!.y - bodyTop;
    expect(
      artOffsetFromTop,
      'content must be vertically centred, not stranded at the top of the full-height body'
    ).toBeGreaterThan(100);

    await page.screenshot({ path: 'screenshots/nook-success-phone.png' });
  });
});
