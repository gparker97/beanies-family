/**
 * Rehype plugin — annotate guide prose with class hooks so the CSS can style
 * structural patterns that live in the markdown source.
 *
 * What it does:
 *
 * 1. Short-answer blocks — paragraphs whose first child is `<strong>short
 *    answer:</strong>` get `class="guide-short-answer"` on the <p> and
 *    `class="guide-short-answer-label"` on the <strong>. CSS turns these
 *    into the distinctive "TL;DR" answer cards without restructuring the DOM
 *    (so AIO crawlers still read a <p><strong>short answer:</strong> ...</p>
 *    just as before).
 *
 * 2. First-paragraph-after-H2 drop-cap — the first <p> after every <h2> gets
 *    `class="guide-lead"` so ::first-letter can style a drop-cap without
 *    hitting every paragraph in the body.
 *
 * No DOM restructuring; no text insertion; no hidden content. Crawlers see
 * identical semantic HTML. CSS handles presentation.
 */

function addClass(node, cls) {
  node.properties ??= {};
  const existing = node.properties.className;
  if (Array.isArray(existing)) {
    if (!existing.includes(cls)) existing.push(cls);
  } else if (typeof existing === 'string' && existing.length > 0) {
    node.properties.className = existing.split(/\s+/).concat(cls);
  } else {
    node.properties.className = [cls];
  }
}

function elementChild(node) {
  return node.children?.find((c) => c.type === 'element');
}

function textOf(node) {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.children) return node.children.map(textOf).join('');
  return '';
}

export default function rehypeGuideAnnotations() {
  return (tree) => {
    if (!tree.children) return;

    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];
      if (node.type !== 'element') continue;

      // 1. Short-answer detection.
      if (node.tagName === 'p') {
        const first = elementChild(node);
        if (first && first.tagName === 'strong') {
          const text = textOf(first).trim().toLowerCase();
          if (text === 'short answer:' || text === 'short answer') {
            addClass(node, 'guide-short-answer');
            addClass(first, 'guide-short-answer-label');
          }
        }
      }

      // 2. Lead paragraph = first <p> after each <h2>.
      if (node.tagName === 'h2') {
        for (let j = i + 1; j < tree.children.length; j++) {
          const next = tree.children[j];
          if (next.type !== 'element') continue;
          if (next.tagName === 'h2' || next.tagName === 'h3') break;
          if (next.tagName === 'p') {
            // Skip the short-answer paragraph — the "lead" is the first
            // narrative paragraph after the answer block.
            const first = elementChild(next);
            const isShortAnswer =
              first && first.tagName === 'strong' && /^short answer:?$/i.test(textOf(first).trim());
            if (!isShortAnswer) {
              addClass(next, 'guide-lead');
              break;
            }
          }
        }
      }
    }
  };
}
