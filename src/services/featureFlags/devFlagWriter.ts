// Dev-only client transport for the feature-flags card. POSTs a flag change to
// the dev Vite endpoint (see featureFlagWriterDev in vite.config.ts), which
// rewrites the committed flags file. Pure transport: on any failure it THROWS
// with an actionable message — the caller (DevFeatureFlagsCard) owns the UI
// consequence (toast + optimistic revert), so the no-silent-failure guarantee
// lives in one place.
//
// This module is imported ONLY by the dev-only card, which is itself loaded via
// an `import.meta.env.DEV` dynamic import — so it is tree-shaken from prod. The
// runtime guard below is belt-and-suspenders (mirrors services/e2e/dataBridge).

import type { DevFlag } from '@/config/flagRegistry';

const ENDPOINT = '/__feature-flags';

/**
 * Persist a flag's committed PROD state via the dev server. Resolves on success;
 * throws an Error with guidance on any failure. Dev-only — a no-op in prod.
 */
export async function setProdFlag(flag: DevFlag, enabled: boolean): Promise<void> {
  if (!import.meta.env.DEV) return;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flag, enabled }),
    });
  } catch (err) {
    throw new Error(
      'Could not reach the dev flag writer. Ensure `npm run dev` is running and the repo is writable.',
      { cause: err }
    );
  }

  if (!res.ok) {
    let message = `Flag write failed (HTTP ${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // No/unreadable JSON body — keep the status-based message.
    }
    throw new Error(message);
  }
}
