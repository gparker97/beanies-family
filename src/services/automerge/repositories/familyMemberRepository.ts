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
  return {
    ...member,
    role: member.role ?? 'member',
    gender: member.gender ?? 'other',
    ageGroup: member.ageGroup ?? 'adult',
    requiresPassword: !member.passwordHash,
    canViewFinances: member.canViewFinances ?? true,
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
