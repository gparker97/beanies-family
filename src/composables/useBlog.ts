import { computed } from 'vue';
import { marked } from 'marked';

export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  category: string;
  coverEmoji: string;
  excerpt: string;
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

const allPosts: BlogPost[] = Object.entries(modules)
  .map(([path, raw]) => {
    const { meta, body } = parseFrontmatter(raw as string);
    return {
      slug: meta.slug || path.replace(/.*\//, '').replace('.md', ''),
      title: meta.title || 'Untitled',
      date: meta.date || '',
      category: meta.category || 'general',
      coverEmoji: meta.coverEmoji || '📝',
      excerpt: meta.excerpt || '',
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
