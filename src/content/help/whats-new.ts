/**
 * What's New — help center articles auto-generated from release notes.
 *
 * Each ReleaseNote produces one HelpArticle. Content is the `en` text
 * (help center is not beanie-mode aware — it uses standard English).
 */

import type { HelpArticle, ArticleSection } from './types';
import { getAllReleaseNotes, isSpotlightRelease, type ReleaseNote } from '@/content/release-notes';

function releaseNoteToArticle(note: ReleaseNote): HelpArticle {
  const sections: ArticleSection[] = [];
  const features = note.features ?? [];

  // Opening paragraph — what changed and why it matters
  sections.push({
    type: 'paragraph',
    content: `Here's what's new in beanies.family for <strong>${note.month}</strong> — improvements to help your family plan, track, and stay organised.`,
  });

  // Brief per-deploy note — the authored one-liner
  if (note.summary) {
    sections.push({ type: 'paragraph', content: note.summary.en });
  }

  // Features
  if (features.length > 0) {
    sections.push({ type: 'heading', content: 'New features', level: 2, id: 'features' });
    for (const f of features) {
      sections.push({
        type: 'heading',
        content: f.title.en,
        level: 3,
        id: f.title.en.replace(/\s+/g, '-').toLowerCase(),
      });
      sections.push({ type: 'paragraph', content: f.description.en });
    }
  }

  // Fixes
  if (note.fixes && note.fixes.length > 0) {
    sections.push({ type: 'heading', content: 'Also fixed', level: 2, id: 'fixes' });
    sections.push({
      type: 'list',
      content: '',
      items: note.fixes.map((f) => f.text.en),
    });
  }

  const excerpt = features.length
    ? features
        .slice(0, 3)
        .map((f) => f.title.en)
        .join(', ')
    : (note.summary?.en ?? `Updates for ${note.month}`);

  return {
    slug: note.version.replace(/\./g, '-'), // '2026.03' → '2026-03', '2026.05.27' → '2026-05-27'
    category: 'whats-new',
    title: `What's New — ${note.month}`,
    excerpt,
    icon: '✨',
    readTime: 2,
    updatedDate: note.date,
    sections,
  };
}

// Only the significant (spotlight) releases become standalone help articles —
// the steady stream of brief per-deploy notes lives in the notification bell,
// not as a "what's new" article each. Keeps this a curated highlights view.
export const WHATS_NEW_ARTICLES: HelpArticle[] = getAllReleaseNotes()
  .filter(isSpotlightRelease)
  .map(releaseNoteToArticle);
