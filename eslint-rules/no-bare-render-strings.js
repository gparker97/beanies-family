/**
 * Custom ESLint rule: no-bare-render-strings
 *
 * Closes the `.ts` i18n blind spot that `vue/no-bare-strings-in-template`
 * cannot see. That rule only scans `.vue` templates, so user-facing English
 * baked into `.ts` data sources — `label`/`title`/`name` literals in
 * `constants/*` and `composables/*` that get rendered verbatim — slips through
 * untranslated (this is exactly how the travel-segment + transaction-category
 * labels shipped as bare English). See docs/TRANSLATION.md § Enforcement.
 *
 * The rule flags string literals assigned to display-bound keys when the value
 * looks like natural-language UI text. It deliberately does NOT flag:
 *   - translation keys (anything containing a `.`, e.g. 'planner.deleteActivity')
 *   - code identifiers (camelCase, e.g. 'useBeanTips', 'demoStore')
 *   - acronyms / all-caps tokens (no lowercase letter, e.g. 'IRA', 'PDF', 'QR')
 *   - `<expr> as UIStringKey` casts (the value is a key, not a phrase)
 *   - configured allowlist entries (brand + third-party product names)
 *
 * Fix a flag by routing the value through `t()` (add the key to uiStrings.ts
 * and resolve at the render site, as `useCategoryLabel` does for categories),
 * or — for a genuinely non-translatable token — add it to the allowlist here
 * (keeps the exempt set reviewed) or add an inline eslint-disable with a reason.
 */

const DEFAULT_RENDER_KEYS = [
  'label',
  'title',
  'heading',
  'subtitle',
  'header',
  'placeholder',
  'tooltip',
  'ariaLabel',
  'text',
];

/**
 * Heuristic: does `s` read like a human-facing English phrase (vs. a key,
 * identifier, or acronym)?
 */
function looksLikeUiText(s) {
  const v = s.trim();
  if (!v) return false;
  if (v.includes('.')) return false; // translation key or brand domain
  if (/[a-z][A-Z]/.test(v)) return false; // camelCase identifier
  if (!/[a-z]/.test(v)) return false; // acronym / all-caps token / no letters
  if (!/[a-z]{2,}/.test(v)) return false; // needs at least one real word
  // word-like: letters, digits, spaces, and the punctuation real UI labels use
  return /^[A-Za-z0-9 ()/#&,'+–—-]+$/.test(v);
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow bare user-facing English strings in rendered .ts data sources',
    },
    schema: [
      {
        type: 'object',
        properties: {
          keys: { type: 'array', items: { type: 'string' } },
          allowlist: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      bare:
        "Bare user-facing string '{{ text }}' on `{{ key }}` — route it through t() " +
        '(add a key to uiStrings.ts), or allowlist it if it is a brand/product name.',
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const renderKeys = new Set(options.keys || DEFAULT_RENDER_KEYS);
    const allowlist = new Set(options.allowlist || []);

    /** Resolve a Property/key node to its static name, or null. */
    function keyName(node) {
      if (!node.computed && node.key.type === 'Identifier') return node.key.name;
      if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
      return null;
    }

    return {
      Property(node) {
        const k = keyName(node);
        if (!k || !renderKeys.has(k)) return;

        // Skip `'foo' as UIStringKey` casts — the value is a key.
        const value = node.value;
        if (value.type === 'TSAsExpression') return;
        if (value.type !== 'Literal' || typeof value.value !== 'string') return;

        const text = value.value;
        if (allowlist.has(text)) return;
        if (!looksLikeUiText(text)) return;

        context.report({ node: value, messageId: 'bare', data: { key: k, text } });
      },
    };
  },
};
