import { ref, watch, type Ref } from 'vue';
import { ALL_ARTICLES, getArticleSearchText, type HelpArticle } from '@/content/help';

/**
 * Composable for searching help articles.
 * Debounced, case-insensitive search across title, excerpt, and section content.
 * Title matches are ranked first.
 */
export function useHelpSearch(query: Ref<string>) {
  const results = ref<HelpArticle[]>([]);
  const hasQuery = ref(false);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  // Pre-compute search text for each article
  const searchIndex = ALL_ARTICLES.map((article) => ({
    article,
    text: getArticleSearchText(article).toLowerCase(),
    title: article.title.toLowerCase(),
  }));

  watch(query, (q) => {
    clearTimeout(timeout);
    const trimmed = q.trim();
    hasQuery.value = trimmed.length > 0;

    if (!trimmed) {
      results.value = [];
      return;
    }

    timeout = setTimeout(() => {
      const lower = trimmed.toLowerCase();
      const titleMatches: HelpArticle[] = [];
      const bodyMatches: HelpArticle[] = [];

      for (const entry of searchIndex) {
        if (entry.title.includes(lower)) {
          titleMatches.push(entry.article);
        } else if (entry.text.includes(lower)) {
          bodyMatches.push(entry.article);
        }
      }

      results.value = [...titleMatches, ...bodyMatches];
    }, 200);
  });

  return { results, hasQuery };
}
