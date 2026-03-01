import { createRepository } from '../createRepository';
import { getDatabase } from '../database';
import type { Asset, AssetType, CreateAssetInput, UpdateAssetInput } from '@/types/models';

const repo = createRepository<'assets', Asset, CreateAssetInput, UpdateAssetInput>('assets');

export const getAllAssets = repo.getAll;
export const getAssetById = repo.getById;
export const createAsset = repo.create;
export const updateAsset = repo.update;
export const deleteAsset = repo.remove;

export async function getAssetsByMemberId(memberId: string): Promise<Asset[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('assets', 'by-memberId', memberId);
}

export async function getAssetsByType(type: AssetType): Promise<Asset[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('assets', 'by-type', type);
}

export async function getTotalAssetValue(memberId?: string): Promise<number> {
  const assets = memberId ? await getAssetsByMemberId(memberId) : await getAllAssets();
  return assets
    .filter((a) => a.includeInNetWorth)
    .reduce((sum, asset) => sum + asset.currentValue, 0);
}

export async function getAssetAppreciation(id: string): Promise<number> {
  const asset = await getAssetById(id);
  if (!asset) return 0;
  return asset.currentValue - asset.purchaseValue;
}
