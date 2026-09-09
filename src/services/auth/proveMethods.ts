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
 * Phase 4 probes: device biometric (native keystore ONLY — the web WebAuthn+PRF
 * path is retired; a lingering web registration surfaces as `prf_withheld` on the
 * resolved event, never as a method), deviceUnlock PIN, tap-through (credential-less
 * member on an open pod — returning EITHER `tap-through` for a child OR the
 * `invite-needed` explanation for an adult, because both answer the same single
 * question and must never be able to disagree), password (LEGACY members only —
 * suppressed for PIN-only members and for kit-born families cold, where no password
 * wrap exists), and the family recovery passphrase (cold only, when the envelope
 * carries one).
 *
 * The two credential probes share ONE cold gate, `coldEnvelopeHas`, which fails CLOSED
 * on an unreadable envelope. That is the whole point of the `CapabilityState` type: its
 * predecessor was a `boolean | null` that defaulted to "offer it anyway".
 * The unconditional terminal is now `recovery` (kit / passphrase / bootstrap), so
 * the never-blank guarantee no longer rests on the retiring password method.
 */

import type { AgeGroup, PasskeyRegistration } from '@/types/models';
import type { EnvelopeCapabilities } from '@/services/sync/fileSync';
import { resolveDeviceKeys } from '@/services/auth/passkeyService';
import { getPinUnlockRecord, removePinUnlock } from '@/services/auth/deviceUnlock';
import { isNative } from '@/services/sync/capabilities';
import { emitProveMethodsResolved } from '@/services/telemetry/loginFlowEvents';
import { reportError } from '@/utils/errorReporter';

/**
 * AUTHORIZATION predicate: may this member enter WITHOUT proving anything?
 *
 * The single definition of the tap-through age rule, shared by this engine (what to
 * OFFER) and `authStore.signInPasswordless` (what to ALLOW) so the two enforcement
 * points cannot drift apart. Fails closed — anything but a definite `'child'` is an
 * adult, including a missing `ageGroup` on a cold roster card.
 *
 * NOT a general age helper. The other `ageGroup === 'child'` comparisons in the app
 * all choose a LABEL ("Little bean" / "Parent bean"); sweeping them into this would
 * couple user-facing copy to a security predicate, so a wording change could move the
 * auth boundary. Leave them alone.
 */
export function isChildMember(m: { ageGroup?: AgeGroup }): boolean {
  return m.ageGroup === 'child';
}

export interface ProveContext {
  familyId: string;
  memberId: string;
  /** The doc is decrypted in memory — tap-through and doc-hash checks are possible. */
  podOpen: boolean;
  /**
   * Whether the member has ANY credential (password or PIN hash). `null` = unknown (pod
   * not open and the roster entry didn't say) — treated as "has one", because offering
   * tap-through to a credentialed member is the dangerous direction and asking for a
   * password from a passwordless member merely falls through to the create-password path.
   */
  hasCredential: boolean | null;
  /**
   * Whether this member is a child (`isChildMember`). Only a child may tap through; an
   * unclaimed ADULT must be claimed out-of-band via an invite (#79).
   *
   * Deliberately a plain `boolean`, not the `boolean | null` tri-state its siblings use:
   * there, "unknown" and "false" imply different offers, so the third state carries
   * behaviour. Here "unknown" and "not a child" are the SAME outcome (adult → no
   * tap-through), so a tri-state would add a branch with nothing behind it. Required
   * rather than optional so the compiler points at every call site.
   */
  isChild: boolean;
  /**
   * Whether the member has a doc-side PIN hash (Phase 2). Only knowable when the pod is
   * open — `null` when cold, where the device-wrap record alone decides the PIN offer.
   */
  hasPin: boolean | null;
  /**
   * Phase 4: whether the member has a doc-side passwordHash (from the roster cache
   * when cold, the open doc when warm). `null` = unknown → password stays offered
   * (the safe legacy default).
   */
  hasPassword: boolean | null;
  /**
   * What the family's envelope can ACTUALLY be opened with, derived from the envelope
   * itself. Consulted only COLD — warm, the caller already holds the decrypted doc.
   *
   * ⚠️ Required and non-optional so the compiler points at every construction site.
   * Its predecessor was a `boolean | null` carried on the roster cache where `null`
   * meant "offer it anyway", so a device with no cache offered a password against a
   * kit-born envelope that had no password wrap. `known: false` now fails CLOSED.
   */
  envelope: CapabilityState;
  /** Where the person list came from — carried through to telemetry only. */
  rosterSource: 'roster' | 'credential-records' | 'open-pod';
}

/**
 * Whether we know what the envelope can be opened with. The `known: false` arm is the
 * honest third state: it means "we could not read the envelope", NOT "there is nothing
 * there". It fails closed for every credential-specific offer while the unconditional
 * `recovery` terminal still guarantees a way forward.
 */
export type CapabilityState =
  | { known: true; capabilities: EnvelopeCapabilities }
  | { known: false; reason: 'not-staged' | 'stage-failed' };

/**
 * Cold-path capability gate — the fail-closed rule, defined exactly once.
 *
 * A credential is offered from cold ONLY when the envelope PROVES it can work. Unknown
 * fails CLOSED: an offer that cannot succeed is worse than one that is absent, because
 * the user spends their attempt on it and lands on a crypto error. Warm callers never
 * ask — they already hold the doc.
 */
function coldEnvelopeHas(ctx: ProveContext, cap: keyof EnvelopeCapabilities): boolean {
  return ctx.envelope.known && ctx.envelope.capabilities[cap];
}

export type ProveMethod =
  /** OS biometric (native keystore) — the member's key on THIS device. Native only. */
  | { kind: 'biometric'; registration: PasskeyRegistration }
  /**
   * Member PIN (Phase 2). `hasDeviceWrap` true = this device holds a PIN wrap, so the
   * PIN can unlock a CLOSED pod; false = doc-side PIN only (offered on an open pod:
   * verify against the doc hash, then silently enrol this device's wrap).
   */
  | { kind: 'pin'; hasDeviceWrap: boolean }
  /** Credential-less CHILD on an already-open pod — one tap, no ceremony. */
  | { kind: 'tap-through' }
  /**
   * An unclaimed ADULT on an open pod (#79). Claiming must go out-of-band through a
   * 24h invite sent by a signed-in member, so this offers no action at all — it is an
   * EXPLANATORY PANE the user lands on, not a prove method and not the `recovery`
   * escape (which routes straight out of the screen).
   */
  | { kind: 'invite-needed' }
  /**
   * LEGACY members' password prove. A conditional probe since Phase 4: suppressed
   * where a PIN is verifiably usable instead (warm + hasPin), and cold for
   * kit-born families (no password wrap exists). Full retirement (#117) = delete
   * the probe from the array.
   */
  | { kind: 'password' }
  /**
   * The family recovery PASSPHRASE (Phase 3), offered cold and only when the envelope
   * proves one exists. It identifies NO member — `decryptPendingFile` returns
   * `viaRecoveryPassphrase` and `runOpening` routes that to `recoveryMode` — so it
   * opens the pod without signing anyone in.
   */
  | { kind: 'passphrase' }
  /**
   * The unconditional bootstrap/recovery terminal (Phase 4): recovery kit,
   * passphrase, device link, or re-bootstrap. Appended outside the probe loop —
   * the never-blank guarantee.
   */
  | { kind: 'recovery' };

type Probe = {
  name: string;
  run: (ctx: ProveContext) => Promise<ProveMethod | null>;
};

/**
 * Ordered probes. Each returns its method or null — no try/catch, no logging, no
 * fallbacks of its own (the loop owns all of that).
 *
 * ⚠️ ARRAY ORDER IS THE OFFER ORDER. `ProveView` renders the first non-recovery entry
 * as the active pane (`ProveView.vue:70`) and the rest as switch links in this order
 * (`:159-166`). Reordering this array is a UI change, not a refactor.
 */
const PROBES: Probe[] = [
  {
    name: 'device-biometric',
    run: async (ctx) => {
      // Phase 4: NATIVE keystore only — the web WebAuthn+PRF path is retired. A
      // leftover web registration is reported by the resolver as `prf_withheld`
      // (the straggler signal), never offered as a method.
      if (!isNative()) return null;
      const keys = await resolveDeviceKeys(ctx.familyId);
      const own = keys.find((k) => k.memberId === ctx.memberId);
      if (!own) return null;
      return { kind: 'biometric', registration: own };
    },
  },
  {
    name: 'pin',
    run: async (ctx) => {
      const record = await getPinUnlockRecord(ctx.familyId, ctx.memberId);
      if (record) {
        // Review F9: an OPEN pod whose doc carries NO pinHash for this member means the
        // wrap is stale (the hash never reached the file, or an older beanpod was
        // restored) — offering it would render a permanently dead PIN method. Self-heal
        // by removing the record, same pattern as nativeResolveDeviceKeys' cleanup.
        if (ctx.podOpen && ctx.hasPin === false) {
          await removePinUnlock(ctx.familyId, ctx.memberId);
          return null;
        }
        return { kind: 'pin', hasDeviceWrap: true };
      }
      if (ctx.podOpen && ctx.hasPin === true) return { kind: 'pin', hasDeviceWrap: false };
      return null;
    },
  },
  {
    // Name kept as 'tap-through' on purpose: it is the `context.kind` on the loop's
    // existing `probe_failed` report, and renaming would break that signal's continuity.
    name: 'tap-through',
    // ONE probe answers "may this credential-less member enter here?" — a child taps
    // through, an adult gets the invite explanation (#79). Splitting them in two would
    // duplicate this precondition and let a future edit offer both or neither.
    // Strict equality on `false`: `null` (unknown) must NOT tap through — see ProveContext.
    run: async (ctx) => {
      if (!ctx.podOpen || ctx.hasCredential !== false) return null;
      return ctx.isChild ? { kind: 'tap-through' } : { kind: 'invite-needed' };
    },
  },
  {
    name: 'password',
    // LEGACY members only (Phase 4). Suppressed when: the member verifiably has no
    // password; a PIN is verifiably usable instead (warm — `setMemberPin` never
    // clears passwordHash, but cold the password wrap is a converted member's only
    // local bootstrap, so cold suppression keys on the ENVELOPE, not the PIN); or
    // cold against a kit-born envelope, where no password wrap exists to unwrap.
    run: async (ctx) => {
      if (ctx.hasPassword === false) return null;
      if (ctx.podOpen) return ctx.hasPin === true ? null : { kind: 'password' };
      return coldEnvelopeHas(ctx, 'password') ? { kind: 'password' } : null;
    },
  },
  {
    name: 'passphrase',
    // The family recovery passphrase: family-wide, COLD ONLY (warm, the pod is already
    // open and there is nothing left to unwrap). Ordered after `password` so a legacy
    // member's own credential stays the active pane and the passphrase is the switch
    // link, matching `tryUnwrapFamilyKey`, which tries member wraps before the
    // passphrase so an identical phrase can never shadow a member's password.
    run: async (ctx) =>
      !ctx.podOpen && coldEnvelopeHas(ctx, 'passphrase') ? { kind: 'passphrase' } : null,
  },
];

/**
 * Resolve the ordered prove methods for one member on this device.
 *
 * Never throws; never returns []. The `recovery` terminal is appended outside the
 * probe loop so no probe failure — or all of them failing at once — can strand the
 * user on a blank prove screen.
 */
export async function resolveProveMethods(ctx: ProveContext): Promise<ProveMethod[]> {
  const methods: ProveMethod[] = [];
  let firstErrorCode: string | undefined;

  // Straggler signal for the PRF retirement: a web passkey registration exists for
  // this member but the method is withheld (assertion path deleted). Computed HERE,
  // not inside a probe — probes stay free of telemetry per the module contract.
  let prfWithheld = false;
  if (!isNative()) {
    try {
      const keys = await resolveDeviceKeys(ctx.familyId);
      prfWithheld = keys.some((k) => k.memberId === ctx.memberId);
    } catch {
      // Signal-only — never degrade the screen for it.
    }
  }

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

  // The unconditional bootstrap/recovery terminal. Appended OUTSIDE the loop by
  // design — the never-blank guarantee no longer rests on the retiring password.
  methods.push({ kind: 'recovery' });

  // Which cold offers the fail-closed rule withheld. Computed HERE from `ctx` and the
  // resolved list, not inside a probe — probes stay free of telemetry per the module
  // contract, same as `prfWithheld` above.
  const suppressed = ctx.podOpen
    ? []
    : (['password', 'passphrase'] as const).filter(
        (k) => !coldEnvelopeHas(ctx, k) && !methods.some((m) => m.kind === k)
      );

  emitProveMethodsResolved({
    methods: methods.map((m) => m.kind),
    rosterSource: ctx.rosterSource,
    errorCode: firstErrorCode,
    prfWithheld,
    suppressed,
    capsKnown: ctx.podOpen ? undefined : ctx.envelope.known,
  });

  return methods;
}
