import {
  createRouter,
  createWebHistory,
  type LocationQuery,
  type RouteRecordRaw,
} from 'vue-router';
import { useTranslationStore } from '@/stores/translationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';
import { restoreWallOrientation } from '@/composables/useWallOrientation';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { QUICK_ADD_CONTEXT_KEYS } from '@/constants/quickAddItems';
import { isFlagEnabled, type DevFlag } from '@/config/flags';
import { hardReload, isChunkLoadError, CHUNK_RELOAD_FLAG } from '@/utils/hardReload';
import { isPodlessRecoveryQuery } from '@/components/login/resumePaths';

// First `RouteMeta` augmentation in the repo. Intentionally PARTIAL — it types
// only `noChrome` (consumed by `shouldShowAppLayout` + App.vue's boot block).
// The other meta fields (`requiresAuth`, `requiresFinance`, `titleKey`,
// `hideQuickAdd`, …) remain on vue-router's default `unknown`-indexed `RouteMeta`
// by design; typing them all is a separate, speculative change out of scope here.
declare module 'vue-router' {
  interface RouteMeta {
    /** When true, the route renders WITHOUT the app shell (sidebar/header). */
    noChrome?: boolean;
    /** Gate the route behind a dev feature flag — redirected to /nook when off. */
    requiresFlag?: DevFlag;
  }
}

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
  // Dev-only ADR-032 worker spike harness (measurement page; removed with the spike).
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/worker-spike',
          name: 'DevWorkerSpike',
          component: () => import('@/pages/dev/WorkerSpikePage.vue'),
          meta: { requiresAuth: false, noChrome: true, hideQuickAdd: true },
        } as RouteRecordRaw,
      ]
    : []),
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
    meta: { titleKey: 'login.welcome', requiresAuth: false, hideQuickAdd: true, noChrome: true },
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'login.title', requiresAuth: false, hideQuickAdd: true, noChrome: true },
  },
  {
    path: '/join',
    name: 'JoinFamily',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'join.title', requiresAuth: false, hideQuickAdd: true, noChrome: true },
    props: { initialView: 'join' },
  },
  {
    path: '/create',
    name: 'CreateFamily',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'create.title', requiresAuth: false, hideQuickAdd: true, noChrome: true },
    props: { initialView: 'create' },
  },
  {
    // Drive "Open with beanies.family" landing page. See OpenFromDrivePage.vue
    // for the full flow. Route is unauthenticated because new users may land
    // here before having a beanies session — Drive auto-handles OAuth before
    // the redirect, so we already have drive.file scope on arrival.
    path: '/open',
    name: 'OpenFromDrive',
    component: () => import('@/pages/OpenFromDrivePage.vue'),
    meta: {
      titleKey: 'openFromDrive.title',
      requiresAuth: false,
      hideQuickAdd: true,
      noChrome: true,
    },
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
    path: '/pod/:memberId([0-9a-f-]{36})/:tab(overview|favorites|sayings|allergies|medications|notes|milestones)',
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
    path: '/pod/milestones',
    name: 'FamilyMilestones',
    component: () => import('@/pages/FamilyTimelinePage.vue'),
    meta: { titleKey: 'milestones.pageTitle', requiresAuth: true },
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
    path: '/meal-planner',
    name: 'MealPlanner',
    component: () => import('@/pages/MealPlannerPage.vue'),
    meta: { titleKey: 'nav.mealPlanner', requiresAuth: true, requiresFlag: 'mealPlanner' },
  },
  {
    path: '/lists',
    name: 'Lists',
    component: () => import('@/pages/BeanieListsPage.vue'),
    meta: { titleKey: 'nav.lists', requiresAuth: true, requiresFlag: 'familyLists' },
  },
  {
    path: '/budgets',
    name: 'Budgets',
    component: () => import('@/pages/BudgetPage.vue'),
    meta: { titleKey: 'nav.budgets', requiresAuth: true, requiresFinance: true },
  },
  {
    // The beanie wall: chrome-free by design (no sidebar, header or bottom nav)
    // so a mounted tablet shows the family's week, not the app's furniture.
    path: '/wall',
    name: 'BeanieWall',
    component: () => import('@/pages/BeanieWallPage.vue'),
    meta: {
      titleKey: 'wall.name',
      requiresAuth: true,
      noChrome: true,
      hideQuickAdd: true,
      requiresFlag: 'beanieWall',
    },
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
    // Backstop for the NATIVE OAuth return. Reaching this route in the Vue app
    // is never expected: the apex serves /oauth/native itself (see
    // infrastructure/modules/web/functions/apex-cutover.js). If we land here,
    // that exemption regressed or a stale bare-URL 301 was cached on-device —
    // so the page reports it and offers the same bridge hop the apex page does,
    // rather than falling through to the catch-all and rendering a 404 (which
    // is exactly what the iOS sign-in bug looked like).
    // NOTE: App.vue bails out of init for this route name — see the terminal
    // OAuth surfaces guard. Renaming this route requires updating that guard.
    path: '/oauth/native',
    name: 'OAuthNativeBridge',
    component: () => import('@/pages/OAuthNativeBridgePage.vue'),
    meta: { requiresAuth: false, hideQuickAdd: true, noChrome: true },
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
    meta: { requiresAuth: false, hideQuickAdd: true, noChrome: true },
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
    // Web Share Target landing (#64). The service worker intercepts the POST and 303s here
    // with an id; this page reads the stash and hands it to the shared ingest orchestrator.
    //
    // requiresAuth is FALSE on purpose, and it is not a hole: this page persists nothing and
    // reveals nothing — it reads a stash keyed by an id only this browser was just handed,
    // and the orchestrator runs the same signed-out check every other entry point runs. With
    // the guard on, a signed-out share was redirected BEFORE this page mounted, and since
    // this page is the only code that deletes the stash, someone else's document stayed in
    // Cache Storage indefinitely: nothing sweeps it, there is no TTL, and sign-out clears
    // IndexedDB but not `caches`.
    path: '/share',
    name: 'ShareTarget',
    component: () => import('@/pages/ShareTargetPage.vue'),
    meta: { requiresAuth: false, hideQuickAdd: true, noChrome: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { titleKey: 'notFound.title', hideQuickAdd: true, noChrome: true },
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
// Exception: an authenticated user whose pod file doesn't exist yet (a
// half-finished onboarding — see `authStore.podCreated`) belongs on the
// resume-setup recovery screen, which lives at `/welcome?resume=setup`.
// We send them there rather than bouncing them to an empty `/nook`.
//
// /join and /oauth/callback are intentionally excluded — an authenticated
// user may legitimately be accepting an invite to a different pod, and the
// OAuth callback must always execute its handler regardless of state.
const ALREADY_AUTH_REDIRECT_FROM = new Set(['/welcome', '/login']);

/**
 * Critical-write guard. When `syncStore.createNewFile` or the recovery
 * `loadFromGoogleDrive` is in flight, we cannot let the user navigate away
 * — the in-flight write hasn't reached its point of no return yet, and a
 * mid-flight nav would leave durable state inconsistent. The
 * SetupProgressModal is showing during these windows so the user gets
 * visual feedback for why their click didn't navigate.
 *
 * Paired with `App.vue:beforeunload`, which returns truthy in the same
 * state so the native browser confirm fires for close-tab.
 *
 * Lives above every other guard because none of the others matter while a
 * critical write is in flight — block first, ask questions later.
 */
router.beforeEach(() => {
  const syncStore = useSyncStore();
  if (syncStore.criticalWriteState.kind !== 'idle') {
    return false;
  }
});

router.beforeEach((to) => {
  if (!ALREADY_AUTH_REDIRECT_FROM.has(to.path)) return;
  const authStore = useAuthStore();
  if (!authStore.isAuthenticated) return;
  // Mid-create: the add-members step renders at /welcome?resume=setup AFTER
  // createNewFile flips podCreated=true (so needsPodSetup is already false).
  // Without this, the redirect below would bounce the user to /nook and skip
  // add-members on iOS. The flag is set only during the members phase and
  // cleared on completion/unmount (see ResumePodSetup).
  const syncStore = useSyncStore();
  if (syncStore.membersStepActive) return;
  if (authStore.needsPodSetup) {
    // Already on a resume screen — let them stay. `setup` is the create/recovery
    // continuation; `load-drive` is the Drive-load OAuth return that re-opens the
    // file picker (ADR-029). Rewriting the latter to `setup` would strand a
    // returning-but-podless user on resume-setup instead of the picker.
    if (isPodlessRecoveryQuery(to.query.resume)) return;
    return { name: 'Welcome', query: { resume: 'setup' } };
  }
  // Un-strand an established owner (`podCreated`) whose provider config was lost
  // (IDB eviction) and who is genuinely on the resume-setup recovery screen: let
  // them reach `ResumePodSetup` (registry-resume) instead of bouncing to /nook.
  // Gate on the DURABLE `podCreated` + the resume query ONLY — never on the
  // transient `syncStore.isConfigured` (false during every cold boot before the
  // silent heal completes; branching on it would cause intermittent mis-routing).
  // A configured owner who reaches this URL just harmlessly re-loads their pod;
  // one on bare `/welcome` still falls through to /nook below.
  if (authStore.podCreated && isPodlessRecoveryQuery(to.query.resume)) {
    logEvent({
      level: 'warn',
      surface: 'app-podcreated-unconfigured',
      message: 'podCreated owner routed to resume-setup recovery',
      context: { route_path: to.path },
    });
    return;
  }
  return { name: 'Nook' };
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
// Fired at most once per session — `authStore.podCreated` being false on a
// `requiresAuth` route means a half-finished onboarding is reachable, which
// should not happen; surface it so we see how often (and from where) it does.
let zombieStateReported = false;

router.beforeEach((to) => {
  if (!to.meta.requiresAuth) return;
  const authStore = useAuthStore();
  if (!authStore.isInitialized) return;
  if (!authStore.isAuthenticated) {
    return {
      name: 'Welcome',
      query: { next: to.fullPath },
      replace: true,
    };
  }
  // Authenticated, but the `.beanpod` file doesn't exist yet — route to the
  // resume-setup recovery screen instead of letting an empty `/nook` render.
  if (authStore.needsPodSetup) {
    if (!zombieStateReported) {
      zombieStateReported = true;
      reportError({
        surface: 'app.onboardingZombieState',
        message: `Authenticated session with no pod file reached a requiresAuth route (${to.path}) — routing to resume-setup`,
        severity: 'critical',
        context: { route_path: to.path },
      });
    }
    return { name: 'Welcome', query: { resume: 'setup' }, replace: true };
  }
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
      // block access defensively. NOTE this reads the session `role` to BLOCK, which is
      // safe in the fail-closed direction; usePermissions deliberately no longer reads it
      // to GRANT once a roster exists (#80). Do not "align" these two by widening either.
      return { name: 'NoAccess' };
    }
  }
});

// Feature-flag guard: a route gated behind an off dev flag is unreachable
// (redirect home). Mirrors the finance guard's shape — no novel control flow.
router.beforeEach((to) => {
  if (to.meta.requiresFlag && !isFlagEnabled(to.meta.requiresFlag)) {
    return { path: '/nook' };
  }
});

/**
 * Where "leave the beanie wall" should return to.
 *
 * Captured on the way IN, because by the time the wall wants it the current
 * route is the wall itself. Without this the exit hard-coded `/settings`, which
 * dropped anyone who started the wall from the account menu somewhere they had
 * never been — and made them wait on the heaviest page in the app to compile.
 *
 * Registered AFTER the feature-flag guard, so a navigation to `/wall` that gets
 * redirected away cannot leave a return path behind for a visit that never
 * happened.
 */
let wallReturnPath = '/nook';

export function getWallReturnPath(): string {
  return wallReturnPath;
}

router.beforeEach((to, from) => {
  if (to.name === 'BeanieWall' && from.name && from.name !== 'BeanieWall') {
    wallReturnPath = from.fullPath;
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
router.afterEach((to, from) => {
  const titleKey = to.meta.titleKey as UIStringKey | undefined;
  const translationStore = useTranslationStore();
  const title = titleKey ? translationStore.t(titleKey) : undefined;
  document.title = title ? `${title} | beanies.family` : 'beanies.family';

  // The beanie wall is the one route allowed to rotate. Restore the portrait
  // default when LEAVING it — the component's own scope dispose covers a clean
  // unmount, but a back button, deep link, session expiry or error-boundary
  // navigation may not run it.
  //
  // Guarded on `from`, not `to`: keying off `to.name !== 'BeanieWall'` fired on
  // boot and on every route change for every user, locking portrait even for
  // the ~100% who never enable the wall — which is exactly the regression
  // (manifest orientation overriding the user's rotation lock) that made us
  // choose release/restore over lock-at-boot in the first place.
  if (from.name === 'BeanieWall' && to.name !== 'BeanieWall') restoreWallOrientation();
});

// Auto-recover from stale-chunk failures after a deploy. The PWA's
// precached `index.html` references hashed JS chunk filenames that no
// longer exist on the server once a new build ships; the next lazy
// `import()` rejects with `Failed to fetch dynamically imported module`.
// `hardReload()` evicts the workbox precache and forces a fresh
// navigation so the user lands on the new build's chunk URLs.
//
// `CHUNK_RELOAD_FLAG` is a counter, not a boolean — see App.vue's init
// catch for the full retry budget. We just increment-or-reload here.
router.onError((err) => {
  if (!isChunkLoadError(err)) return;
  const attempts = parseInt(sessionStorage.getItem(CHUNK_RELOAD_FLAG) ?? '0', 10) || 0;
  if (attempts >= 3) {
    // Budget exhausted — let the error surface through the global handler
    // (main.ts unhandledrejection / App.vue's overlay path) instead of
    // looping silently. Slack alert will fire from App.vue's exhausted
    // branch when the next nav also fails.
    return;
  }
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(attempts + 1));
  void hardReload();
});

// NOTE: previously cleared `CHUNK_RELOAD_FLAG` here on every successful
// nav, intending "clean nav ⇒ deploy gap survived, reset for next time".
// That fired on the INITIAL nav too — which resolves successfully before
// App.vue's onMounted error throws — so every page load thought it was
// the "first attempt", silent hardReload looped forever, and the Slack
// "exhausted" alert never fired (greg's iPhone, 2026-05-13). The reset
// now lives in App.vue, gated on a successful post-init health check.

export default router;
