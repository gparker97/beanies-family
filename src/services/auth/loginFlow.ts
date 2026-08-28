/**
 * The pure login-flow state machine (2026-08-28 login rethink, Phase 1).
 *
 * Typed states + one `transition(state, event)` function. No Vue imports, no I/O, no
 * store access — effects (resolving prove methods, running a biometric prompt, fetching
 * and decrypting the pod) are REQUESTED by the states this machine returns and executed
 * by the rendering component, which reports outcomes back as events. That inversion is
 * what makes the routing matrix unit-testable without mounting components — the property
 * the previous architecture lacked while its tri-engine routing bug survived five review
 * rounds.
 *
 * Scope (Phase 1): the RETURNING-USER path — a family already known to this device —
 * from person selection through prove and open. Bootstrap surfaces (welcome, create,
 * join, resume-setup, the load-a-file picker) stay outside the machine: `idle` means
 * "the machine is not driving; a bootstrap surface owns the screen".
 *
 * The core inversion: PROVE FIRST (yield identity + family key from local material),
 * THEN OPEN (fetch/decrypt). A dead Drive token therefore surfaces as `open-recovery`
 * — a reconnect panel shown to an already-proven member — never as a fall-back onto a
 * credential surface. The one deliberate exception is the password method: a password
 * can only be verified against the envelope/doc, so its submission happens inside
 * `opening` (fetch → unwrap → verify), and a fetch failure returns to `open-recovery`
 * with the prove step still satisfied-pending rather than re-asking who the user is.
 */

import type { ProveMethod } from '@/services/auth/proveMethods';
import type { RosterCacheMember } from '@/types/models';

/** Where the person list was sourced from (telemetry + fallback semantics). */
export type PersonSource = 'roster' | 'credential-records' | 'open-pod';

/**
 * One person card on the picker — the roster projection, whatever its source.
 * `photoUrl` is populated only when the pod is already open (photos live inside the
 * encrypted doc, so a pre-decrypt roster can never carry one).
 */
export type PersonCard = RosterCacheMember & { photoUrl?: string };

/** Why an open attempt failed — drives which recovery panel renders. */
export type OpenFailReason =
  | 'auth' // Drive token gone → reconnect panel
  | 'permission' // local file handle permission revoked → grant panel
  | 'not-found' // file moved/deleted → re-pick panel
  | 'wrong-password' // password prove failed against the envelope/doc — back to prove
  | 'error'; // anything else → generic retry panel

/**
 * The credential material a successful prove yields. `fk` is absent exactly when the
 * method verifies identity without producing a key (tap-through on an open pod, or a
 * web passkey assert whose PRF/caches produced nothing — the opening effect then relies
 * on the pod already being open, or fails into recovery honestly).
 */
export interface ProveGrant {
  memberId: string;
  fkAvailable: boolean;
}

/** The prove-screen context an `opening` attempt must retain to come back from. */
export interface ProveResume {
  familyName: string;
  person: PersonCard;
  source: PersonSource;
  people: PersonCard[];
}

export type LoginFlowState =
  /** Machine not driving — a bootstrap surface (welcome/create/join/load) owns the screen. */
  | { kind: 'idle' }
  /** Person picker for one family. */
  | {
      kind: 'person-select';
      familyId: string;
      familyName: string;
      people: PersonCard[];
      source: PersonSource;
    }
  /** Effect requested: resolveProveMethods for the picked person. */
  | {
      kind: 'prove-loading';
      familyId: string;
      familyName: string;
      person: PersonCard;
      source: PersonSource;
      /** Retained so BACK can restore the picker without re-querying. */
      people: PersonCard[];
    }
  /** The one prove screen: ordered methods, inline fallback. */
  | {
      kind: 'prove';
      familyId: string;
      familyName: string;
      person: PersonCard;
      methods: ProveMethod[];
      /** How many times the user has fallen back on this screen (telemetry). */
      fallbackDepth: number;
      source: PersonSource;
      people: PersonCard[];
    }
  /** Effect requested: ensure the pod is fetched + decrypted + session completed. */
  | {
      kind: 'opening';
      familyId: string;
      grant: ProveGrant;
      /** Set when this attempt is a retry from recovery. */
      retry: boolean;
      /** Prove-screen context, retained so 'wrong-password' can return there. */
      resume: ProveResume;
    }
  /**
   * Open failed for a NON-credential reason — fix the transport. `grant` is null when
   * the failure happened BEFORE identity was proven (web cold start needs the envelope
   * fetched before a PRF assert can run): retry then returns to prove, not to opening.
   * Either way the user is never asked to re-answer "who are you".
   */
  | {
      kind: 'open-recovery';
      familyId: string;
      grant: ProveGrant | null;
      reason: Exclude<OpenFailReason, 'wrong-password'>;
      resume: ProveResume;
    }
  /** Terminal: signed in; the component routes to `destination`. */
  | { kind: 'done'; destination: string };

export type LoginFlowEvent =
  /** Enter the flow for a known family (from boot single-family or the family picker). */
  | {
      type: 'START';
      familyId: string;
      familyName: string;
      people: PersonCard[];
      source: PersonSource;
    }
  | { type: 'PICK_PERSON'; person: PersonCard }
  /** The prove-loading effect finished. */
  | { type: 'METHODS_RESOLVED'; methods: ProveMethod[] }
  /**
   * A local prove method succeeded (biometric assert, tap-through). The session tail has
   * run; the machine's job is to open the pod.
   */
  | { type: 'PROVE_SUCCEEDED'; grant: ProveGrant }
  /** The user moved down the fallback chain on the prove screen (telemetry only). */
  | { type: 'PROVE_FELL_BACK' }
  /**
   * The password path: submission is verified INSIDE the opening effect (envelope/doc
   * needed), so it enters `opening` with `fkAvailable: false` and the effect carries
   * the password out-of-band (never stored in machine state).
   */
  | { type: 'PASSWORD_SUBMITTED'; memberId: string }
  | { type: 'OPEN_SUCCEEDED' }
  | { type: 'OPEN_FAILED'; reason: OpenFailReason }
  /** The recovery panel's retry (after reconnect/grant/re-pick). */
  | { type: 'RECOVERY_RETRY' }
  /** "Not you?" / back from prove → person picker. */
  | { type: 'BACK' }
  /** Leave the flow entirely (to welcome / family picker) — machine goes idle. */
  | { type: 'EXIT' };

/** The default post-login destination. Kept here so every DONE agrees. */
export const LOGIN_DESTINATION = '/nook';

function proveResume(state: Extract<LoginFlowState, { kind: 'prove' }>): ProveResume {
  return {
    familyName: state.familyName,
    person: state.person,
    source: state.source,
    people: state.people,
  };
}

/**
 * Pure transition. Unknown (state, event) pairs return the state unchanged — a stale
 * event from a superseded effect (e.g. a slow METHODS_RESOLVED landing after BACK) must
 * be inert, never a crash or a surprise navigation.
 */
export function transition(state: LoginFlowState, event: LoginFlowEvent): LoginFlowState {
  switch (event.type) {
    case 'START':
      return {
        kind: 'person-select',
        familyId: event.familyId,
        familyName: event.familyName,
        people: event.people,
        source: event.source,
      };

    case 'EXIT':
      return { kind: 'idle' };

    case 'PICK_PERSON':
      if (state.kind !== 'person-select') return state;
      return {
        kind: 'prove-loading',
        familyId: state.familyId,
        familyName: state.familyName,
        person: event.person,
        source: state.source,
        people: state.people,
      };

    case 'METHODS_RESOLVED':
      if (state.kind !== 'prove-loading') return state;
      return {
        kind: 'prove',
        familyId: state.familyId,
        familyName: state.familyName,
        person: state.person,
        methods: event.methods,
        fallbackDepth: 0,
        source: state.source,
        people: state.people,
      };

    case 'PROVE_FELL_BACK':
      if (state.kind !== 'prove') return state;
      return { ...state, fallbackDepth: state.fallbackDepth + 1 };

    case 'PROVE_SUCCEEDED':
      if (state.kind !== 'prove') return state;
      return {
        kind: 'opening',
        familyId: state.familyId,
        grant: event.grant,
        retry: false,
        resume: proveResume(state),
      };

    case 'PASSWORD_SUBMITTED':
      if (state.kind !== 'prove') return state;
      return {
        kind: 'opening',
        familyId: state.familyId,
        grant: { memberId: event.memberId, fkAvailable: false },
        retry: false,
        resume: proveResume(state),
      };

    case 'OPEN_SUCCEEDED':
      if (state.kind !== 'opening') return state;
      return { kind: 'done', destination: LOGIN_DESTINATION };

    case 'OPEN_FAILED': {
      // Also legal from `prove`: the prove effect may need the envelope staged before a
      // web PRF assert, and that fetch can fail. Identity is not yet proven there, so
      // recovery carries a null grant and retry re-enters prove.
      if (state.kind === 'prove' && event.reason !== 'wrong-password') {
        return {
          kind: 'open-recovery',
          familyId: state.familyId,
          grant: null,
          reason: event.reason,
          resume: proveResume(state),
        };
      }
      if (state.kind !== 'opening') return state;
      // A wrong password is a PROVE failure, not a transport failure — return to the
      // prove screen (via prove-loading so methods are freshly re-resolved), never to
      // a transport-recovery panel.
      if (event.reason === 'wrong-password') {
        return {
          kind: 'prove-loading',
          familyId: state.familyId,
          familyName: state.resume.familyName,
          person: state.resume.person,
          source: state.resume.source,
          people: state.resume.people,
        };
      }
      return {
        kind: 'open-recovery',
        familyId: state.familyId,
        grant: state.grant,
        reason: event.reason,
        resume: state.resume,
      };
    }

    case 'RECOVERY_RETRY':
      if (state.kind !== 'open-recovery') return state;
      // Not yet proven (the transport died before the assert) → back to prove with
      // fresh methods. Proven → straight to opening with the same grant.
      if (!state.grant) {
        return {
          kind: 'prove-loading',
          familyId: state.familyId,
          familyName: state.resume.familyName,
          person: state.resume.person,
          source: state.resume.source,
          people: state.resume.people,
        };
      }
      return {
        kind: 'opening',
        familyId: state.familyId,
        grant: state.grant,
        retry: true,
        resume: state.resume,
      };

    case 'BACK':
      // From prove (or its loading) → back to the person picker, state intact.
      if (state.kind === 'prove' || state.kind === 'prove-loading') {
        return {
          kind: 'person-select',
          familyId: state.familyId,
          familyName: state.familyName,
          people: state.people,
          source: state.source,
        };
      }
      // From the picker (or recovery) → out of the flow entirely.
      if (state.kind === 'person-select' || state.kind === 'open-recovery') {
        return { kind: 'idle' };
      }
      return state;

    default:
      return state;
  }
}
