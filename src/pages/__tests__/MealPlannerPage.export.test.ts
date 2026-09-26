/**
 * Characterisation of the meal-plan export's failure contract (#109).
 *
 * Written against the page BEFORE its export code moved into `useSheetExportRunner`, so the
 * refactor has to keep exactly this behaviour: whichever stage throws, the busy flag clears
 * (both buttons usable again, the off-screen sheet unmounted) and exactly ONE error toast
 * fires, under surface `plan-export` with the meal copy keys and the failing stage.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MealPlannerPage from '@/pages/MealPlannerPage.vue';
import { showToast } from '@/composables/useToast';
import { deliverFile } from '@/utils/deliverFile';
import * as sheetExport from '@/composables/useSheetExport';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ currentLanguage: 'en', t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/perfTiming', () => ({ record: vi.fn() }));
vi.mock('@/utils/deliverFile', () => ({ deliverFile: vi.fn() }));
vi.mock('@/composables/useCalendarSlide', () => ({ useCalendarSlide: vi.fn() }));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn() }));
vi.mock('@/composables/useSheetExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useSheetExport')>()),
  exportElementToPng: vi.fn(),
  pngBlobToPdf: vi.fn(),
  prewarmSheetExport: vi.fn(),
}));
vi.mock('@/stores/mealPlanStore', () => ({
  useMealPlanStore: () => ({ mealsForWeek: () => [], weekHasMeals: () => false }),
}));
vi.mock('@/stores/recipesStore', () => ({ useRecipesStore: () => ({ recipes: [] }) }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [], initialsById: new Map() }),
}));

const STUBS = {
  RecipeRail: true,
  MealWeekBoard: true,
  MealDayStack: true,
  MealEditModal: true,
  MealPickerSheet: true,
  PageWelcomeSubtitle: true,
  BeanieIcon: true,
};

const exportElementToPng = vi.mocked(sheetExport.exportElementToPng);
const pngBlobToPdf = vi.mocked(sheetExport.pngBlobToPdf);

const mounted: VueWrapper[] = [];
function factory() {
  const wrapper = mount(MealPlannerPage, { global: { stubs: STUBS }, attachTo: document.body });
  mounted.push(wrapper);
  return wrapper;
}

function button(wrapper: VueWrapper, labelKey: string) {
  const found = wrapper.findAll('button').find((b) => b.text().includes(labelKey));
  if (!found) throw new Error(`no button labelled ${labelKey}`);
  return found;
}

/** Busy flag cleared: both buttons show their idle label, enabled; the sheet is unmounted. */
function expectIdle(wrapper: VueWrapper) {
  expect(button(wrapper, 'mealPlanner.export.share').attributes('disabled')).toBeUndefined();
  expect(button(wrapper, 'mealPlanner.export.exportPdf').attributes('disabled')).toBeUndefined();
  expect(wrapper.text()).not.toContain('mealPlanner.export.building');
  expect(wrapper.find('.export-host').exists()).toBe(false);
}

function expectOneFailureToast(format: 'image' | 'pdf', stage: string) {
  const errorToasts = vi.mocked(showToast).mock.calls.filter((c) => c[0] === 'error');
  expect(errorToasts).toHaveLength(1);
  expect(errorToasts[0]).toEqual([
    'error',
    'mealPlanner.export.failed',
    'mealPlanner.export.failedHelp',
    expect.objectContaining({
      surface: 'plan-export',
      context: { format, stage },
      error: expect.anything(),
    }),
  ]);
}

describe('MealPlannerPage export — failure contract', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    exportElementToPng.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    pngBlobToPdf.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
    vi.mocked(deliverFile).mockResolvedValue({ delivered: true } as never);
  });
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
  });

  it('delivers a PNG on Share and returns to idle with no error toast', async () => {
    const wrapper = factory();
    await button(wrapper, 'mealPlanner.export.share').trigger('click');
    await flushPromises();

    expect(deliverFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deliverFile).mock.calls[0]![0]).toMatchObject({
      mimeType: 'image/png',
      kind: 'meal-plan-png',
    });
    expect(vi.mocked(deliverFile).mock.calls[0]![0].filename).toMatch(
      /^beanies-meal-plan-\d{4}-\d{2}-\d{2}\.png$/
    );
    expect(showToast).not.toHaveBeenCalled();
    expectIdle(wrapper);
  });

  it('rasterize failure: one toast at stage rasterize, busy flag cleared', async () => {
    exportElementToPng.mockRejectedValue(new sheetExport.ExportError('rasterize', new Error('x')));
    const wrapper = factory();
    await button(wrapper, 'mealPlanner.export.share').trigger('click');
    await flushPromises();

    expectOneFailureToast('image', 'rasterize');
    expect(deliverFile).not.toHaveBeenCalled();
    expectIdle(wrapper);
  });

  it('pdf failure: one toast at stage pdf, busy flag cleared', async () => {
    pngBlobToPdf.mockRejectedValue(new sheetExport.ExportError('pdf', new Error('x')));
    const wrapper = factory();
    await button(wrapper, 'mealPlanner.export.exportPdf').trigger('click');
    await flushPromises();

    expectOneFailureToast('pdf', 'pdf');
    expect(deliverFile).not.toHaveBeenCalled();
    expectIdle(wrapper);
  });

  it('deliver failure (a plain Error): one toast at stage deliver, busy flag cleared', async () => {
    vi.mocked(deliverFile).mockRejectedValue(new Error('share blew up'));
    const wrapper = factory();
    await button(wrapper, 'mealPlanner.export.exportPdf').trigger('click');
    await flushPromises();

    expectOneFailureToast('pdf', 'deliver');
    expectIdle(wrapper);
  });
});
