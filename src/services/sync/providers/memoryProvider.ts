/**
 * In-memory storage provider — DEV/E2E, plus REVIEW-DEMO.
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
 * REVIEW-DEMO: it is ALSO the storage layer for store-review demo mode, which
 * runs in production builds — a demo pod that never touches Drive or the
 * filesystem is exactly what this provider already is. Hence `createMemoryProvider`
 * gates on `DEV || isReviewDemoAvailable()` rather than `DEV` alone.
 *
 * Constructed ONLY behind that gate, so it can never be installed by a real
 * user: an un-armed or expired build throws. It implements the full
 * `StorageProvider` contract honestly and throws on genuine misuse rather than
 * failing silently.
 */
import type { StorageProvider } from '@/services/sync/storageProvider';
import { isReviewDemoAvailable } from '@/utils/reviewDemo';
import { toISODateString } from '@/utils/date';

class MemoryProvider implements StorageProvider {
  readonly type = 'local' as const;

  private content: string | null = null;
  private lastModified: string | null = null;
  private readonly fileName: string;
  /** ADR-032 Plan B change-log chunks (sibling objects beside the .beanpod). */
  private readonly aux = new Map<string, string>();

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

  // ─── Plan B aux change-log (in-memory sibling objects) ──────────────────────
  async listAux(): Promise<string[]> {
    return [...this.aux.keys()];
  }
  async readAux(name: string): Promise<string | null> {
    return this.aux.get(name) ?? null;
  }
  async writeAux(name: string, content: string): Promise<void> {
    this.aux.set(name, content);
  }
  async deleteAux(name: string): Promise<void> {
    this.aux.delete(name);
  }
}

/**
 * Build an in-memory provider for DEV/E2E or for REVIEW-DEMO seeding.
 *
 * Throws otherwise, so a stray call can never install a non-durable provider for
 * a real family — that would silently discard their data.
 *
 * REVIEW-DEMO: the gate deliberately reuses `isReviewDemoAvailable()`, the SAME
 * predicate the welcome-screen affordance and the code validator bind to, so an
 * expired or un-armed build cannot install this either. Do NOT replace it with an
 * `allowInProd` argument: an argument can be passed from anywhere, whereas the
 * predicate is the one place demo mode is switched on.
 */
export function createMemoryProvider(fileName?: string): StorageProvider {
  if (!import.meta.env.DEV && !isReviewDemoAvailable()) {
    throw new Error(
      '[MemoryProvider] is DEV/E2E + review-demo only and must never run for a real family'
    );
  }
  return new MemoryProvider(fileName);
}
