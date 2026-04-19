import { createAutomergeRepository } from '../automergeRepository';
import type { SayingItem } from '@/types/models';

const repo = createAutomergeRepository<'sayings', SayingItem>('sayings');

export const getAllSayings = repo.getAll;
export const getSayingById = repo.getById;
export const createSaying = repo.create;
export const updateSaying = repo.update;
export const deleteSaying = repo.remove;

export async function getSayingsByMember(memberId: string): Promise<SayingItem[]> {
  const all = await getAllSayings();
  return all.filter((s) => s.memberId === memberId || s.aboutMemberId === memberId);
}
