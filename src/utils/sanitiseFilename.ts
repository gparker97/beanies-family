// Bound an untrusted filename before it reaches a `File` and, from there, storage (#64).
//
// The share boundary is exported to every app on the device (an Android `ACTION_SEND` filter
// and an iOS Share Extension), so `file.name` is attacker-controlled in a way the in-app
// pickers' names never were. It flows into `new File([...], name)` in all three `deliverX`
// steps and is persisted with the attachment.
//
// It produces a BASE name with no extension at all: every caller appends its own (`.jpg`).
// The final extension is dropped and any REMAINING dots are flattened, so `invoice.pdf.jpg`
// comes back as `invoice pdf` rather than `invoice.pdf` — which the caller would otherwise
// turn straight back into `invoice.pdf.jpg`.
//
// It also PRESERVES the user's own language. An earlier version allowed only ASCII, which
// was fine for the hostile case it was written for but silently wrecked the ordinary one:
// this function is shared with the in-app picker, so `学校通知.jpg` became `shared.jpg` and
// `Fête d'école.png` became `F-te d-cole` for people simply choosing a file. Letters, marks
// and digits in ANY script are kept; only the characters that carry meaning to a filesystem
// or a path are replaced.

/** Longest base name kept. Comfortably past any real name, far short of a 4KB one. */
const MAX_BASE_LENGTH = 64;

/** Used when sanitising leaves nothing — an empty, all-separator, or all-illegal name. */
const FALLBACK_BASE = 'shared';

/**
 * Reduce an arbitrary filename to a safe, extension-less base:
 * - takes the basename, so `../../etc/passwd` cannot traverse;
 * - drops the final extension, then flattens any dots left inside the name;
 * - keeps letters, marks and digits in any script, plus space, dash and underscore;
 * - trims separators from both ends and bounds the length.
 *
 * Always returns a non-empty string.
 */
export function sanitiseAttachmentBase(name: string): string {
  // Basename first: split on BOTH separators so a Windows-style path cannot slip through.
  const basename = name.split(/[/\\]/).pop() ?? '';
  // Drop the final extension — the caller appends the real one.
  const withoutExt = basename.replace(/\.[^.]*$/, '');
  const cleaned = withoutExt
    // Then flatten anything left, so a double extension cannot survive.
    .replace(/\./g, ' ')
    // Keep letters, marks and digits in ANY script, plus space, dash and underscore.
    // Everything else — separators, control characters, shell metacharacters — collapses.
    .replace(/[^\p{L}\p{M}\p{N} \-_]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-_\s]+|[-_\s]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    // Slicing counts UTF-16 units, so it can cut an astral character (CJK Ext-B, Adlam,
    // Deseret — all `\p{L}`, all preserved above) in half and leave a lone surrogate that
    // then reaches storage. Unreachable while the filter was ASCII-only; reachable now.
    .replace(/[\uD800-\uDBFF]$/, '')
    // Slicing can also re-expose a trailing separator.
    .replace(/[-_\s]+$/, '');

  return cleaned || FALLBACK_BASE;
}
