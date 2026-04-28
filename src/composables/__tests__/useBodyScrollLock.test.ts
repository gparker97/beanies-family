import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { effectScope, ref } from 'vue';
import { useBodyScrollLock } from '../useBodyScrollLock';
import { resetOverlayStack } from '@/utils/overlayStack';

describe('useBodyScrollLock', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetOverlayStack();
    document.body.style.overflow = '';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    resetOverlayStack();
    document.body.style.overflow = '';
  });

  it('locks body scroll when isOpen is true', () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBodyScrollLock(isOpen));

    expect(document.body.style.overflow).toBe('hidden');
    scope.stop();
  });

  it('does not lock when isOpen is false', () => {
    const isOpen = ref(false);
    const scope = effectScope();
    scope.run(() => useBodyScrollLock(isOpen));

    expect(document.body.style.overflow).toBe('');
    scope.stop();
  });

  it('unlocks when isOpen flips to false', async () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBodyScrollLock(isOpen));
    expect(document.body.style.overflow).toBe('hidden');

    isOpen.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('');

    scope.stop();
  });

  it('ref-counts across nested overlays', async () => {
    const a = ref(true);
    const b = ref(true);
    const scopeA = effectScope();
    const scopeB = effectScope();
    scopeA.run(() => useBodyScrollLock(a));
    scopeB.run(() => useBodyScrollLock(b));

    expect(document.body.style.overflow).toBe('hidden');

    // Close A — B is still open, scroll stays locked
    a.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('hidden');

    // Close B — now everything is unlocked
    b.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('');

    scopeA.stop();
    scopeB.stop();
  });

  it('releases lock on scope dispose if still open (safety net)', () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBodyScrollLock(isOpen));
    expect(document.body.style.overflow).toBe('hidden');

    scope.stop();
    expect(document.body.style.overflow).toBe('');
  });

  it('does not double-release if already released before dispose', async () => {
    const isOpen = ref(true);
    const scope = effectScope();
    scope.run(() => useBodyScrollLock(isOpen));

    isOpen.value = false;
    await Promise.resolve();

    // Add an unrelated lock to verify dispose doesn't decrement past zero
    const other = ref(true);
    const otherScope = effectScope();
    otherScope.run(() => useBodyScrollLock(other));
    expect(document.body.style.overflow).toBe('hidden');

    scope.stop(); // already released; should be no-op for the counter
    expect(document.body.style.overflow).toBe('hidden'); // other still holds it

    otherScope.stop();
    expect(document.body.style.overflow).toBe('');
  });
});
