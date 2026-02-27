# Plan: Fix Google Drive account picker popup on PWA restart

> Date: 2026-02-27

## Context

When a user with Google Drive storage + biometric authentication force-closes and reopens the PWA, a Google Drive account selection popup appears **before the login screen renders**. The user expects to see the login screen → click family → biometric prompt. Instead they get an unexpected Google popup first.

## Root Cause

`LoginPage.vue onMounted()` calls `syncStore.initialize()`, which for Google Drive families calls `requestAccessToken()`. After a PWA force-close, sessionStorage is cleared (no cached Google token), so `isTokenValid()` returns false and `requestAccessToken({ prompt: '' })` fires. This triggers Google's account chooser popup during mount — **not a user gesture** — before the login screen is even interactive.

The `requestAccessToken()` call in `initialize()` is purely a pre-loading optimization. The `GoogleDriveProvider.read()` and `write()` methods already handle on-demand token acquisition via `getValidToken()` → `requestAccessToken()`.

## Approach

1. Remove eager `requestAccessToken()` from `syncStore.initialize()` — keep `loadGIS()` only
2. Set up token expiry handler after successful Google Drive file load in `loadFromFile()`
3. Show reconnect toast when Google Drive read fails in `loadFromFile()`
4. Gate `GoogleReconnectToast` behind `!authStore.needsAuth` in App.vue

## Files affected

- `src/stores/syncStore.ts` — Fixes 1, 2, 3
- `src/App.vue` — Fix 4
