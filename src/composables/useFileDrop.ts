/**
 * Drag-and-drop file composable.
 *
 * Handles the counter dance (dragenter fires on every child element, so a
 * plain boolean flicker's) and exposes a reactive `isDragging` plus a
 * `bindings` object to spread onto the drop-zone element:
 *
 *   const { isDragging, bindings } = useFileDrop({ onDrop, accept: ['image/*'] });
 *   <div :class="{ active: isDragging }" v-bind="bindings">drop zone</div>
 *
 * Each dropped entry carries the File and (when supported by the browser)
 * a FileSystemFileHandle — JoinPodView uses the handle to persist access
 * to the `.beanpod` across sessions. For simple cases (e.g. photo uploads)
 * callers can ignore the handle.
 */
import { ref, readonly, type Ref } from 'vue';

export interface DroppedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

export interface UseFileDropOptions {
  /** Called after a successful drop with the accepted files. */
  onDrop: (dropped: DroppedFile[]) => void | Promise<void>;
  /**
   * Optional accept list — extensions (`.beanpod`, `.jpg`) and/or MIME
   * types (`image/jpeg`, `image/*`). Files that don't match are dropped
   * silently; onReject is called so the UI can surface an error.
   */
  accept?: string[];
  /** Allow multiple files per drop. Default true. */
  multiple?: boolean;
  /** Called when one or more dropped files fail the accept filter. */
  onReject?: (rejected: DroppedFile[]) => void;
}

export interface UseFileDropBindings {
  onDragenter: (e: DragEvent) => void;
  onDragleave: () => void;
  onDragover: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

export interface UseFileDropReturn {
  isDragging: Readonly<Ref<boolean>>;
  bindings: UseFileDropBindings;
}

export function useFileDrop(options: UseFileDropOptions): UseFileDropReturn {
  const isDragging = ref(false);
  let dragCounter = 0;

  function onDragenter(e: DragEvent): void {
    e.preventDefault();
    dragCounter++;
    isDragging.value = true;
  }

  function onDragleave(): void {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      isDragging.value = false;
    }
  }

  function onDragover(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    dragCounter = 0;
    isDragging.value = false;

    const items = e.dataTransfer?.items;
    if (!items || items.length === 0) return;

    const collected: DroppedFile[] = [];
    const limit = options.multiple === false ? 1 : items.length;
    for (let i = 0; i < items.length && collected.length < limit; i++) {
      const item = items[i];
      if (!item || item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (!file) continue;
      const handle = await tryGetFileSystemHandle(item);
      collected.push({ file, handle });
    }

    if (collected.length === 0) return;

    const { accepted, rejected } = partitionByAccept(collected, options.accept);
    if (rejected.length > 0 && options.onReject) options.onReject(rejected);
    if (accepted.length > 0) await options.onDrop(accepted);
  }

  return {
    isDragging: readonly(isDragging),
    bindings: { onDragenter, onDragleave, onDragover, onDrop },
  };
}

// --- helpers ---

async function tryGetFileSystemHandle(
  item: DataTransferItem
): Promise<FileSystemFileHandle | undefined> {
  if (!('getAsFileSystemHandle' in item)) return undefined;
  try {
    const handle = await (
      item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }
    ).getAsFileSystemHandle();
    if (handle?.kind === 'file') return handle as FileSystemFileHandle;
  } catch {
    // FileSystemHandle access can fail (e.g. cross-origin); File-only is fine.
  }
  return undefined;
}

function partitionByAccept(
  entries: DroppedFile[],
  accept?: string[]
): { accepted: DroppedFile[]; rejected: DroppedFile[] } {
  if (!accept || accept.length === 0) return { accepted: entries, rejected: [] };
  const accepted: DroppedFile[] = [];
  const rejected: DroppedFile[] = [];
  for (const entry of entries) {
    if (matchesAccept(entry.file, accept)) accepted.push(entry);
    else rejected.push(entry);
  }
  return { accepted, rejected };
}

export function matchesAccept(file: File, accept: string[]): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  for (const raw of accept) {
    const token = raw.trim().toLowerCase();
    if (!token) continue;
    if (token.startsWith('.')) {
      if (name.endsWith(token)) return true;
    } else if (token.endsWith('/*')) {
      const prefix = token.slice(0, -1); // "image/"
      if (type.startsWith(prefix)) return true;
      // eslint-disable-next-line security/detect-possible-timing-attacks -- MIME-type equality for <input accept="..."> matching. No secrets involved; timing uniformity isn't a concern for a UI filter.
    } else if (type === token) {
      return true;
    }
  }
  return false;
}
