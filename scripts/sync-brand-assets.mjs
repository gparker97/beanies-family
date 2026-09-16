#!/usr/bin/env node
/**
 * Copy the brand media masters out of `packages/brand/assets/` into the two
 * served roots that actually need them.
 *
 * WHY THIS EXISTS. `public/` (Vue app, app.beanies.family) and `web/public/`
 * (Astro site, beanies.family) are separate origins, so each one has to have the
 * files present at build time. For a long while that was achieved by keeping two
 * copies in git, which drifted: 19 byte-identical files in both trees, a folder
 * of blog images copied into the app bundle that the app cannot even reach, and
 * two heroes that were live on the site but missing from the app's tree entirely,
 * which is how this came to light. Now there is ONE copy in git and these two
 * destinations are build output.
 *
 * FOLDER EXPRESSES INTENT, so no hand-written include list can rot:
 *
 *   shared/     -> public/brand/  AND  web/public/brand/
 *   marketing/  -> web/public/brand/  only
 *   blog/       -> web/public/blog/   only
 *
 * `marketing/` is what keeps the OG image, the Play feature graphic and the store
 * badges out of the app bundle, where no screen renders them.
 *
 * Sync FLATTENS each source folder into its destination, so every served URL is
 * unchanged: `marketing/og-default.png` still serves at `/brand/og-default.png`.
 * This is a repository-layout change, never a URL change.
 *
 * ORDER MATTERS: sync (copy masters) THEN `convert-images.mjs` (add the .webp
 * companions under `web/public/` only). The generated .webp files are not in git;
 * this script never writes them and never deletes them.
 *
 * Usage:
 *   node scripts/sync-brand-assets.mjs           # write
 *   node scripts/sync-brand-assets.mjs --check   # exit 1 if anything is stale
 */
import { readdir, mkdir, copyFile, stat, unlink, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages/brand/assets');
const CHECK = process.argv.includes('--check');

/** source folder -> every destination it populates. */
const TARGETS = [
  { from: 'shared', to: ['public/brand', 'web/public/brand'] },
  { from: 'marketing', to: ['web/public/brand'] },
  { from: 'blog', to: ['web/public/blog'] },
];

/**
 * Written into each destination so the script knows which files it owns.
 *
 * Without it, "remove what is no longer in source" would be indistinguishable
 * from "remove anything I did not just write", which would delete the generated
 * .webp companions on every run and quietly fight `convert-images.mjs`.
 */
const MANIFEST = '.synced-assets.json';

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
    else if (entry.name !== MANIFEST) out.push(rel);
  }
  return out;
}

async function sameBytes(a, b) {
  if (!existsSync(b)) return false;
  const [sa, sb] = await Promise.all([stat(a), stat(b)]);
  if (sa.size !== sb.size) return false;
  const [ba, bb] = await Promise.all([readFile(a), readFile(b)]);
  return ba.equals(bb);
}

/** Destination -> the source files that should land in it, from every target. */
function planByDestination() {
  const byDest = new Map();
  for (const t of TARGETS) {
    for (const dest of t.to) {
      if (!byDest.has(dest)) byDest.set(dest, []);
      byDest.get(dest).push(t.from);
    }
  }
  return byDest;
}

async function syncDestination(dest, sourceFolders) {
  const destAbs = join(ROOT, dest);
  await mkdir(destAbs, { recursive: true });

  /** relative path in dest -> absolute source path */
  const wanted = new Map();
  for (const folder of sourceFolders) {
    const srcAbs = join(SRC, folder);
    if (!existsSync(srcAbs)) throw new Error(`Missing source folder: ${relative(ROOT, srcAbs)}`);
    for (const rel of await listFiles(srcAbs)) {
      const clash = wanted.get(rel);
      if (clash) {
        // Two source folders flattening onto the same served name would make the
        // winner depend on TARGETS ordering. Refuse rather than pick.
        throw new Error(
          `Name collision in ${dest}: "${rel}" comes from more than one source folder ` +
            `(${relative(SRC, clash)} and ${folder}/${rel}). Rename one.`
        );
      }
      wanted.set(rel, join(srcAbs, rel));
    }
  }

  const previous = existsSync(join(destAbs, MANIFEST))
    ? JSON.parse(await readFile(join(destAbs, MANIFEST), 'utf-8')).files || []
    : [];

  const stale = [];
  let copied = 0;
  for (const [rel, srcPath] of wanted) {
    const destPath = join(destAbs, rel);
    if (await sameBytes(srcPath, destPath)) continue;
    stale.push(`${dest}/${rel}`);
    if (CHECK) continue;
    await mkdir(join(destPath, '..'), { recursive: true });
    await copyFile(srcPath, destPath);
    copied++;
  }

  // Only ever remove a file THIS script previously wrote. A generated .webp or a
  // hand-placed file is reported, never deleted.
  const removed = [];
  for (const rel of previous) {
    if (wanted.has(rel)) continue;
    const destPath = join(destAbs, rel);
    if (!existsSync(destPath)) continue;
    removed.push(`${dest}/${rel}`);
    if (!CHECK) await unlink(destPath);
  }

  if (!CHECK) {
    await writeFile(
      join(destAbs, MANIFEST),
      `${JSON.stringify({ generatedBy: 'scripts/sync-brand-assets.mjs', files: [...wanted.keys()].sort() }, null, 2)}\n`
    );
  }

  return { dest, total: wanted.size, copied, stale, removed };
}

async function main() {
  if (!existsSync(SRC)) {
    throw new Error(`No brand asset source at ${relative(ROOT, SRC)}. Nothing to sync.`);
  }

  const results = [];
  for (const [dest, folders] of planByDestination()) {
    results.push(await syncDestination(dest, folders));
  }

  const drifted = results.flatMap((r) => [...r.stale, ...r.removed]);

  for (const r of results) {
    const detail = CHECK
      ? `${r.stale.length} stale, ${r.removed.length} orphaned`
      : `${r.copied} written, ${r.removed.length} removed`;
    console.log(`  ${r.dest.padEnd(18)} ${String(r.total).padStart(3)} files — ${detail}`);
  }

  if (CHECK && drifted.length) {
    console.error('\nBrand assets are out of date. Run `npm run sync-brand-assets`.');
    // Name them. A check that only says "something drifted" gets ignored.
    for (const p of drifted) console.error(`  ${p}`);
    process.exit(1);
  }

  if (CHECK) console.log('Brand assets up to date.');
}

main().catch((err) => {
  console.error('Brand asset sync failed:', err.message);
  process.exit(1);
});
