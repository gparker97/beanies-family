import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useTranslationStore } from '@/stores/translationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';

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
    meta: { titleKey: 'login.welcome', requiresAuth: false },
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'login.title', requiresAuth: false },
  },
  {
    path: '/join',
    name: 'JoinFamily',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { titleKey: 'join.title', requiresAuth: false },
    props: { initialView: 'join' },
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
    redirect: '/pod',
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
    meta: { titleKey: 'nav.settings', requiresAuth: true },
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
  externalRedirect('/help/:pathMatch(.*)*', 'HelpRedirect'),
  externalRedirect('/privacy', 'PrivacyRedirect'),
  externalRedirect('/terms', 'TermsRedirect'),
  {
    path: '/blog',
    name: 'BeanstalkBlog',
    component: () => import('@/pages/BeanstalkBlogPage.vue'),
    meta: { titleKey: 'nav.beanstalk', requiresAuth: false },
  },
  {
    path: '/blog/:slug',
    name: 'BeanstalkPost',
    component: () => import('@/pages/BeanstalkPostPage.vue'),
    meta: { titleKey: 'nav.beanstalk', requiresAuth: false },
  },
  { path: '/beanstalk', redirect: '/blog' },
  { path: '/beanstalk/:slug', redirect: (to) => `/blog/${to.params.slug}` },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { titleKey: 'notFound.title' },
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

// Update document title on route change
router.afterEach((to) => {
  const titleKey = to.meta.titleKey as UIStringKey | undefined;
  const translationStore = useTranslationStore();
  const title = titleKey ? translationStore.t(titleKey) : undefined;
  document.title = title ? `${title} | beanies.family` : 'beanies.family';
});

export default router;
