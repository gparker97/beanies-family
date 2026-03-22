import { describe, it, expect, beforeEach } from 'vitest';
import { lockBodyScroll, unlockBodyScroll, resetOverlayStack } from '../overlayStack';

describe('overlayStack', () => {
  beforeEach(() => {
    resetOverlayStack();
  });

  it('locks body scroll on first lock', () => {
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps body locked with multiple overlays', () => {
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('unlocks body when all overlays close', () => {
    lockBodyScroll();
    lockBodyScroll();
    unlockBodyScroll();
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('never goes below zero', () => {
    unlockBodyScroll();
    unlockBodyScroll();
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('handles drawer + modal stacking scenario', () => {
    // Drawer opens (z-40)
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    // ConfirmModal opens on top (z-60)
    lockBodyScroll();
    expect(document.body.style.overflow).toBe('hidden');

    // ConfirmModal closes
    unlockBodyScroll();
    // Body should STILL be locked — drawer is open
    expect(document.body.style.overflow).toBe('hidden');

    // Drawer closes
    unlockBodyScroll();
    expect(document.body.style.overflow).toBe('');
  });
});
