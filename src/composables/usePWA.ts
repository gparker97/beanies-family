import { ref, readonly } from 'vue';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed';
const DISMISS_DAYS = 7;

const canInstall = ref(false);
const isInstalled = ref(false);

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;

function isDismissed(): boolean {
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return false;
  const dismissedAt = parseInt(dismissed, 10);
  const daysSince = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
  return daysSince < DISMISS_DAYS;
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  // Detect if already installed (standalone mode)
  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  isInstalled.value = standaloneQuery.matches || (navigator as any).standalone === true;

  standaloneQuery.addEventListener('change', (e) => {
    isInstalled.value = e.matches;
    if (e.matches) canInstall.value = false;
  });

  // Listen for install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    canInstall.value = !isInstalled.value;
  });

  // Detect install completion
  window.addEventListener('appinstalled', () => {
    isInstalled.value = true;
    canInstall.value = false;
    deferredPrompt = null;
  });
}

async function installApp(): Promise<boolean> {
  if (!deferredPrompt) return false;

  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  if (outcome === 'accepted') {
    deferredPrompt = null;
    canInstall.value = false;
    return true;
  }
  return false;
}

function dismissInstallPrompt() {
  localStorage.setItem(DISMISS_KEY, Date.now().toString());
}

export function usePWA() {
  init();

  return {
    canInstall: readonly(canInstall),
    isInstalled: readonly(isInstalled),
    isDismissed,
    installApp,
    dismissInstallPrompt,
  };
}
