/**
 * CalendarCardShell: the collapsible row shared by the synced and the view-only
 * calendar cards. The row is a real button that toggles the body, says whether it
 * is open, and names the region it controls; a calendar that needs attention says
 * so on the closed row.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CalendarCardShell from '../CalendarCardShell.vue';

function mountShell(props: Record<string, unknown> = {}, withActions = true) {
  return mount(CalendarCardShell, {
    attachTo: document.body,
    props: { name: 'Family', account: 'a@b.com', statusLabel: 'Connected', ...props },
    slots: {
      default: '<p class="body-content">Body</p>',
      ...(withActions ? { actions: '<button class="action">Act</button>' } : {}),
    },
  });
}

describe('CalendarCardShell', () => {
  it('shows the name, account line and status on the closed row', () => {
    const wrapper = mountShell();
    const row = wrapper.get('[data-testid="calendar-card-toggle"]');
    expect(row.element.tagName).toBe('BUTTON');
    expect(row.attributes('type')).toBe('button');
    expect(row.get('[data-testid="calendar-card-name"]').text()).toBe('Family');
    expect(row.get('[data-testid="calendar-card-account"]').text()).toBe('a@b.com');
    expect(row.get('[data-testid="calendar-card-status"]').text()).toBe('Connected');
  });

  it('starts closed: aria-expanded false and the body hidden', () => {
    const wrapper = mountShell();
    const row = wrapper.get('[data-testid="calendar-card-toggle"]');
    expect(row.attributes('aria-expanded')).toBe('false');
    expect(wrapper.get('[data-testid="calendar-card-body"]').isVisible()).toBe(false);
  });

  it('aria-controls names the body region, which exists even while closed', () => {
    const wrapper = mountShell();
    const controls = wrapper
      .get('[data-testid="calendar-card-toggle"]')
      .attributes('aria-controls');
    expect(controls).toBeTruthy();
    expect(wrapper.get('[data-testid="calendar-card-body"]').attributes('id')).toBe(controls);
  });

  it('a tap asks to open (v-model:open) and the open prop shows both slots', async () => {
    const wrapper = mountShell();
    await wrapper.get('[data-testid="calendar-card-toggle"]').trigger('click');
    expect(wrapper.emitted('update:open')).toEqual([[true]]);

    await wrapper.setProps({ open: true });
    const row = wrapper.get('[data-testid="calendar-card-toggle"]');
    expect(row.attributes('aria-expanded')).toBe('true');
    const body = wrapper.get('[data-testid="calendar-card-body"]');
    expect(body.isVisible()).toBe(true);
    expect(body.find('.body-content').exists()).toBe(true);
    expect(body.get('[data-testid="calendar-card-actions"]').find('.action').exists()).toBe(true);

    await row.trigger('click');
    expect(wrapper.emitted('update:open')).toEqual([[true], [false]]);
  });

  it('omits the action row when no actions are given', () => {
    const wrapper = mountShell({ open: true }, false);
    expect(wrapper.find('[data-testid="calendar-card-actions"]').exists()).toBe(false);
  });

  it('an attention status is Heritage Orange with its lift, never red', () => {
    const wrapper = mountShell({ statusTone: 'attention', statusLabel: 'Sign In Again' });
    const pill = wrapper.get('[data-testid="calendar-card-status"]');
    expect(pill.attributes('data-tone')).toBe('attention');
    expect(pill.classes()).toEqual(
      expect.arrayContaining(['text-primary-700', 'dark:text-accent-lift'])
    );
    expect(pill.html()).not.toMatch(/red-|danger/);
  });

  it('draws the hollow color dot only when given a color', () => {
    expect(mountShell().find('.view-only-dot').exists()).toBe(false);
    const dot = mountShell({ dotColor: '#6b7280' }).get('.view-only-dot');
    expect(dot.attributes('style')).toContain('--vo-hue: #6b7280');
    expect(dot.attributes('aria-hidden')).toBe('true');
  });

  it('hides the account line when it is empty', () => {
    expect(mountShell({ account: '' }).find('[data-testid="calendar-card-account"]').exists()).toBe(
      false
    );
  });
});
