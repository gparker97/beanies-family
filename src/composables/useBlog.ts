import { computed } from 'vue';
import { marked } from 'marked';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  category: string;
  coverEmoji: string;
  coverImage?: string;
  excerpt: string;
  subtitle?: string;
  /** 1-based index in chronological order (oldest = 1). Drives per-post
   *  tint cycling + "issue N" labelling on the beanstalk index. */
  issueNumber: number;
  featured: boolean;
  author: string;
  content: string; // raw markdown body
  html: string; // parsed HTML
}

/** Parse frontmatter + body from raw markdown string */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      meta[key] = value;
    }
  }
  return { meta, body: match[2]! };
}

// Load all markdown files at build time via Vite glob import
const modules = import.meta.glob('/content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Map each slug to an issue number (1-based by chronological order:
// oldest = Issue 01). Computed once across ALL posts before filtering/
// sorting, so numbers stay stable regardless of display order.
const chronological = Object.entries(modules)
  .map(([path, raw]) => {
    const { meta } = parseFrontmatter(raw as string);
    return {
      slug: meta.slug || path.replace(/.*\//, '').replace('.md', ''),
      date: meta.date || '',
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));
const issueNumberBySlug = new Map<string, number>(chronological.map((p, i) => [p.slug, i + 1]));

const allPosts: BlogPost[] = Object.entries(modules)
  .map(([path, raw]) => {
    const { meta, body } = parseFrontmatter(raw as string);
    const slug = meta.slug || path.replace(/.*\//, '').replace('.md', '');
    return {
      slug,
      title: meta.title || 'Untitled',
      date: meta.date || '',
      category: meta.category || 'general',
      coverEmoji: meta.coverEmoji || '📝',
      coverImage: meta.coverImage || undefined,
      excerpt: meta.excerpt || '',
      subtitle: meta.subtitle || undefined,
      issueNumber: issueNumberBySlug.get(slug) ?? 1,
      featured: meta.featured === 'true',
      author: meta.author || 'The Beanies Team',
      content: body,
      html: marked.parse(body, { async: false }) as string,
    };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

export function useBlog() {
  const posts = computed(() => allPosts);

  const featuredPost = computed(() => allPosts.find((p) => p.featured) || allPosts[0]);

  const regularPosts = computed(() => allPosts.filter((p) => p !== featuredPost.value));

  function getPostBySlug(slug: string): BlogPost | undefined {
    return allPosts.find((p) => p.slug === slug);
  }

  return { posts, featuredPost, regularPosts, getPostBySlug };
}

export const BLOG_CATEGORIES: { id: string; label: string; emoji: string }[] = [
  { id: 'updates', label: 'Updates', emoji: '🌱' },
  { id: 'money', label: 'Money', emoji: '💰' },
  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
  { id: 'travel', label: 'Travel', emoji: '✈️' },
  { id: 'tips', label: 'Tips', emoji: '💡' },
];
