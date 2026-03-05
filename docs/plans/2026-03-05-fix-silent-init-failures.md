# Plan: Fix Silent Initialization Failures — Error Handling & Diagnostics

> Date: 2026-03-05
> Severity: Critical (app unusable on some devices)

## Context

A family member on Honor X9c (Android 16, Chrome 145, MagicOS 10.0) reports blank pages and "No automerge document loaded" errors. Root cause: `App.vue` `onMounted` wraps initialization in `try/finally` with no `catch` block — errors are silently swallowed.

## Approach

1. Add `catch` block with `initError`/`initErrorDetail` refs to capture and surface errors
2. Error recovery UI: brand-consistent screen with reload button, sign-out-and-clear button, expandable technical details
3. Contextual error wrapping in `loadFamilyData()` — each path re-throws with context (sync file / local cache / init doc)
4. Device diagnostics (UA, WASM, Crypto, IDB, SW) in error detail section

## Files affected

| File                                    | Change                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `src/App.vue`                           | catch block, error state refs, error recovery UI, contextual error wrapping |
| `src/services/translation/uiStrings.ts` | `app.initError.*` translation strings                                       |
