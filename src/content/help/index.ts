import type { HelpArticle, HelpCategory } from './types';
import { WHATS_NEW_ARTICLES } from './whats-new';
import { GETTING_STARTED_ARTICLES } from './getting-started';
import { FEATURES_ARTICLES } from './features';
import { SECURITY_ARTICLES } from './security';
import { HOW_IT_WORKS_ARTICLES } from './how-it-works';

export type {
  HelpArticle,
  HelpCategory,
  HelpCategoryMeta,
  ArticleSection,
  SectionType,
} from './types';
export { HELP_CATEGORIES, getCategoryMeta } from './categories';

/** All help articles, ordered by category then position. */
export const ALL_ARTICLES: HelpArticle[] = [
  ...WHATS_NEW_ARTICLES,
  ...GETTING_STARTED_ARTICLES,
  ...FEATURES_ARTICLES,
  ...SECURITY_ARTICLES,
  ...HOW_IT_WORKS_ARTICLES,
];

/** Get a single article by category + slug. */
export function getArticle(category: string, slug: string): HelpArticle | undefined {
  return ALL_ARTICLES.find((a) => a.category === category && a.slug === slug);
}

/** Get articles for a specific category. */
export function getCategoryArticles(category: HelpCategory): HelpArticle[] {
  return ALL_ARTICLES.filter((a) => a.category === category);
}

/** Get articles marked as popular. */
export function getPopularArticles(): HelpArticle[] {
  return ALL_ARTICLES.filter((a) => a.popular);
}

/**
 * Flatten an article into plain search text.
 * Used for client-side search and LLM prompt generation.
 */
export function getArticleSearchText(article: HelpArticle): string {
  const categoryName = article.category.replace(/-/g, ' ');
  const parts: string[] = [article.title, article.excerpt, categoryName];
  for (const section of article.sections) {
    if (section.content) parts.push(section.content);
    if (section.title) parts.push(section.title);
    if (section.items) parts.push(...section.items);
  }
  // Strip inline HTML tags for clean search text
  return parts.join(' ').replace(/<[^>]+>/g, '');
}
