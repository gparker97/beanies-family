#!/usr/bin/env node
/* global process */
/* eslint-disable no-console -- this is a CLI; its output IS the interface */
/**
 * Optimize a blog image for beanies.family/blog and write it to `web/public/blog/`.
 *
 * Notion serves images from expiring S3 URLs, so the usual shape is: download to a
 * temp file, run this, commit the .webp. Nothing else in the repo resizes blog
 * images — `scripts/convert-images.mjs` only re-encodes to webp at q85 and leaves a
 * 4000px phone photo at 4000px, which is exactly the LCP problem this exists to fix.
 *
 * Defaults (the house convention, per greg 2026-07-10):
 *   - max 1200px wide, never upscaled
 *   - WebP quality 80
 *   - EXIF stripped (phone photos carry GPS coordinates of your home)
 *
 * The Astro build injects width/height into the <img> at build time
 * (web/src/lib/rehype-image-dims.mjs), so there is no CLS to worry about — but that
 * plugin only *reads* the file. If the file is missing it logs and moves on, and the
 * page ships a broken image. That silence is why this script verifies its own output.
 *
 * Usage:
 *   node optimize-blog-image.mjs <input> [more inputs...] [--width 1200] [--quality 80]
 *   node optimize-blog-image.mjs ~/Downloads/photo.jpg --name aloe-vera-big-island-2002
 *
 * Prints one line per image: the markdown path to use, and the size saved.
 */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.env.BEANIES_REPO_ROOT ?? process.cwd();
const OUT_DIR = path.join(REPO_ROOT, 'web', 'public', 'blog');

const MAX_WIDTH = 1200;
const QUALITY = 80;

function parseArgs(argv) {
  const inputs = [];
  const opts = { width: MAX_WIDTH, quality: QUALITY, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--quality') opts.quality = Number(argv[++i]);
    else if (a === '--name') opts.name = argv[++i];
    else inputs.push(a);
  }
  return { inputs, opts };
}

/** `Some Photo (1).JPG` -> `some-photo-1`. Keeps URLs clean and predictable. */
function slugifyBasename(file) {
  return path
    .basename(file, path.extname(file))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function optimize(input, opts) {
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);

  const stem = opts.name ?? slugifyBasename(input);
  const outPath = path.join(OUT_DIR, `${stem}.webp`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = sharp(input).rotate(); // honour EXIF orientation, then drop the EXIF
  const meta = await src.metadata();

  await src
    // `withoutEnlargement` matters: a 900px source stays 900px. Upscaling would add
    // bytes and no detail.
    .resize({ width: opts.width, withoutEnlargement: true })
    .webp({ quality: opts.quality })
    .toFile(outPath);

  const before = fs.statSync(input).size;
  const after = fs.statSync(outPath).size;
  const outMeta = await sharp(outPath).metadata();

  // Verify rather than assume: a silently-zero-byte or wrong-size output would
  // surface as a broken image on the live site, long after this ran.
  if (after === 0) throw new Error(`wrote an empty file: ${outPath}`);
  if (outMeta.width > opts.width) throw new Error(`resize failed: ${outMeta.width}px`);

  return {
    markdown: `/blog/${stem}.webp`,
    fsPath: outPath,
    from: `${meta.width}x${meta.height}`,
    to: `${outMeta.width}x${outMeta.height}`,
    before,
    after,
  };
}

const { inputs, opts } = parseArgs(process.argv.slice(2));
if (inputs.length === 0) {
  console.error('usage: optimize-blog-image.mjs <input> [...] [--width N] [--quality N] [--name s]');
  process.exit(1);
}
if (inputs.length > 1 && opts.name) {
  console.error('--name only makes sense with a single input');
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
let failed = 0;

for (const input of inputs) {
  try {
    const r = await optimize(input, opts);
    const saved = Math.round((1 - r.after / r.before) * 100);
    console.log(`✓ ${r.markdown}  ${r.from} -> ${r.to}  ${kb(r.before)} -> ${kb(r.after)} (-${saved}%)`);
  } catch (err) {
    failed++;
    console.error(`✗ ${input}: ${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
