# Plan: SEO + AIO/GEO optimization — final, reviewed

> Date: 2026-04-14
> Status: **Approved** 2026-04-14
> Epic issue: [#167](https://github.com/gparker97/beanies-family/issues/167)
> Architecture: Astro at apex `beanies.family`, Vue PWA at `app.beanies.family`

---

## Context

beanies.family is in an active marketing push. Goal: maximum discoverability + citation by search engines and AI chatbots. Current site is a Vue SPA — invisible to GPTBot, ClaudeBot, PerplexityBot, CCBot (they don't execute JS). The apex must become SSG'd static HTML; the PWA moves to a subdomain to cleanly isolate service-worker scope, cookies, and the auth entry point.

---

## DRY audit — what is reused

| Asset                                               | Current location                                                | Strategy                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind v4 `@theme` block + CSS vars               | `src/style.css`                                                 | Extract to `packages/brand/theme.css`. Both apps `@import` it. Single source for Heritage Orange, Deep Slate, Sky Silk, Terracotta, Outfit, Inter.                                                                                    |
| Brand images (logo, beanies PNGs)                   | `public/brand/`                                                 | Move to `packages/brand/assets/`. Both apps copy into their build output via workspace resolution.                                                                                                                                    |
| Fonts (Outfit, Inter)                               | Google Fonts CDN                                                | Self-host WOFF2 subsets in `packages/brand/fonts/`. Same files, both apps.                                                                                                                                                            |
| Blog markdown (3 posts)                             | `content/blog/`                                                 | Move to `apps/web/src/content/blog/` (Astro content collection). Only Astro consumes it post-cutover.                                                                                                                                 |
| Help content data (24 articles)                     | `apps/app/src/content/help/*.ts` — pure `ArticleSection[]` data | Move to `apps/web/src/content/help/`. Astro loader imports the existing TS + renders sections via one component (`HelpArticleRenderer.astro`) that walks the array. Full content preserved exactly as today; no data conversion step. |
| Translation strings                                 | `src/services/translation/uiStrings.ts`                         | Shared TS object. English keys used directly by Astro at build time. No duplication.                                                                                                                                                  |
| Nav links / footer links                            | `AppHeader.vue` / sidebar config                                | Extract public link list to `packages/brand/nav.ts`. Astro components consume same list. Markup differs per framework but source data does not.                                                                                       |
| Organization / Person / SoftwareApplication JSON-LD | Does not exist                                                  | Define once in `packages/brand/schema.ts`.                                                                                                                                                                                            |

## Community packages (no hand-rolled pipelines)

- `@astrojs/sitemap`, `@astrojs/rss`, `@astrojs/mdx`
- `@tailwindcss/vite` (Tailwind **v4**, matches app setup — **not** `@astrojs/tailwind` which is v3)
- `astro-seo` for head meta
- `astro-og-canvas` for dynamic OG images
- `web-vitals` npm for RUM

## What is NOT reused

- Vue marketing pages (`HomePage.vue`, `BeanstalkBlogPage.vue`, etc.) — mounting them as Astro Vue islands imports the Vue runtime onto every content page and kills the whole performance case. Rewrite lean Astro components. The shared brand package keeps visual parity without shared render code.
- App UI components (BaseModal, BeanieFormModal, BaseButton) — marketing pages have no forms/modals; adding one later is local work, not upfront abstraction.

---

## Target repository layout

```
beanies-family/  (npm workspaces monorepo)
├── apps/
│   ├── app/                     # existing Vue SPA → deploys to app.beanies.family
│   └── web/                     # new Astro 5.x → deploys to beanies.family (apex)
│       ├── src/content/blog/    # moved from /content/blog
│       └── src/content/help/    # moved from apps/app/src/content/help
└── packages/
    └── brand/                   # theme.css, fonts/, assets/, nav.ts, schema.ts
```

## Infrastructure (extend existing Terraform — do not rewrite)

- New ACM cert for `app.beanies.family`
- DNS CNAME `app.beanies.family` → new CloudFront distribution
- Two distributions: apex (Astro + new S3 bucket), app subdomain (existing S3 bucket)
- **Single** CloudFront Function at apex consolidating all 301 rules:
  - Authenticated paths (`/dashboard`, `/accounts`, `/transactions`, `/assets`, `/goals`, `/reports`, `/forecast`, `/family`, `/nook`, `/activities`, `/travel`, `/todo`, `/budgets`, `/settings`, `/oauth`, `/login`, `/join`, `/welcome`) → `https://app.beanies.family$1$QS`
  - `/beanstalk*` → `/blog*` (legacy preservation)
- OAuth redirect URI: **add** `https://app.beanies.family/oauth/callback` in Google Cloud Console **before** cutover; keep apex URI registered for 30 days as safety net, then remove.
- Staging preview on a subdomain with `X-Robots-Tag: noindex` header (prevents duplicate indexing during QA).

---

## Phases

### Phase 0 — Scaffolding (Week 1)

1. **Monorepo**: npm workspaces; move Vue SPA to `apps/app`; scaffold `apps/web` with Astro 5.x + community packages listed above.
2. **`packages/brand/`**: extract `@theme` block + CSS vars to `theme.css`; self-host fonts; move brand assets; author `nav.ts` + `schema.ts`.
3. Both apps `@import "@beanies/brand/theme.css"` — replaces inline `@theme` block in app's `style.css`.
4. **Content collections** (`apps/web/src/content/config.ts`): Zod-validated schemas for `blog` and `help`. Invalid frontmatter fails the build — prevents silent production drift.
5. Move blog markdown → `apps/web/src/content/blog/`. Move help TS data → `apps/web/src/content/help/`.
6. **Astro pages** (one file each): `/`, `/blog`, `/blog/[...slug]`, `/help`, `/help/[category]`, `/help/[category]/[...slug]`, `/privacy`, `/terms`.
7. **One** `BaseLayout.astro` using `astro-seo` for all head tags. **One** `JsonLd.astro`, `Breadcrumbs.astro`, `Byline.astro`, `Nav.astro`, `Footer.astro`, `RelatedArticles.astro`, `HelpArticleRenderer.astro` (walks `ArticleSection[]`), `HelpSearch.astro` (client-side search island, see step 7a). No per-section variants.
   7a. **Help search** (parity with current Vue app): MiniSearch-based island on `/help` index page. Build-time indexer (`apps/web/src/scripts/build-help-index.ts`) walks the `help` content collection and emits `public/help-index.json` (title, slug, category, excerpt, section text). Runtime island (~30 lines vanilla TS) lazy-loads the JSON on first focus, runs MiniSearch in the browser. Same data source as the pages — zero content duplication. Total JS ~10 KB, loaded only on `/help`.
8. **Astro config**: `site: 'https://beanies.family'`, `trailingSlash: 'never'` (matches current URLs — no 301 chains).
9. **Sitemap + RSS** (dynamic, auto-maintained): `@astrojs/sitemap` scans all Astro pages at each build — including dynamic routes (`/blog/[slug]`, `/help/[category]/[slug]`) — and emits a complete `sitemap-index.xml` + child sitemaps with `lastmod`. `@astrojs/rss` does the same for the feed. Every new blog post → next deploy → sitemap + feed updated automatically → IndexNow pings search engines. No manual maintenance.
10. **`robots.txt`** (apex): explicit allowlist for OAI-SearchBot, ChatGPT-User, GPTBot, ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, PerplexityBot, Perplexity-User, Google-Extended, Googlebot, Applebot, Applebot-Extended, CCBot, cohere-ai, Amazonbot, Meta-ExternalAgent, Meta-ExternalFetcher, DuckAssistBot, YouBot, Bravebot, MistralAI-User, Kagibot, Diffbot. **`robots.txt`** (app subdomain): `Disallow: /`.
11. **`llms.txt`** hand-curated; **`llms-full.txt`** generated by a ~20-line `src/pages/llms-full.txt.ts` that imports both collections and concatenates.
12. **IndexNow**: random key, key file at `/<key>.txt`, deploy hook pings on changed URLs.
13. **GSC + Bing**: verify both apex and app-subdomain properties (app-subdomain is verified so we can monitor and block any accidental indexing).
14. **Terraform**: new distribution + function + cert + DNS in a new module; referenced from existing `main.tf`. Plan reviewed before apply.
15. **Deploy pipelines**: `deploy-web.yml` (path filter `apps/web/**`, `packages/**`); `deploy-app.yml` renamed from existing, path-filtered to `apps/app/**`.
16. **PWA migration** — tiny self-unregistering SW at apex (`apps/web/public/sw.js`, ~10 lines):
    ```js
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (e) =>
      e.waitUntil(
        (async () => {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
          await self.registration.unregister();
          const clients = await self.clients.matchAll();
          clients.forEach((c) => c.navigate(c.url));
        })()
      )
    );
    ```
    Served with `Cache-Control: no-cache`. Old Vue SW update-checks, picks up this replacement, self-destructs.
17. **App-side cleanup**:
    - Remove marketing routes from `apps/app/src/router/index.ts`
    - `apps/app/public/manifest.webmanifest`: `start_url: '/'`, `scope: '/'` — auto-correct since origin is now `app.beanies.family`
    - `apps/app/vite.config.ts`: no changes needed to Workbox (new origin = new SW registration)
    - Update any absolute `beanies.family` link in the app to `beanies.family` (marketing link) or `app.beanies.family` (self-reference) as appropriate
    - Plausible data-domain attribute updated to new origin
18. **Cutover**: deploy to staging preview subdomain first → full QA including OAuth round-trip → atomic DNS + CF behavior flip during a low-traffic window. Rollback = single Terraform revert.

### Phase 1 — SEO/AIO content layer (Week 2)

Applied in the layouts from Phase 0; no new components:

- Visible "Last updated" date + "By greg" byline (links to `/about/greg` page with `Person` JSON-LD + `sameAs`)
- Breadcrumbs on blog posts and help articles (one component, used twice)
- Related articles (3-5 curated) on blog posts
- Dynamic OG image per blog post via `astro-og-canvas` (config only)
- All content images via `astro:assets` (AVIF/WebP, auto width/height, `loading="lazy"` except LCP hero which uses `fetchpriority="high"`)
- `web-vitals` RUM → Plausible custom events (one ~15-line script)
- Content authoring pass (no code): reshape H2/H3 to questions on explainer posts, add 40-70-word direct-answer paragraphs on explainer/how-to content. Narrative story posts keep their voice. 3 blog posts + 24 help articles.

### Phase 2 — New content (Weeks 3-6)

Pure authoring + one JSON-LD block each:

- `/help/glossary` — `DefinedTermSet` schema, 10+ terms
- `/help/faq` — `FAQPage` schema, 20 Q&As
- 3 comparison posts (vs YNAB, vs Actual Budget, vs Copilot Money)
- 4 pillar pages (Family Organization, Family Finance Basics, Overwhelmed with Family Planning, Local-first Family Tools)

### Phase 3 — Off-site & entity (Weeks 4-8, parallel)

_Specific subs/copy/timing in Notion per CLAUDE.md_: Product Hunt, AlternativeTo, SaaSHub, G2, Capterra, Crunchbase, PrivacyTools.io, AwesomeSelfhosted, Wikidata, Show HN, YouTube demo (with transcript), GitHub org polish, Reddit organic presence via existing karma-run skill.

### Phase 4 — Performance budgets (continuous)

LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1, JS ≤ 30 KB per content page. Self-hosted fonts with `font-display: swap`, preload above-fold weights. CloudFront cache-control: HTML `max-age=0, must-revalidate`; assets `max-age=31536000, immutable`. Lighthouse CI blocks regressions on key templates.

### Phase 5 — Measurement (continuous)

GSC + Bing weekly. Otterly.ai ($29/mo) — 20 tracked prompts. Monthly manual prompt test across ChatGPT/Claude/Perplexity/Gemini (tracked in Notion). Quarterly content refresh with `dateModified` bumps only on substantive changes. CloudFront log analysis on-demand via CloudFront Studio (not a scheduled GoAccess run — on-demand is enough).

---

## Security review

- AI crawler allowlist adds no new risk — they fetch public HTML only. No private paths at apex.
- `llms-full.txt` concatenates public marketing/blog/help content. No PII, no secrets.
- IndexNow key is public (by design — fetchable at `/<key>.txt`). Random, stored as a constant in the repo.
- OAuth transition: keep old apex redirect URI registered for 30 days — prevents day-1 OAuth breakage if any DNS edge propagation is slow.
- Auth is localStorage-based (`beanies_auth_session`, confirmed in `apps/app/src/stores/authStore.ts`). Origin-scoped → one-time re-login on first `app.beanies.family` visit. Not a security issue; a UX note.
- CSP on apex: must permit Plausible (`https://plausible.io`) and self-hosted fonts. CSP on app subdomain: unchanged from current.
- Staging preview: `X-Robots-Tag: noindex` to prevent duplicate-content indexing during QA.
- CloudFront Function: runs edge-side, no secrets, no external calls.

## Bugs / side effects avoided

- **Absolute URLs everywhere**: Astro `site: 'https://beanies.family'` is set so sitemap, RSS, OG, canonical tags all use absolute https URLs.
- **Trailing slash match**: `trailingSlash: 'never'` matches existing URLs — no 301 redirect chains.
- **Build-time frontmatter validation**: Zod schemas on Astro content collections catch typos and missing fields at build time, not in production.
- **Preview subdomain `noindex`**: prevents staging from getting indexed as duplicate content.
- **SW self-unregister** at apex: old Vue PWA installs clean up without manual user action.
- **Old Vue marketing pages deleted post-cutover**: no duplicate indexing risk; Astro is the only apex-reachable source for these URLs.
- **OAuth dual-URI window**: both apex and app redirect URIs registered for 30 days — zero OAuth downtime during cutover/propagation.
- **Plausible domain config**: configure two properties (apex + app subdomain), each with its own script tag. Avoids cross-origin attribution confusion. Duplication is two `<script>` tags — acceptable.

## Assumptions to revalidate

1. Author is "greg" (lowercase), single-author initially
2. English only in Phase 1
3. `app.beanies.family` is the accepted subdomain
4. One-time re-login after cutover is acceptable
5. Astro 5.x remains stable through implementation window
6. Plausible plan supports custom events (CWV)
7. 30-day OAuth dual-URI window is acceptable per Google policy

## Out of scope

- Touching the Vue SPA beyond router cleanup + origin move
- Converting help data arrays into MDX files (we render the existing TS arrays directly — all content preserved, no conversion needed)
- Hand-rolling sitemap/RSS/OG generators (we use official Astro packages — auto-maintained, dynamic)
- Mounting Vue components as Astro islands (kills performance edge)
- HowTo schema (deprecated 2023), `ai.txt` (effectively dead)
- Unedited AI-generated content (YMYL penalty risk)
- Wikipedia self-creation (use Wikidata)
- Chinese content / hreflang (future)
- Newsletter/forms requiring backend (add when needed)

---

## Verification

1. `curl` every new apex URL — unique `<title>`, `<meta description>`, `<link canonical>`, OG, JSON-LD all in HTML (no JS).
2. `curl -A "GPTBot"`, `-A "ClaudeBot"`, `-A "PerplexityBot"` → 200 + full body.
3. Schema Markup Validator + Google Rich Results Test pass on home, blog post, help article, glossary, FAQ.
4. Sitemap includes every blog post + help article + category + static page, with `lastmod` and absolute https URLs.
5. `robots.txt` at apex has the full AI allowlist; at app subdomain has `Disallow: /`.
6. `llms-full.txt` < 1 MB, contains every published blog + help body.
7. CloudFront 301s: `beanies.family/dashboard` → `app.beanies.family/dashboard`; `/beanstalk/<slug>` → `/blog/<slug>`.
8. All pre-migration URLs resolve to 200 or 301 — zero 404s.
9. Lighthouse Performance ≥ 95 on home, blog post, help article (mobile).
10. Axe-core: zero critical violations.
11. PWA test: install on apex (pre-cutover), visit post-cutover → old SW self-unregisters; then install fresh at `app.beanies.family`.
12. OAuth end-to-end login works at `app.beanies.family` (both Google Drive auth and passkey flows).
13. GSC + Bing: both properties verified, sitemap accepted, no coverage errors.
14. Staging preview: `X-Robots-Tag: noindex` present on every response.
15. 2 weeks post-launch: AI crawler hits visible in CloudFront logs at apex returning 200; GSC impressions growing.

## Rollback

Revert apex DNS + CloudFront to original Vue distribution (one Terraform apply). `app.beanies.family` distribution stays live — migrated users keep working. Vue marketing routes stay deployed until Phase 0 passes all checks, and Vue marketing code is deleted only after 2 weeks of clean production.

---

## Confirmed decisions

1. Subdomain: **`app.beanies.family`** ✓
2. 30-day OAuth dual-URI window: ✓
3. One-time PWA re-install + re-login at cutover: ✓
4. Staging: **`staging.beanies.family`** ✓
