/**
 * Remote push for flight changes (#143 Phase 2, ADR-046): the ONE module that touches
 * `@capacitor/push-notifications`. Native only; on web every export is an inert no-op and the
 * plugin is never even loaded (a dynamic import behind `isNative()`, so the web bundle carries
 * no push code).
 *
 * It owns the OS side and nothing else: the push token (`pushToken`), `register()` once per
 * process, and the three listeners (installed once). It NEVER prompts for permission: the
 * flight-change switch asks at the right moment (`useNotificationPermission`), and the same OS
 * permission covers local and remote notices, so `ensurePushToken` only checks it
 * (`ensureNotificationPermission(false)`) and answers null without it.
 *
 * Callers: `flightStatusStore` (the token, inside its reconcile; `onTokenChanged` →
 * `request('push-token')`) and `App.vue` (`onPushTap` → `handleReminderTap`). Module-level
 * state (the `useNotificationPermission` singleton pattern): a push tap at cold start fires
 * before any store exists, and the plugin retains it until the listener is added.
 */
import { ref } from 'vue';
import type { PushNotificationsPlugin } from '@capacitor/push-notifications';
import { getPlatform, isNative } from '@/services/sync/capabilities';
import { ensureNotificationPermission } from '@/composables/useNotificationPermission';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

const SURFACE = 'travel-verify';

/** The push payload's `data` (the server sends `{ kind: 'travel-change', flight, date }`). */
export type PushData = Record<string, unknown> | undefined;
/** Why `ensurePushToken` came back empty (the `push_token_failed` event's `detail`). */
export type PushTokenFailure = 'no_permission' | 'timeout' | 'registration_error';

/** This install's push token, once the OS has issued one this process; else null. */
export const pushToken = ref<string | null>(null);

const tapHandlers = new Set<(data: PushData) => void>();
const receivedHandlers = new Set<(data: PushData) => void>();
const tokenHandlers = new Set<(token: string) => void>();

/** The plugin with its listeners installed (once); null when that failed (reported). */
let plugin: Promise<PushNotificationsPlugin | null> | null = null;
/** The one `register()` of this process and the token it resolved to (null on error). */
let registering: Promise<string | null> | null = null;
let settleRegistration: ((token: string | null) => void) | null = null;
let failureReported = false;

/** The push platform this build registers as (`ios` | `android`), or null on web, where
 *  remote push does not exist: the one native-only gate callers need. */
export function pushPlatform(): 'ios' | 'android' | null {
  if (!isNative()) return null;
  const platform = getPlatform();
  return platform === 'web' ? null : platform;
}

function os(): string {
  return getPlatform();
}

/**
 * Report that this device could not get a push token, ONCE per process: the device keeps the
 * Phase 1 behaviour (the change shows on open) and the person sees no error. `timeout` is
 * reported by the store, which owns that deadline; the other two from here.
 */
export function reportPushTokenFailure(detail: PushTokenFailure, error?: unknown): void {
  if (failureReported) return;
  failureReported = true;
  reportError({
    surface: SURFACE,
    severity: 'warning',
    message: 'push token failed',
    error,
    context: { action: 'push_token_failed', os: os(), detail },
  });
}

function emit(handlers: Set<(data: PushData) => void>, data: unknown): void {
  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
  for (const handler of handlers) handler(payload);
}

function onRegistration(value: string): void {
  const previous = pushToken.value;
  pushToken.value = value;
  settleRegistration?.(value);
  settleRegistration = null;
  if (previous === null) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'push token',
      context: { action: 'push_token', os: os() },
    });
  } else if (previous !== value) {
    for (const handler of tokenHandlers) handler(value);
  }
}

function onRegistrationError(error: unknown): void {
  settleRegistration?.(null);
  settleRegistration = null;
  reportPushTokenFailure('registration_error', error);
}

/** Load the plugin and install the listeners, once. Native only. */
function loadPlugin(): Promise<PushNotificationsPlugin | null> {
  if (!isNative()) return Promise.resolve(null);
  plugin ??= import('@capacitor/push-notifications')
    .then(async ({ PushNotifications }) => {
      await Promise.all([
        PushNotifications.addListener('registration', (t) => onRegistration(t.value)),
        PushNotifications.addListener('registrationError', (e) => onRegistrationError(e.error)),
        PushNotifications.addListener('pushNotificationReceived', (n) => {
          // In the foreground: the open app's own check shows the change within the tick.
          logEvent({
            level: 'info',
            surface: SURFACE,
            message: 'push received',
            context: { action: 'push_received', os: os() },
          });
          emit(receivedHandlers, n.data);
        }),
        PushNotifications.addListener('pushNotificationActionPerformed', (a) =>
          emit(tapHandlers, a.notification?.data)
        ),
      ]);
      return PushNotifications;
    })
    .catch((e: unknown) => {
      reportError({
        surface: SURFACE,
        severity: 'warning',
        message: 'push listener registration failed; flight pushes will not register or open',
        error: e,
        context: { action: 'push_token_failed', os: os(), detail: 'listener' },
      });
      return null;
    });
  return plugin;
}

async function register(): Promise<string | null> {
  const push = await loadPlugin();
  if (!push) return null;
  const token = new Promise<string | null>((resolve) => {
    settleRegistration = resolve;
  });
  try {
    await push.register();
  } catch (e) {
    onRegistrationError(e);
  }
  return token;
}

/**
 * This install's push token: the one already issued, else (permission already granted) the
 * answer of this process's one `register()`. Null on web, without permission, or when the OS
 * refused (`registrationError`, reported once). Never prompts. May take a while on a slow
 * network: the caller bounds the wait (`raceTimeout`), and a token that lands later is kept
 * in `pushToken` for the next run.
 */
export async function ensurePushToken(): Promise<string | null> {
  if (!isNative()) return null;
  if (pushToken.value) return pushToken.value;
  if (!(await ensureNotificationPermission(false))) {
    reportPushTokenFailure('no_permission');
    return null;
  }
  registering ??= register();
  return registering;
}

function subscribe<T>(handlers: Set<T>, handler: T): () => void {
  handlers.add(handler);
  void loadPlugin();
  return () => handlers.delete(handler);
}

/** A tap on a push, cold or warm, with its `data`. Returns the remover. */
export function onPushTap(handler: (data: PushData) => void): () => void {
  return subscribe(tapHandlers, handler);
}

/** A push delivered while the app is in the foreground (logged here already). */
export function onPushReceived(handler: (data: PushData) => void): () => void {
  return subscribe(receivedHandlers, handler);
}

/** The OS issued a NEW token after an earlier one (a rotation); not the first token. */
export function onTokenChanged(handler: (token: string) => void): () => void {
  return subscribe(tokenHandlers, handler);
}

/** TEST ONLY: forget the process state. */
export function __resetPushRegistrationForTesting(): void {
  pushToken.value = null;
  tapHandlers.clear();
  receivedHandlers.clear();
  tokenHandlers.clear();
  plugin = null;
  registering = null;
  settleRegistration = null;
  failureReported = false;
}
