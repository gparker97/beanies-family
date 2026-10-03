import { createAutomergeRepository } from '../automergeRepository';
import { getById as projectionGetById } from '../projection';
import { mutate } from '../worker/docClient';
import type { MutationOp } from '../worker/protocol';
import type { Asset, AssetType, CreateAssetInput, UpdateAssetInput } from '@/types/models';

const repo = createAutomergeRepository<'assets', Asset, CreateAssetInput, UpdateAssetInput>(
  'assets'
);

export const getAllAssets = repo.getAll;
export const getAssetById = repo.getById;
export const createAsset = repo.create;
export const updateAsset = repo.update;
export const deleteAsset = repo.remove;

export async function getAssetsByMemberId(memberId: string): Promise<Asset[]> {
  const assets = await getAllAssets();
  return assets.filter((a) => a.memberId === memberId);
}

export async function getAssetsByType(type: AssetType): Promise<Asset[]> {
  const assets = await getAllAssets();
  return assets.filter((a) => a.type === type);
}

export async function getTotalAssetValue(memberId?: string): Promise<number> {
  const assets = memberId ? await getAssetsByMemberId(memberId) : await getAllAssets();
  return assets
    .filter((a) => a.includeInNetWorth)
    .reduce((sum, asset) => sum + asset.currentValue, 0);
}

/**
 * Delete an asset AND its linked loan account and linked recurring payment item in ONE
 * Automerge change (audit C7): three separate deletes could leave a mirror account with no
 * asset behind it. A `delete` of an absent id is a no-op, so a concurrent delete of either link
 * never fails this. Resolves `false` (no write) when the asset is not in the projection.
 */
export async function deleteAssetCascade(
  id: string,
  linked: { accountId?: string; recurringItemId?: string }
): Promise<boolean> {
  if (!projectionGetById('assets', id)) return false;
  const ops: MutationOp[] = [];
  if (linked.recurringItemId) {
    ops.push({ op: 'delete', collection: 'recurringItems', id: linked.recurringItemId });
  }
  if (linked.accountId) ops.push({ op: 'delete', collection: 'accounts', id: linked.accountId });
  ops.push({ op: 'delete', collection: 'assets', id });
  await mutate({ op: 'batch', ops });
  return true;
}

export async function getAssetAppreciation(id: string): Promise<number> {
  const asset = await getAssetById(id);
  if (!asset) return 0;
  return asset.currentValue - asset.purchaseValue;
}
