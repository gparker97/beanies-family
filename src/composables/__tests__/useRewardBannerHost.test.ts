/**
 * Stars and rewards (#148): a mounted surface registers as the achieved banner's host for its
 * kids, follows the list as it changes, and releases everything when it unmounts.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';

const hosts = vi.hoisted(() => [] as string[]);
vi.mock('@/stores/starStore', () => ({
  useStarStore: () => ({
    hostRewardBanner: (memberId: string, surface: string) => {
      const key = `${memberId}:${surface}`;
      hosts.push(key);
      return () => {
        const i = hosts.indexOf(key);
        if (i >= 0) hosts.splice(i, 1);
      };
    },
  }),
}));

import { useRewardBannerHost } from '../useRewardBannerHost';

describe('useRewardBannerHost', () => {
  it('registers from mount, follows the list, releases on unmount', async () => {
    const ids = ref<string[]>(['pip']);
    const Host = defineComponent({
      setup() {
        useRewardBannerHost(() => ids.value, 'wall');
        return () => null;
      },
    });
    const w = mount(Host);
    expect(hosts).toEqual(['pip:wall']);
    ids.value = ['pip', 'juno'];
    await nextTick();
    expect(hosts).toEqual(['pip:wall', 'juno:wall']);
    ids.value = ['juno'];
    await nextTick();
    expect(hosts).toEqual(['juno:wall']);
    w.unmount();
    expect(hosts).toEqual([]);
  });
});
