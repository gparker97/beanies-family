import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import type { CachedAuthSession } from '@/types/models';
import { toISODateString } from '@/utils/date';

// Offline grace period: 7 days
const OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cache authentication tokens in the registry database.
 */
export async function cacheSession(session: {
  userId: string;
  email: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  familyId: string;
}): Promise<void> {
  const db = await getRegistryDatabase();
  const cached: CachedAuthSession = {
    userId: session.userId,
    email: session.email,
    idToken: session.idToken,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: toISODateString(session.expiresAt),
    familyId: session.familyId,
    cachedAt: toISODateString(new Date()),
  };
  await db.put('cachedSessions', cached);
}

/**
 * Get the cached session for a user.
 */
export async function getCachedSession(userId: string): Promise<CachedAuthSession | null> {
  const db = await getRegistryDatabase();
  const session = await db.get('cachedSessions', userId);
  return session ?? null;
}

/**
 * Get any cached session (for auto-login on app start).
 */
export async function getAnyCachedSession(): Promise<CachedAuthSession | null> {
  const db = await getRegistryDatabase();
  const sessions = await db.getAll('cachedSessions');
  if (sessions.length === 0) return null;

  // Return the most recently cached session
  return sessions.sort(
    (a, b) => new Date(b.cachedAt).getTime() - new Date(a.cachedAt).getTime()
  )[0]!;
}

/**
 * Clear a cached session.
 */
export async function clearCachedSession(userId: string): Promise<void> {
  const db = await getRegistryDatabase();
  await db.delete('cachedSessions', userId);
}

/**
 * Clear all cached sessions.
 */
export async function clearAllCachedSessions(): Promise<void> {
  const db = await getRegistryDatabase();
  await db.clear('cachedSessions');
}

/**
 * Check if a cached session is still valid for offline access.
 * Tokens may be expired, but we allow a grace period for offline use.
 */
export function isSessionValidForOffline(session: CachedAuthSession): boolean {
  const cachedAt = new Date(session.cachedAt).getTime();
  const now = Date.now();
  return now - cachedAt < OFFLINE_GRACE_PERIOD_MS;
}

/**
 * Check if tokens are expired (ignoring offline grace period).
 */
export function areTokensExpired(session: CachedAuthSession): boolean {
  const expiresAt = new Date(session.expiresAt).getTime();
  return Date.now() > expiresAt;
}

/**
 * Decode a JWT payload without verification (for local claims reading only).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
