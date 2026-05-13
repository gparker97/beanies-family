import { describe, it, expect } from 'vitest';
import { nextTick, ref } from 'vue';
import { useExpandableList } from '@/composables/useExpandableList';

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('useExpandableList', () => {
  it('shows only the first `initial` items, and reports whether more exist', () => {
    const { visible, total, canShowMore, canShowLess } = useExpandableList(ref(range(12)), {
      initial: 5,
    });
    expect(visible.value).toEqual([0, 1, 2, 3, 4]);
    expect(total.value).toBe(12);
    expect(canShowMore.value).toBe(true);
    expect(canShowLess.value).toBe(false);
  });

  it('a source no longer than `initial` is fully shown with no toggles', () => {
    const { visible, canShowMore, canShowLess } = useExpandableList(ref(range(3)), { initial: 5 });
    expect(visible.value).toEqual([0, 1, 2]);
    expect(canShowMore.value).toBe(false);
    expect(canShowLess.value).toBe(false);
  });

  it('incremental mode: showMore reveals `step` more, clamps at total, then collapses to initial', () => {
    const list = useExpandableList(ref(range(20)), { initial: 6, step: 6 });
    list.showMore();
    expect(list.visible.value).toHaveLength(12);
    expect(list.canShowMore.value).toBe(true);
    expect(list.canShowLess.value).toBe(true);
    list.showMore();
    list.showMore(); // 18 → 24 → clamped to 20
    expect(list.visible.value).toHaveLength(20);
    expect(list.canShowMore.value).toBe(false);
    expect(list.canShowLess.value).toBe(true);
    list.showLess();
    expect(list.visible.value).toHaveLength(6);
    expect(list.canShowLess.value).toBe(false);
  });

  it('all-or-nothing mode (no step): showMore reveals everything, showLess collapses back', () => {
    const list = useExpandableList(ref(range(9)), { initial: 5 });
    list.showMore();
    expect(list.visible.value).toHaveLength(9);
    expect(list.canShowMore.value).toBe(false);
    expect(list.canShowLess.value).toBe(true);
    list.showLess();
    expect(list.visible.value).toHaveLength(5);
    expect(list.canShowMore.value).toBe(true);
    expect(list.canShowLess.value).toBe(false);
  });

  it('tracks a getter source and re-derives when it changes', () => {
    const src = ref(range(3));
    const { visible, total, canShowMore } = useExpandableList(() => src.value, { initial: 5 });
    expect(visible.value).toHaveLength(3);
    expect(canShowMore.value).toBe(false);
    src.value = range(10);
    expect(total.value).toBe(10);
    expect(visible.value).toEqual([0, 1, 2, 3, 4]);
    expect(canShowMore.value).toBe(true);
  });

  it('snaps the limit back down if the source shrinks below it while expanded', async () => {
    const src = ref(range(20));
    const list = useExpandableList(src, { initial: 5 });
    list.showMore(); // limit → 20
    expect(list.visible.value).toHaveLength(20);
    src.value = range(3);
    await nextTick(); // let the clamp watcher flush
    expect(list.visible.value).toEqual([0, 1, 2]);
    expect(list.canShowMore.value).toBe(false);
    expect(list.canShowLess.value).toBe(false); // limit is back at `initial`, not lingering at 20
  });
});
