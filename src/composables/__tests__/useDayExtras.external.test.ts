/**
 * `useDayExtras` emits an all-day view-only event as ONE `external` extra per day it
 * covers (plan 2026-11-17, C2), reading the read-only selector and never setting the
 * fetch window. With nothing viewed it emits none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useDayExtras } from '@/composables/useDayExtras';
import { externalEvent } from '@/test/monthCellFixtures';
import type { ExternalEvent } from '@/types/externalEvents';

const ext = vi.hoisted(() => ({
  active: true,
  byDate: new Map<string, ExternalEvent[]>(),
  setScreenWindow: vi.fn(),
}));

vi.mock('@/composables/useExternalEvents', async () => {
  const { computed } = await import('vue');
  return {
    useExternalEvents: () => ({
      isActive: computed(() => ext.active),
      allDayForDate: (ymd: string) => (ext.byDate.get(ymd) ?? []).filter((e) => e.allDay),
      setScreenWindow: ext.setScreenWindow,
    }),
  };
});

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'calendarView.event.busy' ? 'Busy' : k) }),
}));

const away = externalEvent('Grandma away', {
  ymd: '2026-11-25',
  allDay: true,
  endYmd: '2026-11-27',
});

beforeEach(() => {
  setActivePinia(createPinia());
  ext.active = true;
  ext.byDate = new Map([
    ['2026-11-25', [away]],
    ['2026-11-26', [away, externalEvent('timed', { ymd: '2026-11-26' })]],
    ['2026-11-27', [away]],
  ]);
  ext.setScreenWindow.mockReset();
});

describe('useDayExtras: all-day view-only events', () => {
  it('emits one external extra per covered day inside the window, labelled with the title', () => {
    const { extras } = useDayExtras(
      computed(() => '2026-11-24'),
      computed(() => '2026-11-26')
    );
    const external = extras.value.filter((e) => e.kind === 'external');
    expect(external.map((e) => e.ymd)).toEqual(['2026-11-25', '2026-11-26']);
    expect(external.every((e) => e.external === away && e.label === 'Grandma away')).toBe(true);
    expect(new Set(external.map((e) => e.id)).size).toBe(2);
  });

  it('a busy-only event is labelled "Busy"', () => {
    const busy = externalEvent('x', { ymd: '2026-11-25', allDay: true, busyOnly: true });
    ext.byDate = new Map([['2026-11-25', [busy]]]);
    const { extras } = useDayExtras(
      computed(() => '2026-11-25'),
      computed(() => '2026-11-25')
    );
    expect(extras.value[0]).toMatchObject({ kind: 'external', label: 'Busy' });
  });

  it('ignores the person filter (the event belongs to no member)', () => {
    const { extras } = useDayExtras(
      computed(() => '2026-11-25'),
      computed(() => '2026-11-25'),
      { isMemberVisible: computed(() => () => false) }
    );
    expect(extras.value.some((e) => e.kind === 'external')).toBe(true);
  });

  it('emits nothing while no calendar is viewed, and never sets the fetch window', () => {
    ext.active = false;
    const { extras } = useDayExtras(
      computed(() => '2026-11-24'),
      computed(() => '2026-11-28')
    );
    expect(extras.value.filter((e) => e.kind === 'external')).toEqual([]);
    expect(ext.setScreenWindow).not.toHaveBeenCalled();
  });
});
