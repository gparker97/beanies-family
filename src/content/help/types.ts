export type HelpCategory =
  | 'whats-new'
  | 'getting-started'
  | 'features'
  | 'security'
  | 'how-it-works';

export type SectionType =
  | 'heading'
  | 'paragraph'
  | 'callout'
  | 'infoBox'
  | 'codeBlock'
  | 'list'
  | 'steps';

export interface ArticleSection {
  type: SectionType;
  /** Main text content. Supports inline HTML (<strong>, <em>, <code>). */
  content: string;
  /** Title for callout/infoBox sections */
  title?: string;
  /** Emoji icon for callout/infoBox */
  icon?: string;
  /** Heading level (2 or 3) */
  level?: 2 | 3;
  /** List/steps items */
  items?: string[];
  /** Whether list is ordered */
  ordered?: boolean;
  /** Heading anchor ID for TOC links */
  id?: string;
}

export interface HelpArticle {
  slug: string;
  category: HelpCategory;
  title: string;
  excerpt: string;
  icon: string;
  readTime: number;
  sections: ArticleSection[];
  popular?: boolean;
  updatedDate: string;
}

export interface HelpCategoryMeta {
  id: HelpCategory;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  color: string;
}
