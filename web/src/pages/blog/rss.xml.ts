import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { SITE_URL } from '@beanies/brand/nav';

export async function GET(context: APIContext) {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime()
  );

  return rss({
    title: 'the beanstalk — beanies.family',
    description: 'stories, updates, and philosophy from the making of beanies.family',
    site: context.site ?? SITE_URL,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.excerpt,
      link: `/blog/${post.data.slug}`,
      author: post.data.author,
    })),
    customData: '<language>en-us</language>',
  });
}
