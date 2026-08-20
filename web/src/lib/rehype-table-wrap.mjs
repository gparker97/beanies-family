// Rehype plugin: wrap every markdown <table> in a
// `<div class="table-scroll">` so wide comparison tables scroll inside
// their own box instead of forcing the whole page to scroll sideways.
//
// Why a plugin rather than CSS: making the <table> itself the scroll
// container needs `display: block`, which destroys the table formatting
// context — column widths stop aligning between header and body. The only
// way to keep real table layout AND bound the width is an actual wrapper
// element, and markdown gives us no way to author one.
//
// The wrapper is also the hook for the fade hint on the right edge (see
// `.table-scroll` in blog/[...slug].astro and guides/[...slug].astro).

import { visit } from 'unist-util-visit';

export default function rehypeTableWrap() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || !parent || index === undefined) return;
      // Already wrapped (idempotent — the plugin may run over cached trees).
      if (parent.type === 'element' && parent.properties?.className?.includes?.('table-scroll')) {
        return;
      }
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-scroll'], role: 'region', tabIndex: 0 },
        children: [node],
      };
      // Skip re-visiting the node we just moved.
      return ['skip'];
    });
  };
}
