import { createAutomergeRepository } from '../automergeRepository';
import type { MemberNote } from '@/types/models';

const repo = createAutomergeRepository<'memberNotes', MemberNote>('memberNotes');

export const getAllMemberNotes = repo.getAll;
export const getMemberNoteById = repo.getById;
export const createMemberNote = repo.create;
export const updateMemberNote = repo.update;
export const deleteMemberNote = repo.remove;

export async function getMemberNotesByMember(memberId: string): Promise<MemberNote[]> {
  const all = await getAllMemberNotes();
  return all.filter((n) => n.memberId === memberId);
}
