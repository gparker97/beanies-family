import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory, type Router } from 'vue-router';
import type { PlannerView } from '@/composables/usePlannerNavigation';
import {
  parsePlannerQuery,
  toPlannerQuery,
  usePlannerUrlState,
} from '@/composables/usePlannerUrlState';
import { parseLocalDate, toDateInputValue } from '@/utils/date';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));

const TODAY = '2026-10-19';

describe('parsePlannerQuery', () => {
  it('reads a valid view and date', () => {
    expect(parsePlannerQuery({ view: 'day', d: '2026-06-15' }, TODAY)).toEqual({
      view: 'day',
      ymd: '2026-06-15',
      invalid: [],
    });
  });

  it('defaults to month on today when the params are absent', () => {
    expect(parsePlannerQuery({}, TODAY)).toEqual({ view: 'month', ymd: TODAY, invalid: [] });
  });

  it('rejects unknown views, impossible dates and repeated params, falling back', () => {
    expect(parsePlannerQuery({ view: 'year', d: '2026-02-30' }, TODAY)).toEqual({
      view: 'month',
      ymd: TODAY,
      invalid: ['view', 'd'],
    });
    expect(parsePlannerQuery({ view: ['day', 'week'], d: null }, TODAY).invalid).toEqual([
      'view',
      'd',
    ]);
  });
});

describe('toPlannerQuery', () => {
  it('drops the defaults so plain /activities is canonical', () => {
    expect(toPlannerQuery('month', parseLocalDate(TODAY), TODAY)).toEqual({
      view: undefined,
      d: undefined,
    });
  });

  it('carries a non-default view and date', () => {
    expect(toPlannerQuery('week', parseLocalDate('2026-06-15'), TODAY)).toEqual({
      view: 'week',
      d: '2026-06-15',
    });
    expect(toPlannerQuery('day', parseLocalDate(TODAY), TODAY)).toEqual({
      view: 'day',
      d: undefined,
    });
  });
});

describe('usePlannerUrlState', () => {
  let router: Router;
  let activeView: Ref<PlannerView>;
  let referenceDate: Ref<Date>;
  let drillToDay: (ymd: string) => void;

  const ymd = () => toDateInputValue(referenceDate.value);

  async function setup(path: string) {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'Home', component: { render: () => null } },
        { path: '/activities', name: 'Activities', component: { render: () => null } },
      ],
    });
    await router.push(path);
    activeView = ref<PlannerView>('month');
    referenceDate = ref(new Date());
    const Host = defineComponent({
      setup() {
        ({ drillToDay } = usePlannerUrlState({ activeView, referenceDate }));
        return () => h('div');
      },
    });
    mount(Host, { global: { plugins: [router] } });
    await flushPromises();
  }

  beforeEach(() => logEvent.mockClear());

  it('assigns the refs from the URL on setup', async () => {
    await setup('/activities?view=week&d=2020-02-15');
    expect(activeView.value).toBe('week');
    expect(ymd()).toBe('2020-02-15');
  });

  it('drillToDay pushes exactly one entry, and back returns to the month on that date', async () => {
    await setup('/activities?d=2020-02-01');
    const push = vi.spyOn(router, 'push');
    const replace = vi.spyOn(router, 'replace');

    drillToDay('2020-02-15');
    await flushPromises();
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query).toEqual({ view: 'day', d: '2020-02-15' });

    router.back();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/activities?d=2020-02-01');
    expect(activeView.value).toBe('month');
    expect(ymd()).toBe('2020-02-01');
  });

  it('prev/next-style ref changes replace the entry and add none', async () => {
    await setup('/activities?d=2020-02-01');
    drillToDay('2020-02-15');
    await flushPromises();
    const push = vi.spyOn(router, 'push');
    const replace = vi.spyOn(router, 'replace');

    referenceDate.value = parseLocalDate('2020-02-16');
    await flushPromises();
    referenceDate.value = parseLocalDate('2020-02-17');
    await flushPromises();
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(router.currentRoute.value.query).toEqual({ view: 'day', d: '2020-02-17' });

    // Back skips straight past the replaced day entries to the drilled-from month.
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/activities?d=2020-02-01');
    expect(activeView.value).toBe('month');
  });

  it('switching back to month drops view from the URL', async () => {
    await setup('/activities?view=week&d=2020-02-15');
    activeView.value = 'month';
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ d: '2020-02-15' });
  });

  it('keeps a pending activity deep link when it rewrites the query', async () => {
    await setup('/activities?activity=abc&date=2020-03-01');
    referenceDate.value = parseLocalDate('2020-02-15');
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({
      activity: 'abc',
      date: '2020-03-01',
      d: '2020-02-15',
    });
  });

  it('logs an invalid param once and falls back to the default', async () => {
    await setup('/activities?view=year&d=2020-02-15');
    expect(activeView.value).toBe('month');
    expect(ymd()).toBe('2020-02-15');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'planner-url',
        message: 'invalid_param',
        context: { action: 'invalid_param', detail: 'view' },
      })
    );
  });

  it('does nothing once the route is no longer the planner', async () => {
    await setup('/activities?view=week&d=2020-02-15');
    await router.push('/');
    await nextTick();
    expect(activeView.value).toBe('week');
    expect(ymd()).toBe('2020-02-15');

    const replace = vi.spyOn(router, 'replace');
    referenceDate.value = parseLocalDate('2020-02-16');
    await flushPromises();
    expect(replace).not.toHaveBeenCalled();
  });
});
