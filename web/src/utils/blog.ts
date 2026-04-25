/**
 * Beanstalk blog helpers — issue numbers, per-edition tints, reading time.
 *
 * Shared between `/blog` (the masthead/issue grid) and `/blog/[slug]`
 * (each issue's detail page) so the per-issue tint a reader sees on the
 * index carries forward into the post they click into.
 */

import type { CollectionEntry } from 'astro:content';

export type IssueTint = {
  name: 'orange' | 'terracotta' | 'sky' | 'kraft' | 'slate';
  hex: string;
  wash: string;
  accentOn: string;
  ink: string;
};

/**
 * Per-issue tint rotation. Each post gets one of five brand-palette
 * washes assigned by chronological position, so /blog reads as a
 * series of distinct editions and each post detail page inherits the
 * same edition color from the index card the reader clicked.
 */
export const TINTS: IssueTint[] = [
  {
    name: 'orange',
    hex: '#f15d22',
    wash: 'linear-gradient(140deg, #fff6ef 0%, #ffe9d6 100%)',
    accentOn: 'rgb(241 93 34 / 18%)',
    ink: '#a83a11',
  },
  {
    name: 'terracotta',
    hex: '#c76a21',
    wash: 'linear-gradient(140deg, #fff5e8 0%, #f5e1c2 100%)',
    accentOn: 'rgb(199 106 33 / 22%)',
    ink: '#7d420f',
  },
  {
    name: 'sky',
    hex: '#3a82b3',
    wash: 'linear-gradient(140deg, #f1f8fd 0%, #dceaf6 100%)',
    accentOn: 'rgb(58 130 179 / 22%)',
    ink: '#1f4d6d',
  },
  {
    name: 'kraft',
    hex: '#b58a2a',
    wash: 'linear-gradient(140deg, #fbf6e8 0%, #f3e4bc 100%)',
    accentOn: 'rgb(181 138 42 / 22%)',
    ink: '#6c4f15',
  },
  {
    name: 'slate',
    hex: '#2c3e50',
    wash: 'linear-gradient(140deg, #f2f4f7 0%, #dde3ec 100%)',
    accentOn: 'rgb(44 62 80 / 20%)',
    ink: '#1a2533',
  },
];

/** Pick the tint for a given issue number. Cycles through the 5-tint set. */
export function tintFor(issueNumber: number): IssueTint {
  return TINTS[(issueNumber - 1) % TINTS.length]!;
}

/**
 * Build a slug → issue-number map from a blog collection. Issue 01 is the
 * oldest published post; issues stay stable as new posts land at the top.
 */
export function buildIssueMap(posts: CollectionEntry<'blog'>[]): Map<string, number> {
  const sorted = [...posts].sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
  const map = new Map<string, number>();
  sorted.forEach((p, i) => map.set(p.data.slug, i + 1));
  return map;
}

/**
 * Estimate reading time in minutes from a markdown body string.
 * Standard 200 wpm, floor of 1 minute. Strips markdown markers crudely
 * (good enough for an editorial estimate; not exact).
 */
export function readingMinutes(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → keep visible text
    .replace(/[#>*_~`]/g, ' '); // markdown punctuation
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(wordCount / 200));
}

/** Format a date as the issue stamp used in the masthead + post kicker. */
export function fmtIssueStamp(d: Date): string {
  return d
    .toLocaleDateString('en-US', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();
}

/** Zero-pad an issue number to 2 digits — "issue 04" not "issue 4". */
export function padIssue(n: number): string {
  return n.toString().padStart(2, '0');
}
