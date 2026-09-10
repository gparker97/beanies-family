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
 * ANIMATED INPUT (gif / animated webp) is detected and kept animated. This used to
 * be the script's sharpest edge: `sharp(input)` reads only the FIRST FRAME unless it
 * is opened with `{ animated: true }`, so an 84-frame celebration gif came out as a
 * single frozen frame, every verification below still passed, and the still shipped.
 * Nothing failed. So animated files are re-opened with `{ animated: true }`, and the
 * frame count is now an assertion rather than an assumption. `.rotate()` is skipped
 * for them: there is no EXIF on a gif, and rotate on a multi-page pipeline mangles
 * the frame strip.
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
  // A CLI's whole job is to act on the path it was handed, so every fs call below is
  // a "non-literal filename" by construction. The security config errors on that to
  // protect SHIPPED code from path injection; this is a local dev tool run by hand,
  // and the output dir is a fixed prefix under the repo. Same justification as
  // web/src/lib/rehype-image-dims.mjs.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(input)) throw new Error(`input not found: ${input}`);

  const stem = opts.name ?? slugifyBasename(input);
  const outPath = path.join(OUT_DIR, `${stem}.webp`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Probe first: `pages` is only reported when the file is opened as animated, so
  // this read decides which pipeline the real work uses.
  const probe = await sharp(input, { animated: true }).metadata();
  const frames = probe.pages ?? 1;
  const animated = frames > 1;

  // rotate() only for stills — see the ANIMATED INPUT note in the header.
  const src = animated ? sharp(input, { animated: true }) : sharp(input).rotate();
  const meta = await src.metadata();
  // For a multi-page image `height` is the whole frame strip; `pageHeight` is the
  // one that means what a person means by "how tall is it".
  const srcHeight = animated ? meta.pageHeight : meta.height;

  await src
    // `withoutEnlargement` matters: a 900px source stays 900px. Upscaling would add
    // bytes and no detail.
    .resize({ width: opts.width, withoutEnlargement: true })
    .webp({ quality: opts.quality, ...(animated ? { effort: 5 } : {}) })
    .toFile(outPath);

  /* eslint-disable security/detect-non-literal-fs-filename -- see the note above */
  const before = fs.statSync(input).size;
  const after = fs.statSync(outPath).size;
  /* eslint-enable security/detect-non-literal-fs-filename */
  const outMeta = await sharp(outPath, { animated: true }).metadata();
  const outFrames = outMeta.pages ?? 1;
  const outHeight = animated ? outMeta.pageHeight : outMeta.height;

  // Verify rather than assume: a silently-zero-byte or wrong-size output would
  // surface as a broken image on the live site, long after this ran.
  if (after === 0) throw new Error(`wrote an empty file: ${outPath}`);
  if (outMeta.width > opts.width) throw new Error(`resize failed: ${outMeta.width}px`);
  // The one that actually bit us: a flattened animation is a valid, correctly-sized,
  // non-empty webp, so every other check above passes while the motion is gone.
  if (outFrames !== frames) {
    throw new Error(`frame loss: ${frames} frame(s) in, ${outFrames} out`);
  }

  return {
    markdown: `/blog/${stem}.webp`,
    fsPath: outPath,
    from: `${meta.width}x${srcHeight}`,
    to: `${outMeta.width}x${outHeight}`,
    frames,
    animated,
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
    const anim = r.animated ? `  animated (${r.frames} frames kept)` : '';
    console.log(
      `✓ ${r.markdown}  ${r.from} -> ${r.to}  ${kb(r.before)} -> ${kb(r.after)} (-${saved}%)${anim}`
    );
  } catch (err) {
    failed++;
    console.error(`✗ ${input}: ${err.message}`);
  }
}

process.exit(failed ? 1 : 0);
