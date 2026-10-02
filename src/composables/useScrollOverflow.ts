import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

/**
 * Whether a scroll container's content is taller than the container, kept
 * current by a ResizeObserver on the container AND its content (the container
 * is usually a fixed-size flex child, so only the content changes height when
 * a section opens). Where ResizeObserver is missing the flag stays false, which
 * simply means no overflow styling.
 */
export function useScrollOverflow(container: Ref<HTMLElement | null>) {
  const canScroll = ref(false);
  let observer: ResizeObserver | null = null;

  function measure() {
    const el = container.value;
    canScroll.value = !!el && el.scrollHeight > el.clientHeight;
  }

  function attach() {
    observer?.disconnect();
    observer = null;
    const el = container.value;
    if (!el || typeof ResizeObserver === 'undefined') {
      canScroll.value = false;
      return;
    }
    observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    measure();
  }

  onMounted(attach);
  // The container can mount later than this component (a v-if'd drawer panel): re-attach then.
  watch(container, attach, { flush: 'post' });

  onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
  });

  return { canScroll };
}
