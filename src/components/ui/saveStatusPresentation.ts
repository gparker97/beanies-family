import type { SaveStatus } from '@/stores/syncStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

/**
 * Pure status → presentation lookup for the SaveStatusIndicator. Keyed on the
 * FULL `SaveStatus` union (no optional access — `saveStatus` is a total
 * computed), so it stays a flat, exhaustively-testable map instead of nested
 * template ternaries. Colours are the dark-sidebar variants from the approved
 * mockup (`docs/mockups/sidebar-save-status-indicator-2026-08-06.html`); every
 * concrete token is CIG-sourced (soft-green `#6EE7B7`, Sky-Silk `#AED6F1`,
 * Heritage Orange `#F15D22` — never Alert Red for the degraded state).
 */
export interface SaveStatusPresentation {
  /** i18n key for the row label. `usesRelativeTime` keys interpolate `{time}`. */
  labelKey: UIStringKey;
  /** true → the label is `savedAgo` and needs the relative time filled in. */
  usesRelativeTime: boolean;
  /** Tailwind class for the status dot colour. */
  dotClass: string;
  /** true → dot gently pulses (in-flight / attention states). */
  pulse: boolean;
  /** Tailwind class for the label text colour (on the dark sidebar). */
  textClass: string;
  /** false → the row renders nothing (no data file / pre-first-save window). */
  visible: boolean;
  /** true → degraded/critical tone: amber row tint + the hamburger alert dot. */
  attention: boolean;
}

export const SAVE_STATUS_PRESENTATION: Record<SaveStatus, SaveStatusPresentation> = {
  saved: {
    labelKey: 'saveStatus.savedAgo',
    usesRelativeTime: true,
    dotClass: 'bg-[#6EE7B7]',
    pulse: false,
    textClass: 'text-white/45',
    visible: true,
    attention: false,
  },
  saving: {
    labelKey: 'saveStatus.saving',
    usesRelativeTime: false,
    dotClass: 'bg-[#AED6F1]',
    pulse: true,
    textClass: 'text-[#AED6F1]/85',
    visible: true,
    attention: false,
  },
  degraded: {
    labelKey: 'saveStatus.degraded',
    usesRelativeTime: false,
    dotClass: 'bg-[#F15D22]',
    pulse: true,
    textClass: 'text-[#F6A583]',
    visible: true,
    attention: true,
  },
  critical: {
    labelKey: 'saveStatus.degraded',
    usesRelativeTime: false,
    dotClass: 'bg-[#F15D22]',
    pulse: true,
    textClass: 'text-[#F6A583]',
    visible: true,
    attention: true,
  },
  hidden: {
    labelKey: 'saveStatus.saved',
    usesRelativeTime: false,
    dotClass: '',
    pulse: false,
    textClass: '',
    visible: false,
    attention: false,
  },
};
