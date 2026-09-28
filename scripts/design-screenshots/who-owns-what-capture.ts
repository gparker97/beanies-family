import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for Who Owns What (#109). Named after the feature so later
 * Who Owns What work extends it. First written for the card art
 * (docs/plans/2026-09-28-who-owns-what-card-art.md). Lives OUTSIDE `e2e/specs/` on purpose
 * (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "who owns what walk"
 */

const SHOTS = 'scratch-shots/who-owns-what';
const ART = 'img[src^="/brand/cards/"]';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(300);
}

/** Every visible card-art image in `scope`: its file and whether it actually decoded. */
async function artIn(page: Page, scope = 'body') {
  await page.waitForTimeout(400);
  return page.locator(`${scope} ${ART}`).evaluateAll((imgs) =>
    (imgs as HTMLImageElement[])
      .filter((i) => i.getBoundingClientRect().width > 0)
      .map((i) => ({
        file: i.getAttribute('src')!.split('/').pop(),
        loaded: i.complete && i.naturalWidth > 0,
        w: Math.round(i.getBoundingClientRect().width),
        filter: getComputedStyle(i).filter,
        opacity: getComputedStyle(i).opacity,
      }))
  );
}

async function view(page: Page, key: 'overview' | 'deal' | 'deck') {
  await page
    .getByTestId('who-owns-what-views')
    .getByRole('button', { name: ui(`whoOwnsWhat.view.${key}`) })
    .click();
  await page.waitForTimeout(500);
}

test('who owns what walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[console.${m.type()}] ${m.text()}`);
  });

  // ── Desktop: deal a few cards ────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0]!;
  const ownerId = owner.id;
  // Two more beans, so the board has someone holding nothing (the idle strip).
  const now = new Date().toISOString();
  const bean = (id: string, name: string, color: string, ageGroup: 'adult' | 'child') =>
    ({
      id,
      name,
      color,
      ageGroup,
      email: `${id}@example.test`,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    }) as never;
  await db.seedData({
    familyMembers: [
      owner,
      bean('e2e-sofia', 'Sofia', '#ec4899', 'adult'),
      bean('e2e-mia', 'Mia', '#10b981', 'child'),
    ],
  });

  await gotoRoute(page, '/who-owns-what');
  await page.getByTestId('first-deal-start').click();
  await page.getByTestId('deal-pile').waitFor();
  const pileArt = await artIn(page, '[data-testid="deal-pile"]');
  console.log('[walk] pile art (cooking-dinner first):', JSON.stringify(pileArt));
  expect(pileArt.some((a) => a.file === 'cooking-dinner.webp' && a.loaded)).toBe(true);
  await shot(page, '01-desktop-pile-light');
  await setDark(page, true);
  await shot(page, '02-desktop-pile-dark');
  await setDark(page, false);

  const keepTo = async (memberId: string) => {
    await page.getByTestId('deal-pile-keep').click();
    await page.getByTestId(`deal-pick-${memberId}`).click();
    await page.waitForTimeout(700);
  };
  const skip = async () => {
    await page.getByTestId('deal-pile-skip').click();
    await page.waitForTimeout(700);
  };
  const keepForLater = async () => {
    await page.getByTestId('deal-pile-keep').click();
    await page.getByRole('button', { name: ui('whoOwnsWhat.pile.decideLater') }).click();
    await page.waitForTimeout(700);
  };
  // cooking-dinner → owner, breakfast skip, dishes skip, laundry kept with nobody,
  // floors skip, sparkling-bathrooms skip, trash-night skipped (a skipped hero).
  await keepTo(ownerId);
  await skip();
  await skip();
  await keepForLater();
  await skip();
  await skip();
  await skip();
  await shot(page, '03-desktop-pile-lists-light');
  console.log('[walk] pile + lists art:', JSON.stringify(await artIn(page)));

  // ── Overview ────────────────────────────────────────────────────────────
  await view(page, 'overview');
  await page.getByTestId('deck-overview').waitFor();
  console.log('[walk] overview art:', JSON.stringify(await artIn(page)));
  await shot(page, '04-desktop-overview-light');
  await setDark(page, true);
  await shot(page, '05-desktop-overview-dark');
  await setDark(page, false);

  // Check-in drawer (only reachable when a rhythm is set).
  const startCheckIn = page.getByTestId('check-in-start');
  if (await startCheckIn.isVisible()) {
    await startCheckIn.click();
    await page.waitForTimeout(800);
    console.log('[walk] check-in art:', JSON.stringify(await artIn(page)));
    await shot(page, '06-desktop-checkin-light');
    await page.keyboard.press('Escape');
  } else {
    console.log('[walk] check-in: no rhythm set, check-in drawer not reachable here');
  }

  // ── Deck: tiles, ghosting ───────────────────────────────────────────────
  await view(page, 'deck');
  const deckArt = await artIn(page);
  console.log('[walk] deck art:', JSON.stringify(deckArt));
  const laundry = deckArt.find((a) => a.file === 'laundry.webp');
  const cooking = deckArt.find((a) => a.file === 'cooking-dinner.webp');
  console.log('[walk] ghost check laundry (open):', JSON.stringify(laundry));
  console.log('[walk] ghost check cooking (held):', JSON.stringify(cooking));
  expect(laundry?.filter).toContain('grayscale');
  expect(cooking?.filter).not.toContain('grayscale');
  await shot(page, '07-desktop-deck-light');
  await setDark(page, true);
  await shot(page, '08-desktop-deck-dark');
  await setDark(page, false);

  await expect(page.getByTestId('who-owns-what-share')).toBeVisible();
  // ── Drawers (before the Skipped filter, which the Deck then keeps) ───────
  await page.getByTestId('card-open-cooking-dinner').click();
  await page.getByTestId('card-view-name').waitFor();
  const viewHeader = await artIn(page, '[role="dialog"]');
  console.log('[walk] view drawer art:', JSON.stringify(viewHeader));
  expect(viewHeader.some((a) => a.file === 'cooking-dinner.webp' && a.loaded)).toBe(true);
  await shot(page, '10-desktop-view-drawer-light');
  await page.getByTestId('card-view-edit').click();
  await page.waitForTimeout(700);
  const editHeader = await artIn(page, '[role="dialog"]');
  console.log('[walk] edit drawer art:', JSON.stringify(editHeader));
  expect(editHeader.some((a) => a.file === 'cooking-dinner.webp')).toBe(true);
  await setDark(page, true);
  await shot(page, '11-desktop-edit-drawer-dark');
  await setDark(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Skipped hero, ghosted.
  await view(page, 'overview');
  await page.getByTestId('overview-see-skipped').click();
  await page.waitForTimeout(600);
  const skippedArt = await artIn(page);
  console.log('[walk] skipped deck art:', JSON.stringify(skippedArt));
  expect(skippedArt.find((a) => a.file === 'trash-night.webp')?.filter).toContain('grayscale');
  await shot(page, '09-desktop-deck-skipped-light');

  // ── Board: art on the rail and chips, drag by the art ───────────────────
  await gotoRoute(page, '/who-owns-what');
  await view(page, 'deal');
  // Card by Card | Board View is a pill switch now; Share / Export show on every view.
  await expect(page.getByTestId('who-owns-what-share')).toBeVisible();
  await page.getByTestId('deal-mode-board').click();
  await page.getByTestId('deal-board').waitFor();
  await shot(page, '11b-deal-mode-switch-light');
  await setDark(page, true);
  await shot(page, '11c-deal-mode-switch-dark');
  await setDark(page, false);
  console.log('[walk] board art:', JSON.stringify(await artIn(page, '[data-testid="deal-board"]')));
  await shot(page, '12-desktop-board-light');

  const railArt = page.getByTestId('deal-rail-grocery-shopping').locator('img');
  await railArt.scrollIntoViewIfNeeded();
  await railArt.dragTo(page.getByTestId(`deal-row-${ownerId}`));
  await page.waitForTimeout(900);
  const chip = page.locator(`[data-testid^="deal-chip-${ownerId}-"]`, {
    has: page.locator('img[src$="grocery-shopping.webp"]'),
  });
  const chipCount = await chip.count();
  console.log('[walk] rail drag by art → owner chip count:', chipCount);
  expect(chipCount).toBe(1);

  await chip.locator('img').dragTo(page.getByTestId('deal-row-skipped'));
  await page.waitForTimeout(900);
  await page.getByTestId('deal-skipped-toggle').dispatchEvent('click');
  const skippedChip = page.locator('[data-testid^="deal-chip-skipped-"]', {
    has: page.locator('img[src$="grocery-shopping.webp"]'),
  });
  const skippedCount = await skippedChip.count();
  console.log('[walk] chip drag by art → skipped chip count:', skippedCount);
  expect(skippedCount).toBe(1);
  await setDark(page, true);
  await shot(page, '13-desktop-board-dark');
  await setDark(page, false);

  // ── Board layout: fills the page, idle beans fold, Skipped folds ────────
  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const box = await page.getByTestId('deal-board').boundingBox();
    const main = await page.locator('main').boundingBox();
    const gap = Math.round(main!.y + main!.height - (box!.y + box!.height));
    console.log(
      `[walk] board ${w}x${h}: top ${Math.round(box!.y)}, height ${Math.round(box!.height)}, gap to main bottom ${gap}`
    );
    expect(gap).toBeLessThanOrEqual(32);
    const strip = page.getByTestId('deal-idle-strip');
    await expect(strip).toBeInViewport();
    await shot(page, `20-board-${w}-light`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const skippedGridOpen = await page.getByTestId('deal-skipped-grid').isVisible();
  if (skippedGridOpen) await page.getByTestId('deal-skipped-toggle').dispatchEvent('click');
  await expect(page.getByTestId('deal-skipped-grid')).toHaveCount(0);

  // Deal a first card to Sofia by dropping it on her idle face: she gets a lane.
  // Home Supplies (unsorted): Laundry stays waiting for the phone pile check below.
  const railCard = page.getByTestId('deal-rail-home-supplies');
  await railCard.dragTo(page.getByTestId('deal-row-e2e-sofia'));
  await page.waitForTimeout(900);
  const sofiaTag = await page.getByTestId('deal-row-e2e-sofia').evaluate((el) => el.tagName);
  console.log('[walk] Sofia after a drop on her idle face:', sofiaTag);
  expect(sofiaTag).toBe('SECTION');
  await expect(page.getByTestId('deal-row-e2e-mia')).toBeVisible();
  // A full deck: deal ~25 cards to one person by tapping. Lanes must grow, never spill
  // their last row into the next lane (greg, 2026-09-28: flex items shrank below content).
  for (let i = 0; i < 25; i++) {
    // Laundry stays waiting: the phone pile check below deals it.
    const rail = page
      .locator('[data-testid^="deal-rail-"]:not([data-testid="deal-rail-laundry"])')
      .first();
    if (!(await rail.count())) break;
    await rail.click();
    await page.getByTestId(`deal-board-pick-${ownerId}`).click();
    await page.waitForTimeout(250);
  }
  const lanes = await page.locator('[data-testid="deal-lanes"] > section').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, overflow: el.scrollHeight - el.clientHeight };
    })
  );
  const overlaps = lanes.slice(1).filter((l, i) => l.top < lanes[i]!.bottom - 1).length;
  const spilled = lanes.filter((l) => l.overflow > 1).length;
  console.log(`[walk] full deck: ${lanes.length} lanes, overlaps ${overlaps}, spilled ${spilled}`);
  expect(overlaps).toBe(0);
  expect(spilled).toBe(0);
  await shot(page, '20c-board-full-deck-light');
  await setDark(page, true);
  await shot(page, '21-board-1440-dark');
  await setDark(page, false);

  // The Skipped toggle is reachable: not under the Quick Add button.
  const toggleBox = await page.getByTestId('deal-skipped-toggle').boundingBox();
  const fabBox = await page.getByRole('button', { name: 'Quick add' }).boundingBox();
  const overlap =
    !!toggleBox &&
    !!fabBox &&
    toggleBox.x < fabBox.x + fabBox.width &&
    toggleBox.x + toggleBox.width > fabBox.x &&
    toggleBox.y < fabBox.y + fabBox.height &&
    toggleBox.y + toggleBox.height > fabBox.y;
  console.log('[walk] skipped toggle overlaps the Quick Add button:', overlap);
  expect(overlap).toBe(false);
  await page.getByTestId('deal-skipped-toggle').click();
  await expect(page.getByTestId('deal-skipped-grid')).toBeVisible();
  await shot(page, '21b-board-skipped-open-light');
  await page.getByTestId('deal-skipped-toggle').click();

  // The card in hand from a board lane (the list is that lane).
  await page.locator(`[data-testid^="deal-chip-${ownerId}-"]`).first().click();
  await page.locator('[data-testid^="card-view-card-"]').waitFor();
  console.log(
    '[walk] lane drawer position shown:',
    await page.getByTestId('card-view-position').count(),
    '| history rows:',
    await page.locator('[data-testid="card-view-history"] li').count()
  );
  await shot(page, '22-drawer-from-lane-light');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // From the Deck: arrows, ← →, and the card changes.
  await view(page, 'deck');
  await page.getByTestId('card-open-cooking-dinner').click();
  await page.getByTestId('card-view-card-cooking-dinner').waitFor();
  const pos1 = await page.getByTestId('card-view-position').innerText();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const pos2 = await page.getByTestId('card-view-position').innerText();
  console.log('[walk] deck drawer position, then after →:', pos1, '|', pos2);
  expect(pos2).not.toBe(pos1);
  await page.getByTestId('card-view-prev').click();
  await page.getByTestId('card-view-card-cooking-dinner').waitFor();
  await shot(page, '23-drawer-deck-light');
  await setDark(page, true);
  await shot(page, '24-drawer-deck-dark');
  await setDark(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── Phone ───────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 400, height: 860 });
  await gotoRoute(page, '/who-owns-what');
  await view(page, 'deal');
  await page.getByTestId('deal-pile').waitFor();
  const phonePile = await artIn(page, '[data-testid="deal-pile"]');
  console.log('[walk] phone pile art:', JSON.stringify(phonePile));
  await shot(page, '14-phone-pile-light');
  await setDark(page, true);
  await shot(page, '15-phone-pile-dark');
  await view(page, 'deck');
  await shot(page, '16-phone-deck-dark');
  await view(page, 'overview');
  await shot(page, '17-phone-overview-dark');
  await setDark(page, false);

  // Phone drawer: the card in hand at pile size, swipe to the next card.
  await view(page, 'deck');
  await page.getByTestId('card-open-cooking-dinner').click();
  await page.getByTestId('card-view-card-cooking-dinner').waitFor();
  await page.waitForTimeout(500);
  const cardEl = page.getByTestId('card-view-card-cooking-dinner');
  const cardBox = await cardEl.boundingBox();
  const cy = cardBox!.y + cardBox!.height / 2;
  // A mouse drag must NOT flip the card (it selects text on a desktop).
  await page.mouse.move(cardBox!.x + cardBox!.width - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cardBox!.x + 10, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await cardEl.count()).toBe(1);
  // A touch swipe does.
  const touch = (type: string, x: number) =>
    cardEl.dispatchEvent(type, {
      pointerType: 'touch',
      pointerId: 7,
      isPrimary: true,
      clientX: x,
      clientY: cy,
      bubbles: true,
    });
  await touch('pointerdown', cardBox!.x + cardBox!.width - 20);
  await touch('pointermove', cardBox!.x + cardBox!.width - 60);
  await touch('pointermove', cardBox!.x + 20);
  await touch('pointerup', cardBox!.x + 10);
  await page.waitForTimeout(500);
  const swiped = await page.getByTestId('card-view-card-cooking-dinner').count();
  console.log('[walk] phone touch swipe left moved off cooking-dinner:', swiped === 0);
  expect(swiped).toBe(0);
  await shot(page, '25-phone-drawer-light');
  await setDark(page, true);
  await shot(page, '26-phone-drawer-dark');
  await setDark(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await view(page, 'overview');

  // A hero on the phone pile: the art must sit inside the slab, not be clipped by it.
  await page.getByTestId('overview-deal-laundry').click();
  await page.getByTestId('deal-pile-card-laundry').waitFor();
  const fit = await page.getByTestId('deal-pile-card-laundry').evaluate((cardEl) => {
    const slab = cardEl.querySelector('.slab')!.getBoundingClientRect();
    const img = cardEl.querySelector('img')!.getBoundingClientRect();
    return {
      slabH: Math.round(slab.height),
      imgH: Math.round(img.height),
      inside: img.top >= slab.top && img.bottom <= slab.bottom,
    };
  });
  console.log('[walk] phone pile hero fit:', JSON.stringify(fit));
  expect(fit.inside).toBe(true);
  await page.getByTestId('deal-pile-card-laundry').scrollIntoViewIfNeeded();
  await shot(page, '19-phone-pile-hero-light');

  // ── Nav: The Bean Pod anchor still renders (NavGlyph → ImageGlyph) ──────
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoRoute(page, '/nook');
  const anchor = page.locator('aside nav button[aria-expanded] img');
  await expect(anchor).toHaveCount(1);
  const natural = await anchor.evaluate((img: HTMLImageElement) => img.naturalWidth);
  console.log('[walk] pod anchor naturalWidth:', natural);
  expect(natural).toBeGreaterThan(0);
  await shot(page, '18-desktop-nav-light');
});
