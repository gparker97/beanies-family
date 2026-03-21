import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useTranslationStore } from '@/stores/translationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/nook',
  },
  {
    path: '/home',
    name: 'Home',
    component: () => import('@/pages/HomePage.vue'),
    meta: { titleKey: 'app.name', requiresAuth: false },
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
  {
    path: '/family',
    name: 'Family',
    component: () => import('@/pages/FamilyPage.vue'),
    meta: { titleKey: 'nav.family', requiresAuth: true },
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
  {
    path: '/help',
    name: 'HelpCenter',
    component: () => import('@/pages/HelpCenterPage.vue'),
    meta: { titleKey: 'help.title', requiresAuth: false },
  },
  {
    path: '/help/:category',
    name: 'HelpCategory',
    component: () => import('@/pages/HelpCategoryPage.vue'),
    meta: { titleKey: 'help.title', requiresAuth: false },
  },
  {
    path: '/help/:category/:slug',
    name: 'HelpArticle',
    component: () => import('@/pages/HelpArticlePage.vue'),
    meta: { titleKey: 'help.title', requiresAuth: false },
  },
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
