/**
 * Offline queue for Google Drive saves.
 *
 * When a Drive write() fails due to network error, the content is queued here.
 * Only the latest save is kept (each is a full file replacement).
 * On reconnect, the queued content is flushed via the provider.
 */
import type { StorageProvider } from './storageProvider';

// In-memory queue (only keeps latest)
let pendingContent: string | null = null;
let flushProvider: StorageProvider | null = null;
let isListening = false;

/**
 * Enqueue content for offline save.
 * Replaces any previously queued content.
 */
export function enqueueOfflineSave(content: string): void {
  pendingContent = content;
  startListening();
  console.warn('[offlineQueue] Save queued for when connection resumes');
}

/**
 * Set the provider to use when flushing the queue.
 */
export function setFlushProvider(provider: StorageProvider): void {
  flushProvider = provider;
}

/**
 * Check if there's a pending offline save.
 */
export function hasPendingSave(): boolean {
  return pendingContent !== null;
}

/**
 * Flush the queued save. Called automatically on 'online' event.
 */
export async function flushQueue(): Promise<boolean> {
  if (!pendingContent || !flushProvider) return false;

  const content = pendingContent;
  try {
    await flushProvider.write(content);
    // Only clear if this specific content was flushed
    // (a newer save may have been queued during the flush)
    if (pendingContent === content) {
      pendingContent = null;
    }
    console.log('[offlineQueue] Queued save flushed successfully');
    return true;
  } catch (e) {
    console.warn('[offlineQueue] Flush failed, will retry on next online event:', e);
    return false;
  }
}

/**
 * Clear the queue (e.g. on disconnect).
 */
export function clearQueue(): void {
  pendingContent = null;
  stopListening();
}

// --- Event listeners ---

function handleOnline(): void {
  flushQueue().catch(console.warn);
}

function startListening(): void {
  if (isListening) return;
  window.addEventListener('online', handleOnline);
  isListening = true;
}

function stopListening(): void {
  if (!isListening) return;
  window.removeEventListener('online', handleOnline);
  isListening = false;
}
