/**
 * useFlyTo: the deal animation is cosmetic, so it must never block or break the write it
 * decorates. It resolves (never rejects) on an aborted flight, is a no-op under reduced
 * motion, and always leaves the element un-animated when it resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('@/utils/prefersReducedMotion', () => ({ prefersReducedMotion: () => motion.reduced }));

import { flyTo } from '../useFlyTo';

function fakeAnimation(finished: Promise<unknown>) {
  return { finished, cancel: vi.fn() } as unknown as Animation & {
    cancel: ReturnType<typeof vi.fn>;
  };
}

function elements(animation: Animation) {
  const el = document.createElement('div');
  const target = document.createElement('div');
  el.animate = vi.fn(() => animation);
  return { el, target };
}

beforeEach(() => {
  motion.reduced = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('flyTo', () => {
  it('animates towards the target, waits for the flight, then cancels the fill', async () => {
    const anim = fakeAnimation(Promise.resolve());
    const { el, target } = elements(anim);

    await flyTo(el, target);

    expect(el.animate).toHaveBeenCalledTimes(1);
    const [keyframes, opts] = (el.animate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(keyframes).toHaveLength(3);
    expect(opts).toMatchObject({ duration: 560 });
    expect(anim.cancel).toHaveBeenCalled();
  });

  it('resolves (with a warning) when the flight is aborted mid-way', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const abort = Object.assign(new Error('detached'), { name: 'AbortError' });
    const anim = fakeAnimation(Promise.reject(abort));
    const { el, target } = elements(anim);

    await expect(flyTo(el, target)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[useFlyTo] animation aborted', abort);
  });

  it('does not animate at all under reduced motion', async () => {
    motion.reduced = true;
    const anim = fakeAnimation(Promise.resolve());
    const { el, target } = elements(anim);

    await flyTo(el, target);
    expect(el.animate).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing element or target', async () => {
    await expect(flyTo(null, document.createElement('div'))).resolves.toBeUndefined();
    await expect(flyTo(document.createElement('div'), undefined)).resolves.toBeUndefined();
  });
});
