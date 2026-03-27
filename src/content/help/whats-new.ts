/**
 * What's New — help center articles auto-generated from release notes.
 *
 * Each ReleaseNote produces one HelpArticle. Content is the `en` text
 * (help center is not beanie-mode aware — it uses standard English).
 */

import type { HelpArticle, ArticleSection } from './types';
import { getAllReleaseNotes, type ReleaseNote } from '@/content/release-notes';

function releaseNoteToArticle(note: ReleaseNote): HelpArticle {
  const sections: ArticleSection[] = [];

  // Opening paragraph — what changed and why it matters
  sections.push({
    type: 'paragraph',
    content: `Here's what's new in beanies.family for <strong>${note.month}</strong> — features to help your family plan, track, and stay organised.`,
  });

  // Features
  if (note.features.length > 0) {
    sections.push({ type: 'heading', content: 'New features', level: 2, id: 'features' });
    for (const f of note.features) {
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

  return {
    slug: note.version.replace('.', '-'), // '2026.03' → '2026-03'
    category: 'whats-new',
    title: `What's New — ${note.month}`,
    excerpt: note.features
      .slice(0, 3)
      .map((f) => f.title.en)
      .join(', '),
    icon: '\u{1F331}',
    readTime: 2,
    updatedDate: note.date,
    sections,
  };
}

export const WHATS_NEW_ARTICLES: HelpArticle[] = getAllReleaseNotes().map(releaseNoteToArticle);
