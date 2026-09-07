import pluginSecurity from 'eslint-plugin-security';
import pluginNoSecrets from 'eslint-plugin-no-secrets';
import pluginSDL from '@microsoft/eslint-plugin-sdl';
import * as parserVue from 'vue-eslint-parser';
import tseslint from 'typescript-eslint';

/**
 * Security-focused ESLint configuration
 * This config is used specifically for security scanning in CI/CD
 * Run with: npm run security:lint
 */
export default [
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: parserVue,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      security: pluginSecurity,
      'no-secrets': pluginNoSecrets,
      '@microsoft/sdl': pluginSDL,
    },
    rules: {
      // Security plugin rules - detect vulnerabilities
      'security/detect-object-injection': 'warn', // TypeScript provides type safety, so warn instead of error
      'security/detect-non-literal-regexp': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',

      // Secrets detection - prevent hardcoded secrets
      //
      // ⚠️ THE DELIMITERS ARE THE FALSE-POSITIVE FIX, NOT THE TOLERANCE. This rule reads
      // comments as well as code, and a backtick-quoted identifier is exactly the shape it
      // mistakes for a credential: `COMMITTED_FLAGS.docWorker` measured 4.21 and
      // `BLOCKER_OVERLAY_KEY['podLocalUnreadable.inline']` 4.28, both a hair over the 4.2
      // line, and both merely prose describing our own code. They failed the gate for four
      // days.
      //
      // Splitting on the punctuation that WRAPS a quoted identifier turns each of those
      // into short words that no longer clear the bar, and it generalises: the next comment
      // quoting a SCREAMING_SNAKE constant needs no edit here. Raising `tolerance` would buy
      // the same green by lowering the bar for every real secret in the repo, and an
      // `ignoreContent` denylist would need a new entry every time somebody writes a
      // comment, which is the same hand-patching in a different file.
      //
      // It does not weaken detection of a real credential: API keys, bearer tokens and
      // base64 payloads contain no backtick or bracket, so nothing that matters is split.
      //
      // ⚠️ ADD A DELIMITER ONLY AFTER RUNNING `npm run security:lint`, because splitting is
      // not monotonic — a NARROWER token can score HIGHER, so a delimiter that fixes one
      // false positive invents others somewhere else. Both obvious additions were tried and
      // rejected on measurement, not taste:
      //   `.`  isolates the last segment of a dotted i18n key, so `'x.deleteFamilyExport-
      //        CheckMsg'` (safe as a whole) became the bare identifier at 4.24 and failed in
      //        two files.
      //   `'`  strips the quotes off every string literal, and two identical quote characters
      //        were all that held several literals under the line: `hotel|airbnb|campground|
      //        family_friends` surfaced at 4.25 the moment they went.
      // Between them they took the run from 2 errors to 6.
      //
      // ⚠️ EACH DELIMITER IS A REGEX, NOT A LITERAL. The plugin compiles this list with
      // `new RegExp` (`compileListOfPatterns` in its `utils.js`), so an unescaped `[` fails
      // to compile at all — ESLint then dies with "Failed to compiled the regexp" naming the
      // FIRST file it linted, which reads like a broken fixture rather than a broken config.
      // The four original delimiters hid this because none of them is a metacharacter.
      'no-secrets/no-secrets': [
        'error',
        {
          tolerance: 4.2,
          additionalDelimiters: [',', ';', ':', '=', '`', '\\[', '\\]'],
        },
      ],

      // Microsoft SDL - secure development lifecycle
      '@microsoft/sdl/no-inner-html': 'error',
      '@microsoft/sdl/no-insecure-url': 'error',
      '@microsoft/sdl/no-postmessage-star-origin': 'error',
      '@microsoft/sdl/no-document-write': 'error',
      '@microsoft/sdl/no-html-method': 'error',
      '@microsoft/sdl/no-msapp-exec-unsafe': 'error',
    },
  },
  {
    ignores: [
      'dist/**',
      // The Astro site's build output. Same category as `dist/**`, and missing until
      // now — anyone who ran `npm run build:web` before `security:lint` crashed the
      // ESLint formatter outright (RangeError on the results table) rather than seeing
      // a lint result. CI never hit it only because it checks out clean.
      'web/dist/**',
      // The built Vue bundle, as `npx cap sync` copies it into the native projects.
      // It is `dist/**` again under another name (both are git-ignored), and scanning
      // it means linting minified vendor code: ~4.7k findings, enough to crash the
      // ESLint formatter before it prints anything. Same clean-checkout reason CI
      // never saw it.
      'android/app/src/main/assets/public/**',
      'ios/App/App/public/**',
      'node_modules/**',
      'public/**',
      '*.config.js',
      '*.config.ts',
      'scripts/**',
      // Skill build/tooling scripts (pinterest-post, beanies-blog, …) are developer
      // tooling that legitimately does fs ops on computed paths — same category as
      // `scripts/**`, NOT shipped app code. Scanning them fails the app-security gate
      // on `security/detect-non-literal-fs-filename` for no real risk.
      '.claude/**',
      'playwright-report/**',
      'test-results/**',
      '.github/**',
      '**/*.test.ts',
      '**/*.test.js',
      // .mjs was missing: the Lambda suites are ESM, so this config had never scanned a
      // lambda test file until #72 added one. Test files legitimately read fixture paths
      // built from variables (detect-non-literal-fs-filename), which is not a finding here.
      '**/*.test.mjs',
      '**/*.spec.mjs',
      '**/*.spec.ts',
      '**/*.spec.js',
    ],
  },
];
