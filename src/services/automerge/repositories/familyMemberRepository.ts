import { createAutomergeRepository } from '../automergeRepository';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

/** Apply defaults for legacy records missing gender/ageGroup/requiresPassword fields */
function applyDefaults(member: FamilyMember): FamilyMember {
  return {
    ...member,
    gender: member.gender ?? 'other',
    ageGroup: member.ageGroup ?? 'adult',
    requiresPassword: !member.passwordHash,
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
