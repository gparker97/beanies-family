/**
 * The shared toast's first test file.
 *
 * It needed one: both of its affordances are now label-driven (`v-if="reconnectLabel"`,
 * `v-if="dismissLabel"`), and until this change the dismiss branch had NEVER
 * rendered anywhere — the component had exactly one call site and it never passed
 * `dismissible`. So the markup a bystander now sees was, until now, unexercised.
 *
 * The parent's own suite stubs this component out, so assertions about "is there a
 * button" can only mean something here, against the real thing.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ReconnectToast from '../ReconnectToast.vue';

function open(props: Record<string, unknown>) {
  return mount(ReconnectToast, { props: { title: 'Google Calendar is disconnected', ...props } });
}

describe('ReconnectToast — the action is present only when it is labelled', () => {
  it('renders the action button when a label is bound', () => {
    const w = open({ reconnectLabel: 'Reconnect' });
    const btn = w.find('button');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toBe('Reconnect');
  });

  it('🔴 renders NO button element at all when the label is absent', () => {
    // The bystander case. An empty label used to render an empty Heritage-Orange
    // button — present, tappable, and meaningless. Assert on the element, not the
    // text, or the old behaviour passes.
    const w = open({});
    expect(w.findAll('button')).toHaveLength(0);
  });

  it('shows the busy label and disables the button while reconnecting', () => {
    const w = open({ reconnectLabel: 'Reconnect', busy: true, busyLabel: '…' });
    const btn = w.find('button');
    expect(btn.text()).toBe('…');
    expect(btn.attributes('disabled')).toBeDefined();
  });

  it('emits reconnect on click', async () => {
    const w = open({ reconnectLabel: 'Reconnect' });
    await w.find('button').trigger('click');
    expect(w.emitted('reconnect')).toHaveLength(1);
  });
});

describe('ReconnectToast — the dismiss ✕', () => {
  it('renders when a label is bound, and carries it as the accessible name', () => {
    // The label IS the switch, precisely so this can never be an unlabelled
    // button: there is no way to render the ✕ without passing its aria-label.
    const w = open({ dismissLabel: 'Dismiss' });
    const btn = w.find('button');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('aria-label')).toBe('Dismiss');
  });

  it('renders no ✕ when no label is bound', () => {
    expect(open({ reconnectLabel: 'Reconnect' }).findAll('button')).toHaveLength(1);
  });

  it('emits dismiss on click', async () => {
    const w = open({ dismissLabel: 'Dismiss' });
    await w.find('button').trigger('click');
    expect(w.emitted('dismiss')).toHaveLength(1);
  });

  it('keeps a readable resting colour in BOTH modes', () => {
    // `text-slate-400` had only a `dark:hover:` partner, so the ✕ at rest took its
    // colour from the light ramp on a dark surface. CLAUDE.md: readable glyphs
    // resolve to the ink scale.
    const cls = open({ dismissLabel: 'Dismiss' }).find('button').classes().join(' ');
    expect(cls).toContain('dark:text-ink-faint');
    expect(cls).toContain('dark:hover:text-ink');
  });
});

describe('ReconnectToast — a purely informational toast', () => {
  it('renders its title and subtitle with no controls whatsoever', () => {
    const w = open({ subtitle: 'Ask Mum to reconnect it.' });
    expect(w.text()).toContain('Google Calendar is disconnected');
    expect(w.text()).toContain('Ask Mum to reconnect it.');
    expect(w.findAll('button')).toHaveLength(0);
    // `role="status"` was always correct for this; now it is also honest.
    expect(w.find('[role="status"]').exists()).toBe(true);
  });
});
