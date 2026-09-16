#!/usr/bin/env node
/**
 * Adds a .webp companion next to every .png/.jpg/.jpeg file in the directories
 * listed below.
 *
 * NOT a one-off, despite how it started. The .webp companions are NOT committed
 * (see .gitignore); they are build output, so this has to run on every build or
 * the deploy ships broken images. It is wired into `prebuild` on both workspaces
 * and MUST run AFTER `sync-brand-assets.mjs`, which puts the masters in place.
 *
 * `public/help/pwa-install` is in the list because the in-app help centre
 * hard-references `.webp` for those screenshots with no <picture> fallback
 * (src/content/help/getting-started.ts), while only the .jpg masters are
 * committed. Before this script covered that directory, those help images were
 * broken in the app.
 *
 * - Keeps the original PNG/JPG files in place (legacy URL compat)
 * - Idempotent: skips conversion if the .webp already exists and is
 *   newer than the source
 * - Quality 85 — good tradeoff for photographic and mascot-style PNG content
 *
 * Usage: node scripts/convert-images.mjs
 */
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = [
  join(ROOT, 'web/public/brand'),
  join(ROOT, 'web/public/blog'),
  join(ROOT, 'web/public/help/pwa-install'),
  join(ROOT, 'public/help/pwa-install'),
];
const QUALITY = 85;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function convert(file) {
  const ext = extname(file).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(ext)) return null;
  const webpPath = file.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  if (existsSync(webpPath)) {
    const [srcStat, webpStat] = await Promise.all([stat(file), stat(webpPath)]);
    if (webpStat.mtimeMs > srcStat.mtimeMs) return { file, skipped: true };
  }
  await sharp(file).webp({ quality: QUALITY }).toFile(webpPath);
  const [srcStat, webpStat] = await Promise.all([stat(file), stat(webpPath)]);
  return {
    file,
    webp: webpPath,
    srcBytes: srcStat.size,
    webpBytes: webpStat.size,
    skipped: false,
  };
}

const fmt = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)}MB` : `${(n / 1024).toFixed(1)}KB`;

let total = 0;
let saved = 0;
let skipped = 0;

for (const dir of DIRS) {
  if (!existsSync(dir)) {
    console.warn(`skip (missing): ${dir}`);
    continue;
  }
  for await (const file of walk(dir)) {
    const result = await convert(file);
    if (!result) continue;
    total++;
    if (result.skipped) {
      skipped++;
      console.log(`= ${result.file.replace(ROOT + '/', '')} (already current)`);
    } else {
      saved += result.srcBytes - result.webpBytes;
      const pct = (((result.srcBytes - result.webpBytes) / result.srcBytes) * 100).toFixed(0);
      console.log(
        `+ ${result.file.replace(ROOT + '/', '')} → .webp  ${fmt(result.srcBytes)} → ${fmt(
          result.webpBytes
        )}  (-${pct}%)`
      );
    }
  }
}

console.log(
  `\nDone. ${total} files touched, ${skipped} already current, ${
    total - skipped
  } converted. Total saved: ${fmt(saved)}.`
);
