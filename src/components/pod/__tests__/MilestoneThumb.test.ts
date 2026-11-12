/**
 * MilestoneThumb image-failure fallback: a thumb whose `<img>` fails drops to the category
 * emoji for that URL and never marks the photo unresolved. The resilient read and the
 * `scrapbook_image_failed` log are opt-in (`ignoreUnresolved`, the scrapbook's pieces); every
 * other caller reads the URL as it always did and logs nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { Milestone } from '@/types/models';
import MilestoneThumb from '@/components/pod/MilestoneThumb.vue';
import { __resetScrapbookImageFailedForTests } from '@/utils/scrapbookImageFailed';

const { logEventMock, getPublicUrlMock, markUnresolvedMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  markUnresolvedMock: vi.fn(),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

vi.mock('@/composables/useTranslation', async () => {
  const { ref } = await import('vue');
  return {
    useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }),
  };
});

vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    photos: { 'photo-1': { id: 'photo-1', driveFileId: 'drive-abcdWXYZ' } },
    getPublicUrl: getPublicUrlMock,
    markUnresolved: markUnresolvedMock,
  }),
}));

vi.mock('@/stores/milestonesStore', () => ({
  useMilestonesStore: () => ({ safeCategoryFor: () => 'other' }),
}));

const milestone = {
  id: 'ms-1',
  memberId: 'm-1',
  title: 'First swim',
  occurredOn: '2026-09-12',
  photoIds: ['photo-1'],
} as unknown as Milestone;

beforeEach(() => {
  __resetScrapbookImageFailedForTests();
  logEventMock.mockReset();
  markUnresolvedMock.mockReset();
  getPublicUrlMock.mockReset();
  getPublicUrlMock.mockReturnValue('https://lh3.googleusercontent.com/d/drive-abcdWXYZ=w400');
});

describe('MilestoneThumb', () => {
  it('reads the thumb URL as before for an ordinary caller, and logs nothing on an error', async () => {
    const w = mount(MilestoneThumb, { props: { milestone } });
    expect(getPublicUrlMock).toHaveBeenCalledWith('photo-1', 'thumb', { ignoreUnresolved: false });
    await w.find('img').trigger('error');
    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain('\u{2728}');
    expect(logEventMock).not.toHaveBeenCalled();
    expect(markUnresolvedMock).not.toHaveBeenCalled();
  });

  it('opted in: reads with ignoreUnresolved, falls back to the emoji and logs once', async () => {
    const w = mount(MilestoneThumb, { props: { milestone, ignoreUnresolved: true } });
    expect(getPublicUrlMock).toHaveBeenCalledWith('photo-1', 'thumb', { ignoreUnresolved: true });
    await w.find('img').trigger('error');

    expect(w.find('img').exists()).toBe(false);
    expect(w.text()).toContain('\u{2728}');
    expect(logEventMock).toHaveBeenCalledTimes(1);
    expect(logEventMock.mock.calls[0]![0]).toMatchObject({
      level: 'warn',
      surface: 'scrapbook',
      message: 'scrapbook_image_failed',
      context: { file_id_tail: '…WXYZ', online: expect.any(Boolean) },
    });
    expect(markUnresolvedMock).not.toHaveBeenCalled();
  });

  it('logs one photo once a day, however many times its cards remount', async () => {
    for (let i = 0; i < 3; i++) {
      const w = mount(MilestoneThumb, { props: { milestone, ignoreUnresolved: true } });
      await w.find('img').trigger('error');
      w.unmount();
    }
    expect(logEventMock).toHaveBeenCalledTimes(1);
  });

  it('the +N badge is at least text-xs (12 px), on a rem-sized pill', () => {
    const many = { ...milestone, photoIds: ['photo-1', 'photo-2', 'photo-3'] } as Milestone;
    const badge = mount(MilestoneThumb, { props: { milestone: many } })
      .findAll('span')
      .filter((s) => s.text() === '+2')
      .at(-1)!;
    expect(badge.classes()).toEqual(expect.arrayContaining(['text-xs', 'h-5', 'min-w-5']));
    expect(badge.classes().some((c) => /^text-\[/.test(c))).toBe(false);
  });
});
