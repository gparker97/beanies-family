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
    /** Optional. Set when a post has been substantively edited after publish.
     *  Byline renders "last updated" and BlogPosting JSON-LD uses it for
     *  `dateModified`. If unset, JSON-LD falls back to the original `date`. */
    updatedDate: z.coerce.date().optional(),
    /** When true, the entry is hidden from production builds (list pages,
     *  sitemap, RSS, direct URL). Visible in `npm run dev:web` so drafts
     *  can be iterated locally. See `isPublished()` in utils/content.ts. */
    draft: z.boolean().default(false),
  }),
});

/**
 * Guides collection — evergreen pillar pages (reference material).
 *
 * Distinct from blog posts by design:
 * - Undated, authoritative, updated-in-place (not archived)
 * - Lives at /guides/<slug>, NOT in the RSS feed, NOT syndicated to Substack
 * - Aimed at comprehensive topic coverage + long-tail search + AI-citation
 * - Blog posts act as spokes that link into matching pillars
 *
 * Files in content/guides/*.md are picked up automatically.
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: '../content/guides' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    excerpt: z.string(),
    heroEmoji: z.string().optional(),
    publishedDate: z.coerce.date(),
    lastUpdated: z.coerce.date(),
    /** Blog post slugs that act as spokes for this pillar — rendered in "further reading". */
    relatedPosts: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    /** When true, the entry is hidden from production builds (list pages,
     *  sitemap, direct URL). Visible in `npm run dev:web` so drafts can
     *  be iterated locally. See `isPublished()` in utils/content.ts. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, guides };
