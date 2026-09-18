import { useRouter } from 'vue-router';
import { parseInviteLink } from '@/services/crypto/inviteService';

/**
 * Take a beanies invite / sign-in link from anywhere and route on it.
 *
 * ⚠️ EXTRACTED, NOT REWRITTEN. This body was `PasteLinkPanel.openPastedLink`, and every
 * paragraph below is a fix that cost someone a bug report. The cold surface's new "Open
 * Camera" button consumes exactly the same string, and re-implementing any of this beside it
 * would have meant maintaining two copies of four hard-won edge cases.
 *
 * ⚠️ A COMPOSABLE, NOT A PLAIN FUNCTION. It needs `useRouter()`, which throws outside setup.
 * Importing the router singleton instead would make it unmockable without booting the real
 * router, for identical ergonomics at the call sites (both are in setup).
 */
export function useBeaniesLinkSubmit(): { submit: (raw: string) => boolean } {
  const router = useRouter();

  /** @returns true when the link resolved and routing happened; false when it did not parse. */
  function submit(rawInput: string): boolean {
    // ⚠️ Normalise a missing scheme first. `parseInviteLink` does `new URL(raw)` with no
    // base, and the commonest way a chat app renders a copied link is `app.beanies.family/
    // join?…` with no `https://`. The fallback that exists to rescue a failed deep link was
    // rejecting the most likely input with "check it copied fully" — when it had.
    const raw = rawInput.trim();
    const normalised = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = parseInviteLink(normalised);
    // ⚠️ `parseInviteLink` returns null on a malformed URL and SILENTLY DROPS an
    // undecodable `ref`/`hint`. A paste box — and now a camera — is exactly where a
    // truncated link arrives, so that silence has to be broken by the caller rather than
    // becoming a dead-end spinner three screens later.
    if (!parsed) return false;

    // ⚠️ Forward what `parseInviteLink` RESOLVED, never a re-parse of the raw string.
    // It deliberately accepts hash-routed links (`…/#/join?fam=…&t=…`), so re-deriving from
    // `new URL(...).search` validated the hash form and then forwarded an EMPTY query —
    // routing to a bare `/join`, where the joiner met the generic "how to join" card with no
    // error, no token and no family. One parser, one answer.
    void router.push({
      path: '/join',
      query: {
        fam: parsed.familyId,
        ...(parsed.token ? { t: parsed.token } : {}),
        ...(parsed.provider ? { p: parsed.provider } : {}),
        ...(parsed.fileId ? { fileId: parsed.fileId } : {}),
        ...(parsed.fileName ? { ref: btoa(unescape(encodeURIComponent(parsed.fileName))) } : {}),
        ...(parsed.inviteeEmail
          ? { hint: btoa(unescape(encodeURIComponent(parsed.inviteeEmail))) }
          : {}),
        ...(parsed.linkMode ? { lk: '1' } : {}),
        ...(parsed.magicLink ? { ml: '1' } : {}),
        ...(parsed.memberId ? { m: parsed.memberId } : {}),
      },
    });

    return true;
  }

  return { submit };
}
