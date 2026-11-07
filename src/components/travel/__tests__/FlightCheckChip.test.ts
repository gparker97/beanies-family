/**
 * FlightCheckChip (#143): six states, each with its label (from `chipLabel`) and its colour
 * pair. The colour assertions are the Dark Mode Coverage contract: every accent carries its
 * `-lift` partner, red appears ONLY for a cancellation, and nothing readable is dimmed.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import FlightCheckChip from '../FlightCheckChip.vue';
import type { FlightVerification } from '@/types/flightStatus';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k, currentLanguage: { value: 'en' } }),
}));

const NOW = Date.parse('2026-12-13T08:00:00Z');

function mountChip(verification: FlightVerification, compact = false) {
  return mount(FlightCheckChip, { props: { verification, nowMs: NOW, compact } });
}

describe('FlightCheckChip', () => {
  it('verified: green dot that pulses while the check is fresh, success pair', () => {
    const w = mountChip({ state: 'verified', checkedAt: NOW - 12 * 60_000 });
    const root = w.get('[data-state="verified"]');
    // `t` is the identity stub, so the label is the template key (fillTemplate leaves it).
    expect(root.text()).toBe('flightChecks.checked');
    expect(root.classes()).toEqual(
      expect.arrayContaining(['text-green-800', 'dark:text-success-lift'])
    );
    expect(root.find('.live-dot').exists()).toBe(true);
  });

  it('verified: the dot stops pulsing once the check is over an hour old', () => {
    const w = mountChip({ state: 'verified', checkedAt: NOW - 2 * 60 * 60_000 });
    expect(w.find('.live-dot').exists()).toBe(false);
    expect(w.find('span.rounded-full span.bg-current').exists()).toBe(true);
  });

  it('verified with a display-only "may be cancelled" status is orange, never green', () => {
    const w = mountChip({
      state: 'verified',
      checkedAt: NOW,
      live: { status: 'CanceledUncertain' },
    });
    const root = w.get('[data-state="verified"]');
    expect(root.text()).toBe('flightChecks.chip.mayBeCancelled');
    expect(root.classes()).toContain('dark:text-accent-lift');
    expect(root.classes()).not.toContain('text-green-800');
  });

  it('changed: arrow icon, Heritage Orange with its lift', () => {
    const w = mountChip({ state: 'changed', was: { departureTime: '17:00' } });
    const root = w.get('[data-state="changed"]');
    expect(root.text()).toBe('flightChecks.chip.changed');
    expect(root.classes()).toEqual(
      expect.arrayContaining(['text-primary-700', 'dark:text-accent-lift'])
    );
    expect(root.find('svg[aria-hidden="true"]').exists()).toBe(true);
  });

  it('conflict: dashed orange edge on the lighter orange tint', () => {
    const root = mountChip({ state: 'conflict' }).get('[data-state="conflict"]');
    expect(root.text()).toBe('flightChecks.chip.conflict');
    expect(root.classes()).toEqual(
      expect.arrayContaining([
        'border-dashed',
        'border-primary-500',
        'dark:border-accent-lift',
        'bg-[var(--tint-orange-8)]',
      ])
    );
  });

  it('cancelled: the one red state, with its danger lift', () => {
    const root = mountChip({ state: 'cancelled' }).get('[data-state="cancelled"]');
    expect(root.text()).toBe('flightChecks.chip.cancelled');
    expect(root.classes()).toEqual(
      expect.arrayContaining([
        'text-red-700',
        'dark:text-danger-lift',
        'bg-[var(--tint-danger-10)]',
      ])
    );
  });

  it('unavailable: grey, and the label follows the reason', () => {
    const before = mountChip({
      state: 'unavailable',
      reason: 'before_window',
      opensAt: '2026-12-19T09:00:00Z',
    }).get('[data-state="unavailable"]');
    expect(before.text()).toBe('flightChecks.chip.checksFrom');
    expect(before.classes()).toEqual(
      expect.arrayContaining(['text-secondary-400', 'dark:text-ink-soft'])
    );

    expect(mountChip({ state: 'unavailable', reason: 'offline' }).text()).toBe(
      'flightChecks.chip.unavailable'
    );
    expect(mountChip({ state: 'unavailable', reason: 'no_match' }).text()).toBe(
      'flightChecks.chip.noMatch'
    );
    // Unentitled reads "Not checked live", never an error.
    expect(mountChip({ state: 'unavailable', reason: 'unentitled' }).text()).toBe(
      'flightChecks.chip.notLive'
    );
  });

  it('not-live: dashed outline, transparent, faint ink, no icon', () => {
    const root = mountChip({ state: 'not-live' }).get('[data-state="not-live"]');
    expect(root.text()).toBe('flightChecks.chip.notLive');
    expect(root.classes()).toEqual(
      expect.arrayContaining(['border-dashed', 'bg-transparent', 'dark:text-ink-faint'])
    );
    expect(root.find('svg').exists()).toBe(false);
  });

  it('never dims readable text with an opacity modifier, in any state', () => {
    const states: FlightVerification[] = [
      { state: 'verified', checkedAt: NOW },
      { state: 'changed' },
      { state: 'conflict' },
      { state: 'cancelled' },
      { state: 'unavailable' },
      { state: 'not-live' },
    ];
    for (const v of states) {
      for (const c of mountChip(v).get('[data-state]').classes()) {
        expect(c).not.toMatch(/^(?:dark:)?text-.*\/\d+$/);
      }
    }
  });

  it('compact tightens the padding only', () => {
    const root = mountChip({ state: 'changed' }, true).get('[data-state="changed"]');
    expect(root.classes()).toContain('px-2');
    expect(root.text()).toBe('flightChecks.chip.changed');
  });

  it('is a plain span unless it reveals a folded notice, when it is a labelled button', async () => {
    const plain = mountChip({ state: 'changed' });
    expect(plain.get('[data-state="changed"]').element.tagName).toBe('SPAN');
    await plain.get('[data-state="changed"]').trigger('click');
    expect(plain.emitted('click')).toBeUndefined();

    const w = mount(FlightCheckChip, {
      props: { verification: { state: 'changed' }, nowMs: NOW, reveals: true },
    });
    const root = w.get('[data-state="changed"]');
    expect(root.element.tagName).toBe('BUTTON');
    expect(root.attributes('type')).toBe('button');
    expect(root.attributes('aria-label')).toBe('flightChecks.chip.showNotice');
    await root.trigger('click');
    expect(w.emitted('click')).toHaveLength(1);
  });
});
