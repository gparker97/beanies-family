// Bound an untrusted filename before it reaches a `File` and, from there, storage (#64).
//
// The share boundary is exported to every app on the device (an Android `ACTION_SEND` filter
// and an iOS Share Extension), so `file.name` is attacker-controlled in a way the in-app
// pickers' names never were. It flows into `new File([...], name)` in all three `deliverX`
// steps and is persisted with the attachment.
//
// This deliberately produces a BASE name with no extension: every caller appends its own
// (`.jpg`), so returning a name that could carry a second extension would defeat the point.

/** Longest base name kept. Comfortably past any real name, far short of a 4KB one. */
const MAX_BASE_LENGTH = 64;

/** Used when sanitising leaves nothing — an empty, all-separator, or all-illegal name. */
const FALLBACK_BASE = 'shared';

/**
 * Reduce an arbitrary filename to a safe, extension-less base:
 * - takes the basename, so `../../etc/passwd` cannot traverse;
 * - drops the final extension, since callers append their own;
 * - keeps only letters, digits, space, dash, underscore and dot, collapsing the rest;
 * - trims separators from both ends and bounds the length.
 *
 * Always returns a non-empty string.
 */
export function sanitiseAttachmentBase(name: string): string {
  // Basename first: split on BOTH separators so a Windows-style path cannot slip through.
  const basename = name.split(/[/\\]/).pop() ?? '';
  // Drop the final extension only — `photo.tar.gz` keeps `photo.tar`, which is harmless
  // because the caller appends the real extension.
  const withoutExt = basename.replace(/\.[^.]*$/, '');
  const cleaned = withoutExt
    .replace(/[^a-zA-Z0-9 \-_.]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_. ]+|[-_. ]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    // Slicing can re-expose a trailing separator.
    .replace(/[-_. ]+$/, '');

  return cleaned || FALLBACK_BASE;
}
