import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref } from 'vue';
import { useEscapeClose } from '../useEscapeClose';

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useEscapeClose', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('calls onClose on Escape while open', () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it('does not call onClose on Escape while closed', () => {
    const isOpen = ref(false);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    pressKey('Escape');
    expect(onClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('ignores non-Escape keys', () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    pressKey('Enter');
    pressKey('a');
    pressKey('Tab');
    expect(onClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('detaches listener when isOpen flips to false', async () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    isOpen.value = false;
    await Promise.resolve();
    pressKey('Escape');
    expect(onClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('detaches listener on scope dispose (safety net)', () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    scope.stop();
    pressKey('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reattaches listener when isOpen flips back to true', async () => {
    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    isOpen.value = false;
    await Promise.resolve();
    isOpen.value = true;
    await Promise.resolve();
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    scope.stop();
  });

  it('logs and degrades when addEventListener throws', () => {
    const original = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {
      throw new Error('denied');
    });

    const isOpen = ref(true);
    const onClose = vi.fn();
    const scope = effectScope();
    scope.run(() => useEscapeClose(isOpen, onClose));

    expect(warnSpy).toHaveBeenCalledWith(
      '[useEscapeClose] could not attach keydown listener:',
      expect.any(Error)
    );

    scope.stop();
    window.addEventListener = original;
  });
});
