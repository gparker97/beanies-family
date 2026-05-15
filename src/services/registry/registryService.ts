import type { RegistryEntry } from '@/types/models';
import { features } from '@/config/features';

const API_URL = import.meta.env.VITE_REGISTRY_API_URL;
const API_KEY = import.meta.env.VITE_REGISTRY_API_KEY;

async function request(method: string, familyId: string, body?: object): Promise<Response> {
  const res = await fetch(`${API_URL}/family/${familyId}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY!,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

/**
 * Look up a family's file location by familyId.
 * Returns null if not found or if the registry is unavailable.
 */
export async function lookupFamily(familyId: string): Promise<RegistryEntry | null> {
  if (!features.registry) return null;

  try {
    const res = await request('GET', familyId);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as RegistryEntry;
  } catch (err) {
    console.warn('[registry] lookupFamily failed — registry unavailable', err);
    return null;
  }
}

/**
 * Register or update a family's file location.
 * Fire-and-forget — failures are logged but never block the caller.
 *
 * Used by every non-critical write path (background sync, country change,
 * etc.). Callers that NEED the write to succeed before they can proceed
 * (notably `syncStore.createNewFile`, where the registry write is the
 * recovery anchor for resume-from-registry) must use
 * `registerFamilyOrThrow` instead.
 */
export async function registerFamily(
  familyId: string,
  entry: Omit<RegistryEntry, 'familyId' | 'updatedAt'>
): Promise<void> {
  try {
    await registerFamilyOrThrow(familyId, entry);
  } catch (err) {
    console.warn('[registry] registerFamily failed — registry unavailable', err);
  }
}

/**
 * Register or update a family's file location — THROWS on failure.
 *
 * Use from call sites where the registry write is critical (e.g. pod
 * creation, where the recovery flow reads `fileId` from the registry to
 * find the user's pod on a fresh device). For non-critical background
 * writes, use `registerFamily` which swallows failures.
 *
 * Behaviour matches `registerFamily` in the registry-disabled case: it's
 * a no-op success (the registry just isn't part of this self-host's
 * feature set, so the contract is trivially satisfied).
 */
export async function registerFamilyOrThrow(
  familyId: string,
  entry: Omit<RegistryEntry, 'familyId' | 'updatedAt'>
): Promise<void> {
  if (!features.registry) return;

  const res = await request('PUT', familyId, entry);
  if (!res.ok) {
    throw new Error(
      `Registry PUT failed: HTTP ${res.status}${res.statusText ? ' ' + res.statusText : ''}`
    );
  }
}

/**
 * Remove a family from the registry.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export async function removeFamily(familyId: string): Promise<void> {
  if (!features.registry) return;

  try {
    await request('DELETE', familyId);
  } catch (err) {
    console.warn('[registry] removeFamily failed — registry unavailable', err);
  }
}
