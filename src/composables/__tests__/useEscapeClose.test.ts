import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref } from 'vue';
import { useEscapeClose, __resetEscapeCloseForTests } from '../useEscapeClose';

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useEscapeClose', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The escape stack is module-global and persists across tests by design; a
    // test that throws before its scope.stop() would otherwise leak a token into
    // the next test and target the wrong onClose. Reset it before each test.
    __resetEscapeCloseForTests();
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

  it('closes only the TOP-MOST overlay when several are stacked', () => {
    const baseOpen = ref(true);
    const baseClose = vi.fn();
    const topOpen = ref(true);
    const topClose = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useEscapeClose(baseOpen, baseClose); // registered first (underneath)
      useEscapeClose(topOpen, topClose); // registered last (on top)
    });

    pressKey('Escape');
    expect(topClose).toHaveBeenCalledTimes(1);
    expect(baseClose).not.toHaveBeenCalled();

    scope.stop();
  });

  it('falls back to the next overlay once the top one closes', async () => {
    const baseOpen = ref(true);
    const baseClose = vi.fn();
    const topOpen = ref(true);
    const topClose = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      useEscapeClose(baseOpen, baseClose);
      useEscapeClose(topOpen, topClose);
    });

    // Top overlay closes (e.g. its close button) → it leaves the stack.
    topOpen.value = false;
    await Promise.resolve();

    pressKey('Escape');
    expect(topClose).not.toHaveBeenCalled();
    expect(baseClose).toHaveBeenCalledTimes(1);

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
