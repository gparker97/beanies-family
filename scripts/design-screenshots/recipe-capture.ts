import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * Captures the REAL recipe screen for the share-to-beanies blog animation.
 *
 * The OS share sheet has to be illustrated — it is an operating-system surface no
 * browser can render — but the payoff frame, the recipe the reader is being promised,
 * should be the genuine article rather than a drawing of one.
 *
 *   npx playwright test -c playwright.design.config.ts recipe-capture
 */
const RECIPE_ID = '11111111-2222-4333-8444-555555555555';

test('capture the rendered recipe', async ({ page }) => {
  test.setTimeout(180_000);

  await gotoRoot(page);
  await new IndexedDBHelper(page).clearAllData();
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await gotoRoute(page, '/pod/cookbook');
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

  await page.evaluate(async (id) => {
    const bridge = (
      window as unknown as { __e2eDataBridge?: { seedData: (d: unknown) => Promise<void> } }
    ).__e2eDataBridge;
    const stamp = new Date().toISOString();
    await bridge?.seedData({
      recipes: [
        {
          id,
          name: 'Slow-Cooked Beef Ragu',
          subtitle: 'The one from the school fair pamphlet',
          prepTime: '20 min',
          cookTime: '3 hr',
          servings: '6',
          ingredients: [
            '1.2kg beef chuck, cut into large chunks',
            '2 tbsp olive oil',
            '1 onion, finely diced',
            '2 carrots, finely diced',
            '3 garlic cloves, crushed',
            '2 tbsp tomato purée',
            '400g tinned plum tomatoes',
            '250ml red wine',
            '2 bay leaves',
            'Pappardelle, to serve',
          ],
          steps: [
            'Season the beef well and brown in batches in a hot casserole. Set aside.',
            'Soften the onion and carrot in the same pan for 8 minutes.',
            'Stir in the garlic and tomato purée and cook for 2 minutes.',
            'Pour in the wine, scrape the base, and let it reduce by half.',
            'Return the beef with the tomatoes and bay. Cover and cook at 150°C for 3 hours.',
            'Shred the beef into the sauce and toss through cooked pappardelle.',
          ],
          notes: 'Better the next day. Freezes well in portions.',
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    });
    const sync = await import('/src/stores/syncStore.ts');
    await (sync as { useSyncStore: () => { reloadAllStores: () => Promise<void> } })
      .useSyncStore()
      .reloadAllStores();
  }, RECIPE_ID);

  await gotoRoute(page, `/pod/cookbook/${RECIPE_ID}`);
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);

  // Phone width — the animation is a phone story.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/recipe-phone.png' });
});
