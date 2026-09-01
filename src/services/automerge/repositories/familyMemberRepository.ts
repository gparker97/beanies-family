import { createAutomergeRepository } from '../automergeRepository';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

/**
 * Apply defaults for legacy records missing gender/ageGroup/requiresPassword fields.
 *
 * Role defaults to 'member' so an undefined role can never silently slip
 * through any read path. The owner backfill itself is handled by
 * `familyStore.normalizeRoles()` on load — that's the single source of
 * truth for "ensure exactly one owner exists."
 *
 * canManagePod defaults to true only for owners. The legacy "admin" role
 * no longer implies canManagePod here; normalizeRoles persists
 * canManagePod=true on every legacy admin before this default takes
 * effect, so existing admins keep their effective permissions.
 */
function applyDefaults(member: FamilyMember): FamilyMember {
  // Read the effective age ONCE, before the literal below defaults it, so the
  // finance rule and the stored `ageGroup` can never disagree.
  const ageGroup = member.ageGroup ?? 'adult';
  return {
    ...member,
    role: member.role ?? 'member',
    gender: member.gender ?? 'other',
    ageGroup,
    // "Unclaimed": has NO credential at all. Phase 4 (login rethink): a PIN is a
    // first-class claim credential, so a PIN-only member (kit-born family, or a
    // set-pin join) reads as claimed exactly like a password holder. Derived
    // unconditionally on every read — no stored value can disagree with it.
    requiresPassword: !member.passwordHash && !member.pinHash,
    // A child does NOT get the finances by default (#79 review). Only members with
    // no STORED value are affected, so a parent who explicitly set the toggle either
    // way keeps their choice; an owner or pod manager short-circuits ahead of this
    // in `usePermissions`. Deliberately retroactive, matching #79's no-grandfathering
    // rule: a child already created by the wizard loses the access on next load, and
    // a grown-up can hand it back per child in the member modal.
    canViewFinances: member.canViewFinances ?? ageGroup !== 'child',
    canEditActivities: member.canEditActivities ?? true,
    canManagePod: member.canManagePod ?? member.role === 'owner',
  };
}

const repo = createAutomergeRepository<
  'familyMembers',
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput
>('familyMembers', { transform: applyDefaults });

export const getAllFamilyMembers = repo.getAll;
export const getFamilyMemberById = repo.getById;
export const createFamilyMember = repo.create;
/** Recreate a member with a specific id — used to rebuild the owner after a redirect-during-onboarding wiped the in-memory doc. */
export const createFamilyMemberWithId = repo.createWithId;
export const updateFamilyMember = repo.update;
export const deleteFamilyMember = repo.remove;

export async function getFamilyMemberByEmail(email: string): Promise<FamilyMember | undefined> {
  const members = await getAllFamilyMembers();
  return members.find((m) => m.email === email);
}

export async function getOwner(): Promise<FamilyMember | undefined> {
  const members = await getAllFamilyMembers();
  return members.find((m) => m.role === 'owner');
}
