import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { showToast } from '@/composables/useToast';
import { useTranslation } from '@/composables/useTranslation';
import { STORAGE_KEYS } from '@/constants/storageKeys';
import * as settingsRepo from '@/services/automerge/repositories/settingsRepository';
import { isDocLoaded } from '@/services/automerge/docService';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { toISODateString } from '@/utils/date';
import * as globalSettingsRepo from '@/services/indexeddb/repositories/globalSettingsRepository';
import type {
  Settings,
  GlobalSettings,
  CurrencyCode,
  AIProvider,
  AiTier,
  ExchangeRate,
  LanguageCode,
  CountryCode,
  SupportedTravelType,
  ReminderMinutes,
  HelpfulHintType,
} from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import {
  DEFAULT_ACTIVITY_LEAD,
  DEFAULT_TODO_LEAD,
  DEFAULT_TRAVEL_LEADS,
  toActivityLeadOption,
} from '@/utils/reminderSchedule';
import { HINT_LEAD_DAYS } from '@/utils/helpfulHints';

export const useSettingsStore = defineStore('settings', () => {
  // State
  const settings = ref<Settings>(settingsRepo.getDefaultSettings());
  const globalSettings = ref<GlobalSettings>(globalSettingsRepo.getDefaultGlobalSettings());
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const baseCurrency = computed(() => settings.value.baseCurrency);
  const displayCurrency = computed(
    () => settings.value.displayCurrency ?? settings.value.baseCurrency
  );
  // Theme, language, and text-size are global (device-level) settings
  const theme = computed(() => globalSettings.value.theme);
  const language = computed(() => globalSettings.value.language ?? 'en');
  const textSize = computed<'normal' | 'large'>(
    () => globalSettings.value.textSize ?? settings.value.textSize ?? 'normal'
  );
  const syncEnabled = computed(() => settings.value.syncEnabled);
  const aiProvider = computed(() => settings.value.aiProvider);
  // Coalesced on read: pre-existing family docs predate the aiTier field, so the stored
  // value can be undefined (getSettings() backfills only a wholly-absent settings object).
  // Defaulting here — the single read site every consumer goes through — avoids scattering
  // `?? 'managed'` and keeps the tier switch/assertNever safe for upgraded families.
  const aiTier = computed<AiTier>(() => settings.value.aiTier ?? 'managed');
  // Use the most recent rates between per-family (synced via .beanpod) and
  // device-local (IndexedDB). Per-family rates sync across devices, ensuring
  // all devices converge on the same values. Device-local rates may be newer
  // if this device just refreshed. Always pick whichever set was fetched last.
  const exchangeRates = computed(() => {
    const familyRates = settings.value.exchangeRates;
    const globalRates = globalSettings.value.exchangeRates;
    const hasFamilyRates = familyRates && familyRates.length > 0;
    const hasGlobalRates = globalRates && globalRates.length > 0;

    if (hasFamilyRates && hasGlobalRates) {
      const familyFetch = settings.value.exchangeRateLastFetch;
      const globalFetch = globalSettings.value.exchangeRateLastFetch;
      if (familyFetch && globalFetch) {
        return new Date(familyFetch) >= new Date(globalFetch) ? familyRates : globalRates;
      }
      // If only one has a timestamp, prefer that one
      if (familyFetch) return familyRates;
      if (globalFetch) return globalRates;
    }

    if (hasFamilyRates) return familyRates;
    return globalRates;
  });
  const exchangeRateAutoUpdate = computed(() => globalSettings.value.exchangeRateAutoUpdate);
  // Return the most recent fetch timestamp across both storage layers
  const exchangeRateLastFetch = computed(() => {
    const familyFetch = settings.value.exchangeRateLastFetch;
    const globalFetch = globalSettings.value.exchangeRateLastFetch;
    if (familyFetch && globalFetch) {
      return new Date(familyFetch) >= new Date(globalFetch) ? familyFetch : globalFetch;
    }
    return familyFetch || globalFetch;
  });
  const beanieMode = computed(() => {
    // E2E tests inject this flag to force standard English for stable text selectors
    if (typeof window !== 'undefined' && (window as any).__e2e_beanie_off) return false;
    // Dual-persisted like textSize: the device value wins so a per-device toggle
    // sticks, but a fresh device (no local value) falls back to the family-synced
    // doc value instead of resetting to the default.
    return globalSettings.value.beanieMode ?? settings.value.beanieMode ?? true;
  });
  const soundEnabled = computed(() => globalSettings.value.soundEnabled ?? true);
  // Per-device opt-in to The Beanie Lab (experimental features). Default OFF;
  // never family-synced (lives in GlobalSettings, like beanieMode/soundEnabled).
  const beanieLabEnabled = computed(() => globalSettings.value.beanieLabEnabled ?? false);
  // ── OS reminder prefs (#55) — device-scoped, never family-synced (GlobalSettings). ──
  const remindersEnabled = computed(() => globalSettings.value.remindersEnabled ?? true);
  const todoReminderLead = computed(
    () => globalSettings.value.todoReminderLead ?? DEFAULT_TODO_LEAD
  );
  // The DEFAULT lead new activities start with (and the fallback a duty reminder
  // uses when an activity says "None"). Each activity can still override it in
  // its own editor — this only sets where they begin.
  // Narrowed HERE — the single read site every consumer goes through, exactly as
  // `aiTier` coalesces above. A pref written by an older build (LEAD_OPTIONS once
  // offered 180, which is not in ReminderMinutes) is snapped to a valid option,
  // so NO consumer needs a cast or a guard.
  const activityReminderLead = computed<ReminderMinutes>(() =>
    toActivityLeadOption(globalSettings.value.activityReminderLead ?? DEFAULT_ACTIVITY_LEAD)
  );
  // Fully-resolved per-type lead map (device overrides merged over the defaults),
  // so consumers (the scheduler + the settings selects) read one complete map.
  const travelReminderLeads = computed<Record<SupportedTravelType, number>>(() => ({
    ...DEFAULT_TRAVEL_LEADS,
    ...(globalSettings.value.travelReminderLeads ?? {}),
  }));
  const preferredCurrencies = computed(() => settings.value.preferredCurrencies ?? []);
  const effectiveDisplayCurrencies = computed(() => {
    const prefs = preferredCurrencies.value;
    const base = baseCurrency.value;
    const set = new Set([...prefs, base]);
    return Array.from(set);
  });
  const customInstitutions = computed(() => settings.value.customInstitutions ?? []);
  const onboardingCompleted = computed(() => settings.value.onboardingCompleted ?? true);
  /** ISO timestamp of the one-shot #55 activity-reminder back-fill, or undefined. */
  const activityReminderBackfilledAt = computed(() => settings.value.activityReminderBackfilledAt);
  const weekStartDay = computed(() => settings.value.weekStartDay ?? 1); // default Monday
  // Country of residence — drives public-holiday display. Dual-tracked: the
  // per-family value (synced via .beanpod) wins; the device mirror is the
  // fallback for a brand-new device that hasn't synced the family doc yet
  // (same precedence philosophy as exchangeRates).
  const country = computed<CountryCode | null>(
    () => settings.value.country ?? globalSettings.value.country ?? null
  );
  // Public holidays are dormant until a country is picked; once it is, they
  // default to visible (the family can opt out via setShowPublicHolidays).
  const showPublicHolidays = computed<boolean>(() =>
    country.value ? (settings.value.showPublicHolidays ?? true) : false
  );
  // #133: when true, the photo→activity AI consent modal is skipped (auto-consented).
  // Family-scoped (synced); default false so the first use always prompts.
  const skipDocumentConsentPrompt = computed<boolean>(
    () => settings.value.skipDocumentConsentPrompt ?? false
  );
  // #34: warn when an activity clashes with a connected calendar's free/busy.
  // Family-scoped (synced); default ON (the freebusy scope is granted upfront).
  const calendarClashNudgeEnabled = computed<boolean>(
    () => settings.value.calendarClashNudgeEnabled ?? true
  );
  // #40: master on/off for auto-generated Helpful Hint to-dos. Family-scoped
  // (synced); default ON. Governs whether hints are GENERATED for the family.
  const helpfulHintsEnabled = computed<boolean>(() => settings.value.helpfulHintsEnabled ?? true);
  // #40: per-device per-hint-type NOTIFICATION mute (absent key ⟹ enabled).
  // Device-scoped (never synced), mirroring the #55 per-device reminder prefs —
  // suppresses only this device owner's notification, never the shared to-do.
  const helpfulHintNotifyByType = computed<Partial<Record<HelpfulHintType, boolean>>>(
    () => globalSettings.value.helpfulHintNotifyByType ?? {}
  );
  // #40: fully-resolved per-type lead-days (family overrides merged over the
  // defaults) — how many days before an event each hint fires. Family-scoped
  // (synced): the lead governs when the shared to-do appears for everyone.
  const helpfulHintLeadDays = computed<Record<HelpfulHintType, number>>(() => ({
    ...HINT_LEAD_DAYS,
    ...(settings.value.helpfulHintLeadDays ?? {}),
  }));
  // #45: when true, the periodic in-app feedback/NPS prompt never auto-opens.
  // Family-scoped (synced); default OFF (prompts enabled).
  const feedbackOptOut = computed<boolean>(() => settings.value.feedbackOptOut ?? false);
  const isTrustedDevice = computed(() => globalSettings.value.isTrustedDevice ?? false);
  const trustedDevicePromptShown = computed(
    () => globalSettings.value.trustedDevicePromptShown ?? false
  );
  const passkeyPromptShown = computed(() => globalSettings.value.passkeyPromptShown ?? false);

  // Apply theme to document. Mirrors to localStorage so the synchronous
  // bootstrap script in index.html can apply it before CSS loads (no FOUC).
  watch(
    theme,
    (newTheme) => {
      const html = document.documentElement;
      let isDark = false;
      if (newTheme === 'dark') {
        isDark = true;
      } else if (newTheme === 'system') {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      // Flicker guard — only mutate the class if the bootstrap script's
      // initial decision differs from the store's resolved value.
      const hasDark = html.classList.contains('dark');
      if (isDark && !hasDark) html.classList.add('dark');
      else if (!isDark && hasDark) html.classList.remove('dark');

      // Keep browser chrome in sync
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        meta.setAttribute('content', isDark ? '#1a252f' : '#F8F9FA');
      }

      // Mirror to localStorage for the FOUC-prevention bootstrap.
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
      } catch {
        // Storage disabled — bootstrap may not see this value on next reload;
        // watcher still applies live. See bootstrap script for the warning.
      }
    },
    { immediate: true }
  );

  // Apply text-size to document. Single attribute on <html> drives the
  // entire app's Large reading mode via the CSS rule in src/style.css and
  // the brand token --text-scale-large.
  watch(
    textSize,
    (newSize) => {
      const html = document.documentElement;
      const target = newSize === 'large' ? 'large' : null;
      const current = html.getAttribute('data-text-size');

      // Flicker guard: bootstrap script may have already applied the
      // attribute on cold load. If DOM matches resolved value, no-op.
      if (current === target) return;

      if (target) html.setAttribute('data-text-size', target);
      else html.removeAttribute('data-text-size');

      // Mirror to localStorage for the FOUC bootstrap.
      try {
        localStorage.setItem(STORAGE_KEYS.TEXT_SIZE, newSize);
      } catch {
        // Storage disabled — watcher continues applying live; bootstrap
        // on next reload will fall back to default until the store loads.
      }
    },
    { immediate: true }
  );

  // Actions

  /**
   * Load global settings from registry DB (works before family is active).
   */
  async function loadGlobalSettings() {
    try {
      globalSettings.value = await globalSettingsRepo.getGlobalSettings();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load global settings';
    }
  }

  /**
   * Load per-family settings from the active family DB.
   */
  async function loadSettings() {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.getSettings();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      isLoading.value = false;
    }
  }

  async function setBaseCurrency(currency: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    const previous = settings.value.baseCurrency;
    try {
      settings.value = await settingsRepo.setBaseCurrency(currency);
      // Keep display currency in sync with base currency
      settings.value = await settingsRepo.setDisplayCurrency(currency);
      // Ensure base currency is the first preferred currency
      const current = settings.value.preferredCurrencies ?? [];
      const withoutBase = current.filter((c) => c !== currency);
      settings.value = await settingsRepo.setPreferredCurrencies(
        [currency, ...withoutBase].slice(0, 4)
      );
      // Every stored rate is `from: <previous base>`. Leaving them is not merely
      // stale — it is the WRONG BASIS, and `getRate` fails silently: it returns
      // `undefined`, and both `convertToBaseCurrency` and `convertAmount` then
      // hand back the RAW amount, which the UI labels with the new base currency.
      // A €100 account renders as "$100". `getRate`'s USD/EUR/GBP path-finding
      // masks this whenever the OLD base happened to be one of those three, which
      // is why it survived: the default base is USD, so the bug only bites a
      // family whose first base currency was something else (reported by greg
      // during onboarding — accounts in several currencies all showed the base).
      //
      // Awaited, not fire-and-forget: callers switch currency and immediately
      // render converted amounts, so returning before the rates land would show
      // the wrong numbers for a frame. Failure is non-fatal by design (see below).
      if (previous !== currency) await refetchRatesForNewBase(previous, currency);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update base currency';
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Re-fetch exchange rates against a newly-chosen base currency.
   *
   * NON-FATAL: offline, or an API outage, must not block the currency change
   * itself — the user's choice is already persisted above. The rates simply stay
   * on the old basis until the next successful refresh (app init, a stale-tab
   * refresh, or Settings → update rates), which is the same degraded state that
   * shipped before this call existed. It is logged, never silent.
   */
  async function refetchRatesForNewBase(
    previous: CurrencyCode | undefined,
    next: CurrencyCode
  ): Promise<void> {
    try {
      const { forceUpdateRates } = await import('@/services/exchangeRate');
      const result = await forceUpdateRates();
      if (result.success) {
        // Rates are written through the repo, so the store's reactive copies must
        // be re-read or every consumer keeps computing off the old basis.
        await Promise.all([loadSettings(), loadGlobalSettings()]);
        logEvent({
          level: 'info',
          surface: 'exchange-rate-rebase',
          message: 'refetched exchange rates for a new base currency',
          // `count` is deliberately NOT sent: it is not in ALLOWED_CONTEXT_KEYS, and
          // adding a key obliges a store-privacy declaration update (CLAUDE.md) that a
          // rate tally does not justify. The success/failure split plus the pair is
          // what a rate alert needs.
          context: { action: 'rebase-ok', detail: `${previous ?? 'unknown'}->${next}` },
        });
        return;
      }
      logEvent({
        level: 'warn',
        surface: 'exchange-rate-rebase',
        message: 'rate refetch failed after a base-currency change — rates remain on the old basis',
        context: {
          action: 'rebase-failed',
          detail: `${previous ?? 'unknown'}->${next}`,
          error_code: 'fetch-unsuccessful',
        },
      });
    } catch (e) {
      logEvent({
        level: 'warn',
        surface: 'exchange-rate-rebase',
        message: 'rate refetch threw after a base-currency change — rates remain on the old basis',
        error: e instanceof Error ? e : undefined,
        context: {
          action: 'rebase-threw',
          detail: `${previous ?? 'unknown'}->${next}`,
          error_code: 'fetch-threw',
        },
      });
    }
  }

  async function setDisplayCurrency(currency: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setDisplayCurrency(currency);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update display currency';
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Persist a Settings field that is dual-tracked in both GlobalSettings
   * (device, IndexedDB) and Settings (per-family, Automerge). Surfaces
   * failures via toast + console; never silent.
   *
   * Used by setTheme / setLanguage / setTextSize. Adding a fourth
   * dual-persisted preference is a one-line wrapper below.
   */
  async function persistDualSetting<K extends keyof Settings & keyof GlobalSettings>(
    key: K,
    value: Settings[K]
  ): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        [key]: value,
      } as Partial<GlobalSettings>);
      if (isDocLoaded()) {
        settings.value = await settingsRepo.saveSettings({ [key]: value } as Partial<Settings>);
      } else {
        // Pre-pod: globalSettings is the only layer that exists yet. The
        // per-family Automerge write is deferred — settingsStore.language
        // (and theme/textSize/country) read globalSettings preferentially,
        // so the user's choice still drives the UI. The family-doc seed
        // on pod creation will pick this up later (tracked in STATUS.md).
        console.warn(
          `[settingsStore] '${String(key)}' persisted to device only — no family doc loaded yet (pre-pod state).`
        );
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      error.value = detail;
      // User-facing — toast with retry action. Field name goes in the
      // message slot (no interpolation in t() — see uiStrings.ts).
      const { t } = useTranslation();
      const fieldLabel = t(`settings.${String(key)}` as Parameters<typeof t>[0]);
      showToast('error', t('settings.persistFailed'), fieldLabel, {
        actionLabel: t('common.retry'),
        actionFn: () => persistDualSetting(key, value),
        error: e,
        surface: 'settings-persist',
        context: { field: String(key) },
      });
      // Dev-facing — full attempted value + cause for production telemetry.
      console.error(
        `[settingsStore] persistDualSetting('${String(key)}', ${JSON.stringify(value)}) failed — ` +
          `check IndexedDB quota, family-doc lock state, or Automerge schema.`,
        e
      );
      throw e; // re-throw so callers (e.g. BaseSelect via @update:modelValue) can revert visual state.
    } finally {
      isLoading.value = false;
    }
  }

  const setTheme = (v: Settings['theme']) => persistDualSetting('theme', v);
  const setLanguage = (v: LanguageCode) => persistDualSetting('language', v);
  const setTextSize = (v: 'normal' | 'large') => persistDualSetting('textSize', v);
  // Country is dual-persisted (device + family) like language — a new device
  // can resolve it and pre-fetch holidays before the family doc syncs.
  // Passing `undefined` clears it on both layers (treated as "not set").
  const setCountry = (v: CountryCode | null) => persistDualSetting('country', v ?? undefined);

  async function setSyncEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setSyncEnabled(enabled);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update sync setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setAutoSyncEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.setAutoSyncEnabled(enabled);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update auto-sync setting';
    } finally {
      isLoading.value = false;
    }
  }

  // #34: persist the clash-nudge toggle through the report-on-failure contract
  // (toast + console + re-throw) so a failed settings write is never swallowed and
  // the toggle control can revert its optimistic state.
  const setCalendarClashNudgeEnabled = (enabled: boolean) =>
    persistAiSetting('calendarSync.clashNudge.label', 'calendarClashNudgeEnabled', () =>
      settingsRepo.setCalendarClashNudgeEnabled(enabled)
    );

  // #45: opt out of (or back into) the periodic feedback prompt. Same family-only
  // report-on-failure contract so the Settings toggle reverts if the write fails.
  const setFeedbackOptOut = (optOut: boolean) =>
    persistAiSetting('feedback.settings.toggleLabel', 'feedbackOptOut', () =>
      settingsRepo.setFeedbackOptOut(optOut)
    );

  // #45: stamp the feedback cadence clock (date-only) when the prompt auto-opens or on
  // submit. Background (non-user-initiated) family-only write: guard on isDocLoaded, and
  // on failure report a warning (telemetry + console) WITHOUT throwing into the caller —
  // a failed cadence stamp must never break the notifications daemon or the modal flow.
  async function recordFeedbackPrompted(): Promise<void> {
    if (!isDocLoaded()) return;
    try {
      settings.value = await settingsRepo.setFeedbackPromptedAt(toISODateString(new Date()));
    } catch (e) {
      reportError({
        surface: 'feedback-record',
        severity: 'warning',
        message: 'failed to stamp feedback cadence clock',
        error: e,
      });
    }
  }

  const setAIProvider = (provider: AIProvider) =>
    persistAiSetting('settings.ai.byok.provider', 'aiProvider', () =>
      settingsRepo.setAIProvider(provider)
    );

  // All AI settings persist family-only (no device layer) and share ONE error contract:
  // reset error, attempt, and on failure surface a toast (with field name + dev console
  // diagnostic) and RE-THROW so the calling control can revert its visual state. Centralizing
  // here means no component reads the shared `error` ref out-of-band to decide whether to toast.
  async function persistAiSetting(
    label: UIStringKey,
    field: string,
    op: () => Promise<Settings>
  ): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await op();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update AI setting';
      const { t } = useTranslation();
      showToast('error', t('settings.persistFailed'), t(label), {
        error: e,
        surface: 'settings-persist',
        context: { field },
      });
      console.error(`[settingsStore] persistAiSetting('${field}') failed.`, e);
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      isLoading.value = false;
    }
  }

  const setAITier = (tier: AiTier) =>
    persistAiSetting('settings.ai.title', 'aiTier', () => settingsRepo.setAITier(tier));

  const setAIApiKey = (provider: 'claude' | 'openai' | 'gemini', key: string) =>
    persistAiSetting('settings.ai.byok.apiKey', 'aiApiKeys', () =>
      settingsRepo.setAIApiKey(provider, key)
    );

  /**
   * Persist a single device-level (GlobalSettings) field through the same
   * report-on-failure contract as persistDualSetting / persistAiSetting: reset
   * error, attempt the write, and on failure surface a toast (field name + dev
   * console diagnostic) and RE-THROW so the calling control can revert its
   * optimistic state. Deliberately NOT the silent setSoundEnabled/setBeanieMode
   * pattern (those only set error.value and swallow). Adding a new device-only
   * preference is a one-line wrapper below.
   */
  async function persistGlobalSetting<K extends keyof GlobalSettings>(
    label: UIStringKey,
    key: K,
    value: GlobalSettings[K]
  ): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        [key]: value,
      } as Partial<GlobalSettings>);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      const { t } = useTranslation();
      showToast('error', t('settings.persistFailed'), t(label), {
        error: e,
        surface: 'settings-persist',
        context: { field: String(key) },
      });
      console.error(`[settingsStore] persistGlobalSetting('${String(key)}') failed.`, e);
      throw e instanceof Error ? e : new Error(String(e));
    } finally {
      isLoading.value = false;
    }
  }

  const setBeanieLabEnabled = (enabled: boolean) =>
    persistGlobalSetting('settings.beanieLab.title', 'beanieLabEnabled', enabled);

  // ── OS reminder prefs (#55) actions — device-scoped via persistGlobalSetting. ──
  const setRemindersEnabled = (enabled: boolean) =>
    persistGlobalSetting('reminders.title', 'remindersEnabled', enabled);
  const setTodoReminderLead = (minutes: number) =>
    persistGlobalSetting('reminders.title', 'todoReminderLead', minutes);
  const setActivityReminderLead = (minutes: number) =>
    persistGlobalSetting('reminders.title', 'activityReminderLead', minutes);

  /**
   * Marker for the one-shot #55 back-fill. Deliberately a plain throwing setter
   * with NO try/catch: the ONE caller (activityStore.backfillReminderMinutes)
   * owns classification, and a migration-specific `surface` string has no
   * business living in settingsStore — it would be stranded here when the
   * migration is deleted. The rejection propagates so the caller leaves the
   * marker unset and the next boot retries.
   */
  async function setActivityReminderBackfilledAt(iso: string): Promise<void> {
    settings.value = await settingsRepo.saveSettings({ activityReminderBackfilledAt: iso });
  }
  const setTravelReminderLead = (type: SupportedTravelType, minutes: number) =>
    persistGlobalSetting('reminders.title', 'travelReminderLeads', {
      ...(globalSettings.value.travelReminderLeads ?? {}),
      [type]: minutes,
    });

  // ── Helpful Hints (#40) actions ──
  // Master switch: family-synced (report-on-failure chain, like the #34 clash nudge).
  const setHelpfulHintsEnabled = (enabled: boolean) =>
    persistAiSetting('settings.helpfulHints.label', 'helpfulHintsEnabled', () =>
      settingsRepo.setHelpfulHintsEnabled(enabled)
    );
  // Per-type notification mute: device-scoped map-merge (like setTravelReminderLead).
  const setHelpfulHintNotifyType = (type: HelpfulHintType, enabled: boolean) =>
    persistGlobalSetting('reminders.title', 'helpfulHintNotifyByType', {
      ...(globalSettings.value.helpfulHintNotifyByType ?? {}),
      [type]: enabled,
    });
  // Per-type lead-days: family-synced map-merge (report-on-failure chain).
  const setHelpfulHintLead = (type: HelpfulHintType, days: number) =>
    persistAiSetting('settings.helpfulHints.label', 'helpfulHintLeadDays', () =>
      settingsRepo.setHelpfulHintLeadDays({
        ...(settings.value.helpfulHintLeadDays ?? {}),
        [type]: days,
      })
    );

  async function setExchangeRateAutoUpdate(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (exchange rates are device-level)
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        exchangeRateAutoUpdate: enabled,
      });
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.setExchangeRateAutoUpdate(enabled);
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : 'Failed to update exchange rate auto-update setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setBeanieMode(enabled: boolean): Promise<void> {
    // Dual-persist (device + family doc) so the choice follows the family across
    // devices, unlike soundEnabled which stays device-local by design.
    //
    // persistDualSetting fully handles a failure (toast + console + telemetry) and
    // then re-throws so a BaseSelect can revert its optimistic value. The Beanie
    // Mode toggle instead binds to the `beanieMode` COMPUTED, which already reverts
    // on its own when the write didn't land, and its `@update:model-value` handler
    // is not awaited — so swallow the re-throw here (the failure is not silent; it
    // was surfaced upstream) to keep this setter non-throwing and avoid an
    // unhandled rejection.
    try {
      await persistDualSetting('beanieMode', enabled);
    } catch {
      // Already reported inside persistDualSetting; the computed reverts the toggle.
    }
  }

  async function setSoundEnabled(enabled: boolean): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({ soundEnabled: enabled });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update sound setting';
    } finally {
      isLoading.value = false;
    }
  }

  async function setPreferredCurrencies(currencies: CurrencyCode[]): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const limited = currencies.slice(0, 4);
      settings.value = await settingsRepo.setPreferredCurrencies(limited);
      // If current display currency is no longer in the effective list, fall back to base
      const effective = new Set([...limited, settings.value.baseCurrency]);
      if (!effective.has(settings.value.displayCurrency)) {
        settings.value = await settingsRepo.setDisplayCurrency(settings.value.baseCurrency);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update preferred currencies';
    } finally {
      isLoading.value = false;
    }
  }

  async function setOnboardingCompleted(completed: boolean): Promise<void> {
    try {
      settings.value = await settingsRepo.saveSettings({ onboardingCompleted: completed });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update onboarding status';
    }
  }

  async function setWeekStartDay(day: 0 | 1): Promise<void> {
    try {
      settings.value = await settingsRepo.saveSettings({ weekStartDay: day });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update week start day';
    }
  }

  // Family-only preference (no device mirror): whether to show public holidays
  // on the planner. Only meaningful once a country is set.
  async function setShowPublicHolidays(show: boolean): Promise<void> {
    try {
      settings.value = await settingsRepo.setShowPublicHolidays(show);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update holiday display setting';
    }
  }

  // #133: family-scoped consent skip for the photo→activity AI flow. Throws on failure
  // so the caller (the consent flow) can log it without leaving the wedge stranded.
  const setSkipDocumentConsentPrompt = (skip: boolean) =>
    persistAiSetting('settings.ai.askBeforePhotos', 'skipDocumentConsentPrompt', () =>
      settingsRepo.setSkipDocumentConsentPrompt(skip)
    );

  async function addCustomInstitution(name: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.addCustomInstitution(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add custom institution';
    } finally {
      isLoading.value = false;
    }
  }

  async function removeCustomInstitution(name: string): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.removeCustomInstitution(name);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove custom institution';
    } finally {
      isLoading.value = false;
    }
  }

  async function updateExchangeRates(rates: ExchangeRate[]): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      // Save to global settings (exchange rates are device-level)
      globalSettings.value = await globalSettingsRepo.updateGlobalExchangeRates(rates);
      // Also save to per-family settings for backward compatibility
      settings.value = await settingsRepo.updateExchangeRates(rates);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update exchange rates';
    } finally {
      isLoading.value = false;
    }
  }

  async function addExchangeRate(rate: ExchangeRate): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.addExchangeRate(rate);
      // Sync to global settings
      globalSettings.value = await globalSettingsRepo.updateGlobalExchangeRates([rate]);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to add exchange rate';
    } finally {
      isLoading.value = false;
    }
  }

  async function removeExchangeRate(from: CurrencyCode, to: CurrencyCode): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      settings.value = await settingsRepo.removeExchangeRate(from, to);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to remove exchange rate';
    } finally {
      isLoading.value = false;
    }
  }

  async function setTrustedDevice(trusted: boolean): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      isTrustedDevice: trusted,
      trustedDevicePromptShown: true,
    });
  }

  async function setTrustedDevicePromptShown(): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      trustedDevicePromptShown: true,
    });
  }

  async function setPasskeyPromptShown(): Promise<void> {
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      passkeyPromptShown: true,
    });
  }

  /**
   * Cache the exported family key for a specific family.
   * By default only stores when isTrustedDevice is true.
   * Pass `force: true` to bypass the trust check (e.g. during join flow
   * when the user just created a password on this device).
   */
  async function cacheFamilyKey(
    exportedKey: string,
    familyId: string,
    options?: { force?: boolean }
  ): Promise<void> {
    if (!options?.force && !isTrustedDevice.value) return;
    const existing = globalSettings.value.cachedFamilyKeys ?? {};
    globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
      cachedFamilyKeys: { ...existing, [familyId]: exportedKey },
    });
  }

  /**
   * Retrieve the cached family key for a specific family.
   */
  function getCachedFamilyKey(familyId: string): string | null {
    return globalSettings.value.cachedFamilyKeys?.[familyId] ?? null;
  }

  /**
   * Clear the cached family key.
   * With familyId: clear one entry. Without: clear all.
   */
  async function clearCachedFamilyKey(familyId?: string): Promise<void> {
    if (familyId) {
      const existing = { ...(globalSettings.value.cachedFamilyKeys ?? {}) };
      delete existing[familyId];
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        cachedFamilyKeys: existing,
      });
    } else {
      globalSettings.value = await globalSettingsRepo.saveGlobalSettings({
        cachedFamilyKeys: {},
      });
    }
  }

  function resetState() {
    settings.value = settingsRepo.getDefaultSettings();
    isLoading.value = false;
    error.value = null;
  }

  async function convertAmount(
    amount: number,
    from: CurrencyCode,
    to: CurrencyCode
  ): Promise<number | undefined> {
    return settingsRepo.convertAmount(amount, from, to);
  }

  return {
    // State
    settings,
    globalSettings,
    isLoading,
    error,
    // Getters
    baseCurrency,
    displayCurrency,
    theme,
    language,
    textSize,
    syncEnabled,
    aiProvider,
    aiTier,
    exchangeRates,
    exchangeRateAutoUpdate,
    exchangeRateLastFetch,
    beanieMode,
    soundEnabled,
    beanieLabEnabled,
    remindersEnabled,
    todoReminderLead,
    activityReminderLead,
    activityReminderBackfilledAt,
    travelReminderLeads,
    preferredCurrencies,
    effectiveDisplayCurrencies,
    customInstitutions,
    onboardingCompleted,
    weekStartDay,
    country,
    showPublicHolidays,
    skipDocumentConsentPrompt,
    calendarClashNudgeEnabled,
    helpfulHintsEnabled,
    helpfulHintNotifyByType,
    helpfulHintLeadDays,
    feedbackOptOut,
    isTrustedDevice,
    trustedDevicePromptShown,
    passkeyPromptShown,
    // Actions
    setFeedbackOptOut,
    recordFeedbackPrompted,
    loadGlobalSettings,
    loadSettings,
    setBaseCurrency,
    setDisplayCurrency,
    setTheme,
    setLanguage,
    setTextSize,
    setSyncEnabled,
    setAutoSyncEnabled,
    setCalendarClashNudgeEnabled,
    setHelpfulHintsEnabled,
    setHelpfulHintNotifyType,
    setHelpfulHintLead,
    setAIProvider,
    setAITier,
    setAIApiKey,
    setBeanieMode,
    setSoundEnabled,
    setBeanieLabEnabled,
    setRemindersEnabled,
    setTodoReminderLead,
    setActivityReminderLead,
    setActivityReminderBackfilledAt,
    setTravelReminderLead,
    setPreferredCurrencies,
    setOnboardingCompleted,
    setWeekStartDay,
    setCountry,
    setShowPublicHolidays,
    setSkipDocumentConsentPrompt,
    addCustomInstitution,
    removeCustomInstitution,
    setExchangeRateAutoUpdate,
    updateExchangeRates,
    addExchangeRate,
    removeExchangeRate,
    setTrustedDevice,
    setTrustedDevicePromptShown,
    setPasskeyPromptShown,
    cacheFamilyKey,
    getCachedFamilyKey,
    clearCachedFamilyKey,
    convertAmount,
    resetState,
  };
});
