import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import PlannerTimedBlock from '../PlannerTimedBlock.vue';
import PhotoIndicator from '@/components/media/PhotoIndicator.vue';
import type { ActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Piano',
    date: '2026-05-13',
    startTime: '16:00',
    endTime: '17:00',
    category: 'music',
    isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['createdAt'],
    updatedAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['updatedAt'],
    recurrence: 'none',
    photoIds: ['p1'],
    ...overrides,
  } as FamilyActivity;
}

function identity(overrides: Partial<ActivityIdentity> = {}): ActivityIdentity {
  return {
    color: '#F15D22',
    kind: 'shared',
    stackMembers: [],
    emoji: '🎹',
    celebration: { celebrating: false } as ActivityIdentity['celebration'],
    sticker: '',
    style: { borderLeftColor: '#F15D22', background: 'rgba(241, 93, 34, 0.13)' },
    edgeStyle: { borderLeftColor: '#F15D22' },
    flatWash: 'rgba(241, 93, 34, 0.13)',
    dashed: true,
    ...overrides,
  };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    activity: activity(),
    eventDate: '2026-05-13',
    startTime: '16:00',
    endTime: '17:00',
    laneIndex: 1,
    laneCount: 2,
    identity: identity(),
    getPosition: () => ({ top: '15rem', height: '3.75rem' }),
    title: 'Piano',
    surface: 'week' as const,
    ...overrides,
  };
}

const SURFACE_CLASSES = ['bg-white', 'dark:bg-surface-raised', 'shadow-sm'];

describe('PlannerTimedBlock', () => {
  beforeEach(() => {
    // PhotoIndicator reaches into the translation store.
    setActivePinia(createPinia());
  });

  it('renders as a focusable button carrying the activity and occurrence date', () => {
    const w = mount(PlannerTimedBlock, { props: props() });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.attributes('type')).toBe('button');
    expect(w.attributes('data-activity-id')).toBe('a1');
    expect(w.attributes('data-occurrence-date')).toBe('2026-05-13');
    expect(w.text()).toContain('Piano');
  });

  it('keeps the grid position and the lane split it had before extraction', () => {
    const style = (mount(PlannerTimedBlock, { props: props() }).element as HTMLElement).style;
    expect(style.top).toBe('15rem');
    expect(style.height).toBe('3.75rem');
    expect(style.left).toBe('50%');
    expect(style.width).toBe('calc(50% - 2px)');
  });

  it('emits view-activity on click without bubbling to the column', async () => {
    let parentClicks = 0;
    const Host = defineComponent({
      setup: () => () =>
        h('div', { onClick: () => parentClicks++ }, [h(PlannerTimedBlock, props())]),
    });
    const w = mount(Host);
    const block = w.findComponent(PlannerTimedBlock);
    await block.trigger('click');
    expect(block.emitted('view-activity')).toEqual([['a1', '2026-05-13']]);
    expect(parentClicks).toBe(0);
  });

  it("surface='week' paints the identity wash and no card surface or dashed edge", () => {
    const w = mount(PlannerTimedBlock, { props: props({ surface: 'week' }) });
    for (const c of [...SURFACE_CLASSES, 'border-dashed']) expect(w.classes()).not.toContain(c);
    expect((w.element as HTMLElement).style.background).toContain('rgba(241, 93, 34, 0.13)');
  });

  it("surface='lanes' adds the card surface, the dashed edge, and binds the edge only", () => {
    const w = mount(PlannerTimedBlock, { props: props({ surface: 'lanes' }) });
    for (const c of [...SURFACE_CLASSES, 'border-dashed']) expect(w.classes()).toContain(c);
    expect((w.element as HTMLElement).style.background).toBe('');
  });

  it('showPhotos toggles the photo indicator', () => {
    const on = mount(PlannerTimedBlock, { props: props({ showPhotos: true }) });
    expect(on.findComponent(PhotoIndicator).exists()).toBe(true);
    const off = mount(PlannerTimedBlock, { props: props() });
    expect(off.findComponent(PhotoIndicator).exists()).toBe(false);
  });

  describe('drag and drop (#142)', () => {
    const handle = (w: ReturnType<typeof mount>) => w.find('[data-drag="resize-end"]');

    it('is a move source with the Space hint, and no text selection or callout', () => {
      const w = mount(PlannerTimedBlock, { props: props() });
      expect(w.attributes('data-drag')).toBe('move');
      expect(w.attributes('aria-description')).toBeTruthy();
      expect(w.classes()).toEqual(expect.arrayContaining(['select-none']));
    });

    it('an overnight tail (draggable false) is no source and has no handle', () => {
      const w = mount(PlannerTimedBlock, { props: props({ draggable: false, resizable: true }) });
      expect(w.attributes('data-drag')).toBeUndefined();
      expect(w.attributes('aria-description')).toBeUndefined();
      expect(handle(w).exists()).toBe(false);
    });

    it('a vacation-linked activity never becomes a source', () => {
      const w = mount(PlannerTimedBlock, {
        props: props({ activity: activity({ vacationId: 'v1' }), resizable: true }),
      });
      expect(w.attributes('data-drag')).toBeUndefined();
      expect(handle(w).exists()).toBe(false);
    });

    it('carries the decorative bottom resize handle only when resizable', () => {
      expect(handle(mount(PlannerTimedBlock, { props: props() })).exists()).toBe(false);
      const h = handle(mount(PlannerTimedBlock, { props: props({ resizable: true }) }));
      expect(h.exists()).toBe(true);
      expect(h.attributes('aria-hidden')).toBe('true');
      expect(h.classes()).toEqual(expect.arrayContaining(['cursor-ns-resize', 'bottom-0']));
      // The bar has its dark partner, never Tailwind's grey ramp.
      expect(h.find('span').classes()).toContain('dark:bg-line-strong');
    });

    it.each(['week', 'lanes'] as const)(
      "surface='%s': the time is Heritage Orange with its dark lift and no opacity",
      (surface) => {
        const w = mount(PlannerTimedBlock, { props: props({ surface }) });
        const time = w.findAll('span').find((s) => s.text().startsWith('4pm'))!;
        expect(time.classes()).toEqual(
          expect.arrayContaining(['text-primary-500', 'dark:text-accent-lift'])
        );
        expect(time.classes().some((c) => c.startsWith('opacity-'))).toBe(false);
      }
    );

    it.each(['week', 'lanes'] as const)(
      "surface='%s': the time and location lines use the Caption size (text-xs), no custom size",
      (surface) => {
        const w = mount(PlannerTimedBlock, {
          props: props({ surface, activity: activity({ location: 'Hall B' }) }),
        });
        const spans = w.findAll('span');
        const lines = [
          spans.find((s) => s.text().startsWith('4pm'))!,
          spans.find((s) => s.text().includes('Hall B'))!,
        ];
        for (const line of lines) {
          expect(line.classes()).toContain('text-xs');
          // A custom size (`text-[0.6875rem]`), not a colour like `text-[var(--muted-text)]`.
          expect(line.classes().some((c) => /^text-\[\d/.test(c))).toBe(false);
        }
      }
    );

    it.each(['week', 'lanes'] as const)(
      "surface='%s': the location is the muted ink token (it has its own dark value), no opacity",
      (surface) => {
        const w = mount(PlannerTimedBlock, {
          props: props({ surface, activity: activity({ location: 'Hall B' }) }),
        });
        const location = w.findAll('span').find((s) => s.text().includes('Hall B'))!;
        expect(location.classes()).toContain('text-[var(--muted-text)]');
        // No opacity on readable text: neither a modifier (`/60`) nor an `opacity-` class.
        expect(location.classes().some((c) => c.includes('/') || c.startsWith('opacity-'))).toBe(
          false
        );
      }
    );
  });
});
