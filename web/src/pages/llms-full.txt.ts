/**
 * llms-full.txt — concatenated public content for LLM context windows.
 * Regenerated on every build. Single source of truth: same content
 * collections the HTML pages consume.
 */

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { ALL_ARTICLES, getArticleSearchText, HELP_CATEGORIES } from '@/content/help';
import { SITE_URL } from '@beanies/brand/nav';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );

  const lines: string[] = [];
  lines.push('# beanies.family — full public content');
  lines.push('');
  lines.push(
    'This file concatenates all blog posts and help articles into a single LLM-friendly document.'
  );
  lines.push(`Source: ${SITE_URL}`);
  lines.push(`Generated at build time.`);
  lines.push('');

  lines.push('---');
  lines.push('# blog (the beanstalk)');
  lines.push('');
  for (const post of posts) {
    lines.push(`## ${post.data.title}`);
    lines.push('');
    lines.push(`URL: ${SITE_URL}/blog/${post.data.slug}`);
    lines.push(`Date: ${post.data.date.toISOString().slice(0, 10)}`);
    lines.push(`Author: ${post.data.author}`);
    lines.push('');
    lines.push(post.body ?? '');
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('# help center');
  lines.push('');
  for (const cat of HELP_CATEGORIES) {
    const inCat = ALL_ARTICLES.filter((a) => a.category === cat.id);
    if (inCat.length === 0) continue;
    lines.push(`## ${cat.id.replace(/-/g, ' ')}`);
    lines.push('');
    for (const article of inCat) {
      lines.push(`### ${article.title}`);
      lines.push('');
      lines.push(`URL: ${SITE_URL}/help/${article.category}/${article.slug}`);
      lines.push(`Updated: ${article.updatedDate}`);
      lines.push('');
      lines.push(article.excerpt);
      lines.push('');
      lines.push(getArticleSearchText(article));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
