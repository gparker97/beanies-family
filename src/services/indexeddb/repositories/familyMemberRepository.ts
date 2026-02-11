import { getDatabase } from '../database';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllFamilyMembers(): Promise<FamilyMember[]> {
  const db = await getDatabase();
  return db.getAll('familyMembers');
}

export async function getFamilyMemberById(id: string): Promise<FamilyMember | undefined> {
  const db = await getDatabase();
  return db.get('familyMembers', id);
}

export async function getFamilyMemberByEmail(email: string): Promise<FamilyMember | undefined> {
  const db = await getDatabase();
  return db.getFromIndex('familyMembers', 'by-email', email);
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
