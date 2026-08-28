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
 * Ordering (the existing-family migration engine):
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
 *   4. trust — the trusted-device prompt (unchanged).
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
  };
}

/**
 * The kit confirmed-signal (see the Phase-4 plan): a doc-side confirmation stamp,
 * or — for legacy password-era families — kit entries present while the owner holds
 * a real (non-sentinel) password.
 */
export function hasKitConfirmedSignal(ctx: AuthPromptContext): boolean {
  if (ctx.settings?.recoveryKitConfirmedAt) return true;
  const kitCount = Object.keys(ctx.envelope?.recoveryKeys ?? {}).length;
  return kitCount > 0 && !!ctx.owner?.passwordHash;
}

type PromptDescriptor = {
  id: AuthPromptId;
  eligible: (ctx: AuthPromptContext) => Promise<boolean> | boolean;
};

const PROMPTS: PromptDescriptor[] = [
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
  {
    id: 'trust',
    eligible: (ctx) => !ctx.flags.trustedDevicePromptShown,
  },
];

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
