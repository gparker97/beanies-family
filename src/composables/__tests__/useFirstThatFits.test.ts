import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h as hx, nextTick, reactive, ref } from 'vue';
import { useFirstThatFits, type FirstThatFitsOptions } from '../useFirstThatFits';

const settings = reactive({ textSize: 'normal' as 'normal' | 'large' });

vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => settings }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

async function flush(): Promise<void> {
  await nextTick();
  await nextTick();
}

/** A host that renders `texts` as the measurer's children, longest first. */
function host(texts: ReturnType<typeof ref<string[]>>, options: FirstThatFitsOptions = {}) {
  let api!: ReturnType<typeof useFirstThatFits>;
  const Host = defineComponent({
    setup() {
      const container = ref<HTMLElement | null>(null);
      const measurer = ref<HTMLElement | null>(null);
      api = useFirstThatFits(container, measurer, {
        deps: () => texts.value!.join('|'),
        ...options,
      });
      return () =>
        hx('div', { ref: container }, [
          hx(
            'div',
            { ref: measurer },
            texts.value!.map((text) => hx('p', text))
          ),
        ]);
    },
  });
  const wrapper = mount(Host);
  return { wrapper, api: () => api };
}

/** Fits when the text is at most `max` characters. */
const byLength = (max: { value: number }) => (el: HTMLElement) =>
  (el.textContent ?? '').length <= max.value;

describe('useFirstThatFits', () => {
  beforeEach(() => {
    settings.textSize = 'normal';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks the first candidate that fits', async () => {
    const texts = ref(['a long candidate', 'medium one', 'short']);
    const { api } = host(texts, { measure: byLength({ value: 10 }) });
    await flush();
    expect(api().index.value).toBe(1);
    expect(api().settled.value).toBe(true);
  });

  it('takes the last candidate when none fits', async () => {
    const texts = ref(['aaaaaaaa', 'aaaaaaa', 'aaaaaa']);
    const { api } = host(texts, { measure: byLength({ value: 2 }) });
    await flush();
    expect(api().index.value).toBe(2);
  });

  it('settles on a single candidate without measuring', async () => {
    const measure = vi.fn(() => false);
    const { api } = host(ref(['only']), { measure });
    await flush();
    expect(api().index.value).toBe(0);
    expect(api().settled.value).toBe(true);
    expect(measure).not.toHaveBeenCalled();
  });

  it('re-measures when the candidates change', async () => {
    const texts = ref(['twelve chars', 'short']);
    const { api } = host(texts, { measure: byLength({ value: 12 }) });
    await flush();
    expect(api().index.value).toBe(0);
    texts.value = ['thirteen char', 'short'];
    await flush();
    expect(api().index.value).toBe(1);
  });

  it('re-measures when the text size setting flips', async () => {
    const max = { value: 20 };
    const { api } = host(ref(['sixteen chars ok', 'tiny']), { measure: byLength(max) });
    await flush();
    expect(api().index.value).toBe(0);
    max.value = 10; // Large reading mode: the same text is now wider than the line.
    settings.textSize = 'large';
    await flush();
    expect(api().index.value).toBe(1);
  });

  it('keeps the last answer and warns when measuring throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let boom = false;
    const max = { value: 6 };
    const texts = ref(['aaaaaaaa', 'aaaa']);
    const { api } = host(texts, {
      measure: (el) => {
        if (boom) throw new Error('detached');
        return byLength(max)(el);
      },
    });
    await flush();
    expect(api().index.value).toBe(1);
    boom = true;
    texts.value = ['bbbbbbbb', 'bbbb'];
    await flush();
    expect(api().index.value).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('keeping the last choice'),
      expect.any(Error)
    );
  });

  it('decides nothing until the container has a width (layout measure, jsdom)', async () => {
    const { api } = host(ref(['long candidate', 'short']));
    await flush();
    expect(api().settled.value).toBe(false);
    expect(api().index.value).toBe(0);
  });
});
