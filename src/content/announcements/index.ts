/**
 * Announcements registry — adhoc, miscellaneous broadcasts (e.g. "join our
 * Discord") delivered through the in-app notification system, NOT tied to a
 * deploy's release note.
 *
 * Like release notes, each entry is bundled into the app, so a deploy that adds
 * one ships it to all clients — the `announcement` notification derives from it
 * (see `utils/notifications.ts`) and the bell badges. The only persisted state is
 * per-member read/unread (`FamilyDocument.notificationReads`), so reading on one
 * device clears it on another.
 *
 * PUBLIC CONTENT: the repo is public and this ships in the JS bundle, so every
 * string here is effectively public. Keep them user-facing; never put anything
 * sensitive in an announcement.
 */
import { ANNOUNCEMENTS } from './announcements';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnnouncementCta {
  label: { en: string; beanie: string };
  /** External URL — opened via `openExternal` (a new browser tab / system browser). */
  href?: string;
  /** Internal route — `router.push`; the drawer closes first. Use href OR route. */
  route?: string;
}

export interface Announcement {
  /**
   * Stable id — the notification id suffix (`announcement:<id>`) AND the
   * read-state key. NEVER reuse an id (a reused id inherits the old read-state).
   */
  id: string;
  /** ISO date — drives newest-first ordering + the displayed date. */
  date: string;
  /** Friendly display date, e.g. '28 may 2026' (the hero date pill). */
  month: string;
  /** Bold headline — the row title and the body headline. */
  title: { en: string; beanie: string };
  /** The body message (greg's voice). */
  message: { en: string; beanie: string };
  /** Optional smaller caption shown beneath the message (a PS / caveat). */
  note?: { en: string; beanie: string };
  /** Hero kick + row subtitle; defaults to the generic kind label. */
  kicker?: { en: string; beanie: string };
  /** Row lead emoji; defaults to 📣. */
  icon?: string;
  /** Hero medallion image path; defaults to the hugging-family art. */
  medallion?: string;
  /** Optional call-to-action button in the body. */
  cta?: AnnouncementCta;
  /** Sign-off (Caveat); defaults to greg's line. */
  signature?: string;
  /** Auto-open the drawer on login (once per session, until read). */
  autoOpen?: boolean;
  /** Optional visibility window (ISO) — outside it, the announcement is not derived. */
  startsAt?: string;
  expiresAt?: string;
}

// ── Registry (newest first) ──────────────────────────────────────────────────

const ALL_ANNOUNCEMENTS: Announcement[] = [...ANNOUNCEMENTS].sort(
  (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)
);

// ── Public API ───────────────────────────────────────────────────────────────

export function getAllAnnouncements(): readonly Announcement[] {
  return ALL_ANNOUNCEMENTS;
}

export function getAnnouncement(id: string): Announcement | undefined {
  return ALL_ANNOUNCEMENTS.find((a) => a.id === id);
}

/** Whether an announcement gently auto-opens the drawer on login. */
export function isAutoOpenAnnouncement(a: Announcement): boolean {
  return a.autoOpen === true;
}
