import {
  createRouter,
  createWebHistory,
  type LocationQuery,
  type RouteRecordRaw,
} from 'vue-router';
import { useTranslationStore } from '@/stores/translationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';
import { showToast } from '@/composables/useToast';
import { QUICK_ADD_CONTEXT_KEYS } from '@/constants/quickAddItems';
import { hardReload, isChunkLoadError } from '@/utils/hardReload';

const CHUNK_RELOAD_FLAG = 'chunkReloadAttempted';

/** Route that cross-origin-redirects to the Astro marketing site, preserving the full path. */
function externalRedirect(path: string, name: string): RouteRecordRaw {
  return {
    path,
    name,
    beforeEnter: (to) => {
      window.location.replace(`${MARKETING_URL}${to.fullPath}`);
    },
    component: () => import('@/pages/NotFoundPage.vue'), // placeholder — never renders
    meta: { requiresAuth: false },
  };
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/nook',
  },
  {
    // /home lives on the marketing site (beanies.family). If anyone hits
    // app.beanies.family/home, kick them over to the marketing apex. We
    // don't use externalRedirect() here because we want to collapse /home
    // onto the apex `/`, not preserve the /home suffix.
    path: '/home',
    name: 'Home',
    beforeEnter() {
      window.location.replace(`${MARKETING_URL}/`);
    },
    component: () => import('@/pages/NotFoundPage.vue'), // placeholder — never renders
    meta: { requiresAuth: false },
  },
  {
    path: '/welcome',
    name: 'Welcome',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'login.welcome', requiresAuth: false, hideQuickAdd: true },
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'login.title', requiresAuth: false, hideQuickAdd: true },
  },
  {
    path: '/join',
    name: 'JoinFamily',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'join.title', requiresAuth: false, hideQuickAdd: true },
    props: { initialView: 'join' },
  },
  {
    // Drive "Open with beanies.family" landing page. See OpenFromDrivePage.vue
    // for the full flow. Route is unauthenticated because new users may land
    // here before having a beanies session — Drive auto-handles OAuth before
    // the redirect, so we already have drive.file scope on arrival.
    path: '/open',
    name: 'OpenFromDrive',
    component: () => import('@/pages/OpenFromDrivePage.vue'),
    meta: { titleKey: 'openFromDrive.title', requiresAuth: false, hideQuickAdd: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/pages/DashboardPage.vue'),
    meta: { titleKey: 'nav.dashboard', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/accounts',
    name: 'Accounts',
    component: () => import('@/pages/AccountsPage.vue'),
    meta: { titleKey: 'nav.accounts', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/transactions',
    name: 'Transactions',
    component: () => import('@/pages/TransactionsPage.vue'),
    meta: { titleKey: 'nav.transactions', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/assets',
    name: 'Assets',
    component: () => import('@/pages/AssetsPage.vue'),
    meta: { titleKey: 'nav.assets', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/goals',
    name: 'Goals',
    component: () => import('@/pages/GoalsPage.vue'),
    meta: { titleKey: 'nav.goals', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/pages/ReportsPage.vue'),
    meta: { titleKey: 'nav.reports', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/forecast',
    name: 'Forecast',
    component: () => import('@/pages/ForecastPage.vue'),
    meta: { titleKey: 'nav.forecast', requiresAuth: true, requiresFinance: true },
  },
  // The Pod — landing + sub-nav destinations. Sub-pages for scrapbook,
  // cookbook, care & safety, and emergency contacts ship in later phases
  // (see docs/plans/2026-04-19-the-pod-scrapbook-cookbook.md); those
  // routes redirect to /pod for now so the sidebar stays navigable.
  {
    path: '/pod',
    name: 'Pod',
    component: () => import('@/pages/MeetTheBeansPage.vue'),
    meta: { titleKey: 'nav.pod', requiresAuth: true },
  },
  {
    path: '/pod/:memberId([0-9a-f-]{36})',
    redirect: (to) => `/pod/${to.params.memberId as string}/overview`,
  },
  {
    path: '/pod/:memberId([0-9a-f-]{36})/:tab(overview|favorites|sayings|allergies|medications|notes)',
    name: 'BeanDetail',
    component: () => import('@/pages/BeanDetailPage.vue'),
    meta: { titleKey: 'bean.detail.title', requiresAuth: true },
  },
  {
    path: '/pod/scrapbook',
    name: 'FamilyScrapbook',
    component: () => import('@/pages/FamilyScrapbookPage.vue'),
    meta: { titleKey: 'scrapbook.title', requiresAuth: true },
  },
  {
    path: '/pod/cookbook',
    name: 'FamilyCookbook',
    component: () => import('@/pages/FamilyCookbookPage.vue'),
    meta: { titleKey: 'cookbook.title', requiresAuth: true },
  },
  {
    path: '/pod/cookbook/:recipeId([0-9a-f-]{36})',
    name: 'RecipeDetail',
    component: () => import('@/pages/RecipeDetailPage.vue'),
    meta: { titleKey: 'cookbook.title', requiresAuth: true },
  },
  {
    path: '/pod/safety',
    name: 'CareSafety',
    component: () => import('@/pages/CareSafetyPage.vue'),
    meta: { titleKey: 'careSafety.title', requiresAuth: true },
  },
  {
    path: '/pod/contacts',
    name: 'EmergencyContacts',
    component: () => import('@/pages/EmergencyContactsPage.vue'),
    meta: { titleKey: 'contacts.title', requiresAuth: true },
  },
  // Legacy /family URL preserved for bookmarks + external links.
  {
    path: '/family',
    redirect: '/pod',
  },
  {
    path: '/nook',
    name: 'Nook',
    component: () => import('@/pages/FamilyNookPage.vue'),
    meta: { titleKey: 'nav.nook', requiresAuth: true },
  },
  {
    path: '/activities',
    name: 'Activities',
    component: () => import('@/pages/FamilyPlannerPage.vue'),
    meta: { titleKey: 'nav.activities', requiresAuth: true },
  },
  {
    path: '/travel',
    name: 'Travel',
    component: () => import('@/pages/TravelPlansPage.vue'),
    meta: { titleKey: 'nav.travel', requiresAuth: true },
  },
  {
    path: '/todo',
    name: 'Todo',
    component: () => import('@/pages/FamilyTodoPage.vue'),
    meta: { titleKey: 'nav.todo', requiresAuth: true },
  },
  {
    path: '/budgets',
    name: 'Budgets',
    component: () => import('@/pages/BudgetPage.vue'),
    meta: { titleKey: 'nav.budgets', requiresAuth: true, requiresFinance: true },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/pages/SettingsPage.vue'),
    meta: { titleKey: 'nav.settings', requiresAuth: true, hideQuickAdd: true },
  },
  {
    path: '/oauth/callback',
    name: 'OAuthCallback',
    component: () => import('@/pages/OAuthCallbackPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/no-access',
    name: 'NoAccess',
    component: () => import('@/pages/NoAccessPage.vue'),
    meta: { titleKey: 'noAccess.title' },
  },
  {
    // Self-service Plausible analytics exclusion. Sets
    // localStorage.plausible_ignore = 'true' on this device so the tracker
    // stops sending events from this browser. Visit once per device/browser.
    // Mirrors web/src/pages/plausible-exclude.astro on the marketing site.
    path: '/plausible-exclude',
    name: 'PlausibleExclude',
    component: () => import('@/pages/PlausibleExcludePage.vue'),
    meta: { requiresAuth: false, hideQuickAdd: true },
  },
  externalRedirect('/help/:pathMatch(.*)*', 'HelpRedirect'),
  externalRedirect('/privacy', 'PrivacyRedirect'),
  externalRedirect('/terms', 'TermsRedirect'),
  // Blog + beanstalk routes live on the Astro marketing site now
  // (beanies.family/blog). These stubs exist so any stray bookmarks
  // from the pre-Phase-C cutover era redirect to the real thing
  // instead of 404-ing. Same pattern as /help above.
  externalRedirect('/blog', 'BeanstalkBlogRedirect'),
  externalRedirect('/blog/:slug', 'BeanstalkPostRedirect'),
  externalRedirect('/beanstalk', 'BeanstalkBlogLegacyRedirect'),
  externalRedirect('/beanstalk/:slug', 'BeanstalkPostLegacyRedirect'),
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { titleKey: 'notFound.title', hideQuickAdd: true },
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 };
  },
});

// Already-authenticated guard: redirect away from pre-auth landing pages
// (/welcome, /login) when the user already has a valid session. Prevents
// the confusing "sign in again / create a new family" screen for users
// who are already in.
//
// /join and /oauth/callback are intentionally excluded — an authenticated
// user may legitimately be accepting an invite to a different pod, and the
// OAuth callback must always execute its handler regardless of state.
const ALREADY_AUTH_REDIRECT_FROM = new Set(['/welcome', '/login']);

router.beforeEach((to) => {
  if (!ALREADY_AUTH_REDIRECT_FROM.has(to.path)) return;
  const authStore = useAuthStore();
  if (authStore.isAuthenticated) {
    return { name: 'Nook' };
  }
});

/**
 * Auth guard for `requiresAuth: true` routes. Without this, browser-back
 * after a sign-out (or any navigation to an app route while unauthenticated)
 * lands the user on a page like /nook with empty data — App.vue's init flow
 * only catches the no-auth case on app boot, not on subsequent navigations.
 *
 * Skipped while authStore is still initializing: `isAuthenticated` starts
 * false and flips to true async during `authStore.initialize()` (session
 * restore from IndexedDB). Firing the guard before then would bounce a
 * legitimately-authenticated user opening /nook in a fresh tab to /welcome.
 * Once init completes, App.vue's `loadFamilyData` handles the no-session
 * case explicitly. After that, this guard catches any subsequent navigation
 * while unauthenticated (e.g. browser-back after sign-out).
 *
 * The redirect preserves the original `fullPath` as a `?next=` query so
 * post-sign-in code can route the user back to their intent if it wants
 * (currently the login flow defaults to /nook on success; the param is
 * available for future use without changing this guard).
 */
router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return;
  const authStore = useAuthStore();
  if (!authStore.isInitialized) return;
  if (authStore.isAuthenticated) return;
  return {
    name: 'Welcome',
    query: { next: to.fullPath },
    replace: true,
  };
});

// Permission guard: redirect to /no-access if finance permission is missing
router.beforeEach((to) => {
  if (to.meta.requiresFinance) {
    const familyStore = useFamilyStore();
    const authStore = useAuthStore();
    const member = familyStore.currentMember;
    if (member) {
      const isOwner = member.role === 'owner';
      const hasManagePod = !!member.canManagePod;
      const hasFinance = !!member.canViewFinances;
      if (!isOwner && !hasManagePod && !hasFinance) {
        return { name: 'NoAccess' };
      }
    } else if (authStore.isAuthenticated && authStore.currentUser?.role !== 'owner') {
      // currentMember is undefined but user is authenticated and not owner —
      // block access defensively (matches usePermissions fallback behavior)
      return { name: 'NoAccess' };
    }
  }
});

// Orphan quick-add intent guard: if a `?action=...` query arrives on a
// route that hides the FAB (stale bookmark, cross-device share of a
// deep link), strip the intent keys and surface a warning toast so the
// user understands nothing opened silently. Other query params are
// preserved.
router.beforeEach((to) => {
  if (!to.meta.hideQuickAdd) return;
  if (typeof to.query.action !== 'string' || !to.query.action) return;

  const translationStore = useTranslationStore();
  const next: LocationQuery = { ...to.query };
  delete next.action;
  for (const key of QUICK_ADD_CONTEXT_KEYS) {
    delete next[key];
  }

  showToast(
    'warning',
    translationStore.t('quickAdd.error.notHere.title'),
    translationStore.t('quickAdd.error.notHere.message')
  );

  return { path: to.path, query: next, replace: true };
});

// Update document title on route change
router.afterEach((to) => {
  const titleKey = to.meta.titleKey as UIStringKey | undefined;
  const translationStore = useTranslationStore();
  const title = titleKey ? translationStore.t(titleKey) : undefined;
  document.title = title ? `${title} | beanies.family` : 'beanies.family';
});

// Auto-recover from stale-chunk failures after a deploy. The PWA's
// precached `index.html` references hashed JS chunk filenames that no
// longer exist on the server once a new build ships; the next lazy
// `import()` rejects with `Failed to fetch dynamically imported module`.
// `hardReload()` evicts the workbox precache and forces a fresh
// navigation so the user lands on the new build's chunk URLs.
router.onError((err) => {
  if (!isChunkLoadError(err)) return;
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') {
    // Already attempted recovery this session — let the error surface
    // through the global handler instead of reload-looping.
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  void hardReload();
});

router.afterEach(() => {
  // Successful navigation proves the new chunk set is reachable; clear
  // the guard so a future deploy gap can recover too.
  sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
});

export default router;
