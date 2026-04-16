# Plan: Consolidate Help Center to Astro — In-App Link Opens Apex in New Tab

> Date: 2026-04-16
> Related issues: #167 (parent SEO/AIO epic). No new issue — direct implementation.

---

## Context

After the Phase C apex cutover (2026-04-14), help articles live in **two places**:

- `beanies.family/help` — Astro static site (pixel-perfect redesign shipped overnight in commit `110baef`), indexed by search engines and AI crawlers, with dynamic OG images, MiniSearch island, JSON-LD, RSS, and sitemap entries.
- `app.beanies.family/help` — Vue SPA pages (`HelpCenterPage.vue`, `HelpCategoryPage.vue`, `HelpArticlePage.vue`) rendered inside the PWA shell.

Both already import from the same content modules (`src/content/help/`) via the `@/content/help` alias — **content is a single source of truth**. But chrome, layout, and rendering are duplicated, and the new pixel-perfect redesign has not been ported back to Vue. That means every future help styling change would have to be made twice.

**Decision (reached in conversation):** Kill the Vue help pages. In-app "help" links open `beanies.family/help` in a new tab. Benefits: single codebase for help articles, PWA shell preserved in the original tab, and a future in-app LLM chat widget remains orthogonal (different product surface, belongs in Vue where it can be context-aware).

Out of scope: `/privacy`, `/terms`, `/blog` have similar Vue/Astro duplication and will get separate cleanup PRs.

---

## DRY & Simplicity Review (done before drafting)

Key findings from code audit that shaped the approach:

| Concern                          | Existing pattern found                                                                                                          | Approach                                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| External link anchors            | 10+ inline `target="_blank" rel="noopener"` in codebase (`HomePage.vue`, `VacationIdeaCard.vue`, `PrivacyPolicyPage.vue`, etc.) | Stay with inline `<a>` pattern — no utility function needed                                                            |
| Sidebar nav def                  | `NavItemDef` already has optional fields (`comingSoon?`, `badgeKey?`)                                                           | Extend with `external?` + `externalUrl?` — fits existing shape                                                         |
| Public nav links prop            | `PublicNav.vue` already has `{ label, href, scrollTo? }[]`                                                                      | Extend with `external?` — matches existing shape                                                                       |
| Same-origin redirects in router  | `{ path: '/beanstalk', redirect: '/blog' }` pattern exists                                                                      | Cross-origin needs `beforeEnter`, but reuse `NotFoundPage.vue` as placeholder component — no new `RedirectingPage.vue` |
| `VITE_*` env vars                | 11 existing inline usages; no central config module                                                                             | Single constant in `src/utils/marketing.ts` — one import everywhere                                                    |
| Programmatic `window.open` calls | Only 2 places need it (AppHeader, WhatsNewModal)                                                                                | Inline — not worth a wrapper function                                                                                  |
| Help content                     | Already shared at `src/content/help/`, Astro reads via `@/*` alias pointing to repo root                                        | Leave untouched                                                                                                        |

Resulting change is **one new file** (`src/utils/marketing.ts` — a single exported constant) plus edits to existing files.

---

## Approach (in order of implementation)

### 1. Add `MARKETING_URL` constant (1 file, new)

Create `src/utils/marketing.ts`:

```typescript
export const MARKETING_URL =
  (import.meta.env.VITE_MARKETING_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:4321' : 'https://beanies.family');
```

One constant, two environments, no helper functions. Matches the existing `VITE_*` inline-usage pattern but keeps the default in one place.

### 2. Extend `NavItemDef` with external-link support

`src/constants/navigation.ts` — add two optional fields to the existing interface:

```typescript
export interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  section: NavSection;
  comingSoon?: boolean;
  badgeKey?: string;
  external?: boolean; // NEW
  externalUrl?: string; // NEW
}
```

Mark the help entry external:

```typescript
{
  labelKey: 'nav.help',
  path: '/help',            // kept — used as :key and identity
  emoji: '\u{1F4DA}',
  section: 'pinned',
  external: true,
  externalUrl: `${MARKETING_URL}/help`,
},
```

### 3. Teach sidebar `navigateTo` to handle external items

`src/components/common/AppSidebar.vue`:

- Change `navigateTo(path)` → `navigateTo(item)` (pass whole item).
- Branch: `if (item.external && item.externalUrl) { window.open(item.externalUrl, '_blank', 'noopener,noreferrer'); return; }` else `router.push(item.path)`.
- `isActive(item.path)` stays as-is (returns false for external paths naturally — they're never the current route).
- Update both `@click` handlers (L139 and L174) to pass `item` not `item.path`.

### 4. Extend `PublicNav.vue` to render external links

`src/components/public/PublicNav.vue` — link type already supports `scrollTo?`. Add `external?`:

```typescript
interface Props {
  links?: { label: string; href: string; scrollTo?: boolean; external?: boolean }[];
}
```

Template gains a third branch in the `v-for`:

```vue
<template v-for="link in links" :key="link.href">
  <a v-if="link.scrollTo" :href="link.href" @click.prevent="handleLinkClick(link)">{{
    link.label
  }}</a>
  <a v-else-if="link.external" :href="link.href" target="_blank" rel="noopener noreferrer">{{
    link.label
  }}</a>
  <router-link v-else :to="link.href">{{ link.label }}</router-link>
</template>
```

### 5. Update in-app help call sites (5 spots)

All small edits, no new abstractions:

- `src/components/common/AppHeader.vue:161-163` — `handleOpenHelp()`: replace `router.push('/help')` with `window.open(` + `${MARKETING_URL}/help` + `, '_blank', 'noopener,noreferrer')`. The desktop + mobile dropdown buttons both call this same function (no duplication to fix there).
- `src/components/common/WhatsNewModal.vue:28` — `handleSeeAll()`: replace `router.push('/help/whats-new')` with `window.open(` + `${MARKETING_URL}/help/whats-new` + `, '_blank', 'noopener,noreferrer')`.
- `src/components/public/PublicFooter.vue:26` — replace `<router-link to="/help">help</router-link>` with `<a :href="MARKETING_URL + '/help'" target="_blank" rel="noopener noreferrer">help</a>` (matches the pattern of the GitHub link already in this file, L24).
- `src/pages/HomePage.vue:1209` — same treatment for the landing-page footer.
- `src/pages/BeanstalkBlogPage.vue:24` and `src/pages/BeanstalkPostPage.vue:52` — update the `{ label: 'help', href: '/help' }` entry to `{ label: 'help', href: `${MARKETING_URL}/help`, external: true }`.

### 6. Router: delete help pages, add catch-all cross-origin redirect

`src/router/index.ts`:

- Delete the three help route entries (L133–150).
- Insert one catch-all above the NotFound route:

```typescript
{
  path: '/help/:pathMatch(.*)*',
  beforeEnter: (to) => {
    window.location.replace(`${MARKETING_URL}${to.fullPath}`);
  },
  component: () => import('@/pages/NotFoundPage.vue'), // placeholder — never renders
},
```

Reuses the existing `NotFoundPage.vue` component (already lazy-loaded) as a never-rendered placeholder. Vue Router requires a `component` but `window.location.replace` navigates away before render. No `RedirectingPage.vue` needed.

### 7. Delete unused Vue help code

- `src/pages/HelpCenterPage.vue`
- `src/pages/HelpCategoryPage.vue`
- `src/pages/HelpArticlePage.vue`
- `src/components/help/HelpArticleCard.vue`
- `src/components/help/HelpArticleRenderer.vue`
- `src/composables/useHelpSearch.ts`

**Keep:**

- `src/content/help/` — Astro still consumes
- `src/components/help/HelpPublicHeader.vue` — still used by PrivacyPolicyPage + TermsOfServicePage
- `public/help/pwa-install/*.jpg` — serve the in-app PWA install guide images. Deferred cleanup: delete from Vue's `public/` only after verifying `web/public/help/pwa-install/` has the same files and Astro serves them. Do as a probe before shipping (step 1 of verification below).

### 8. i18n cleanup

Grep `src/services/translation/uiStrings.ts` for `help.*` keys. Remove any referenced ONLY by the deleted Vue pages. Keep `nav.help` (sidebar label still renders) and any `help.*` key referenced elsewhere (verify with `grep -r "help\." src/ --include='*.vue' --include='*.ts'`).

Run `npm run translate` afterwards — per CLAUDE.md translation-script-sync rule, the parser can silently break on structural changes.

### 9. Documentation

- `CHANGELOG.md` — 2026-04-16 entry under `### Changed`: "Help center consolidated to the Astro site. In-app `Help` link now opens `beanies.family/help` in a new tab, preserving your PWA session. One codebase for help articles going forward."
- `docs/STATUS.md` — update the most recent dated session block noting the consolidation and the offline-help trade-off.
- No ADR needed (this is a follow-on to the cutover, not a new architectural decision).

---

## Files Affected

**Created (1):**

- `src/utils/marketing.ts`

**Modified (12):**

- `src/constants/navigation.ts`
- `src/components/common/AppSidebar.vue`
- `src/components/common/AppHeader.vue`
- `src/components/common/WhatsNewModal.vue`
- `src/components/public/PublicNav.vue`
- `src/components/public/PublicFooter.vue`
- `src/pages/HomePage.vue`
- `src/pages/BeanstalkBlogPage.vue`
- `src/pages/BeanstalkPostPage.vue`
- `src/router/index.ts`
- `src/services/translation/uiStrings.ts`
- `CHANGELOG.md` + `docs/STATUS.md`

**Deleted (6):**

- `src/pages/HelpCenterPage.vue`
- `src/pages/HelpCategoryPage.vue`
- `src/pages/HelpArticlePage.vue`
- `src/components/help/HelpArticleCard.vue`
- `src/components/help/HelpArticleRenderer.vue`
- `src/composables/useHelpSearch.ts`
- (Conditional) `public/help/pwa-install/*.jpg` — only if Astro equivalents verified

**Not touched:**

- `src/content/help/*` — shared with Astro
- `src/components/help/HelpPublicHeader.vue` — privacy/terms still use it
- Any Astro / `web/` code
- CloudFront, Terraform, Lambda config

---

## Important Notes & Caveats

- **Offline trade-off**: current Vue help pages work offline via bundled content; post-change help requires network. Acceptable for MVP (help was rarely consulted offline). Future in-app LLM chat widget can fill the gap.
- **Installed-PWA new-tab behavior**: Android Custom Tabs / iOS Safari open — original PWA window untouched. Desired pattern (matches Notion, Linear, Slack).
- **Catch-all scope**: `/help/:pathMatch(.*)*` only matches SPA navigation requests — static asset paths (`/help/pwa-install/*.jpg`) are served by CloudFront from S3 directly and never hit the Vue router. Verify the CloudFront distribution's SPA-fallback rule doesn't rewrite `.jpg` requests to `index.html` — if it does, images would redirect; if not (typical), they're safe.
- **Image parity**: content references `/help/pwa-install/*.jpg`. For Astro at apex to render `src/content/help/getting-started.ts` correctly, those images must exist under `web/public/help/pwa-install/`. Verify before deleting from Vue's `public/`.
- **WhatsNewModal `/help/whats-new`**: Astro exposes `whats-new` as a help category (per `HELP_CATEGORIES` in `src/content/help/categories.ts`). Verify the URL resolves on apex.
- **CloudFront-level 301 alternative (not chosen)**: a viewer-request CloudFront Function on the `app.beanies.family` distribution could do proper 301 redirects without loading the SPA. More optimal at runtime but adds infra PR surface. Deferred — revisit if stale-URL volume matters. Vue-side redirect is adequate for the expected volume (browser history + a few shared links).

---

## Assumptions (verify before implementation)

1. `web/public/help/pwa-install/` contains the same 7 images as `public/help/pwa-install/` (commit `110baef` should have handled it — confirm file-by-file).
2. Astro exposes the same URL structure as the Vue app: `/help`, `/help/<category>`, `/help/<category>/<slug>`, `/help/whats-new`. Confirm by hitting those on `beanies.family` before deleting Vue routes.
3. No E2E specs exercise `/help` routes (grep initially matched `helpers/` directory names — re-verify with a strict `router.push('/help')` search in `e2e/`).
4. The Vue app's CloudFront distribution does NOT rewrite `.jpg` requests under `/help/pwa-install/` to the SPA `index.html`. (It shouldn't — standard S3 static-asset behavior.)

---

## Verification Plan

### Pre-flight probes (before any code changes)

1. File-diff `web/public/help/pwa-install/` against `public/help/pwa-install/` — must be identical.
2. Browser hit `https://beanies.family/help`, `/help/features/budgets`, `/help/whats-new` — all 200.
3. `grep -rn "router.push.*['\"]\/help" e2e/` — expect zero matches.
4. `grep -rn "\bhelp\." src/ --include='*.vue' --include='*.ts' | grep -v '@/content/help\|help\.category\|help\.title\|nav\.help'` — shortlist of `help.*` i18n keys that may become dead; cross-reference against deleted files.

### Automated (after changes)

5. `npm run type-check` — no errors.
6. `npm run lint` — no errors.
7. `npm run translate` — parser succeeds (CLAUDE.md rule).
8. `npm run test` — unit tests green.
9. `npm run e2e -- --project=chromium` — all 21 specs green.
10. `npm run build` — measure Vue bundle delta; record in commit message (should drop ~several KB from help chunks + MiniSearch island removal).

### Manual — desktop Chrome

11. `npm run dev:all` → log in at `localhost:5173` → click sidebar "help" → new tab opens `localhost:4321/help`; original tab unchanged.
12. AppHeader profile dropdown → "help" → same behavior.
13. Profile dropdown → "what's new" → opens `localhost:4321/help/whats-new`.
14. In a new tab, navigate directly to `localhost:5173/help` → redirects to `localhost:4321/help`.
15. `localhost:5173/help/features/budgets` → redirects preserving path.
16. Inspect network: `rel="noopener noreferrer"` on all new anchors.
17. Landing page (`/home`) footer "help" link → new tab to apex help.
18. Blog (`/blog`) nav bar "help" → new tab.

### Manual — installed PWA

19. Install PWA on Chrome Android → click sidebar help → opens in Custom Tabs; PWA window intact.
20. Same check on iOS Safari installed PWA.

### Post-deploy smoke

21. Hit `app.beanies.family/help` in prod browser → redirects to `beanies.family/help`.
22. Plausible pageview still fires for the original PWA session (redirect is cross-origin, so the PWA pageview doesn't dupe to apex).

---

## Acceptance Criteria

- [ ] Pre-flight probes (1–4) all green.
- [ ] Sidebar "help" opens `beanies.family/help` in new tab.
- [ ] AppHeader dropdown "help" opens in new tab.
- [ ] "What's new" modal's "see all" opens in new tab.
- [ ] Landing-page + PublicFooter "help" links open in new tab.
- [ ] `/blog` and `/blog/:slug` nav-bar "help" opens in new tab.
- [ ] Direct visit to `app.beanies.family/help` or any `/help/...` path redirects to apex equivalent.
- [ ] No TypeScript, lint, or translation-parser errors.
- [ ] All E2E tests pass on Chromium.
- [ ] Vue bundle size drops (delta recorded in commit).
- [ ] `CHANGELOG.md` + `docs/STATUS.md` updated.
- [ ] Six deleted files removed; `src/content/help/` + `HelpPublicHeader.vue` + `nav.help` key preserved.

---

## Prompt Log

<details>
<summary>Full prompt history (no GitHub issue created)</summary>

### Initial prompt (morning context-gathering)

> Question - the help pages I believe have been migrated to astro, and i can access them at beanies.family/help. There is also an entry in the app sidebar "help" - if i click on that I can see the help center, but the url is app.beanies.com/help. Are these both being served by astro, or is there an issue there we need to align?

### Follow-up 1

> If we redirect the help in the sidebar to the astro pages, will that still load help pages within the app shell, or will it bring the user outside of the app?

### Follow-up 2

> What about help opening in a new tab, and only keeping the astro pages? So we only maintain one codebase for help pages, and help is treated as a standalone page. I'm also thinking about in the future, when we potentially add LLM / openrouter capability to the help section

### Follow-up 3

> If we go that route, in the future, would we still be able to have an LLM-powered "help chat widget" in the app?

### Follow-up 4 (approval to plan)

> ok - make the plan as agreed above to implement help in new tab on astro

### Follow-up 5 (first draft review + DRY mandate)

> 1. no need to open a github issue
> 2. the plan looks good. please open in plan mode. please perform the usual DRY checks -> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, and following all DRY principles - you are not re-writing or repeating any code. Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later. Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, overly complicated flows, or code bloat where not necessary.

</details>
