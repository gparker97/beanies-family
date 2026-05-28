# Plan: Adhoc announcements (Model A — bundled) + Discord launch announcement

> Date: 2026-05-28
> Related: in-app notifications (#233), per-deploy release notes, what's-new celebration
> Decision: Model A from the feasibility writeup (bundled content, no new infra, zero-knowledge preserved)

## Context

greg wants adhoc, miscellaneous announcements (first one: "join us on Discord") delivered through
the notification system shipped in #233. The what's-new channel is already a broadcast mechanism;
an announcement is the same problem with a different content shape. The Discord announcement must
**auto-open on next/first login for every user** (existing + new) and be the first thing new users
see, taking precedence over the what's-new auto-open.

## Approach

A new `announcement` notification kind, derived from a bundled content registry (mirrors
`release-notes/`). Reuses the entire framework — derive, stable ids, read-state in Automerge, bell,
PWA badge, drawer. Read/dismiss state is per-member in `notificationReads`.

### New content registry — `src/content/announcements/`

- `index.ts`: `Announcement` type (`id`, `date`, `month`, `title`, `message`, optional `note`,
  `kicker`, `icon`, `medallion`, `cta {label, href|route}`, `signature`, `autoOpen`,
  `startsAt`/`expiresAt`) + `getAllAnnouncements()` / `getAnnouncement(id)` /
  `isAutoOpenAnnouncement()`. Stable `id` is the read-state key — NEVER reused.
- `announcements.ts`: the Discord entry (`autoOpen: true`, CTA → the invite link).

### Derive + types

- `NotificationKind` += `'announcement'`; `KindPresentation.accent` += `'announcement'`.
- `utils/notifications.ts`: `ANNOUNCEMENT_PREFIX` + `announcementId(id)`; `announcements` in
  `DeriveInput`; a deriver block (window-exempt like whats-new, but honours `startsAt`/`expiresAt`);
  `pruneReadState` exemption extended to the `announcement:` prefix.

### Presentation

- `CelebrationDetail.vue` — **extract** the shared celebration shell (gradient hero + medallion +
  white-body unwrap + Pod + Caveat sign-off + footer) out of `WhatsNewBody.vue`, with a `#kick`
  slot, default content slot, `#footer` slot, and `dateLabel`/`medallionSrc`/`signature` props.
  Both bodies consume it (DRY — no duplicated scaffold CSS).
- `WhatsNewBody.vue` — refactor to consume `CelebrationDetail`; prop becomes `notification`
  (resolves its own `release`), so the detail body is uniform (`:notification`).
- `AnnouncementBody.vue` — new; consumes `CelebrationDetail`; renders title + message + optional
  note + a prominent CTA button (external link via `openExternal`, internal via `router.push`).
  Medallion = the hugging-family art.
- `notificationKinds.ts`: presentation entry (`📣`, `detailBody: AnnouncementBody`), `kindLabelKey`,
  tint. `NotificationRow` puts the `📣` on the orange gradient chip (like what's-new) — a broadcast,
  not a chore. `useNotificationPresentation` resolves the announcement → overrides row `title`
  (bilingual) + `summary` (the kicker); `hasRichBody` covers both rich kinds.
- `NotificationDetail`/`NotificationsDrawer`: pass `:notification` to the dynamic body; detail
  header shows the kind label for announcements.

### Auto-open precedence

- Store: rename `latestUnseenSpotlight` → `latestUnseenAutoOpen` (unread whats-new spotlight OR
  unread auto-open announcement). Notifications sort newest-first, so the Discord announcement
  (dated today) wins. `openToLatestWhatsNew` → `openToLatestAutoOpen`; caller in `useNotifications`.
  The session latch is unchanged (opens once per session, until read).

### i18n + tests

- `notifications.kindAnnouncement` (en + beanie); zh regen. Content strings live in the content file.
- New: `announcements/index.test.ts`, `AnnouncementBody.test.ts`. Update `WhatsNewBody.test.ts`
  (prop → notification) and `notificationsStore.test.ts` (renamed method, announcement is newest).

## Files affected

Create: `src/content/announcements/{index,announcements}.ts`, `CelebrationDetail.vue`,
`AnnouncementBody.vue`, 2 test files.
Modify: `types/notifications.ts`, `utils/notifications.ts`, `notificationKinds.ts`,
`useNotificationPresentation.ts`, `NotificationDetail.vue`, `NotificationsDrawer.vue`,
`NotificationRow.vue`, `WhatsNewBody.vue`, `notificationsStore.ts`, `useNotifications.ts`,
`uiStrings.ts`, `WhatsNewBody.test.ts`, `notificationsStore.test.ts`.

## Notes / decisions to confirm with greg

- The what's-new auto-open is NOT removed — the announcement just outranks it (newest + auto-open).
  Once the announcement is read, an older unread spotlight what's-new could still auto-open on a
  later login. Flagging in case greg wants what's-new to stop auto-opening entirely.
- In-app only (the bell), not OS push — "sends" on each user's next app open.
