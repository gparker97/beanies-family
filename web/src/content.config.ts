import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Blog collection — reads from the repo-level `content/blog/` directory.
 * This is the original location; keeping it there (vs moving into the Astro
 * project) avoids a needless file move and keeps blog authoring friction low.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../content/blog' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    date: z.coerce.date(),
    category: z.string(),
    coverEmoji: z.string().optional(),
    coverImage: z.string().optional(),
    excerpt: z.string(),
    featured: z.boolean().default(false),
    author: z.string().default('greg'),
  }),
});

export const collections = { blog };
