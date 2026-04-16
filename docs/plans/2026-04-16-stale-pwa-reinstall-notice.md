# Plan: Stale-PWA Re-install Notice Modal

> Date: 2026-04-16
> Related issues: #167 (parent SEO/AIO / Astro cutover epic)
> Plan file on disk (post-approval): `docs/plans/2026-04-16-stale-pwa-reinstall-notice.md`

---

## Context

The Phase C apex cutover (2026-04-14) moved the marketing site to Astro at `beanies.family` and the Vue PWA to `app.beanies.family`. Users who installed the PWA **before** the cutover have its `start_url: '/'` baked into the installed icon, pointing at the old `beanies.family` origin. When they tap that icon now, the origin serves Astro static HTML, not the Vue app.

**What already exists (don't rebuild):** `web/src/layouts/BaseLayout.astro:117-136` already handles this — a `is:inline` script detects `display-mode: standalone` at apex and `window.location.replace`s to `https://app.beanies.family<path>`, so the user is bounced into the Vue app. Their data isn't lost (it's in their `.beanpod` file / Google Drive), but:

- The bounced-into Vue app runs as a **browser tab**, not as an installed PWA (the old PWA's scope is locked to the old origin).
- Each launch of the stale icon goes through the redirect → browser-tab experience.
- Users aren't told to re-install from `app.beanies.family` to get the native PWA shell back.

**Goal:** Show a one-time dismissable modal on first-visit-after-stale-PWA-bounce that explains the situation, reassures about data safety, and guides the user through re-installing from the new origin. Design it so future similar "conditional one-time notice" situations can reuse the pattern cheaply.

Out of scope: ripping out the existing apex redirect, changing PWA manifest, or migrating IndexedDB between origins.

---

## DRY & Simplicity Review (done before drafting)

Key findings from code audit that shaped the approach:

| Concern                             | Existing pattern found                                                                                                                                | Approach                                                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PWA standalone detection            | `src/composables/usePWA.ts:30-31` already has `isInstalled` via `matchMedia('(display-mode: standalone)').matches \|\| navigator.standalone === true` | Reuse — no new detection composable                                                                                                                                                   |
| Modal shape/UX pattern              | `src/components/common/WhatsNewModal.vue` — gradient strip + title + feature cards + CTA footer, all via `BaseModal`                                  | Mirror the structure for `PwaReinstallModal.vue`; reuse `BaseModal`                                                                                                                   |
| Dismiss via localStorage            | `src/composables/useWhatsNew.ts` uses `STORAGE_KEY = 'beanies-lastSeenWhatsNew'` + version compare                                                    | Introduce ONE reusable `noticeFlag(key)` utility that provides `isActive/activate/dismiss/clear`. Kept simple — plain function, not a composable                                      |
| Apex-side standalone detection      | `web/src/layouts/BaseLayout.astro:117-136` already redirects with path preserved                                                                      | Extend with `?from-stale-pwa=1` query param — one-line change                                                                                                                         |
| Platform-aware install steps        | `src/content/help/getting-started.ts` — article `install-as-app` has iOS/Android/desktop sections + screenshots                                       | Condense into modal, link out to `beanies.family/help/getting-started/install-as-app` for full guide                                                                                  |
| Analytics                           | `window.plausible?.('event_name', { props: {...} })` used 10+ places                                                                                  | Same pattern — new `pwa_stale_*` events                                                                                                                                               |
| E2E suppression flag                | `WhatsNewModal` checks `sessionStorage.getItem('e2e_auto_auth')` to skip during E2E                                                                   | Same check in `PwaReinstallModal` — blocks specs from being derailed                                                                                                                  |
| Future-proofing for similar notices | `useWhatsNew` is ONE use of "flag + modal + dismiss"; this plan adds a SECOND use                                                                     | Extract the **flag mechanics** (localStorage key pattern) as `noticeFlag(key)` — modal chrome stays per-use-case. Premature to abstract the modal chrome for a third speculative case |

Resulting change is **three new files + two small edits**: one tiny utility (reusable), one detector composable (specific), one modal (specific), plus extending the existing Astro redirect + wiring the modal into `App.vue`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  OLD PWA (installed at beanies.family origin, pre-cutover)               │
│  start_url: /                                                            │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ user taps icon
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  ASTRO APEX — BaseLayout.astro L117-136                                  │
│  Inline script: detect display-mode: standalone                          │
│  EXTEND: add ?from-stale-pwa=1 query param to redirect target            │
│  → window.location.replace('https://app.beanies.family<path>?from-...')  │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  VUE APP (app.beanies.family) — App.vue setup                            │
│  useStalePwaNotice() reads URL param → activates noticeFlag('stalePwa')  │
│  → strips param from URL (history.replaceState)                          │
│  → if running in new-PWA standalone mode here, clears the flag           │
│    (user has successfully re-installed — no modal next launch)           │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  PwaReinstallModal.vue (mounted globally in App.vue)                     │
│  v-if noticeFlag('stalePwa').isActive()                                  │
│  Platform-aware install steps (UA sniff), data-safety reassurance,       │
│  dismiss button, CTA link to /help/getting-started/install-as-app        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Approach (in order of implementation)

### 1. Introduce reusable `noticeFlag` utility

New file `src/utils/notice.ts`:

```typescript
/**
 * Conditional one-time notice flag backed by localStorage.
 *
 * Use for dismissable modals triggered by a specific detected condition
 * (a migration, a breaking-change announcement, etc). Each situation gets
 * its own key. Pair with a detector that calls `activate()` when the
 * condition is detected, and a modal that checks `isActive()` + calls
 * `dismiss()` on the dismiss button.
 *
 * Keys are namespaced under `beanies:notice:{key}:...` to avoid collision
 * with other localStorage usage.
 *
 * Example: see `useStalePwaNotice.ts`
 */
export function noticeFlag(key: string) {
  const showKey = `beanies:notice:${key}:show`;
  const dismissKey = `beanies:notice:${key}:dismissed`;
  return {
    isActive(): boolean {
      try {
        return (
          localStorage.getItem(showKey) === 'true' && localStorage.getItem(dismissKey) !== 'true'
        );
      } catch {
        return false;
      }
    },
    activate(): void {
      try {
        localStorage.setItem(showKey, 'true');
      } catch {
        /* storage unavailable */
      }
    },
    dismiss(): void {
      try {
        localStorage.setItem(dismissKey, 'true');
      } catch {
        /* storage unavailable */
      }
    },
    clear(): void {
      try {
        localStorage.removeItem(showKey);
        localStorage.removeItem(dismissKey);
      } catch {
        /* storage unavailable */
      }
    },
  };
}
```

Reusable for any future one-time notice. Plain function, not a composable (no reactivity needed — modal re-renders on route change / explicit event).

### 2. Add the detector: `useStalePwaNotice`

New file `src/composables/useStalePwaNotice.ts`:

```typescript
import { ref, readonly } from 'vue';
import { noticeFlag } from '@/utils/notice';

const QUERY_PARAM = 'from-stale-pwa';
const NOTICE_KEY = 'stalePwa';

const flag = noticeFlag(NOTICE_KEY);
const shouldShow = ref(false);

let initialized = false;

/**
 * Initializes stale-PWA detection. Called once at App.vue mount.
 *
 * Flow:
 *  1. If URL has `?from-stale-pwa=1`, the user was redirected from the old
 *     apex PWA shell. Activate the notice flag and strip the param from URL.
 *  2. If running at app.beanies.family in standalone mode, the user has
 *     already successfully re-installed — clear the flag.
 *  3. Update reactive `shouldShow` from flag state.
 */
export function useStalePwaNotice() {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true;

    const url = new URL(window.location.href);
    if (url.searchParams.get(QUERY_PARAM) === '1') {
      flag.activate();
      url.searchParams.delete(QUERY_PARAM);
      const cleaned =
        url.pathname +
        (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') +
        url.hash;
      window.history.replaceState({}, '', cleaned);
      window.plausible?.('pwa_stale_detected');
    }

    // User is currently running as an installed PWA at app.beanies.family →
    // they've successfully re-installed. Clear any stale flag.
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (isStandalone) flag.clear();

    shouldShow.value = flag.isActive();
  }

  function dismiss() {
    flag.dismiss();
    shouldShow.value = false;
    window.plausible?.('pwa_stale_dismissed');
  }

  function trackInstallClicked() {
    window.plausible?.('pwa_stale_install_clicked');
  }

  return {
    shouldShow: readonly(shouldShow),
    dismiss,
    trackInstallClicked,
  };
}
```

Module-scoped state (singleton pattern, same as `usePWA.ts` uses). Safe to call from multiple components.

### 3. The modal: `PwaReinstallModal.vue`

New file `src/components/common/PwaReinstallModal.vue`. Structure mirrors `WhatsNewModal.vue` closely — same `BaseModal` wrapper, gradient strip header, body-with-cards pattern, CTA footer. Key differences:

- Reads visibility from `useStalePwaNotice`
- Platform detection (plain UA sniff — iOS/Android/desktop) selects which step-set to render
- Embeds the matching screenshots from `public/help/pwa-install/` (same ones the help article uses)
- Footer CTA: "See full guide →" (external `<a>` to `${MARKETING_URL}/help/getting-started/install-as-app` target=\_blank, consistent with the help-consolidation PR pattern)
- Primary action button: "Got it, I'll re-install" (dismisses)
- E2E suppression: `sessionStorage.getItem('e2e_auto_auth')` short-circuit

Rough shape (abbreviated):

```vue
<script setup lang="ts">
import { computed } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useStalePwaNotice } from '@/composables/useStalePwaNotice';
import { useTranslation } from '@/composables/useTranslation';
import { MARKETING_URL } from '@/utils/marketing';

const { t } = useTranslation();
const { shouldShow, dismiss, trackInstallClicked } = useStalePwaNotice();

type Platform = 'ios' | 'android' | 'desktop';

const platform = computed<Platform>(() => {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
});

const openModal = computed(() => shouldShow.value && !sessionStorage.getItem('e2e_auto_auth'));

function handleGuideClick() {
  trackInstallClicked();
  // Don't dismiss on link-click — the user may want to dismiss separately
  // after they've completed re-install.
}
</script>

<template>
  <BaseModal :open="openModal" size="lg" fullscreen-mobile custom-header @close="dismiss">
    <template #header>
      <!-- gradient strip + title row — pattern matches WhatsNewModal -->
    </template>
    <div class="-mx-6 -mt-6 -mb-6 px-7 py-6">
      <!-- Reassurance lead -->
      <!-- Context paragraph -->
      <!-- Platform-specific steps (v-if on platform) -->
      <!-- Screenshot references from /help/pwa-install/ -->
    </div>
    <template #footer>
      <!-- Primary dismiss button + secondary "see full guide" link -->
    </template>
  </BaseModal>
</template>
```

### 4. Mount the modal in App.vue

Two-line change: import + add `<PwaReinstallModal />` next to the existing `<WhatsNewModal />` (currently at `src/App.vue:888`).

### 5. Extend Astro redirect with URL param

`web/src/layouts/BaseLayout.astro` — current L124-131:

```js
if (isStandalone || isIOS) {
  var target =
    'https://app.beanies.family' +
    window.location.pathname +
    window.location.search +
    window.location.hash;
  window.location.replace(target);
}
```

Replace target construction with URL-API for clean param append:

```js
if (isStandalone || isIOS) {
  var url = new URL(
    'https://app.beanies.family' +
      window.location.pathname +
      window.location.search +
      window.location.hash
  );
  url.searchParams.set('from-stale-pwa', '1');
  window.location.replace(url.toString());
}
```

`URL` constructor is available in all PWA-capable browsers. Still wrapped in the existing `try/catch` — falls through to marketing if unsupported (but no modern browser in this bucket).

### 6. i18n keys + content

Add to `src/services/translation/uiStrings.ts` under a new `pwaReinstall.*` section:

- `pwaReinstall.title` — "Please Re-install"
- `pwaReinstall.subtitle` — "We moved to a new home — here's what to do"
- `pwaReinstall.reassurance` — "Your data is safe 🫘 — your family file, Google Drive sync, and password are untouched. Nothing has been lost."
- `pwaReinstall.context` — "A one-time backend update means the home-screen icon you installed is pointing to the old address. To get the full app experience back, you'll want to re-install from our new home."
- `pwaReinstall.stepsHeading` — "To re-install:"
- `pwaReinstall.iosStep1/2/3`, `pwaReinstall.androidStep1/2/3`, `pwaReinstall.desktopStep1/2/3`
- `pwaReinstall.seeFullGuide` — "See the full install guide →"
- `pwaReinstall.dismiss` — "Got it, thanks"
- `pwaReinstall.oneTimeNote` — "This is a one-time change — we won't do this regularly, promise."

Both `en` and `beanie` variants per the CLAUDE.md text-casing standard. Run `npm run translate` after.

### 7. Documentation

- `CHANGELOG.md` — 2026-04-16 entry under `### Added`: "PWA re-install notice for users who installed the app before the Astro cutover. Shows a one-time dismissable modal explaining why + how to re-install from the new app.beanies.family home. Your data is unaffected."
- `docs/STATUS.md` — append to current dated block.
- No ADR needed (follow-on to cutover, not new architecture).

---

## Files Affected

**Created (3):**

- `src/utils/notice.ts` — reusable `noticeFlag(key)` utility
- `src/composables/useStalePwaNotice.ts` — this-situation-specific detector
- `src/components/common/PwaReinstallModal.vue` — the modal

**Modified (5):**

- `web/src/layouts/BaseLayout.astro` — append `?from-stale-pwa=1` to the existing redirect (L124-131)
- `src/App.vue` — import + mount `<PwaReinstallModal />` alongside `<WhatsNewModal />`
- `src/services/translation/uiStrings.ts` — add `pwaReinstall.*` keys (~15 entries, en + beanie)
- `CHANGELOG.md` — 2026-04-16 entry
- `docs/STATUS.md` — session block append

**Not touched:**

- `src/composables/useWhatsNew.ts` — existing version-based notice, different flavor. Don't refactor it to use `noticeFlag` — it checks against a release-note version, not a boolean flag, and mixing would be awkward. Leave alone; the `noticeFlag` utility is for future boolean-flag notices
- `src/composables/usePWA.ts` — existing standalone detection is for the `beforeinstallprompt` flow; the new composable's detection is simpler and independent. Sharing would couple two unrelated lifecycles
- Astro help content — already covers install steps, we just link to it
- PWA manifest, SW — out of scope, existing behavior preserved

---

## Important Notes & Caveats

- **Don't nag users who dismissed**: Once dismissed, the `beanies:notice:stalePwa:dismissed` flag stays until they clear localStorage, which is exactly right. A user may choose to just use the browser-tab version and never re-install; respect that.
- **Auto-clear when re-installed**: If the user re-installs the PWA at `app.beanies.family`, subsequent visits from that standalone PWA clear both `show` and `dismissed` flags — a fresh state. If they later tap the OLD home-screen icon (still exists on their device), the redirect fires again, param activates flag, modal reappears. That's correct — they should be told to remove the old icon too.
- **iOS programmatic-install limitation**: `beforeinstallprompt` does not fire on iOS Safari. The modal's primary CTA is not "install now" — it's "got it, I'll re-install manually" + instructions. This avoids browser-specific button-disabled logic.
- **E2E suppression**: Use the same `sessionStorage.getItem('e2e_auto_auth')` check WhatsNewModal uses. Otherwise a stray `?from-stale-pwa=1` in test setup could block specs.
- **Do NOT remove the existing apex redirect**: it's doing useful work — without it, users hit the Astro marketing site and bounce out thinking the app is gone.
- **Content copy tone**: lowercase brand voice, reassurance first, honest about the one-time-ness. "your data is safe" before anything else.
- **URL param strip is essential**: without `history.replaceState`, the param sticks in the URL and could be shared/bookmarked, creating false positives.
- **Test on actual devices if possible**: `display-mode: standalone` is tricky to fake reliably. Chrome DevTools device emulation can set it via "Show rendering" → "Emulate CSS media feature".

---

## Assumptions (verify before implementation)

1. `web/public/help/pwa-install/*.jpg` images are served by Astro at `beanies.family/help/pwa-install/...` (previously verified during help consolidation — remains true).
2. The Vue PWA at `app.beanies.family` will receive `/?from-stale-pwa=1` cleanly — the router already handles unknown query params and the home route `/` redirects to `/nook` (router.ts L9-11). The param will survive that redirect and land in the URL when App.vue mounts. Verify: add a test param mid-implementation.
3. `beanies.family/help/getting-started/install-as-app` is the correct URL on Astro — confirmed via `src/content/help/getting-started.ts` slug `install-as-app`.
4. Plausible supports custom events `pwa_stale_detected`, `pwa_stale_dismissed`, `pwa_stale_install_clicked` — yes, Plausible accepts arbitrary event names.

---

## Verification Plan

### Pre-flight probes (before changes)

1. Confirm `/` route in Vue router redirects to `/nook` cleanly preserving query params. Test: `app.beanies.family/?test=1` in browser — does `test=1` remain readable in App.vue's `window.location.search`? If not, the param-preservation assumption breaks and we need to extract it before the redirect.
2. Confirm no existing `beanies:notice:*` localStorage keys in any code path (no collision).
3. Confirm `beanies.family/help/getting-started/install-as-app` resolves 200 on production apex.

### Automated (after changes)

4. `npm run type-check` — no errors.
5. `npm run lint` — no errors.
6. `npm run translate` — parser succeeds, ~15 new keys picked up.
7. `npm run test` — all unit tests pass (new 30-line unit test for `noticeFlag` added).
8. `npm run test:e2e:chromium` — all specs pass, E2E suppression flag prevents modal from appearing during tests.
9. `npm run build` — Vue bundle built. Astro build also rerun locally (new BaseLayout.astro).

### Manual — simulate stale PWA

10. Start `npm run dev:all`. Open `http://localhost:5173/?from-stale-pwa=1` in a regular browser tab.
11. Expect: modal appears. Query param stripped from URL after mount. Localstorage shows `beanies:notice:stalePwa:show=true`.
12. Dismiss. Expect: modal closes. Localstorage shows `beanies:notice:stalePwa:dismissed=true`. Refresh page — modal stays closed.
13. Clear `beanies:notice:stalePwa:dismissed` in DevTools. Refresh — modal reopens.
14. Clear all `beanies:notice:stalePwa:*` keys. Navigate to `http://localhost:5173/` (no param). Expect: no modal.
15. Chrome DevTools → Rendering → Emulate CSS media feature `display-mode: standalone`. Reload. Expect: the "clear flag" branch fires (simulates user being on new PWA).
16. Visit `http://localhost:4321/` (Astro dev). Open DevTools → Rendering → Emulate `display-mode: standalone`. Reload. Expect: inline script tries to redirect to `app.beanies.family/...` — won't work in dev because target is hardcoded. **Known limitation**: real end-to-end apex redirect can only be tested post-deploy.

### Manual — platform-specific modal content

17. Visit `/?from-stale-pwa=1` in Chrome DevTools device emulation (iPhone) — expect iOS steps + Share-menu screenshots.
18. Same with Galaxy emulation — expect Android steps + Chrome 3-dot-menu screenshot.
19. Regular desktop Chrome — expect desktop steps.

### Post-deploy smoke

20. Deploy Vue. Visit `app.beanies.family/?from-stale-pwa=1` in a private window — modal appears.
21. Deploy Astro. On a device that had the pre-cutover PWA installed, tap the old icon. Expect: redirect + `?from-stale-pwa=1` + modal in browser tab.
22. Check Plausible for `pwa_stale_detected` events — gives us real-world affected-user count.

---

## Acceptance Criteria

- [ ] `src/utils/notice.ts` exports `noticeFlag(key)` with the described API.
- [ ] `useStalePwaNotice()` detects URL param on first mount, activates flag, strips param from URL.
- [ ] Modal is platform-aware (iOS / Android / desktop) with correct step copy + screenshot for each.
- [ ] `BaseLayout.astro` redirect appends `?from-stale-pwa=1` to the target URL.
- [ ] Modal renders only when flag is active AND not dismissed AND not in E2E.
- [ ] Dismissing sets localStorage and hides modal for the session + future visits.
- [ ] Being in standalone mode at `app.beanies.family` clears the flag.
- [ ] Plausible events fire: `pwa_stale_detected`, `pwa_stale_dismissed`, `pwa_stale_install_clicked`.
- [ ] CTA links to `${MARKETING_URL}/help/getting-started/install-as-app` in new tab.
- [ ] No TypeScript, lint, or translation-parser errors.
- [ ] All E2E tests pass; new modal does not appear during E2E runs.
- [ ] `CHANGELOG.md` + `docs/STATUS.md` updated.
- [ ] `noticeFlag` utility has a small unit test covering isActive/activate/dismiss/clear.

---

## Reusability — How Future Similar Situations Plug In

When a new situation emerges ("we're deprecating feature X", "users in cohort Y need a notice", etc):

1. **Pick a key** — e.g., `'deprecationX'`.
2. **Write a tiny detector** — URL param, cookie, user-ID match, registry-flag, whatever — that calls `noticeFlag('deprecationX').activate()` when the condition is met.
3. **Write the modal** — copy `PwaReinstallModal.vue` structure, swap in your content and i18n keys. Reads from `noticeFlag('deprecationX').isActive()`.
4. **Mount it in `App.vue`** — one line alongside `<WhatsNewModal />` and `<PwaReinstallModal />`.

What you **don't** re-build: localStorage key conventions, dismiss mechanics, collision avoidance. That's `noticeFlag`'s job, permanently.

What's **intentionally not abstracted** (per DRY memory — don't over-engineer for speculation):

- Modal chrome: each notice may want different copy structures (lists, screenshots, CTAs). Copy-paste a modal is cheaper than parameterizing every slot.
- Detector logic: every situation has a unique trigger. Abstracting "how do I detect X" would be YAGNI.

If a third modal arrives and its shape is identical to the second, **then** extract `NoticeModal.vue` at that point. Not before.

---

## Prompt Log

<details>
<summary>Full prompt history (no GitHub issue created)</summary>

### Initial prompt

> Given our recent migration to astro which broke the PWA, I'd like to create a popup (similar to the new feature popup) for users who are using the PWA and have not re-installed it yet. The idea is that the popup would only show for users who still have the old PWA installed. The logic could be something like (a) Detected that PWA is open and (b) path is '/' which should never happen - or directly check the manifest to see it's the old one, etc - the popup would clearly say something like: 'I've made a small change to the back end. Don't worry, this won't be a regular thing and your data is perfectly safe, all you need to do is re-install the PWA by following the below steps: <...show the steps..> <link to pwa help page if more info needed>
>
> let me know if this is possible and your thoughts on this proposal?

### Follow-up 1

> Yes - pls go ahead as we could potentially re-use this if we have any similar situation in the future

</details>
