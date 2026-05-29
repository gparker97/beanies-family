import { describe, it, expect, vi } from 'vitest';
import type { AppNotification } from '@/types/notifications';
import type { ReleaseNote } from '@/content/release-notes';
import type { BeanTip } from '@/content/tips';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
// txt picks the beanie variant — so a resolved summary is distinguishable from
// the generic fallback in the assertions below.
vi.mock('@/composables/useBeanieText', () => ({
  useBeanieText: () => ({ txt: (v: { en: string; beanie: string }) => v.beanie }),
}));

const releases: Record<string, ReleaseNote> = {
  '2026.05.27': {
    version: '2026.05.27',
    date: '2026-05-27',
    month: '27 may 2026',
    summary: { en: 'EN line', beanie: 'beanie line' },
  },
  '2026.04': {
    version: '2026.04',
    date: '2026-04-15',
    month: 'april 2026',
    features: [{ title: { en: 'f', beanie: 'f' }, description: { en: 'd', beanie: 'd' } }],
  },
};
vi.mock('@/content/release-notes', () => ({ getReleaseNote: (v: string) => releases[v] }));

const tips: Record<string, BeanTip> = {
  'tip-link-txn': {
    id: 'tip-link-txn',
    category: 'finance',
    tryItRoute: '/transactions',
    message: { en: 'EN tip line', beanie: 'beanie tip line' },
  },
};
vi.mock('@/content/tips', async () => {
  const actual = await vi.importActual<typeof import('@/content/tips')>('@/content/tips');
  return { ...actual, getTip: (id: string) => tips[id] };
});

import { useNotificationPresentation } from '@/composables/useNotificationPresentation';

const whatsNew = (sourceId: string): AppNotification => ({
  id: `whats-new:${sourceId}`,
  kind: 'whats-new',
  title: 'april 2026', // the deriver sets title = release.month
  occurredAt: '2026-05-27T00:00:00.000Z',
  sourceId,
  read: false,
});

const tipNote = (sourceId: string): AppNotification => ({
  id: `tip:${sourceId}`,
  kind: 'tip',
  title: sourceId, // the deriver sets title = tip.id; resolved by the composable
  occurredAt: '2026-05-27T09:00:00.000Z',
  sourceId,
  read: false,
});

describe('useNotificationPresentation — whats-new summary', () => {
  it('brief per-deploy note: summary = the authored release summary (beanie/en switched)', () => {
    const { summary, hasRichBody } = useNotificationPresentation(() => whatsNew('2026.05.27'));
    expect(summary.value).toBe('beanie line');
    expect(hasRichBody.value).toBe(true); // still rendered via WhatsNewBody
  });

  it('curated release (no summary): summary falls back to the kind summary (the month)', () => {
    const { summary } = useNotificationPresentation(() => whatsNew('2026.04'));
    expect(summary.value).toBe('april 2026');
  });
});

describe('useNotificationPresentation — tip summary', () => {
  it('resolves the bilingual tip line via txt(tip.message)', () => {
    const { summary, tip, hasRichBody } = useNotificationPresentation(() =>
      tipNote('tip-link-txn')
    );
    expect(tip.value?.id).toBe('tip-link-txn');
    expect(summary.value).toBe('beanie tip line');
    expect(hasRichBody.value).toBe(true); // routes the drawer to TipBody
  });

  it('missing tip (removed from catalogue): tip undefined, summary empty, no rich body', () => {
    const { summary, tip, hasRichBody } = useNotificationPresentation(() => tipNote('tip-gone'));
    expect(tip.value).toBeUndefined();
    expect(summary.value).toBe(''); // notificationSummary returns '' for tip kind
    expect(hasRichBody.value).toBe(false);
  });
});
