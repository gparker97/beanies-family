// Rehype plugin: let a markdown image opt into the wide treatment by giving
// it the title "wide":
//
//   ![alt text](/blog/some-showcase.webp "wide")
//
// The title is consumed (it would otherwise show as a tooltip reading
// "wide") and the image gets `class="is-wide"`, which the blog prose styles
// break out of the text column so a detailed showcase (phone screens,
// widgets) is large enough to read. Every other image keeps the narrower
// illustration cap.
//
// Why a title rather than a class: markdown has no syntax for a class on an
// image, and the title is the one attribute it does carry.

import { visit } from 'unist-util-visit';

export default function rehypeWideImages() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'img' || node.properties?.title !== 'wide') return;
      delete node.properties.title;
      const classes = node.properties.className ?? [];
      if (!classes.includes('is-wide')) node.properties.className = [...classes, 'is-wide'];
    });
  };
}
