/**
 * The FAB's magic-beans composer (#119). A view: it emits, the door does the protocol.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import MagicBeansComposer from '@/components/ai/MagicBeansComposer.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const AllowanceMeterStub = defineComponent({
  name: 'AllowanceMeter',
  props: { compact: { type: Boolean, default: false } },
  setup: () => () => h('div', { 'data-test': 'meter' }),
});

function mountComposer(draft = '', opts: { stubField?: boolean; isMobile?: boolean } = {}) {
  const w = mount(MagicBeansComposer, {
    props: { modelValue: draft, isMobile: opts.isMobile ?? false },
    attachTo: document.body,
    global: {
      stubs: {
        AllowanceMeter: AllowanceMeterStub,
        // A field whose <textarea> did not render: BaseTextarea's focus() reports false.
        ...(opts.stubField
          ? {
              BaseTextarea: defineComponent({
                setup(_, { expose }) {
                  expose({ focus: () => false });
                  return () => h('div');
                },
              }),
            }
          : {}),
      },
    },
  });
  return w;
}

type Exposed = { focus: () => boolean };

describe('MagicBeansComposer', () => {
  it('focus() focuses the textarea and reports it could', () => {
    const w = mountComposer();
    expect((w.vm as unknown as Exposed).focus()).toBe(true);
    expect(document.activeElement).toBe(w.find('textarea').element);
    w.unmount();
  });

  it('focus() returns false when there is no field to focus', () => {
    const w = mountComposer('', { stubField: true });
    expect((w.vm as unknown as Exposed).focus()).toBe(false);
    w.unmount();
  });

  it('does NOT focus itself on mount (the host is the one focus owner)', () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    const w = mountComposer();
    expect(document.activeElement).not.toBe(w.find('textarea').element);
    w.unmount();
  });

  it('Send is disabled for an empty or whitespace draft', async () => {
    const w = mountComposer('');
    const send = () => w.find('[data-testid="magic-composer-send"]');
    expect(send().attributes('disabled')).toBeDefined();
    await w.setProps({ modelValue: '   \n ' });
    expect(send().attributes('disabled')).toBeDefined();
    await send().trigger('click');
    expect(w.emitted('send')).toBeUndefined();
    w.unmount();
  });

  it('Send emits once with the TRIMMED draft', async () => {
    const w = mountComposer('  Swimming Tue 4pm \n');
    const send = w.find('[data-testid="magic-composer-send"]');
    expect(send.attributes('disabled')).toBeUndefined();
    await send.trigger('click');
    expect(w.emitted('send')).toEqual([['Swimming Tue 4pm']]);
    w.unmount();
  });

  it('Enter does not send (explicit-tap rule)', async () => {
    const w = mountComposer('a note');
    await w.find('textarea').trigger('keydown', { key: 'Enter' });
    expect(w.emitted('send')).toBeUndefined();
    w.unmount();
  });

  it('typing updates the v-model', async () => {
    const w = mountComposer('');
    await w.find('textarea').setValue('hello');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['hello']);
    w.unmount();
  });

  it('attach and camera emit, with translated accessible names', async () => {
    const w = mountComposer();
    const file = w.find('[data-testid="magic-composer-file"]');
    const camera = w.find('[data-testid="magic-composer-camera"]');
    expect(file.attributes('aria-label')).toBe('ai.picker.chooseFile');
    expect(camera.attributes('aria-label')).toBe('ai.picker.takePhoto');
    await file.trigger('click');
    await camera.trigger('click');
    expect(w.emitted('file')).toHaveLength(1);
    expect(w.emitted('camera')).toHaveLength(1);
    w.unmount();
  });

  it('the field carries the translated accessible name and the placeholder', () => {
    const w = mountComposer();
    const ta = w.find('textarea');
    expect(ta.attributes('aria-label')).toBe('ai.capture.label');
    expect(ta.attributes('placeholder')).toBe('ai.capture.placeholder');
    expect(ta.attributes('data-testid')).toBe('magic-composer-field');
    w.unmount();
  });

  it('shows the bad-link advisory for an unroutable link-shaped token', async () => {
    const w = mountComposer('hello');
    expect(w.text()).not.toContain('ai.capture.badLinkHint');
    // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- an unroutable link IS the case under test
    await w.setProps({ modelValue: 'ftp://example.com' });
    expect(w.text()).toContain('ai.capture.badLinkHint');
    w.unmount();
  });

  it('renders the allowance meter in compact mode', () => {
    const w = mountComposer();
    expect(w.findComponent({ name: 'AllowanceMeter' }).props('compact')).toBe(true);
    w.unmount();
  });

  it('Send carries the label and the send icon', () => {
    const w = mountComposer('x');
    const send = w.find('[data-testid="magic-composer-send"]');
    expect(send.text()).toContain('ai.capture.action');
    expect(send.findComponent({ name: 'BeanieIcon' }).props('name')).toBe('send');
    w.unmount();
  });

  describe('Ctrl/Cmd+Enter shortcut', () => {
    const chord = (w: ReturnType<typeof mountComposer>, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      w.find('textarea').element.dispatchEvent(event);
      return event;
    };

    afterEach(() => {
      vi.restoreAllMocks();
      vi.resetModules();
    });

    it('Ctrl+Enter sends the trimmed draft once and prevents default', () => {
      const w = mountComposer(' hello \n');
      const ev = chord(w, { ctrlKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(w.emitted('send')).toEqual([['hello']]);
      w.unmount();
    });

    it('Cmd+Enter sends too', () => {
      const w = mountComposer('hello');
      const ev = chord(w, { metaKey: true });
      expect(ev.defaultPrevented).toBe(true);
      expect(w.emitted('send')).toEqual([['hello']]);
      w.unmount();
    });

    it('Ctrl+Enter with an empty draft does nothing', () => {
      const w = mountComposer('  ');
      chord(w, { ctrlKey: true });
      expect(w.emitted('send')).toBeUndefined();
      w.unmount();
    });

    it('plain Enter neither sends nor is prevented', () => {
      const w = mountComposer('hello');
      const ev = chord(w, {});
      expect(ev.defaultPrevented).toBe(false);
      expect(w.emitted('send')).toBeUndefined();
      w.unmount();
    });

    it('Shift+Ctrl+Enter and Alt+Ctrl+Enter do nothing', () => {
      const w = mountComposer('hello');
      expect(chord(w, { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(chord(w, { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
      expect(w.emitted('send')).toBeUndefined();
      w.unmount();
    });

    it('shows the hint and aria-keyshortcuts on desktop, not the hint on mobile', () => {
      const desktop = mountComposer('x');
      expect(desktop.find('[data-testid="magic-composer-shortcut"]').text()).toBe(
        'ai.capture.sendShortcut'
      );
      expect(
        desktop.find('[data-testid="magic-composer-send"]').attributes('aria-keyshortcuts')
      ).toBe('Control+Enter');
      desktop.unmount();
      const mobile = mountComposer('x', { isMobile: true });
      expect(mobile.find('[data-testid="magic-composer-shortcut"]').exists()).toBe(false);
      mobile.unmount();
    });

    it('uses the Mac variant when the platform is Mac', async () => {
      vi.resetModules();
      vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
      const { default: MacComposer } = await import('@/components/ai/MagicBeansComposer.vue');
      const w = mount(MacComposer, {
        props: { modelValue: 'x' },
        global: { stubs: { AllowanceMeter: AllowanceMeterStub } },
      });
      expect(w.find('[data-testid="magic-composer-shortcut"]').text()).toBe(
        'ai.capture.sendShortcutMac'
      );
      expect(w.find('[data-testid="magic-composer-send"]').attributes('aria-keyshortcuts')).toBe(
        'Meta+Enter'
      );
      w.unmount();
    });
  });
});
