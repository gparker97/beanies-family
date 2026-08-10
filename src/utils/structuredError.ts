/**
 * Structured-error view derivation — the shared half of the ADR-024 pattern.
 *
 * The pattern is: a frozen registry maps every error *code* to one i18n message
 * key, an ordered list of recovery actions, and a severity. A view then derives
 * "what do I render right now" from (registry, current error, translator).
 *
 * That derivation is identical everywhere the pattern is used; the *markup* is
 * not. `JoinPodView` renders an inline tinted card in the login flow, while the
 * pod-access surface renders full-bleed `ErrorBanner` chrome at the top of the
 * app — different visual languages with different severity tints and different
 * button treatments. So this module extracts the derivation and deliberately
 * leaves each surface to own its own markup and its own recovery handlers.
 *
 * Why `utils/` and not `composables/`: there is no reactivity, no lifecycle, and
 * no store access here. Filing it under `composables/` would mislabel it and
 * invite someone to add reactivity later. It is also imported (transitively) by
 * `syncStore` via `utils/podAccess.ts`, and a store reaching into `composables/`
 * is the kind of dependency edge that grows into a cycle.
 *
 * Exhaustiveness is enforced at each registry's declaration with
 * `as const satisfies Record<<CodeUnion>, StructuredErrorEntry>` — see
 * `JOIN_ERRORS` (`useJoinFlow.ts`) and `POD_ACCESS_ERRORS` (`utils/podAccess.ts`).
 * Deliberately NOT enforced with generics here: a non-generic signature reads at
 * a glance and has exactly one behaviour to test.
 */

import { fillTemplate } from '@/utils/fillTemplate';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface StructuredErrorEntry {
  /**
   * i18n key; may contain `{placeholder}` tokens filled from the error context.
   * Typed as `UIStringKey` (not `string`) so a registry entry naming a key that
   * doesn't exist in `uiStrings.ts` fails the build rather than rendering the
   * raw key to a user who is already having a bad time.
   */
  messageKey: UIStringKey;
  /** Ordered recovery action ids — the first is rendered as the primary action. */
  recoveries: readonly string[];
  severity: 'warning' | 'critical';
}

export interface StructuredError {
  code: string;
  context?: Record<string, unknown>;
}

export interface StructuredErrorView {
  code: string;
  severity: 'warning' | 'critical';
  /** Already translated and interpolated — render as-is. */
  message: string;
  recoveries: readonly string[];
}

/**
 * Derive the renderable view of the current error, or `null` when there is none.
 *
 * Returns `null` rather than throwing when a code has no registry entry: a
 * missing entry must never blank the screen or crash the surface that was trying
 * to explain a failure. Registries are exhaustive at compile time, so this is a
 * belt-and-braces guard against a hand-built error object.
 */
export function resolveErrorView(
  registry: Readonly<Record<string, StructuredErrorEntry>>,
  err: StructuredError | null,
  t: (key: UIStringKey) => string
): StructuredErrorView | null {
  if (!err) return null;
  const meta = registry[err.code];
  if (!meta) {
    console.warn(`[structuredError] no registry entry for code "${err.code}" — not rendering`);
    return null;
  }
  // Interpolate context via fillTemplate so account/family-controlled values
  // (e.g. {actualEmail}) insert literally and can't be mangled by
  // `$`-replacement patterns.
  const message = err.context ? fillTemplate(t(meta.messageKey), err.context) : t(meta.messageKey);
  return {
    code: err.code,
    severity: meta.severity,
    message,
    recoveries: meta.recoveries,
  };
}
