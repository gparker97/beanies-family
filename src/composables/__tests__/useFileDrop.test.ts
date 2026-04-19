import { describe, it, expect, vi } from 'vitest';
import { useFileDrop, matchesAccept } from '../useFileDrop';

function makeFile(name: string, type = ''): File {
  return new File(['x'], name, { type });
}

function makeDragEvent(files: File[] = []): DragEvent {
  const items = files.map((file) => ({
    kind: 'file',
    type: file.type,
    getAsFile: () => file,
  })) as unknown as DataTransferItem[];
  const dataTransfer = {
    items,
    dropEffect: 'none' as DataTransfer['dropEffect'],
  } as unknown as DataTransfer;
  const e = new Event('drop') as DragEvent;
  Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
  e.preventDefault = vi.fn();
  return e;
}

describe('useFileDrop', () => {
  it('isDragging flips on enter and back on leave (counter correctness)', () => {
    const { isDragging, bindings } = useFileDrop({ onDrop: vi.fn() });
    expect(isDragging.value).toBe(false);

    // Enter the zone
    bindings.onDragenter(new Event('dragenter') as DragEvent);
    expect(isDragging.value).toBe(true);

    // Enter a nested child (counter increments to 2)
    bindings.onDragenter(new Event('dragenter') as DragEvent);

    // Leave the child — should still be dragging (counter = 1)
    bindings.onDragleave();
    expect(isDragging.value).toBe(true);

    // Leave the zone
    bindings.onDragleave();
    expect(isDragging.value).toBe(false);
  });

  it('onDragleave below zero is clamped (robust against out-of-order events)', () => {
    const { isDragging, bindings } = useFileDrop({ onDrop: vi.fn() });
    bindings.onDragleave();
    bindings.onDragleave();
    expect(isDragging.value).toBe(false);

    // After spurious leaves, a real enter still works
    bindings.onDragenter(new Event('dragenter') as DragEvent);
    expect(isDragging.value).toBe(true);
  });

  it('onDrop forwards the dropped file and resets state', async () => {
    const onDrop = vi.fn();
    const { isDragging, bindings } = useFileDrop({ onDrop });
    bindings.onDragenter(new Event('dragenter') as DragEvent);
    expect(isDragging.value).toBe(true);

    const file = makeFile('photo.jpg', 'image/jpeg');
    await bindings.onDrop(makeDragEvent([file]));

    expect(onDrop).toHaveBeenCalledOnce();
    const args = onDrop.mock.calls[0]![0] as Array<{ file: File }>;
    expect(args[0]!.file.name).toBe('photo.jpg');
    expect(isDragging.value).toBe(false);
  });

  it('multiple: false returns only the first file', async () => {
    const onDrop = vi.fn();
    const { bindings } = useFileDrop({ onDrop, multiple: false });
    await bindings.onDrop(
      makeDragEvent([makeFile('a.jpg', 'image/jpeg'), makeFile('b.jpg', 'image/jpeg')])
    );
    const args = onDrop.mock.calls[0]![0] as unknown[];
    expect(args).toHaveLength(1);
  });

  it('accept filter keeps matching files and rejects others', async () => {
    const onDrop = vi.fn();
    const onReject = vi.fn();
    const { bindings } = useFileDrop({
      onDrop,
      onReject,
      accept: ['image/*'],
    });
    await bindings.onDrop(
      makeDragEvent([makeFile('photo.jpg', 'image/jpeg'), makeFile('notes.txt', 'text/plain')])
    );

    const accepted = onDrop.mock.calls[0]![0] as Array<{ file: File }>;
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.file.type).toBe('image/jpeg');

    const rejected = onReject.mock.calls[0]![0] as Array<{ file: File }>;
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.file.name).toBe('notes.txt');
  });

  it('does not call onDrop when every file is rejected', async () => {
    const onDrop = vi.fn();
    const onReject = vi.fn();
    const { bindings } = useFileDrop({ onDrop, onReject, accept: ['.beanpod'] });
    await bindings.onDrop(makeDragEvent([makeFile('photo.jpg', 'image/jpeg')]));
    expect(onDrop).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalled();
  });
});

describe('matchesAccept', () => {
  it('matches by extension', () => {
    expect(matchesAccept(makeFile('family.beanpod'), ['.beanpod'])).toBe(true);
    expect(matchesAccept(makeFile('family.json'), ['.beanpod'])).toBe(false);
  });

  it('matches by exact mime type', () => {
    expect(matchesAccept(makeFile('x', 'image/jpeg'), ['image/jpeg'])).toBe(true);
    expect(matchesAccept(makeFile('x', 'image/png'), ['image/jpeg'])).toBe(false);
  });

  it('matches by mime wildcard', () => {
    expect(matchesAccept(makeFile('x', 'image/heic'), ['image/*'])).toBe(true);
    expect(matchesAccept(makeFile('x', 'text/plain'), ['image/*'])).toBe(false);
  });

  it('matches either of multiple tokens', () => {
    expect(matchesAccept(makeFile('a.json'), ['.beanpod', '.json'])).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesAccept(makeFile('A.BEANPOD'), ['.beanpod'])).toBe(true);
    expect(matchesAccept(makeFile('x', 'IMAGE/JPEG'), ['image/jpeg'])).toBe(true);
  });
});
