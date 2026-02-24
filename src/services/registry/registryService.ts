import type { RegistryEntry } from '@/types/models';

const API_URL = import.meta.env.VITE_REGISTRY_API_URL as string | undefined;
const API_KEY = import.meta.env.VITE_REGISTRY_API_KEY as string | undefined;

export function isRegistryConfigured(): boolean {
  return Boolean(API_URL && API_KEY);
}

/** @deprecated internal alias kept for backward compat */
const isConfigured = isRegistryConfigured;

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
  if (!isConfigured()) return null;

  try {
    const res = await request('GET', familyId);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as RegistryEntry;
  } catch {
    console.warn('[registry] lookupFamily failed — registry unavailable');
    return null;
  }
}

/**
 * Register or update a family's file location.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export async function registerFamily(
  familyId: string,
  entry: Omit<RegistryEntry, 'familyId' | 'updatedAt'>
): Promise<void> {
  if (!isConfigured()) return;

  try {
    await request('PUT', familyId, entry);
  } catch {
    console.warn('[registry] registerFamily failed — registry unavailable');
  }
}

/**
 * Remove a family from the registry.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export async function removeFamily(familyId: string): Promise<void> {
  if (!isConfigured()) return;

  try {
    await request('DELETE', familyId);
  } catch {
    console.warn('[registry] removeFamily failed — registry unavailable');
  }
}
