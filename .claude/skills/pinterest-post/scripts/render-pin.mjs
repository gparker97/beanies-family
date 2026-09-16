#!/usr/bin/env node
/**
 * render-pin.mjs — render a filled beanies pin HTML to a 1000x1500 @2x PNG.
 *
 * Usage:
 *   node .claude/skills/pinterest-post/scripts/render-pin.mjs <input.html> <output.png>
 *
 * - Loads the HTML in headless Chromium at a 1000x1500 viewport, deviceScaleFactor 2,
 *   so the saved PNG is 2000x3000 (the @2x export Pinterest recommends; well under 20 MB).
 * - Rewrites the {{ASSET_BASE}} token to an absolute file:// path pointing at
 *   packages/brand/assets, the ONE home for beanies media, so every graphic is
 *   reachable without a server. Reference them by subfolder:
 *     {{ASSET_BASE}}/shared/…     mascots, logos, celebration art, icons
 *     {{ASSET_BASE}}/marketing/…  pricing heroes, the reading hero, store art
 *     {{ASSET_BASE}}/blog/…       per-post images, for pin-to-post continuity
 *   It used to point at web/public/brand, which held less than half the set and
 *   is now generated output. That single line is why every early pin reached for
 *   the same two or three mascots.
 * - Fails loudly if an <img> 404s, rather than shipping a pin with a hole in it.
 * - Waits for fonts + images to settle before the screenshot.
 *
 * Requires Playwright (already a dev dependency of this repo). If Chromium is not
 * installed, run: npx playwright install chromium
 */
import process from 'node:process';
import { chromium } from 'playwright';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node render-pin.mjs <input.html> <output.png>');
  process.exit(1);
}

// repo root = four levels up from this script (.claude/skills/pinterest-post/scripts)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const assetRoot = path.join(repoRoot, 'packages/brand/assets');
if (!existsSync(assetRoot)) {
  console.error(`No brand assets at ${assetRoot}. Nothing to render against.`);
  process.exit(1);
}
const assetBase = pathToFileURL(assetRoot).href;

let html = await readFile(inPath, 'utf8');
html = html.replaceAll('{{ASSET_BASE}}', assetBase);

// Write the substituted HTML next to the input so it loads from a file:// origin
// (Chromium allows file:// subresources only from a file:// document, not about:blank).
const tmpPath = path.resolve(inPath).replace(/\.html?$/i, '') + '.rendered.html';
await writeFile(tmpPath, html, 'utf8');

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 1500 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(tmpPath).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300); // let webfonts paint

  // A file:// image that does not exist fails SILENTLY: the layout still renders,
  // the pin just has a hole where the art should be, and it looks plausible in a
  // thumbnail. Ask the DOM which images actually decoded rather than trusting the
  // screenshot to look wrong.
  const broken = await page.evaluate(() =>
    [...document.images]
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.getAttribute('src'))
  );
  if (broken.length) {
    console.error(`Refusing to write ${outPath} — ${broken.length} image(s) failed to load:`);
    for (const src of broken) console.error(`  ${src}`);
    console.error('Check the path against packages/brand/assets (shared/ marketing/ blog/).');
    process.exit(1);
  }

  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1000, height: 1500 } });
  console.log(`rendered ${outPath} (2000x3000 @2x)`);
} finally {
  await browser.close();
  await unlink(tmpPath).catch(() => {});
}
