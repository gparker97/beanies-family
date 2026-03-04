import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useClipboard } from '@/composables/useClipboard';

const mockWriteText = vi.fn().mockResolvedValue(undefined);

describe('useClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockWriteText },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should copy text to clipboard and set copied to true', async () => {
    const { copied, copy } = useClipboard();

    expect(copied.value).toBe(false);

    const result = await copy('test text');

    expect(result).toBe(true);
    expect(copied.value).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith('test text');
  });

  it('should reset copied to false after 2 seconds', async () => {
    const { copied, copy } = useClipboard();

    await copy('test text');
    expect(copied.value).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(copied.value).toBe(false);
  });

  it('should return false when clipboard write fails', async () => {
    mockWriteText.mockRejectedValue(new Error('denied'));

    const { copied, copy } = useClipboard();
    const result = await copy('test text');

    expect(result).toBe(false);
    expect(copied.value).toBe(false);
  });
});
