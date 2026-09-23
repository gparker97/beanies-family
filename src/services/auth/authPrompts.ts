/**
 * Post-sign-in auth-prompt sequencer (Phase 4 of the 2026-08-28 login rethink).
 *
 * The one-interruption-slot prompt chain used to live as an inline if-chain in
 * App.vue's watcher; four prompts made that untestable except by mounting App. This
 * module is the same shape as `proveMethods.ts`'s probe array and the sign-out step
 * lists: an ORDERED array of self-contained descriptors, one loop, first eligible
 * wins. App.vue reduces to "winning id → modal component". A fifth prompt someday is
 * one array entry.
 *
 * Ordering:
 *   0. trust — FIRST, and the one UNPREEMPTABLE prompt (2026-09-23, greg: "for any new
 *             device, at the first sign-in, ALWAYS ask the user if the device is
 *             trusted"). Eligible only while the device is untrusted AND the question is
 *             unanswered, so it fires once per device (re-armed by an untrusted or
 *             clear-data sign-out). It used to be LAST, and since only one prompt shows
 *             per sign-in, the PIN / kit / biometric nags routinely won and the question
 *             was never asked. Created and joined devices are trusted automatically, so
 *             they never see it. `unpreemptable` lets it show even when another surface
 *             already holds the one-interruption slot (see useSessionInterruption).
 *
 * Then the existing-family migration engine:
 *   1. pin  — the member holds a legacy password and no PIN yet. Per-MEMBER dismiss
 *             flag (a sibling's dismissal must not suppress it). Deliberately
 *             PIN-less members with NO credential at all (tap-through kids) are
 *             excluded — their PIN setup is a parent-initiated Settings action.
 *   2. kit  — the family lacks the kit confirmed-signal. The signal is
 *             `settings.recoveryKitConfirmedAt`, OR (legacy 0.13 families) kit
 *             entries present while the OWNER holds a real password — those kits
 *             went through the unclosable Settings confirm, and no old client can
 *             ever alter the OWNER's credential, so the inference is spoof-proof.
 *             Only members who can manage the pod are nagged.
 *   3. native-biometric — native keystore enrolment (web passkey prompt retired).
 *
 * The kit signals below are ALSO consumed by the sign-out kit guard
 * (`needsKitGuardBeforeSignOut`, via `useSignOut`), with a deliberately different legacy
 * rule: the nag asks "was a kit ever confirmed?", the guard asks "can this family still
 * get in without this device?".
 *
 * Descriptors are PURE decisions — no modal state, no side effects except the
 * documented confirmed-signal backfill. The caller owns `claimInterruption` and
 * showing the modal.
 */

import type { BeanpodFileV4 } from '@/types/syncFileV4';
import type { FamilyMember, Settings } from '@/types/models';
import { canOfferBiometric, resolveDeviceKeys } from '@/services/auth/passkeyService';
import { isNative } from '@/services/sync/capabilities';
import { reportError } from '@/utils/errorReporter';

export type AuthPromptId = 'pin' | 'kit' | 'native-biometric' | 'trust';

export interface AuthPromptContext {
  familyId: string;
  memberId: string;
  /** The signed-in member's live doc row. */
  member: FamilyMember | undefined;
  /** The family's OWNER row (for the kit confirmed-signal inference). */
  owner: FamilyMember | undefined;
  /** The open envelope (recoveryKeys presence feeds the kit signal). */
  envelope: BeanpodFileV4 | null;
  /** The family's doc-side settings entity. */
  settings: Settings | null;
  /** Device-local dismissal state (settingsStore). */
  flags: {
    isPinPromptDismissed(familyId: string, memberId: string): boolean;
    kitPromptDismissed: boolean;
    trustedDevicePromptShown: boolean;
    isTrustedDevice: boolean;
  };
}

/** The slice of the prompt context the kit signals read (shared with the sign-out guard). */
export type KitSignalContext = Pick<AuthPromptContext, 'settings' | 'owner' | 'envelope'>;

/**
 * The kit confirmed-signal (see the Phase-4 plan): a doc-side confirmation stamp,
 * or — for legacy password-era families — kit entries present while the owner holds
 * a real (non-sentinel) password.
 */
export function hasKitConfirmedSignal(ctx: KitSignalContext): boolean {
  if (ctx.settings?.recoveryKitConfirmedAt) return true;
  const kitCount = Object.keys(ctx.envelope?.recoveryKeys ?? {}).length;
  return kitCount > 0 && !!ctx.owner?.passwordHash;
}

/**
 * Whether the family can be opened on a fresh device WITHOUT a recovery kit, so "you will
 * lose access forever" would be false. Read from the ENVELOPE, because that is exactly what
 * `tryUnwrapFamilyKey` (fileSync.ts) tries cold: a password wrap in `wrappedKeys` (written
 * only by the password-era set/rotate paths) or the family `recoveryPassphrase`. Not the
 * doc's `passwordHash`, which can outlive a removed wrap. This is also how greg's Q2 rule
 * holds ("password-era families count as saved"): their envelope carries password wraps.
 * With no envelope loaded it returns false, so the guard fires: the safe direction.
 */
export function hasColdOpenCredential(ctx: Pick<KitSignalContext, 'envelope'>): boolean {
  const env = ctx.envelope;
  return !!env?.recoveryPassphrase || Object.keys(env?.wrappedKeys ?? {}).length > 0;
}

/**
 * The sign-out kit guard (2026-09-23): stop a manager whose recovery kit was never SAVED
 * (`recoveryKitConfirmedVia !== 'saved'`: ticked only, or confirmed before `via` existed)
 * from a sign-out that drops this device's key material, because for a kit-born family
 * that can be the last way back in. Skipped for the App Review demo (disposable pod) and
 * for a family with any other cold-open credential (`hasColdOpenCredential`), where "you
 * will lose access forever" would be false. Settings or envelope not loaded: it guards.
 */
export function needsKitGuardBeforeSignOut(
  ctx: KitSignalContext & {
    member: FamilyMember | undefined;
    dropsKeyMaterial: boolean;
    isDemo: boolean;
  }
): boolean {
  return (
    !ctx.isDemo &&
    ctx.dropsKeyMaterial &&
    !!ctx.member?.canManagePod &&
    ctx.settings?.recoveryKitConfirmedVia !== 'saved' &&
    !hasColdOpenCredential(ctx)
  );
}

type PromptDescriptor = {
  id: AuthPromptId;
  eligible: (ctx: AuthPromptContext) => Promise<boolean> | boolean;
  /** May show even when another surface holds the one-interruption slot. ONLY `trust`. */
  unpreemptable?: boolean;
};

const PROMPTS: PromptDescriptor[] = [
  {
    id: 'trust',
    eligible: (ctx) => !ctx.flags.isTrustedDevice && !ctx.flags.trustedDevicePromptShown,
    unpreemptable: true,
  },
  {
    id: 'pin',
    eligible: (ctx) => {
      if (!ctx.member) return false;
      // Credential-history members only: legacy password, no PIN yet.
      if (!ctx.member.passwordHash || ctx.member.pinHash) return false;
      return !ctx.flags.isPinPromptDismissed(ctx.familyId, ctx.memberId);
    },
  },
  {
    id: 'kit',
    eligible: (ctx) => {
      if (ctx.flags.kitPromptDismissed) return false;
      // Only pod managers are nagged about the family-level kit.
      if (!ctx.member?.canManagePod) return false;
      return !hasKitConfirmedSignal(ctx);
    },
  },
  {
    id: 'native-biometric',
    eligible: async (ctx) => {
      if (!isNative()) return false;
      const keys = await resolveDeviceKeys(ctx.familyId);
      if (keys.some((k) => k.memberId === ctx.memberId)) return false;
      return canOfferBiometric();
    },
  },
];

/** Whether this prompt may bypass the one-interruption slot (see the header). */
export function isUnpreemptable(id: AuthPromptId): boolean {
  return PROMPTS.some((p) => p.id === id && p.unpreemptable === true);
}

/**
 * First eligible prompt for this sign-in, or null. Never throws: a descriptor
 * failure degrades that prompt away (reported), never the whole chain.
 */
export async function resolveAuthPrompt(ctx: AuthPromptContext): Promise<AuthPromptId | null> {
  for (const prompt of PROMPTS) {
    try {
      if (await prompt.eligible(ctx)) return prompt.id;
    } catch (err) {
      reportError({
        surface: 'login-flow',
        message: `auth prompt '${prompt.id}' eligibility check failed — prompt skipped`,
        error: err,
        severity: 'warning',
        context: { action: 'prompt_eligibility_failed', kind: prompt.id },
      });
    }
  }
  return null;
}
