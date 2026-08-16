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
 *   web/public/brand so local brand images load without a server.
 * - Waits for fonts + images to settle before the screenshot.
 *
 * Requires Playwright (already a dev dependency of this repo). If Chromium is not
 * installed, run: npx playwright install chromium
 */
import process from 'node:process';
import { chromium } from 'playwright';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node render-pin.mjs <input.html> <output.png>');
  process.exit(1);
}

// repo root = four levels up from this script (.claude/skills/pinterest-post/scripts)
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const assetBase = pathToFileURL(path.join(repoRoot, 'web/public/brand')).href;

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
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 1000, height: 1500 } });
  console.log(`rendered ${outPath} (2000x3000 @2x)`);
} finally {
  await browser.close();
  await unlink(tmpPath).catch(() => {});
}
