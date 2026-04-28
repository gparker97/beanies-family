// Rehype plugin: probe each markdown <img>'s `src` from `web/public/` at
// build time and add `width` + `height` attributes (plus `loading="lazy"`
// + `decoding="async"`) so the browser reserves space before the image
// loads — eliminates layout shift and resolves Lighthouse's
// `unsized-images` and `uses-responsive-images` audits for content
// images. Runs only on root-relative paths starting with "/" (skips
// remote URLs and data: URIs).
//
// Uses `sharp` — already a dev dep for Astro's image pipeline — so no
// new install. Failures (file missing, format not supported) log a
// `[rehype-image-dims]` warning and leave the node untouched.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { visit } from 'unist-util-visit';

const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

// Cache size lookups across the whole build so we don't re-decode the
// same screenshot once per page that references it.
const cache = new Map();

async function getDims(src) {
  if (cache.has(src)) return cache.get(src);
  // path.join with a fixed PUBLIC_DIR prefix and a markdown-author-controlled
  // image src; runs at build time only, never on user input. The
  // security/detect-non-literal-fs-filename rule's threat model (untrusted
  // runtime input) does not apply.
  const filePath = path.join(PUBLIC_DIR, src);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(filePath)) {
    console.warn(`[rehype-image-dims] image not found at ${filePath}`);
    cache.set(src, null);
    return null;
  }
  try {
    // Same justification as existsSync above — build-time only, fixed-prefix path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) {
      console.warn(`[rehype-image-dims] no dimensions for ${src}`);
      cache.set(src, null);
      return null;
    }
    const dims = { width: meta.width, height: meta.height };
    cache.set(src, dims);
    return dims;
  } catch (err) {
    console.warn(`[rehype-image-dims] sharp failed for ${src}:`, err);
    cache.set(src, null);
    return null;
  }
}

export default function rehypeImageDims() {
  return async (tree) => {
    const tasks = [];
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img') return;
      const props = node.properties ?? {};
      const src = typeof props.src === 'string' ? props.src : null;
      if (!src || !src.startsWith('/')) return;
      // Skip if author already supplied dimensions explicitly.
      if (props.width || props.height) return;
      tasks.push(
        getDims(src).then((dims) => {
          if (!dims) return;
          props.width = dims.width;
          props.height = dims.height;
          if (!props.loading) props.loading = 'lazy';
          if (!props.decoding) props.decoding = 'async';
          node.properties = props;
        })
      );
    });
    await Promise.all(tasks);
  };
}
