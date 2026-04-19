import { describe, it, expect, vi } from 'vitest';
import { useFilePicker } from '../useFilePicker';

function makeFileList(files: File[]): FileList {
  const list = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  } as unknown as FileList;
  files.forEach((f, i) => {
    Object.defineProperty(list, i, { value: f, enumerable: true });
  });
  return list;
}

function makeChangeEvent(files: File[]): Event {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: makeFileList(files), configurable: true });
  const e = new Event('change');
  Object.defineProperty(e, 'target', { value: input });
  return e;
}

describe('useFilePicker', () => {
  it('onChange forwards selected files to onPick', async () => {
    const onPick = vi.fn();
    const { bindings } = useFilePicker({ onPick, accept: 'image/*', multiple: true });
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    await bindings.onChange(makeChangeEvent([file]));
    expect(onPick).toHaveBeenCalledOnce();
    const files = onPick.mock.calls[0]![0] as File[];
    expect(files[0]!.name).toBe('photo.jpg');
  });

  it('onChange does nothing when the user cancels (empty FileList)', async () => {
    const onPick = vi.fn();
    const { bindings } = useFilePicker({ onPick });
    await bindings.onChange(makeChangeEvent([]));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('resets input.value so picking the same file twice still fires', async () => {
    const onPick = vi.fn();
    const { bindings } = useFilePicker({ onPick });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    // Browsers disallow setting file input.value to non-empty; use a bare
    // stub that records writes instead.
    const valueWrites: string[] = [];
    const input = {
      files: makeFileList([file]),
      get value() {
        return '';
      },
      set value(v: string) {
        valueWrites.push(v);
      },
    } as unknown as HTMLInputElement;
    const e = new Event('change');
    Object.defineProperty(e, 'target', { value: input });
    await bindings.onChange(e);
    expect(valueWrites).toContain('');
  });

  it('bindings reflect accept + multiple options', () => {
    const { bindings } = useFilePicker({
      onPick: vi.fn(),
      accept: 'image/jpeg,image/png',
      multiple: true,
    });
    expect(bindings.type).toBe('file');
    expect(bindings.accept).toBe('image/jpeg,image/png');
    expect(bindings.multiple).toBe(true);
  });

  it('multiple defaults to false', () => {
    const { bindings } = useFilePicker({ onPick: vi.fn() });
    expect(bindings.multiple).toBe(false);
  });

  it('open() calls click() on the input ref', () => {
    const { inputRef, open } = useFilePicker({ onPick: vi.fn() });
    const click = vi.fn();
    inputRef.value = { click } as unknown as HTMLInputElement;
    open();
    expect(click).toHaveBeenCalledOnce();
  });

  it('open() is a no-op when inputRef is null (not yet mounted)', () => {
    const { open } = useFilePicker({ onPick: vi.fn() });
    expect(() => open()).not.toThrow();
  });
});
