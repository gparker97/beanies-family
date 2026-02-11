import { getDatabase } from '../database';
import type { Asset, AssetType, CreateAssetInput, UpdateAssetInput } from '@/types/models';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';

export async function getAllAssets(): Promise<Asset[]> {
  const db = await getDatabase();
  return db.getAll('assets');
}

export async function getAssetById(id: string): Promise<Asset | undefined> {
  const db = await getDatabase();
  return db.get('assets', id);
}

export async function getAssetsByMemberId(memberId: string): Promise<Asset[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('assets', 'by-memberId', memberId);
}

export async function getAssetsByType(type: AssetType): Promise<Asset[]> {
  const db = await getDatabase();
  return db.getAllFromIndex('assets', 'by-type', type);
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const db = await getDatabase();
  const now = toISODateString(new Date());

  const asset: Asset = {
    ...input,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };

  await db.add('assets', asset);
  return asset;
}

export async function updateAsset(id: string, input: UpdateAssetInput): Promise<Asset | undefined> {
  const db = await getDatabase();
  const existing = await db.get('assets', id);

  if (!existing) {
    return undefined;
  }

  const updated: Asset = {
    ...existing,
    ...input,
    updatedAt: toISODateString(new Date()),
  };

  await db.put('assets', updated);
  return updated;
}

export async function deleteAsset(id: string): Promise<boolean> {
  const db = await getDatabase();
  const existing = await db.get('assets', id);

  if (!existing) {
    return false;
  }

  await db.delete('assets', id);
  return true;
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
