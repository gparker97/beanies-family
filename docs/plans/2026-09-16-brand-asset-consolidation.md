# Plan: one home for every beanies graphic

> Date: 2026-09-16
> Related issues: none (raised directly by greg while widening the pinterest-post skill)

## Context

greg went looking for two graphics that are live on the site, the pricing hero and the family
library hero, and could not find either in `public/brand/`. Both exist, in `web/public/brand/`.
That is the symptom. The cause is that there is no single home for brand media, so an asset
lands in whichever served root first needed it, and nothing tells you the other root exists.

The knock-on effect is that anything reasoning about "all our graphics" reasons about half of
them. The `pinterest-post` skill points only at `web/public/brand/`, which is why every pin so
far has reached for the same two or three mascots.

### What the audit actually found

|                                                          |                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `public/brand/` (Vue app served root)                    | 45 files, 8.9M, mostly PNG                                                   |
| `web/public/brand/` (Astro served root)                  | 44 files, 4.4M, PNG **and** generated WEBP                                   |
| Unique illustrations across both                         | 54                                                                           |
| **Byte-identical files present in both**                 | **19**                                                                       |
| WEBP files that are conversions of a PNG in the same dir | 19                                                                           |
| `web/public/blog/`                                       | 59 post images                                                               |
| `public/blog/`                                           | **5 files, all byte-identical to `web/public/blog/`, referenced by nothing** |
| References to `/brand/` across both apps                 | 158                                                                          |

Three separate kinds of duplication, then: the same file in two served roots, a generated WEBP
sitting in git beside its PNG master, and a folder of blog images copied into the app bundle
that the app cannot even reach (`/blog/:slug` is an `externalRedirect` to the marketing site).
The last one is 452K shipped inside the PWA and both native app bundles for nothing.

### The home already exists in the contract

`packages/brand/package.json` already declares:

```json
"exports": { "./assets/*": "./assets/*" },
"files":   ["theme.css", "nav.ts", "schema.ts", "assets", "fonts"]
```

`packages/brand/assets/` was designed as the single home and never created. This plan creates
it and moves the media in, rather than inventing a new location.

## Decisions taken (greg, 2026-09-16)

1. **Generate and gitignore the served copies.** One copy in git. The two `public/brand` dirs
   become build output, produced by a sync script wired into `predev`/`prebuild`.
2. **Scope is brand illustrations plus blog images.** Help screenshots, native app icons and
   splash art, `screenshots/` and `scratch-shots/` stay where they are. The native icons are
   already generated from one source PNG by `build-native-app-assets.mjs`, so they are derived
   artifacts, not duplicates.
3. Blog images are in scope specifically so a pin for a given post can reuse an image from that
   post, giving continuity from pin to post. Not every time, but it should be available.

## Approach

### Source layout: folder expresses intent, so no list can rot

```
packages/brand/assets/
  shared/      -> synced to BOTH public/brand/ and web/public/brand/
  marketing/   -> synced to web/public/brand/ ONLY
  blog/        -> synced to web/public/blog/ ONLY
```

The alternative was a hand-written include list per target. A list is a thing to forget to
update; a folder is a decision you make when you add the file. `marketing/` exists so the app
bundle does not carry the OG image, the Play feature graphic and the store badges, which are
~700K of pure marketing weight that no app screen renders.

Sync **flattens** each source folder into its destination, so every served URL is unchanged.
`marketing/og-default.png` still serves at `/brand/og-default.png`. **No reference in the 158
changes.** That is the point: this is a repository-layout change, not a URL change.

### Masters only in git; WEBP stays generated

Only PNG/SVG/WEBP **masters** are committed. The 19 WEBP files that are conversions of a PNG in
the same directory are deleted from git, because `scripts/convert-images.mjs` already generates
exactly those and does it idempotently. That removes the second kind of duplication for free and
keeps the generated WEBP out of the app bundle, where it was never wanted.

Pipeline order matters and is stated once here: **sync (copy masters) → convert (add WEBP to
`web/public` only)**.

### The sync script

`scripts/sync-brand-assets.mjs`:

- copies each source folder to its destination(s), creating them if absent
- content-compares before writing, so an unchanged asset is not rewritten (keeps Vite's watcher
  quiet during `dev`)
- **removes destination files that no longer exist in source**, so a rename cannot leave a
  ghost behind, which is how the current mess accumulated
- `--check` mode: exits non-zero if any destination is out of date, for CI
- refuses to delete a destination file it did not put there, tracked by a generated
  `.synced-manifest.json`, so a stray hand-placed file is reported rather than silently removed

Wired as `predev`, `prebuild`, and into `dev:web` / `build:web` so either site alone is enough
to populate both.

### Risk: the destinations are currently tracked by git

`git rm -r --cached public/brand web/public/brand web/public/blog` is required, otherwise the
gitignore entries do nothing for already-tracked paths. This must land in the same commit as the
move, or a checkout lands with tracked files that the sync then fights over.

### Observability

This is build tooling, not a runtime feature, so the firehose does not apply. The equivalent is
that the script is loud: it prints per-target copied/updated/removed counts, and `--check`
names every drifted path rather than just failing. A silent sync would reintroduce exactly the
"assets quietly out of step" problem being fixed.

## Verification

1. `npm run sync-brand-assets` from a clean tree reproduces both `public/brand/` and
   `web/public/brand/` byte-identically to what is on `main` today, minus the 19 generated WEBP
   and minus `public/blog/`. This is the safety proof: same bytes, different provenance.
2. `npm run build` (Vue) and `npm run build:web` (Astro) both green.
3. Grep every one of the 158 `/brand/` references and confirm each resolves in both `dist/`
   outputs.
4. `npm run validate` green, E2E green.
5. Confirm the app bundle **shrinks** by ~1.1M (452K dead blog images plus the marketing-only
   assets it no longer carries).
6. Confirm `npx cap sync` still populates the native `public/brand` from the Vue `public/`.

## Files affected

- **New**: `packages/brand/assets/{shared,marketing,blog}/**` (the moved masters),
  `scripts/sync-brand-assets.mjs`
- **Modified**: `.gitignore`, root `package.json` (scripts), `web/package.json` (scripts),
  `scripts/convert-images.mjs` (document the sync-then-convert order)
- **Deleted from git**: `public/brand/**`, `web/public/brand/**`, `web/public/blog/**` (now
  generated), `public/blog/**` (dead, not regenerated), the 19 generated WEBP companions
- **Unchanged**: every `/brand/` and `/blog/` URL in both apps

## Deliberately not doing

- Not touching help screenshots, native app icons, splash art, `screenshots/`, `scratch-shots/`.
- Not renaming any asset. Naming is inconsistent (`beanies_family_hugging_...` vs
  `beanies-family-reading`) but renaming would touch all 158 references and is a separate job
  with its own risk. Noted for later.
- Not introducing an image CDN or Astro's `<Image>` pipeline.
