import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { title: 'Login', requiresAuth: false },
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/pages/SetupPage.vue'),
    meta: { title: 'Setup', requiresSetup: false, requiresAuth: true },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/pages/DashboardPage.vue'),
    meta: { title: 'Dashboard', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/accounts',
    name: 'Accounts',
    component: () => import('@/pages/AccountsPage.vue'),
    meta: { title: 'Accounts', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/transactions',
    name: 'Transactions',
    component: () => import('@/pages/TransactionsPage.vue'),
    meta: { title: 'Transactions', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/assets',
    name: 'Assets',
    component: () => import('@/pages/AssetsPage.vue'),
    meta: { title: 'Assets', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/goals',
    name: 'Goals',
    component: () => import('@/pages/GoalsPage.vue'),
    meta: { title: 'Goals', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/reports',
    name: 'Reports',
    component: () => import('@/pages/ReportsPage.vue'),
    meta: { title: 'Reports', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/forecast',
    name: 'Forecast',
    component: () => import('@/pages/ForecastPage.vue'),
    meta: { title: 'Forecast', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/family',
    name: 'Family',
    component: () => import('@/pages/FamilyPage.vue'),
    meta: { title: 'Family Members', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('@/pages/SettingsPage.vue'),
    meta: { title: 'Settings', requiresSetup: true, requiresAuth: true },
  },
  {
    path: '/auth/magic',
    name: 'MagicLinkCallback',
    component: () => import('@/pages/MagicLinkCallbackPage.vue'),
    meta: { title: 'Signing In...', requiresAuth: false },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { title: 'Not Found' },
  },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

// Update document title on route change
router.afterEach((to) => {
  const title = to.meta.title as string | undefined;
  document.title = title ? `${title} | beanies.family` : 'beanies.family';
});

export default router;
