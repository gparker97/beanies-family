/**
 * Build-time help-search index — emitted as a static JSON file at `/help-index.json`.
 * Fetched lazily by the HelpSearch island on the /help page.
 *
 * Single source of truth: the shared help content modules at `@/content/help`.
 * No content duplication.
 */

import type { APIRoute } from 'astro';
import { ALL_ARTICLES, getArticleSearchText } from '@/content/help';

export const GET: APIRoute = () => {
  const docs = ALL_ARTICLES.map((a) => ({
    id: `${a.category}/${a.slug}`,
    title: a.title,
    excerpt: a.excerpt,
    category: a.category,
    slug: a.slug,
    text: getArticleSearchText(a),
  }));

  return new Response(JSON.stringify(docs), {
    headers: { 'content-type': 'application/json' },
  });
};
