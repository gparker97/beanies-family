/**
 * "Your beanies magic link" — a member's saved sign-in link.
 *
 * WHAT IT IS. A 7-day, per-member URL that unwraps the family key and lands its holder
 * on THAT member's PIN entry. It exists because ADR-034 left a kit-born family with
 * exactly ONE envelope wrap — the recovery kit — and a device-local PIN that cannot
 * travel. The measured consequence: 6 of the 22 real families created since telemetry
 * began redeemed a recovery kit, every one on a cold device, and 5 of the 6 then
 * replaced a PIN that worked. The kit had become the front door.
 *
 * WHAT IT IS NOT. It is not a cryptographic compartment. The link unwraps the FAMILY
 * key, so whoever holds it can open everything the family has; the member binding and
 * the PIN that follows gate the INTERFACE, not the ciphertext. Copy must never promise
 * otherwise. It is also not "permanent but revocable" — see REVOCATION below.
 *
 * REVOCATION, which is the part that is easy to get silently wrong. Three mechanisms,
 * and no one of them is sufficient:
 *   1. the dict is keyed by MEMBER ID, so a new mint OVERWRITES rather than appends
 *      (`envelopeMerge` cannot propagate a deletion, so overwrite is the only shape
 *      revocation can take at all);
 *   2. the dict merges NEWEST-WINS, without which a peer holding the pre-rotation entry
 *      wins the merge and republishes the dead wrap — the revocation un-happens;
 *   3. `createdAt` is MONOTONIC at mint, so a device with a fast clock cannot stamp an
 *      entry that outlives its own replacement.
 * The 7-day `expiresAt` is a safety net on top, NOT the mechanism. A link revoked on
 * day 1 must be dead on day 1.
 *
 * The token is NEVER persisted — same contract as the recovery kit. That is why Settings
 * can only ever mint a NEW link, never re-display the current one.
 */
import {
  MAGIC_LINK_EXPIRY_MS,
  buildInviteLink,
  createInvitePackage,
  hashInviteToken,
  isInviteExpired,
  generateInviteToken,
  redeemInviteToken,
  type InviteLinkParams,
} from '@/services/crypto/inviteService';
import type { MemberLinkKeyPackage } from '@/types/syncFileV4';

/**
 * Why a redeem was refused. Each maps to its own user-facing message and its own
 * `error_code` — never a shared generic one, because the recovery advice differs.
 */
export type MagicLinkRefusal =
  | 'no-entry' // nothing at memberLinkKeys[memberId] — or the merge dropped the dict
  | 'link-revoked' // a newer link was minted, or the member was unclaimed
  | 'token-expired' // past its 7 days
  | 'key-rotated'; // the family key was rotated (#117)

/**
 * Mint a member's magic link package.
 *
 * `previousCreatedAt` is the entry being REPLACED, if any. It is what makes `createdAt`
 * monotonic: `pickNewerByCreatedAt` resolves an exact tie to the incoming side, so two
 * mints inside one millisecond would otherwise be a coin flip, and a fast clock on the
 * old entry would beat a correct clock on the new one outright.
 *
 * ⚠️ `expiresAt` is NOT derived from `createdAt`. It comes from `createInvitePackage`,
 * i.e. the real wall clock plus 7 days, so a `createdAt` bumped forward to win a merge
 * can never extend a link's life.
 */
export async function mintMagicLinkPackage(
  familyKey: CryptoKey,
  keyId: string,
  previousCreatedAt?: string
): Promise<{ token: string; pkg: MemberLinkKeyPackage }> {
  const token = generateInviteToken();
  const base = await createInvitePackage(familyKey, token, MAGIC_LINK_EXPIRY_MS);
  const prevMs = previousCreatedAt ? Date.parse(previousCreatedAt) : NaN;
  const createdAt = new Date(
    Number.isFinite(prevMs) ? Math.max(Date.now(), prevMs + 1) : Date.now()
  ).toISOString();

  return {
    token,
    pkg: { ...base, tokenHash: await hashInviteToken(token), keyId, createdAt },
  };
}

/**
 * A package that can never be unwrapped by anyone, used to REVOKE.
 *
 * Deleting the entry would be the obvious move and is the wrong one: `mergeKeyDict` is
 * a union, so a deletion does not propagate and any peer would resurrect the live wrap
 * on its next sync. Overwriting does propagate, under `newest-wins`. Empty `salt`/
 * `wrapped` plus an unmatchable `tokenHash` means the redeem stops at the revocation
 * check and reports `link-revoked` rather than limping on to a generic unwrap failure.
 */
export function revokedMagicLinkPackage(
  keyId: string,
  previousCreatedAt?: string
): MemberLinkKeyPackage {
  const prevMs = previousCreatedAt ? Date.parse(previousCreatedAt) : NaN;
  return {
    salt: '',
    wrapped: '',
    tokenHash: '',
    keyId,
    createdAt: new Date(
      Number.isFinite(prevMs) ? Math.max(Date.now(), prevMs + 1) : Date.now()
    ).toISOString(),
    expiresAt: new Date(0).toISOString(),
  };
}

/**
 * The four refusal checks, IN ORDER. Returns `null` when the package is good.
 *
 * ⚠️ Order is a UX decision, not an implementation detail. Revocation is checked BEFORE
 * expiry because someone who rotated their link yesterday needs "you created a newer
 * link", not "it lapsed" — and a revoked package is also stamped expired, so checking
 * expiry first would report the wrong cause every time.
 */
export async function refuseMagicLink(
  pkg: MemberLinkKeyPackage | undefined,
  token: string,
  envelopeKeyId: string
): Promise<MagicLinkRefusal | null> {
  if (!pkg) return 'no-entry';
  if (pkg.tokenHash !== (await hashInviteToken(token))) return 'link-revoked';
  if (isInviteExpired(pkg.expiresAt)) return 'token-expired';
  if (pkg.keyId !== envelopeKeyId) return 'key-rotated';
  return null;
}

/** Unwrap the family key from a package already cleared by `refuseMagicLink`. */
export function unwrapMagicLink(pkg: MemberLinkKeyPackage, token: string): Promise<CryptoKey> {
  return redeemInviteToken(pkg.wrapped, pkg.salt, token);
}

/** Build the shareable URL. `memberId` + `ml=1` are what route it past the person picker. */
export function buildMagicLinkUrl(
  params: Omit<InviteLinkParams, 'magicLink' | 'linkMode'> & { memberId: string }
): string {
  return buildInviteLink({ ...params, magicLink: true });
}
