import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';

const h = vi.hoisted(() => ({ state: {} as { line?: unknown; pct?: unknown; brief?: unknown } }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useAllowanceLine', () => ({
  useAllowanceLine: () => ({
    line: ref(h.state.line),
    pct: ref(h.state.pct),
    brief: ref(h.state.brief),
  }),
}));

import AllowanceMeter from '../AllowanceMeter.vue';

describe('AllowanceMeter', () => {
  it('full: shows the long line and the bar', () => {
    h.state = { line: 'long line', pct: 70, brief: 'short' };
    const w = mount(AllowanceMeter);
    expect(w.text()).toBe('long line');
    expect(w.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('70');
  });

  it('compact: shows the brief line, not the long one', () => {
    h.state = { line: 'long line', pct: 70, brief: 'short' };
    const w = mount(AllowanceMeter, { props: { compact: true } });
    expect(w.text()).toBe('short');
    expect(w.find('[role="progressbar"]').exists()).toBe(true);
  });

  it('compact: renders nothing when usage could not be read (line is the unavailable sentence)', () => {
    h.state = { line: 'unavailable', pct: null, brief: null };
    const w = mount(AllowanceMeter, { props: { compact: true } });
    expect(w.find('[data-testid="allowance-meter"]').exists()).toBe(false);
  });
});
