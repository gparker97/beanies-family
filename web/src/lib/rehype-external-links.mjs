/**
 * Rehype plugin — make every link in prose open in a new tab.
 *
 * Applies to all markdown-rendered content (blog + guides). Long-form readers
 * shouldn't lose their place when they click a citation or cross-reference.
 *
 * Scope:
 *   - All <a> with href → target="_blank" + rel="noopener noreferrer"
 *   - Skip in-page anchors (href starts with "#") — those scroll within the
 *     current page and should not spawn a new tab.
 *   - Skip <a> with no href (malformed anchors).
 *
 * Preserves any existing rel tokens; de-duplicates.
 */
export default function rehypeExternalLinks() {
  return (tree) => {
    visit(tree);
  };
}

function visit(node) {
  if (!node) return;
  if (node.type === 'element' && node.tagName === 'a') {
    const href = node.properties?.href;
    if (typeof href === 'string' && href.length > 0 && !href.startsWith('#')) {
      node.properties ??= {};
      node.properties.target = '_blank';
      node.properties.rel = mergeRel(node.properties.rel, ['noopener', 'noreferrer']);
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) visit(child);
  }
}

function mergeRel(existing, add) {
  const tokens = new Set();
  if (Array.isArray(existing)) {
    for (const t of existing) tokens.add(t);
  } else if (typeof existing === 'string' && existing.length > 0) {
    for (const t of existing.split(/\s+/)) tokens.add(t);
  }
  for (const t of add) tokens.add(t);
  return Array.from(tokens);
}
