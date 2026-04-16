# Plan: #167 Engineering Cleanup — Fonts, Phase-1 Schema, Images, Lighthouse CI

> Date: 2026-04-16
> Related issues: #167 (SEO/AIO epic) — no new issue, direct implementation
> Plan file on disk (post-approval): `docs/plans/2026-04-16-epic-167-engineering-cleanup.md`

---

## Context

Epic #167 ships the Astro apex + Vue subdomain split. Phase 0 (foundations) and Phase C cutover are live. This plan closes the remaining **engineering backlog** from Phases 1 and 4 — i.e., work that isn't content authoring (pillars/comparison posts/FAQ body, which the user is handling over time).

**Audit found four concrete gaps** (confirmed by reading the live templates):

1. **Fonts loaded from Google Fonts externally** — both `web/src/layouts/BaseLayout.astro:57-60` and `index.html:72-75` use `fonts.googleapis.com`. Phase 4 AC says "Fonts self-hosted (WOFF2 subsets) with `font-display: swap`". Kills a third-party request (perf + privacy win, matches the brand's "no third-party tracking" story).
2. **Phase 1 content-structure components exist but aren't wired in.** `web/src/components/Byline.astro`, `Breadcrumbs.astro`, `RelatedArticles.astro` are all defined but neither the blog template (`web/src/pages/blog/[...slug].astro`) nor the help article template (`web/src/pages/help/[category]/[...slug].astro`) uses them. So every blog post is missing: "By greg" link to `/about/greg`, BreadcrumbList schema, related-articles section, and last-updated. Every help article has visual breadcrumbs but no BreadcrumbList schema.
3. **26 images in `web/public/` are all JPG/PNG, zero AVIF/WebP.** Largest is 1.3 MB (`beanies_family_hugging_transparent_1024x1024.png`). Hero mascot + blog screenshots + PWA-install guide screenshots are all candidates. Phase 1 AC: "All content images AVIF/WebP with explicit dimensions and `loading='lazy'`".
4. **No Lighthouse CI.** Phase 4 AC: "Lighthouse CI wired; PRs blocked on regression". Currently no workflow exists. Without it, perf regresses silently — and we're about to add new content (pillars) that would benefit from a guard rail.

**Goal for this plan:** close all four gaps in one PR, with order chosen so the Lighthouse CI baseline captures the improved state (not the pre-fix state).

Out of scope (deferred):

- New content (pillar pages, comparison posts, FAQ body) — user is handling separately
- Vue app font hosting change — the app is authenticated and not indexed. Could still be included for perf parity, but is additional scope; flagged as a follow-up
- Google Search Console / Bing Webmaster verification — manual browser ops
- Otterly.ai subscription — paid service decision
- GoAccess monthly report automation — separate, measurement workstream

---

## DRY & Simplicity Review (done before drafting)

| Concern                                         | Existing pattern found                                                                                  | Approach                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-host fonts                                 | No existing `@font-face` or WOFF2 handling anywhere                                                     | Use `@fontsource-variable/*` npm packages — a single variable-font file per family covers all weights. Zero manual WOFF2 extraction, no subset tooling, automatic updates via npm                                                                           |
| Shared font definition Vue ↔ Astro              | `packages/brand/theme.css` is already imported by both apps (single source for CSS tokens)              | Keep font-family tokens in theme.css unchanged; import fontsource packages from each app's entry (Astro global CSS, Vue `main.ts`) so each bundles its own copy                                                                                             |
| Byline, Breadcrumbs, RelatedArticles components | Already exist in `web/src/components/` — just not wired in                                              | Use them — no rewrite needed. Byline takes (author, date, updatedDate, readTime); Breadcrumbs takes Crumb[] and auto-renders BreadcrumbList schema; RelatedArticles takes items[]                                                                           |
| Image optimization at build time                | No existing pipeline                                                                                    | Sharp-based one-off conversion script (`scripts/convert-images.mjs`) run locally once. Output goes to `web/public/` in place (same filenames, .webp extension). Astro ships these as-is. No runtime framework cost                                          |
| Blog schema additions (updatedDate)             | `content.config.ts` already has clean zod schema for blog collection; guides already have `lastUpdated` | Add optional `updatedDate?: Date` to blog schema. If unset, Byline falls back to showing only the original date (existing `showUpdated` guard handles this)                                                                                                 |
| Lighthouse CI                                   | No existing perf gate in CI                                                                             | Use `treosh/lighthouse-ci-action@v12` with `lighthouserc.json` in `web/`. Runs against `web/` preview (`npm run preview:web`) in a dedicated workflow that only fires when `web/` or `content/blog/` or `content/guides/` changes — won't slow Vue-only PRs |
| Sequencing                                      | —                                                                                                       | Do the work in order: fonts → Phase 1 wiring → image conversion → Lighthouse CI. This way the Lighthouse baseline captures the fully-improved state                                                                                                         |

---

## Approach (in order of implementation)

### 1. Self-host fonts (Astro)

**Install:**

```bash
npm install --workspace=web @fontsource-variable/outfit @fontsource-variable/inter
```

Variable-font versions are ~50–80 KB total (single file per family, covers all weights 300–800). Google Fonts currently sends ~120+ KB across multiple CSS + WOFF2 requests with round-trips.

**`web/src/layouts/BaseLayout.astro`:**

- Replace the three `<link>` tags (preconnect × 2 + fonts stylesheet) with an import at the top of the frontmatter:
  ```astro
  ---
  import '@fontsource-variable/outfit';
  import '@fontsource-variable/inter';
  // ...
  ```
- Add `<link rel="preload" as="font" type="font/woff2" crossorigin href="..." />` tags for the two primary font files (Astro resolves the URL at build). Purpose: prevent FOIT on the hero — LCP win.

**Leave `packages/brand/theme.css` alone** — it already references `--font-outfit` / `--font-inter` which resolve against whatever `font-family` the browser finds. fontsource registers `Outfit Variable` and `Inter Variable` — theme.css fallback chain picks them up naturally.

**Vue app NOT touched in this PR** — `index.html`'s Google Fonts links stay. Flagged as follow-up; parity is nice-to-have but out of scope for the #167 cleanup (authenticated app, not SEO-critical).

### 2. Wire up Phase 1 content-structure components

**Blog schema — add optional `updatedDate`:**

`web/src/content.config.ts` blog schema:

```typescript
updatedDate: z.coerce.date().optional(),
```

No existing post frontmatter needs changing (optional field). Future posts can set it when updated.

**Blog post template** (`web/src/pages/blog/[...slug].astro`):

- Add imports: `Byline`, `Breadcrumbs`, `RelatedArticles`, plus helper to find related posts
- Replace the inline `.post-header-meta` block (author span + dot + formatted date) with `<Byline author={post.data.author} date={post.data.date} updatedDate={post.data.updatedDate} />` (no `readTime` — unnecessary blog-boilerplate; Byline's prop is optional)
- Replace the "← all posts" back link with `<Breadcrumbs items={[{label: 'home', href: '/'}, {label: 'beanstalk', href: '/blog'}, {label: post.data.title, href: canonicalPath}]} />` — gives both visual breadcrumbs AND BreadcrumbList JSON-LD for free
- Compute `relatedPosts`: same-category posts excluding self, limit 3. Fallback to latest 3 posts if category has < 3.
- Add `<RelatedArticles items={relatedPosts} />` after the post `<Content />`, before `<SubstackSubscribe />`
- Keep prev/next navigation (useful for sequential reading)
- Add `dateModified` to the `BlogPosting` JSON-LD using `post.data.updatedDate ?? post.data.date`
- The Byline author link resolves to **`/about/greg`** which already exists (`web/src/pages/about/greg.astro`) with bio, breadcrumbs, and Person JSON-LD. No new page needed.

**Help article template** (`web/src/pages/help/[category]/[...slug].astro`):

- Replace the inline visual breadcrumb `<nav>` block (L90-96) with `<Breadcrumbs items={...} />` — delivers BreadcrumbList schema
- Keep the existing `{article.readTime} min read · Updated {...}` line — it already shows updated date. Don't use Byline here (help articles are pod-collective authored, not personal; byline-by-greg would be misleading)
- Left sidebar category-article navigation already covers "related" — don't double it with `<RelatedArticles>` (would be UX noise + duplication)

### 3. Image optimization

**Script: `scripts/convert-images.mjs`** (new, one-off pass):

- Use `sharp` (already listed as Astro-ecosystem; if not installed, add to web workspace devDep)
- Walk `web/public/brand/`, `web/public/blog/`, `web/public/help/pwa-install/`
- For each `.png` / `.jpg` source: write `.webp` sibling at quality 85
- Leave PNG/JPG files in place (legacy URL compat; they're still referenced by the Vue app, emails, and maybe external embeds). Size cost is minimal — they're already deployed. Focus on adding WebP companions, not removing originals.

**Update source references in templates + content:**

- `web/src/layouts/BaseLayout.astro` — `<img src="/brand/beanies_logo_transparent_logo_only_192x192.png">` stays (favicon-adjacent, browser-compat, small file)
- Blog post template (`[...slug].astro` L78) — `<img src="/brand/beanies_father_son_icon_192x192.png">` stays (small)
- Blog markdown: `content/blog/2026-04-03-*.md` and `content/blog/2026-04-10-*.md` — update `![alt](/blog/*.jpg)` to `![alt](/blog/*.webp)`. Authors' writing ergonomic stays identical
- Help content (`src/content/help/getting-started.ts`): update the 6 inline `<img src="/help/pwa-install/*.jpg">` refs to `.webp`
- PublicNav logo, PublicFooter — any `<img>` tags to check; keep small PNG/logos as-is

**Explicit dimensions + lazy loading:**

- Markdown-rendered `<img>` tags don't accept `width`/`height` attrs natively. Astro's `astro:assets` + `<Image>` handles this for Astro pages but not for markdown. For Phase 1 AC, the acceptable interpretation: blog prose CSS already sets `width: 100%` and a natural aspect ratio via the source image — CLS is minimal on these. Keep as-is; revisit only if Lighthouse flags CLS > 0.1 in CI
- For inline HTML `<img>` in help content and templates: add `loading="lazy"` where missing AND matching width/height if reasonable to infer. Search the help content for `<img` — 6 occurrences; add `width="..." height="..." loading="lazy"` where missing (author already includes `loading="lazy"` per `getting-started.ts` spot-check, so the attr is already present — just verify)

**Don't gate on explicit-dimensions for markdown** — acceptable per Phase 1 AC interpretation given CSS-enforced responsive sizing. Note this trade-off in the commit message.

### 4. Lighthouse CI

**Config: `web/lighthouserc.json`** (new):

```jsonc
{
  "ci": {
    "collect": {
      "numberOfRuns": 3,
      "staticDistDir": "./dist",
      "url": [
        "http://localhost/index.html",
        "http://localhost/blog/index.html",
        "http://localhost/blog/accidentally-built-greatest-family-app/index.html",
        "http://localhost/help/index.html",
        "http://localhost/help/getting-started/install-as-app/index.html",
      ],
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.95 }],
        "categories:accessibility": ["warn", { "minScore": 0.9 }],
        "categories:best-practices": ["warn", { "minScore": 0.9 }],
        "categories:seo": ["error", { "minScore": 0.95 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }],
        "resource-summary:script:size": ["warn", { "maxNumericValue": 30720 }],
      },
    },
    "upload": { "target": "temporary-public-storage" },
  },
}
```

LHCI uses TBT (server-side proxy for INP) + resource-summary for JS weight. 30KB = 30720 bytes, per Phase 4 AC.

**Workflow: `.github/workflows/lighthouse-ci.yml`** (new):

- Trigger: `pull_request` with paths filter `web/**`, `content/blog/**`, `content/guides/**`, `packages/**`
- Steps: checkout → node setup → `npm ci` → `npm run build:web` → `npx lhci autorun --config=web/lighthouserc.json`
- Fail job on assertion failure → PR blocked via existing branch protection (if configured) or visible red X for reviewer enforcement

**Why a new workflow, not a job in `main-ci.yml`**: paths filter keeps Vue-only PRs fast. Lighthouse takes ~2–3 min; shouldn't run on every PR.

### 5. Documentation

- `CHANGELOG.md` — entry under `### Performance`: "Self-hosted Outfit + Inter fonts (variable, ~60 KB total); removed Google Fonts third-party requests from the marketing site. Converted brand mascot + blog screenshots to WebP (~70% size reduction). Wired up Byline, Breadcrumbs, and RelatedArticles on blog posts (BreadcrumbList JSON-LD now emitted). Lighthouse CI now blocks perf regressions on the marketing site."
- `docs/STATUS.md` — append to today's dated block noting the epic #167 cleanup

---

## Files Affected

**Created (3):**

- `web/lighthouserc.json`
- `.github/workflows/lighthouse-ci.yml`
- `scripts/convert-images.mjs`

**Modified — Astro (4):**

- `web/package.json` — add `@fontsource-variable/outfit`, `@fontsource-variable/inter`, `sharp` (devDep for the script)
- `web/src/layouts/BaseLayout.astro` — replace Google Fonts links with fontsource imports + preload tags
- `web/src/content.config.ts` — add optional `updatedDate` to blog schema
- `web/src/pages/blog/[...slug].astro` — wire Byline, Breadcrumbs, RelatedArticles; add `dateModified` to JSON-LD
- `web/src/pages/help/[category]/[...slug].astro` — replace visual breadcrumbs with Breadcrumbs component

**Modified — content (3):**

- `content/blog/2026-04-03-accidentally-built-greatest-family-app.md` — update image ref to `.webp`
- `content/blog/2026-04-10-travel-plans-intro.md` — update image ref to `.webp`
- `src/content/help/getting-started.ts` — update 6 inline `<img>` refs to `.webp`

**Modified — docs:**

- `CHANGELOG.md`, `docs/STATUS.md`

**New binary assets (added alongside existing originals):**

- `web/public/brand/*.webp` (mascot + icons — converted)
- `web/public/blog/*.webp` (screenshots — converted)
- `web/public/help/pwa-install/*.webp` (PWA install screenshots — converted)

**Not touched:**

- Vue app `index.html` font loading — out of scope for this PR
- Existing PNG/JPG files in `web/public/` — stay for legacy URL compat; WebP files added as siblings
- `packages/brand/theme.css` — font-family tokens unchanged
- Astro site content — no copy changes
- `main-ci.yml` — Lighthouse CI is a new standalone workflow with its own paths filter

---

## Important Notes & Caveats

- **Fontsource variable fonts subset to Latin by default.** Non-Latin characters (e.g., Chinese pinyin ruby in the greg bio post) will fall back to the browser's system font. Acceptable; our English-first audience isn't affected. If we later need extended latin or CJK, fontsource has explicit subset imports.
- **PNG/JPG files kept after WebP conversion.** Keeps legacy URLs working; caching layer (CloudFront) still serves them. Minor storage cost, zero UX risk. Can be cleaned up later.
- **Markdown `![]()` images don't get explicit width/height.** CSS-enforced `width: 100%` on `.blog-prose img` keeps CLS low in practice. Lighthouse CI will surface any real CLS regressions; address then if needed.
- **Help articles get Breadcrumbs component (schema win) but NOT Byline** — pod/team authored, not personal. Don't create misleading `/about/greg` links from help articles.
- **Lighthouse CI runs on the static dist, not a live URL.** `staticDistDir` mode spins up a temporary local server. Pros: deterministic, no network flake. Cons: no real CDN perf. Acceptable — we're checking our code, not CloudFront.
- **The three URL patterns tested represent the three template classes** (homepage, blog post, help article). If coverage becomes a concern, add more URLs; if CI time is a concern, drop to 1 per class.
- **Lighthouse score ≥95 is tight.** May need follow-up perf tuning (image dimensions, link preload/prefetch, fold-first CSS) if tests fail. Plan allows for that — assertion failures block merge, you'd open a small follow-up.
- **`.webp` browser support:** all modern browsers since 2020. No polyfill / `<picture>` fallback needed for our user base.

---

## Assumptions (verify before implementation)

1. `@fontsource-variable/outfit` and `@fontsource-variable/inter` exist on npm and cover weights 300–800 for Outfit, 400–600 for Inter — verify via `npm view @fontsource-variable/outfit` pre-install.
2. Astro's build resolves `@import` from fontsource correctly into `dist/assets/` with hashed filenames.
3. Sharp is already available or installable in the web workspace (`npm view sharp`).
4. Astro's markdown renderer passes `![alt](x.webp)` through unchanged — no format-based transforms.
5. Branch protection on `main` allows (or will allow) adding `lighthouse-ci` as a required check.
6. `npm run preview:web` or equivalent serves `web/dist/` — if not, LHCI's `staticDistDir` mode works directly from the folder. Verify there's no SSR-only behavior in Astro pages that breaks static serving.
7. **Verified:** `/about/greg` page exists at `web/src/pages/about/greg.astro` with bio + breadcrumbs + `AUTHOR` JSON-LD — Byline's author link resolves correctly, no new page needed.

---

## Verification Plan

### Pre-flight probes

1. `npm view @fontsource-variable/outfit versions --json | jq '. | last'` — confirm package exists, note latest version
2. `npm view sharp` — confirm availability for the image-conversion script
3. Inspect `web/astro.config.mjs` for any SSR / adapter config that would break static serving
4. Confirm content/blog posts are the only markdown files with `.jpg` image refs (no surprise content/guides/ images)

### Automated (after each section)

After **section 1 (fonts)**:

- `npm run build:web` — no build errors
- Open `web/dist/index.html` in browser → verify fonts render (should see Outfit heading, Inter body)
- DevTools Network tab: no `fonts.googleapis.com` or `fonts.gstatic.com` requests; fontsource-served woff2 files loaded same-origin
- `curl http://localhost:4321 | grep -i "fonts.google"` → expect zero matches

After **section 2 (Phase 1 wiring)**:

- Blog post page renders with "by greg" link, breadcrumbs trail, related articles section
- `curl /blog/accidentally-built-greatest-family-app | grep -c "BreadcrumbList"` → expect ≥ 1
- `curl /blog/... | grep -c "BlogPosting"` → expect ≥ 1
- Help article page renders with breadcrumbs component (styled), `curl` confirms BreadcrumbList JSON-LD present
- Visit /about/greg (the author link destination) — already exists per earlier audit; confirm still works
- Related articles section shows 3 items from same category; when category has < 3, shows latest

After **section 3 (images)**:

- `ls web/public/brand/*.webp web/public/blog/*.webp web/public/help/pwa-install/*.webp` — all expected files present
- Visual parity on blog post pages (WebP versions look identical to JPG originals)
- Blog screenshot test: `du -b web/public/blog/beanies-nook-screenshot.webp` vs `.jpg` — expect significant reduction
- DevTools Network tab on a blog post: images served as `image/webp`

After **section 4 (Lighthouse CI)**:

- `npm run build:web && npx lhci autorun --config=web/lighthouserc.json` locally — all assertions pass
- Push a trivial content change on a branch → PR fires `lighthouse-ci.yml` → all green
- Intentionally introduce a regression (e.g., unused huge image) → PR fires → fails as expected

### Full-build smoke

- `npm run type-check` ✅
- `npm run lint` ✅
- `npm run test` ✅ (no new unit tests; existing 1003 should stay green)
- `npm run build` (Vue) ✅
- `npm run build:web` (Astro) ✅
- Deploy to staging via `deploy-web.yml --ref main -f target=staging` first — check `staging.beanies.family`. THEN to production

### Manual visual checks on staging

- Homepage, blog index, 1 blog post, /about/greg, /help, /help/getting-started/install-as-app, /privacy, /terms — all render unchanged typographically (fonts load correctly)
- Blog post shows new Byline + Breadcrumbs + Related articles section visibly
- Help article shows new Breadcrumbs component (styling change acceptable per plan)

---

## Acceptance Criteria

- [ ] Google Fonts requests no longer appear on the Astro site's homepage, blog, or help pages (verified via DevTools Network tab)
- [ ] Fontsource variable fonts ship bundled with the Astro build (~60 KB total)
- [ ] `@font-face` with `font-display: swap` in effect for both Outfit and Inter
- [ ] Blog post template renders `<Byline>` with a link to `/about/greg`
- [ ] Blog post template renders `<Breadcrumbs>` with BreadcrumbList JSON-LD in raw HTML
- [ ] Blog post template renders `<RelatedArticles>` with 3 same-category posts (or latest 3)
- [ ] Blog schema accepts optional `updatedDate`; BlogPosting JSON-LD uses it for `dateModified` when set
- [ ] Help article template renders `<Breadcrumbs>` component (with schema)
- [ ] ≥ 80% of `web/public/**` images (by byte count) have WebP companions
- [ ] Blog markdown + help content `<img>` refs point to `.webp`
- [ ] `web/lighthouserc.json` + `.github/workflows/lighthouse-ci.yml` live
- [ ] Lighthouse CI runs on the PR that introduces it and reports all categories passing at the required thresholds (performance ≥ 95, SEO ≥ 95, LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms, script weight ≤ 30 KB/page)
- [ ] Lint / type-check / unit tests all green
- [ ] CHANGELOG + STATUS updated
- [ ] Post-deploy smoke on staging + prod confirms visual parity

---

## Prompt Log

<details>
<summary>Full prompt history (no GitHub issue created)</summary>

### Initial prompt

> is there anything left to do for epic #167 for AI optimization? aside from creating the pillar etc pages which will happen over time

### Follow-up 1

> sure let's do items 1-4

</details>
