import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { requestGoToday, usePlannerTodayConsumer } from '../usePlannerToday';

// Track every mounted host so we can unmount between tests — the consumer's
// `watch` lives for the component's lifetime, and a leaked watcher from a prior
// test would consume the shared module flag before the current test's does.
const wrappers: VueWrapper[] = [];

/** Mount a throwaway host that wires the consumer to `handler`. */
function mountConsumer(handler: () => void): VueWrapper {
  const wrapper = mount(
    defineComponent({
      setup() {
        usePlannerTodayConsumer(handler);
        return () => h('div');
      },
    })
  );
  wrappers.push(wrapper);
  return wrapper;
}

afterEach(() => {
  while (wrappers.length) wrappers.pop()!.unmount();
});

describe('usePlannerToday', () => {
  it('fires on mount when a request was queued before the page mounted (cross-page case)', () => {
    const handler = vi.fn();
    requestGoToday(); // nav set the flag before navigating
    mountConsumer(handler); // page mounts → onMounted consumes
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fires via watch when already mounted (same-page re-tap case)', async () => {
    const handler = vi.fn();
    mountConsumer(handler); // nothing queued yet → onMounted no-ops
    expect(handler).not.toHaveBeenCalled();
    requestGoToday(); // re-tap while on the page
    await nextTick();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('clears the flag after consuming so it never re-fires on the next mount', () => {
    const first = vi.fn();
    requestGoToday();
    mountConsumer(first); // consumes the flag
    expect(first).toHaveBeenCalledOnce();

    const second = vi.fn();
    mountConsumer(second); // flag already cleared → no spurious fire
    expect(second).not.toHaveBeenCalled();
  });
});
