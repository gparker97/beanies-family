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
      'no-secrets/no-secrets': [
        'error',
        {
          tolerance: 4.2,
          additionalDelimiters: [',', ';', ':', '='],
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
