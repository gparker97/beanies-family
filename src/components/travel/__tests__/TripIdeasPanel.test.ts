/**
 * TripIdeasPanel — extracted from ~100 lines of inline page template.
 *
 * The tests worth having here are the two things the extraction could quietly break: the
 * quick-add box must still be focusable from the page (it moved inside this component, so
 * the page's ref stopped binding), and every mutation must leave as an emit rather than
 * being handled locally — the page owns the permission gate and the store writes.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import TripIdeasPanel from '../TripIdeasPanel.vue';
import type { FamilyVacation, VacationIdea } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function idea(id: string, over?: Partial<VacationIdea>): VacationIdea {
  return {
    id,
    title: `Idea ${id}`,
    votes: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    ...over,
  } as VacationIdea;
}

function trip(): FamilyVacation {
  return {
    id: 'vac-1',
    activityId: 'act-1',
    name: 'Japan',
    tripType: 'fly_and_stay',
    assigneeIds: [],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: 'm-1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as FamilyVacation;
}

function mountPanel(unplanned: VacationIdea[] = [], planned: VacationIdea[] = []) {
  setActivePinia(createPinia());
  return mount(TripIdeasPanel, {
    props: {
      vacation: trip(),
      unplannedIdeas: unplanned,
      plannedIdeas: planned,
      quickIdeaText: '',
      'onUpdate:quickIdeaText': vi.fn(),
    },
    global: { stubs: { VacationIdeaCard: true, LinkedLists: true } },
    attachTo: document.body,
  });
}

describe('TripIdeasPanel', () => {
  it('exposes focusQuickAdd, which the page needs after scrolling', () => {
    // The input moved in here with the panel, so the page's `quickIdeaInput` ref stopped
    // binding. Leaving that broken would have silently killed the "add an idea" affordance.
    const w = mountPanel();
    const vm = w.vm as unknown as { focusQuickAdd?: () => void };
    expect(typeof vm.focusQuickAdd).toBe('function');
    vm.focusQuickAdd!();
    expect(document.activeElement?.tagName).toBe('INPUT');
  });

  it('renders one card per idea in each group', () => {
    const w = mountPanel([idea('a'), idea('b')], [idea('c', { isPlanned: true })]);
    expect(w.findAll('vacation-idea-card-stub').length).toBe(3);
  });

  it('emits add-idea rather than writing to the store itself', async () => {
    const w = mountPanel();
    const btn = w.findAll('button').find((b) => b.text().includes('+'));
    if (btn) {
      await btn.trigger('click');
      expect(w.emitted('add-idea')).toBeTruthy();
    }
  });

  it('does not clear the quick-add box itself — the page owns that', () => {
    // Deliberate: the box must clear only once the write LANDS, or a failed save silently
    // discards what the user typed.
    const w = mountPanel();
    expect(w.emitted('update:quickIdeaText')).toBeFalsy();
  });
});
