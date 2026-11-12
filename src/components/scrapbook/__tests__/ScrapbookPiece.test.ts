/**
 * ScrapbookPiece tests.
 *
 * Covers:
 *   - Each entry type renders its own paper (sticky saying, favorite card, polaroid
 *     milestone, taped milestone, ripped note) and an unknown type reports + renders nothing
 *   - The polaroid reads its URL with `ignoreUnresolved` at the requested size
 *   - A polaroid image error falls back to the taped text card and logs exactly once (its
 *     fallback thumb failing too does not log the same photo again), without ever marking
 *     the photo unresolved
 *   - Muted text uses semantic colours, never an opacity modifier, at `text-xs` or above
 *   - The hover lift only applies when `interactive` is set, and the card wrapper sets it
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { FavoriteItem, MemberNote, Milestone, SayingItem } from '@/types/models';
import type { ScrapbookEntry } from '@/composables/useScrapbookFeed';
import ScrapbookPiece from '@/components/scrapbook/ScrapbookPiece.vue';
import ScrapbookEntryCard from '@/components/scrapbook/ScrapbookEntryCard.vue';
import { __resetScrapbookImageFailedForTests } from '@/utils/scrapbookImageFailed';

const { reportErrorMock, logEventMock, getPublicUrlMock, markUnresolvedMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  logEventMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
  markUnresolvedMock: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

vi.mock('@/composables/useTranslation', async () => {
  const { ref } = await import('vue');
  return {
    useTranslation: () => ({ t: (key: string) => key, isBeanieMode: ref(false) }),
  };
});

vi.mock('@/stores/photoStore', () => ({
  usePhotoStore: () => ({
    photos: {
      'photo-1': { id: 'photo-1', driveFileId: 'drive-abcdWXYZ' },
      'photo-2': { id: 'photo-2', driveFileId: 'drive-second' },
    },
    getPublicUrl: getPublicUrlMock,
    markUnresolved: markUnresolvedMock,
  }),
}));

vi.mock('@/stores/milestonesStore', () => ({
  useMilestonesStore: () => ({ safeCategoryFor: () => 'other' }),
}));

const NOW = '2026-11-01T10:00:00.000Z';

function entry(type: string, payload: object, id = `${type}-1`): ScrapbookEntry {
  return {
    id,
    type,
    memberId: 'm-1',
    effectiveDate: NOW,
    createdAt: NOW,
    payload,
  } as unknown as ScrapbookEntry;
}

const saying = entry('saying', {
  id: 'saying-1',
  memberId: 'm-1',
  words: 'I am a dinosaur',
  saidOn: '2026-10-01',
} as Partial<SayingItem>);

const favorite = entry('favorite', {
  id: 'favorite-1',
  memberId: 'm-1',
  category: 'food',
  name: 'Ramen',
  description: 'Extra egg',
} as Partial<FavoriteItem>);

const note = entry('note', {
  id: 'note-1',
  memberId: 'm-1',
  title: 'Shoe size',
  body: 'Size 2 now',
} as Partial<MemberNote>);

function milestone(photoIds?: string[]): ScrapbookEntry {
  return entry('milestone', {
    id: 'milestone-1',
    memberId: 'm-1',
    title: 'First swim',
    occurredOn: '2026-09-12',
    photoIds,
  } as Partial<Milestone>);
}

beforeEach(() => {
  __resetScrapbookImageFailedForTests();
  reportErrorMock.mockReset();
  logEventMock.mockReset();
  markUnresolvedMock.mockReset();
  getPublicUrlMock.mockReset();
  getPublicUrlMock.mockImplementation(
    (id: string, size: string) => `https://lh3.googleusercontent.com/d/${id}=${size}`
  );
});

describe('ScrapbookPiece', () => {
  it('renders a sticky note for a saying', () => {
    const w = mount(ScrapbookPiece, { props: { entry: saying } });
    expect(w.find('.sticky-note').exists()).toBe(true);
    expect(w.text()).toContain('I am a dinosaur');
  });

  it('renders a favorite card with its name and description', () => {
    const w = mount(ScrapbookPiece, { props: { entry: favorite } });
    expect(w.classes()).toContain('rounded-2xl');
    expect(w.text()).toContain('Ramen');
    expect(w.text()).toContain('Extra egg');
  });

  it('renders a ripped note', () => {
    const w = mount(ScrapbookPiece, { props: { entry: note } });
    expect(w.classes()).toContain('scrap-ripped');
    expect(w.text()).toContain('Shoe size');
  });

  it('renders the taped milestone card when the photo is not emphasized', () => {
    const w = mount(ScrapbookPiece, { props: { entry: milestone(['photo-1']) } });
    expect(w.classes()).toContain('scrap-taped');
    expect(w.classes()).not.toContain('emphasized-photo-card');
    expect(w.text()).toContain('First swim');
  });

  it('renders the polaroid at the requested size, read with ignoreUnresolved', () => {
    const w = mount(ScrapbookPiece, {
      props: {
        entry: milestone(['photo-1', 'photo-2']),
        emphasizePhoto: true,
        photoSize: 'screen',
      },
    });
    expect(w.classes()).toContain('emphasized-photo-card');
    expect(getPublicUrlMock).toHaveBeenCalledWith('photo-1', 'screen', { ignoreUnresolved: true });
    expect(w.find('img.emphasized-photo-img').attributes('src')).toContain('photo-1=screen');
    expect(w.text()).toContain('+1');
  });

  it("defaults the polaroid to the 'full' size", () => {
    mount(ScrapbookPiece, { props: { entry: milestone(['photo-1']), emphasizePhoto: true } });
    expect(getPublicUrlMock).toHaveBeenCalledWith('photo-1', 'full', { ignoreUnresolved: true });
  });

  it('falls back to the taped card when the photo cannot be resolved', () => {
    getPublicUrlMock.mockReturnValue(null);
    const w = mount(ScrapbookPiece, {
      props: { entry: milestone(['photo-1']), emphasizePhoto: true },
    });
    expect(w.classes()).not.toContain('emphasized-photo-card');
    expect(w.classes()).toContain('scrap-taped');
  });

  it('falls back to the taped text card on an image error and logs once', async () => {
    const w = mount(ScrapbookPiece, {
      props: { entry: milestone(['photo-1']), emphasizePhoto: true },
    });
    await w.find('img.emphasized-photo-img').trigger('error');

    expect(w.classes()).not.toContain('emphasized-photo-card');
    expect(w.classes()).toContain('scrap-taped');
    expect(w.text()).toContain('First swim');
    // The fallback's thumb is opted in to the resilient read, and its failure is the same photo.
    expect(getPublicUrlMock).toHaveBeenCalledWith('photo-1', 'thumb', { ignoreUnresolved: true });
    await w.find('img').trigger('error');

    const failures = logEventMock.mock.calls.filter(
      ([e]) => (e as { message: string }).message === 'scrapbook_image_failed'
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]![0]).toMatchObject({
      level: 'warn',
      surface: 'scrapbook',
      context: { file_id_tail: '…WXYZ', online: expect.any(Boolean) },
    });
    expect(markUnresolvedMock).not.toHaveBeenCalled();
  });

  it('reports an unknown type once and renders only a hidden span', () => {
    const w = mount(ScrapbookPiece, { props: { entry: entry('mystery', {}, 'x-1') } });
    expect(w.element.tagName).toBe('SPAN');
    expect(w.attributes('hidden')).toBeDefined();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
  });

  it('muted text: no opacity modifier on readable text, nothing below text-xs', () => {
    const pieces = [
      mount(ScrapbookPiece, { props: { entry: favorite } }),
      mount(ScrapbookPiece, { props: { entry: note } }),
      mount(ScrapbookPiece, { props: { entry: milestone(['photo-1']) } }),
      mount(ScrapbookPiece, {
        props: { entry: milestone(['photo-1', 'photo-2']), emphasizePhoto: true },
      }),
    ];
    for (const w of pieces) {
      const html = w.html();
      expect(html).not.toMatch(/\btext-(primary|secondary)-\d+\/\d+/);
      expect(html).not.toMatch(/text-\[0\.\d+rem\]/);
    }
  });

  it('only lifts on hover when interactive', () => {
    expect(mount(ScrapbookPiece, { props: { entry: note } }).classes()).not.toContain(
      'hover:scale-[1.02]'
    );
    expect(
      mount(ScrapbookPiece, { props: { entry: note, interactive: true } }).classes()
    ).toContain('hover:scale-[1.02]');
  });
});

describe('ScrapbookEntryCard', () => {
  it('wraps the piece in a button that emits the entry and makes it interactive', async () => {
    const w = mount(ScrapbookEntryCard, { props: { entry: favorite } });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.find('.rounded-2xl').classes()).toContain('hover:scale-[1.02]');
    await w.trigger('click');
    expect(w.emitted('click')?.[0]).toEqual([favorite]);
  });

  it('does not lift the sticky saying', () => {
    const w = mount(ScrapbookEntryCard, { props: { entry: saying } });
    expect(w.html()).not.toContain('hover:scale-[1.02]');
  });

  it('renders no button for an unknown type', () => {
    const w = mount(ScrapbookEntryCard, { props: { entry: entry('mystery', {}, 'x-2') } });
    expect(w.element.tagName).toBe('SPAN');
    expect(w.find('button').exists()).toBe(false);
  });
});
