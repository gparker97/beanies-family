/**
 * Link-preview cards for beanstalk posts (1200x630), built at build time.
 * URL pattern: /og/<slug>.jpg (the earlier generator wrote .png; the new extension also makes
 * platforms that cached an old card fetch the new one).
 *
 * A post with a cover image gets the composed card from `~/lib/postCard`. A post without one
 * (or whose cover file is missing) gets the site-wide hugging-family card, so a link never
 * previews as a broken image.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '~/utils/content';
import sharp from 'sharp';
import { renderPostCard } from '~/lib/postCard';

const PUBLIC_DIR = path.resolve('public');
const DEFAULT_CARD = path.join(PUBLIC_DIR, 'brand/og-default.png');

interface CardProps {
  title: string;
  category: string;
  coverImage?: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('blog', isPublished);
  return posts.map((post) => ({
    params: { slug: `${post.data.slug}.jpg` },
    props: {
      title: post.data.title,
      category: post.data.category,
      coverImage: post.data.coverImage,
    } satisfies CardProps,
  }));
};

export const GET: APIRoute = async ({ props, params }) => {
  const { title, category, coverImage } = props as CardProps;
  // A cover is a file under `public/` named by our own frontmatter; anything that resolves
  // outside it is treated as no cover.
  const resolved = coverImage ? path.join(PUBLIC_DIR, coverImage) : '';
  const coverPath = resolved.startsWith(PUBLIC_DIR + path.sep) ? resolved : '';
  let body: Buffer;
  // Build-time only, and confined to `public/` above: not a request-controlled path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (coverPath && existsSync(coverPath)) {
    body = await renderPostCard({ title, category, coverPath });
  } else {
    if (coverImage) {
      console.warn(`[og] ${params.slug}: cover ${coverImage} not found, using the default card`);
    }
    body = await sharp(await readFile(DEFAULT_CARD))
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/jpeg' } });
};
