/**
 * In-memory storage provider — DEV/E2E ONLY.
 *
 * The create-a-family flow finishes on `ResumePodSetup` and calls
 * `syncStore.createNewFile`, which hard-fails unless a real `StorageProvider`
 * is installed (`syncService.getProvider()`). The only un-automatable step in
 * headless E2E is the storage connect itself — the OS save-file picker and the
 * Drive OAuth popup/redirect cannot run in Playwright. This provider stands in
 * for that ONE piece: it keeps the `.beanpod` bytes in memory so the rest of
 * the create flow (password → write → verify → members → /nook) runs through
 * the REAL UI and the REAL store path, with nothing else mocked.
 *
 * Constructed ONLY behind `import.meta.env.DEV` (see `createMemoryProvider`),
 * so it is tree-shaken out of production builds and can never be installed by
 * a real user. It implements the full `StorageProvider` contract honestly and
 * throws on genuine misuse rather than failing silently.
 */
import type { StorageProvider } from '@/services/sync/storageProvider';
import { toISODateString } from '@/utils/date';

class MemoryProvider implements StorageProvider {
  readonly type = 'local' as const;

  private content: string | null = null;
  private lastModified: string | null = null;
  private readonly fileName: string;

  constructor(fileName = 'e2e-memory.beanpod') {
    this.fileName = fileName;
  }

  async write(content: string): Promise<void> {
    if (typeof content !== 'string') {
      // Honest failure — never silently swallow a misuse that would corrupt the
      // pod bytes the rest of the create flow reads back during verify.
      throw new Error('[MemoryProvider] write() requires a string payload');
    }
    this.content = content;
    this.lastModified = toISODateString(new Date());
  }

  async read(): Promise<string | null> {
    return this.content;
  }

  async getLastModified(): Promise<string | null> {
    return this.lastModified;
  }

  async isReady(): Promise<boolean> {
    return true;
  }

  async requestAccess(): Promise<boolean> {
    return true;
  }

  async persist(): Promise<void> {
    // No durable config — the bytes live only for the test's lifetime.
  }

  async clearPersisted(): Promise<void> {
    // Nothing persisted; nothing to clear.
  }

  async disconnect(): Promise<void> {
    this.content = null;
    this.lastModified = null;
  }

  getDisplayName(): string {
    return this.fileName;
  }

  getFileId(): string | null {
    return null;
  }

  getAccountEmail(): string | null {
    return null;
  }

  supportsLocalPolling(): boolean {
    return false;
  }
}

/**
 * Build a DEV/E2E in-memory provider. Throws in production so a stray call can
 * never install a non-durable provider for a real family.
 */
export function createMemoryProvider(fileName?: string): StorageProvider {
  if (!import.meta.env.DEV) {
    throw new Error('[MemoryProvider] is DEV/E2E only and must never run in production');
  }
  return new MemoryProvider(fileName);
}
