import { getDatabase } from '../database';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

/** Apply defaults for legacy records missing gender/ageGroup/requiresPassword fields */
function applyDefaults(member: FamilyMember): FamilyMember {
  return {
    ...member,
    gender: member.gender ?? 'other',
    ageGroup: member.ageGroup ?? 'adult',
    requiresPassword: member.passwordHash ? false : (member.requiresPassword ?? true),
  };
}

export async function getAllFamilyMembers(): Promise<FamilyMember[]> {
  const db = await getDatabase();
  const members = await db.getAll('familyMembers');
  return members.map(applyDefaults);
}

export async function getFamilyMemberById(id: string): Promise<FamilyMember | undefined> {
  const db = await getDatabase();
  const member = await db.get('familyMembers', id);
  return member ? applyDefaults(member) : undefined;
}

export async function getFamilyMemberByEmail(email: string): Promise<FamilyMember | undefined> {
  const db = await getDatabase();
  const member = await db.getFromIndex('familyMembers', 'by-email', email);
  return member ? applyDefaults(member) : undefined;
}

export async function createFamilyMember(input: CreateFamilyMemberInput): Promise<FamilyMember> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const member: FamilyMember = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('familyMembers', member);
  return member;
}

export async function updateFamilyMember(
  id: string,
  input: UpdateFamilyMemberInput
): Promise<FamilyMember | undefined> {
  const db = await getDatabase();
  const existing = await db.get('familyMembers', id);

  if (!existing) {
    return undefined;
  }

  const updated: FamilyMember = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('familyMembers', updated);
  return updated;
}

export async function deleteFamilyMember(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('familyMembers', id);

  if (!existing) {
    return false;
  }

  await db.delete('familyMembers', id);
  return true;
}

export async function getOwner(): Promise<FamilyMember | undefined> {
  const members = await getAllFamilyMembers();
  return members.find((m) => m.role === 'owner');
}
