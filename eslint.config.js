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

      // A component used in a template but never imported is SILENT in prod:
      // Vue falls back to rendering it as an unknown native element — no error,
      // no telemetry, the content just vanishes. This shipped once: the TripCard
      // extraction (f9902d56) moved the markup out of TravelPlansPage but not
      // the import in, and every upcoming trip disappeared from the page while
      // the store, tests and build all stayed green.
      'vue/no-undef-components': ['error', { ignorePatterns: ['RouterView', 'RouterLink'] }],

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
            '○',
            // Archived-cycle tile: history is filed, not active (#cycle-history).
            '🗂',
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
            '‹', // meal-planner nav prev arrow (aria-labelled button)
            '⌫', // PIN keypad backspace (aria-labelled button)
            '🛫', // beanie wall trip card
            '🧱', // beanie wall's "needs a wider screen" gate
            '⧉', // meal-planner copy-week action glyph
            '🍲', // meal planner
            '👥', // "who's eating" guests glyph
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
            '🔓',
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
            '🔢',
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
      // Text-size accessibility mode (Large reading mode) — px text breaks the
      // rem-based root scale. Plus the dark-mode semantic scale: dark colour
      // comes from the tokens in packages/brand/theme.css (ink / ink-soft /
      // ink-faint, surface-*, line, line-strong, *-lift), never Tailwind's raw
      // grey ramp. 580 hand-written `dark:text-gray-*` utilities had drifted
      // below the WCAG AA 4.5:1 floor before this rule existed — see
      // `.claude/skills/beanies-theme/SKILL.md` § Dark mode.
      // Covers static `class` AND `:class` bindings (the plugin walks object
      // keys, array elements, template quasis and `+` concatenation), but not
      // .ts files or a class name built at runtime — so review still matters.
      //
      // Each pattern allows variants on BOTH sides of `dark:` (`sm:dark:`,
      // `dark:hover:`) and an optional `/NN` opacity modifier, because those
      // were the shapes that slipped through the first version of this rule.
      // `bg` starts at 300: `bg-slate-100/200` stay legal as deliberate light
      // pills (e.g. a selected day chip that is light-on-dark by design).
      'vue/no-restricted-class': [
        'error',
        '/^text-\\[\\d+px\\]$/',
        // colour properties that carry TEXT
        '/^(?:[a-z-]+:)*dark:(?:[a-z-]+:)*(?:text|placeholder|decoration)-(?:gray|slate|zinc|neutral|stone)-\\d+(?:\\/\\d+)?$/',
        // surfaces
        '/^(?:[a-z-]+:)*dark:(?:[a-z-]+:)*bg-(?:gray|slate|zinc|neutral|stone)-(?:300|400|500|600|700|800|900|950)(?:\\/\\d+)?$/',
        // every edge-ish property, including per-side borders and dividers
        '/^(?:[a-z-]+:)*dark:(?:[a-z-]+:)*(?:border|border-[lrtbxyse]|divide|divide-[xy]|outline|ring|ring-offset)-(?:gray|slate|zinc|neutral|stone)-\\d+(?:\\/\\d+)?$/',
        // gradient stops
        '/^(?:[a-z-]+:)*dark:(?:[a-z-]+:)*(?:from|via|to)-(?:gray|slate|zinc|neutral|stone)-\\d+(?:\\/\\d+)?$/',
        // opacity modifiers on the ink tiers: dimming an ink is how text drops
        // back below the floor. If it must recede, step down a tier instead.
        '/^(?:[a-z-]+:)*dark:(?:[a-z-]+:)*text-ink(?:-soft|-faint)?\\/\\d+$/',
      ],

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
  // ── The lineage guard has exactly ONE call site, and it is in the worker ──
  //
  // It used to be called from four termini on the main thread, over the two
  // ENVELOPES — which is why it did not work: the envelope is maintained on
  // three tracks independent of the document, so it read `same` while the
  // documents differed and permitted the merge it exists to prevent.
  //
  // A LINT RULE rather than a test, deliberately. The test this replaces sliced
  // `syncStore.ts` source on a delimiter that occurs ZERO times in that file,
  // fell back to "the rest of the file", and asserted nothing while reporting
  // green — which is how a broken guard shipped. A lint rule runs on every file
  // and cannot silently match the wrong slice.
  //
  // ⚠️ `importNames`, never the module: both files legitimately import
  // `PodLineageError` from it to classify a block that the WORKER raised.
  //
  // ⚠️ `patterns` + a WHOLE-APP `files` glob, not `paths` on two files. `paths`
  // matches the literal specifier only, so `./podLineage` from `syncService.ts`
  // and `../sync/podLineage` from anywhere else both walked straight past it —
  // and the two-entry `files` list left every composable, component and service
  // outside the rule's reach anyway. The guard's legitimate home is the WORKER
  // and nowhere else, so the rule's scope is "everything except the worker".
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: [
      '**/__tests__/**',
      // ⚠️ THE ONE FILE, NOT THE DIRECTORY. `worker/**` exempted nine other
      // modules, and `docClient.ts` among them is MAIN-THREAD code that merely
      // lives in the worker folder — so the one import ADR-036 exists to
      // prevent would have linted clean in exactly the layer most likely to
      // attempt it. The guard runs where both documents exist, and that is one
      // function in one file.
      'src/services/automerge/worker/applyAndProject.ts',
      // The module itself, and the ADR-036 policy it owns.
      'src/services/sync/podLineage.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/podLineage', '**/podLineage.ts'],
              importNames: ['guardLineage', 'compareLineage', 'lineageAction'],
              message:
                'The lineage guard runs in the worker (applyAndProject.mergeRemoteEnvelope) — the only place BOTH documents exist. Pass a LineageBasis instead of comparing envelopes here; see ADR-036.',
            },
          ],
        },
      ],
    },
  },

  {
    // FINANCE EXCLUSION for the beanie wall.
    //
    // The wall hangs on a kitchen wall where children, guests and visitors can
    // read it, so no financial figure may EVER appear there — for any signed-in
    // member. That promise is structural rather than a permission check: the
    // wall's component tree simply cannot import a finance store or page.
    //
    // Enforced with a lint zone rather than a bespoke import-graph test, which
    // would need alias resolution, SFC parsing and dynamic-import handling —
    // hundreds of lines nobody would maintain. Known limit, stated openly: this
    // catches DIRECT imports only, so a finance import reached transitively
    // through a shared component would pass. Every wall leaf is presentational
    // and store-free (see the plan's data-flow rule), which is what keeps that
    // gap closed in practice.
    // The composables and utils are IN the zone too. They are where the wall's
    // store access actually lives (`useWallPeripherals` alone reaches four
    // stores), so a zone covering only components and the page left the one
    // place a finance import would plausibly be written unguarded.
    files: [
      'src/components/wall/**',
      'src/composables/useWall*.ts',
      'src/utils/wall*.ts',
      'src/pages/BeanieWallPage.vue',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/stores/accountsStore',
                '**/stores/transactionsStore',
                '**/stores/budgetStore',
                '**/stores/goalsStore',
                '**/stores/assetsStore',
                '**/stores/recurringStore',
                '**/components/dashboard/**',
              ],
              message:
                'The beanie wall must never show money. It is a shared screen kids and guests can read, so finance imports are banned here by design — surface the data on a private route instead.',
            },
          ],
        },
      ],
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
      // Claude skill tooling (.claude/skills/**) are standalone Node CLI scripts
      // run outside the app bundle — same rationale as scripts/** above.
      '.claude/skills/**',
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
