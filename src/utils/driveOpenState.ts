/**
 * Parse the `state` query param Drive sends when launching an app via the
 * "Open with" gesture from a file's right-click menu.
 *
 * Drive's documented format is a JSON-encoded string:
 *
 *     {
 *       "ids": ["FILE_ID"],
 *       "action": "open" | "create",
 *       "userId": "GOOGLE_USER_ID",
 *       "resourceKeys": { ... }   // optional, for shared files
 *     }
 *
 * Returns the first file ID for valid `action: "open"` payloads with at
 * least one ID. Returns `null` for anything else (missing state, malformed
 * JSON, wrong action, empty ids array).
 *
 * Defensively handles both single-encoded and double-encoded variants —
 * vue-router URL-decodes query values once, but a misbehaving caller or
 * proxy could pass a double-encoded blob.
 */
interface DriveOpenState {
  ids?: string[];
  action?: 'open' | 'create';
  userId?: string;
  resourceKeys?: Record<string, string>;
}

function tryParse(raw: string): DriveOpenState | null {
  try {
    return JSON.parse(raw) as DriveOpenState;
  } catch {
    return null;
  }
}

/**
 * @param raw The raw value of `?state=...` (typically a string from
 *            `route.query.state`, but typed as `unknown` to handle the
 *            array/null edge cases vue-router returns).
 * @returns The first file ID if the payload is a valid open-action state,
 *          otherwise `null`.
 */
export function parseDriveOpenState(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  let state = tryParse(raw);
  if (!state) {
    // Try one extra decodeURIComponent in case the value is double-encoded.
    try {
      state = tryParse(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }

  if (!state || state.action !== 'open') return null;
  const firstId = state.ids?.[0];
  if (typeof firstId !== 'string' || firstId.length === 0) return null;
  return firstId;
}
