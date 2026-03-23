# Plan: Cache invite links to avoid redundant generation and Drive sync

> Date: 2026-03-23

## Context

Every time the user clicks "Invite Family Member" on the Family page, the app generates a brand new crypto invite token, wraps the family key, syncs the entire `.beanpod` file to Google Drive (fetch-merge-encrypt-upload), and then displays the link. As the data file grows, this full round-trip gets progressively slower (3-6s+). Since invite tokens are valid for 24 hours, there's no reason to regenerate on every click.

## Approach

Cache the generated invite link + QR code in component-level refs so that subsequent opens of the invite modal reuse the cached link instantly (no crypto, no sync). Only regenerate if no cached link exists (first click in session) or the cached invite has expired (24h).

Changes limited to `src/pages/FamilyPage.vue`:

- Add `cachedInviteExpiry` ref to track when the cached invite expires
- `generateInviteLink()` stores `pkg.expiresAt` in the cache after successful generation
- `openInviteModal()` checks cache first — if valid link + QR exist and haven't expired, returns immediately
- `openShareModal()` uses the same cache-aware check before generating

## Files affected

- `src/pages/FamilyPage.vue` — only file changed
