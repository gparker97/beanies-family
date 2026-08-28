/**
 * The SINGLE "how can this member prove who they are on this device?" decision engine
 * (2026-08-28 login rethink). Every login surface asks this module and renders what it
 * returns — no view, page, or store makes its own biometric-vs-password decision. The
 * previous architecture had three disagreeing copies of that decision (LoginPage,
 * PickBeanView, LoadPodView), and the third was reachable exactly when the first two
 * had been fixed; this module is why that class of bug cannot recur.
 *
 * Structure: an ordered array of self-contained probes, each
 * `(ctx) => Promise<ProveMethod | null>`. ONE wrapper loop owns the per-probe
 * try/catch, `reportError`, and the `error_code` carried on `prove_methods_resolved`;
 * probes contain no error plumbing of their own. The engine NEVER throws and never
 * returns an empty list: a failed probe degrades that method away (never the whole
 * screen), and the bootstrap/recovery terminal is appended unconditionally after the
 * loop. Phase 4 retirement of a legacy mechanism = deleting one probe from the array.
 *
 * Phase 1 probes: device biometric (native keystore, or web passkey until Phase 4),
 * tap-through (passwordless member on an open pod), and password (the legacy prove +
 * cold-bootstrap terminal). Phase 2 inserts the deviceUnlock PIN probe between
 * biometric and tap-through.
 */

import type { PasskeyRegistration } from '@/types/models';
import { resolveDeviceKeys } from '@/services/auth/passkeyService';
import { emitProveMethodsResolved } from '@/services/telemetry/loginFlowEvents';
import { reportError } from '@/utils/errorReporter';

export interface ProveContext {
  familyId: string;
  memberId: string;
  /** The doc is decrypted in memory — tap-through and doc-hash checks are possible. */
  podOpen: boolean;
  /**
   * Whether the member has a password/PIN hash. `null` = unknown (pod not open and the
   * roster entry didn't say) — treated as "has one", because offering tap-through to a
   * credentialed member is the dangerous direction and asking for a password from a
   * passwordless member merely falls through to the create-password path.
   */
  hasCredential: boolean | null;
  /** Where the person list came from — carried through to telemetry only. */
  rosterSource: 'roster' | 'credential-records' | 'open-pod';
}

export type ProveMethod =
  /** OS biometric (native keystore) or web passkey — the member's key on THIS device. */
  | { kind: 'biometric'; registration: PasskeyRegistration }
  /** Passwordless member on an already-open pod — one tap, no ceremony. */
  | { kind: 'tap-through' }
  /** Legacy prove + cold-device bootstrap terminal. Always present until Phase 4. */
  | { kind: 'password' };

type Probe = {
  name: string;
  run: (ctx: ProveContext) => Promise<ProveMethod | null>;
};

/**
 * Ordered probes. Each returns its method or null — no try/catch, no logging, no
 * fallbacks of its own (the loop owns all of that).
 */
const PROBES: Probe[] = [
  {
    name: 'device-biometric',
    run: async (ctx) => {
      const keys = await resolveDeviceKeys(ctx.familyId);
      const own = keys.find((k) => k.memberId === ctx.memberId);
      return own ? { kind: 'biometric', registration: own } : null;
    },
  },
  {
    name: 'tap-through',
    // Strict equality on `false`: `null` (unknown) must NOT tap through — see ProveContext.
    run: async (ctx) =>
      ctx.podOpen && ctx.hasCredential === false ? { kind: 'tap-through' } : null,
  },
];

/**
 * Resolve the ordered prove methods for one member on this device.
 *
 * Never throws; never returns []. The password terminal is appended outside the probe
 * loop so no probe failure — or all of them failing at once — can strand the user on a
 * blank prove screen.
 */
export async function resolveProveMethods(ctx: ProveContext): Promise<ProveMethod[]> {
  const methods: ProveMethod[] = [];
  let firstErrorCode: string | undefined;

  for (const probe of PROBES) {
    try {
      const method = await probe.run(ctx);
      if (method) methods.push(method);
    } catch (err) {
      // A failed probe degrades ITS method away, never the whole screen.
      firstErrorCode ??= err instanceof Error ? err.name : 'unknown';
      reportError({
        surface: 'login-flow',
        message: `prove probe '${probe.name}' failed — method degraded away`,
        error: err,
        severity: 'warning',
        context: { action: 'probe_failed', kind: probe.name },
      });
    }
  }

  // The unconditional bootstrap/recovery terminal (Phase 1: password; the create-password
  // path handles members who have none yet). Appended OUTSIDE the loop by design.
  methods.push({ kind: 'password' });

  emitProveMethodsResolved({
    methods: methods.map((m) => m.kind),
    rosterSource: ctx.rosterSource,
    errorCode: firstErrorCode,
  });

  return methods;
}
