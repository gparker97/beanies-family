#!/usr/bin/env node
/**
 * Writes the native weather glyph assets (#134 Phase 2, P2.4) from the one geometry source,
 * `src/constants/weatherGlyphs.json`, through the pure renderer in `weatherGlyphRender.mjs`:
 *
 *   ios/App/BeaniesWidgets/Assets.xcassets/wx-<kind>.imageset/       light + dark SVG
 *   ios/App/BeaniesWidgets/Assets.xcassets/wx-<kind>-mono.imageset/  template SVG
 *   android/app/src/main/res/drawable/wx_<kind>.xml, wx_<kind>_mono.xml
 *   the `wx_*` colours in res/values/widget_colors.xml + res/values-night/widget_colors.xml
 *
 * Run: node scripts/gen-weather-glyphs.mjs   (then commit the assets).
 * `src/constants/__tests__/weatherGlyphAssets.test.ts` fails when these files drift from it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssetFiles, COLOR_FILES, withColorBlock } from './weatherGlyphRender.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(resolve(root, 'src/constants/weatherGlyphs.json'), 'utf8'));

let written = 0;
for (const [rel, content] of Object.entries(buildAssetFiles(geo))) {
  const abs = resolve(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  written++;
}
for (const [scheme, rel] of Object.entries(COLOR_FILES)) {
  const abs = resolve(root, rel);
  writeFileSync(abs, withColorBlock(readFileSync(abs, 'utf8'), scheme));
  written++;
}
console.log(`gen-weather-glyphs: wrote ${written} files`);
