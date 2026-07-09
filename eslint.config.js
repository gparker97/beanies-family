import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import * as parserVue from 'vue-eslint-parser';
import configPrettier from 'eslint-config-prettier';
import pluginPrettier from 'eslint-plugin-prettier';
import pluginImport from 'eslint-plugin-import';
import pluginSecurity from 'eslint-plugin-security';
import pluginNoSecrets from 'eslint-plugin-no-secrets';
import pluginSDL from '@microsoft/eslint-plugin-sdl';
import tseslint from 'typescript-eslint';
import noBareRenderStrings from './eslint-rules/no-bare-render-strings.js';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  configPrettier,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parser: parserVue,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      prettier: pluginPrettier,
      import: pluginImport,
      security: pluginSecurity,
      'no-secrets': pluginNoSecrets,
      '@microsoft/sdl': pluginSDL,
    },
    rules: {
      'prettier/prettier': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/component-api-style': ['error', ['script-setup']],

      // i18n enforcement: NO hardcoded user-visible English in templates. ALL
      // user-facing text must go through `t('key')` (uiStrings.ts) so it
      // translates to Chinese + beanie mode. Covers text nodes AND the
      // user-facing attributes (title/placeholder/aria-label/alt). The
      // allowlist is brand terms + non-linguistic symbols/tokens only. Script-
      // level strings (showToast/confirm args, option-label arrays) aren't
      // caught by this rule — those go through `t()` by convention + review.
      // See docs/TRANSLATION.md § Enforcement.
      'vue/no-bare-strings-in-template': [
        'error',
        {
          allowlist: [
            // Punctuation / symbols / separators
            '(',
            ')',
            ',',
            '.',
            '&',
            '+',
            '-',
            '=',
            '*',
            '/',
            '#',
            '%',
            '!',
            '?',
            ':',
            ';',
            '[',
            ']',
            '{',
            '}',
            '<',
            '>',
            '|',
            '·',
            '•',
            '–',
            '—',
            '−',
            '×',
            '✕',
            '✓',
            '✗',
            '⠿',
            '✎',
            '→',
            '←',
            '↑',
            '↓',
            '▲',
            '▼',
            '▴',
            '▾',
            '▸',
            '›',
            '★',
            '☆',
            '…',
            '@',
            '°',
            '~',
            '●',
            '↗',
            '⇅',
            '＋',
            '✦',
            '"',
            '0',
            '0.00',
            // Brand terms — never translated (see CLAUDE.md Terminology Guide)
            'beanies.family',
            'beanies',
            '.family',
            '.beanpod',
            'Every bean counts',
            'every bean counts',
            // Non-linguistic technical tokens + third-party product names (not translated)
            'Ctrl+Enter',
            'Ctrl',
            '⌘',
            'QR',
            'PWA',
            'AI',
            'OK',
            'ID',
            'URL',
            'Rx',
            'PDF',
            'OneDrive',
            'Dropbox',
            'iCloud',
            'Google Drive',
            'Google',
            // Decorative glyphs / emoji — render identically in every language, so
            // they carry no translatable content. Adding a NEW decorative glyph
            // triggers a lint error → add it here intentionally (keeps the set
            // reviewed). Wrap purely-decorative glyphs in aria-hidden where they
            // sit next to real (translated) text.
            '⏰',
            '⏳',
            '⚠',
            '⚠️',
            '✅',
            '✈️',
            '✉️',
            '✏️',
            '✨',
            '⭐',
            '🌟',
            '🌱',
            '🌳',
            '🌴',
            '🍝',
            '🍽️',
            '🎂',
            '🎉',
            '🎯',
            '🎹',
            '🏖️',
            '🏠',
            '🏡',
            '🏦',
            '🏨',
            '🐷',
            '👉',
            '👑',
            '👤',
            '👨‍👩‍👧',
            '👨‍👩‍👧‍👦',
            '💊',
            '💡',
            '💪',
            '💬',
            '💛',
            '💰',
            '💸',
            '📄',
            '📅',
            '📣',
            '🔁',
            '📋',
            '📍',
            '📤',
            '📲',
            '📷',
            '📸',
            '🔄',
            '🔍',
            '🔒',
            '🔗',
            '🔻',
            '🕐',
            '🗺️',
            '🚕',
            '🚢',
            '🚫',
            '🥫',
            '🧳',
            '🫘',
            '🪘',
            '📦',
            '☁️',
            '🪟',
            '📎',
            '🗑️',
            '🚗',
            '🚅',
            '⛴️',
            '🌙',
            '🎭',
            '🤔',
            '🩺',
            '🆘',
            '📞',
            '🏥',
            '🍳',
            '🌿',
            '📖',
            '📝',
            '🔥',
            '↩️',
            '⋯',
            '☀️',
            '🔔',
            '💭',
            '🚪',
            '➕',
            '📥',
            '▶',
            '🔐',
            '🔑',
            '🚨',
            '👋',
            '💌',
            '💾',
            '💻',
            '⚽',
            '🎨',
            '🛒',
            '🧡',
            '$',
            '404',
          ],
          attributes: {
            '/.+/': ['title', 'aria-label', 'aria-placeholder', 'aria-roledescription', 'alt'],
            input: ['placeholder'],
            textarea: ['placeholder'],
          },
          directives: ['v-text'],
        },
      ],

      // Forbid `text-[Xpx]` arbitrary classes — px sizes don't participate in
      // the Large reading mode (see .claude/skills/beanies-theme/SKILL.md
      // § Text-size accessibility mode). Use standard Tailwind text-* classes
      // (text-xs through text-4xl) or text-[X.Xrem] for sub-text-xs ornament.
      'vue/no-restricted-class': ['error', '/^text-\\[\\d+px\\]$/'],

      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // import/order disabled for now - conflicts with TS type-first imports
      // 'import/order': ['error', { groups: [...], alphabetize: { order: 'asc' } }],

      // Security rules - detect potential security issues
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',

      // Secrets detection - prevent committing sensitive data
      'no-secrets/no-secrets': ['error', { tolerance: 4.5 }],

      // Microsoft SDL rules - security development lifecycle
      '@microsoft/sdl/no-inner-html': 'error',
      '@microsoft/sdl/no-insecure-url': 'error',
      '@microsoft/sdl/no-postmessage-star-origin': 'error',
    },
  },
  {
    // Dev-only admin tooling (rendered only in `import.meta.env.DEV`) — its
    // copy is for the developer, not end users, so it is intentionally exempt
    // from the i18n bare-string rule.
    files: ['src/components/settings/DevFeatureFlagsCard.vue', 'src/pages/dev/**'],
    rules: {
      'vue/no-bare-strings-in-template': 'off',
    },
  },
  {
    // i18n enforcement for the `.ts` blind spot: `vue/no-bare-strings-in-template`
    // only sees `.vue` templates, so user-facing English baked into rendered data
    // sources (`constants/*`, `composables/*`) escapes it. This catches bare
    // display strings on label/title/etc. keys. Fix by routing through t()
    // (see useCategoryLabel), or allowlist genuine brand/product tokens below.
    files: ['src/constants/**/*.ts', 'src/composables/**/*.ts'],
    ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.spec.ts'],
    plugins: { 'beanies-i18n': { rules: { 'no-bare-render-strings': noBareRenderStrings } } },
    rules: {
      'beanies-i18n/no-bare-render-strings': [
        'error',
        {
          allowlist: [
            // Brand + third-party product names — never translated.
            'beanies.family',
            'Google Drive',
            'OneDrive',
            'iCloud',
            'Dropbox',
            'Google',
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      '*.config.js',
      '*.config.ts',
      'scripts/**',
      'playwright-report/**',
      'test-results/**',
      '.github/**',
      // CloudFront Functions use a constrained JS runtime with a global
      // `handler` entrypoint — not ESM. Linted via the AWS console on upload.
      'infrastructure/modules/web/functions/**',
      // Astro site has its own ESLint config (or none); handled separately.
      'web/**',
      // Capacitor native projects are generated and carry the copied web build
      // (android/app/src/main/assets/public, ios/App/App/public) — not source
      // to lint. ADR-029.
      'android/**',
      'ios/**',
    ],
  },
];
