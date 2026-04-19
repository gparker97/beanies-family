import { createAutomergeRepository } from '../automergeRepository';
import type { FavoriteItem } from '@/types/models';

const repo = createAutomergeRepository<'favorites', FavoriteItem>('favorites');

export const getAllFavorites = repo.getAll;
export const getFavoriteById = repo.getById;
export const createFavorite = repo.create;
export const updateFavorite = repo.update;
export const deleteFavorite = repo.remove;

export async function getFavoritesByMember(memberId: string): Promise<FavoriteItem[]> {
  const all = await getAllFavorites();
  return all.filter((f) => f.memberId === memberId);
}
