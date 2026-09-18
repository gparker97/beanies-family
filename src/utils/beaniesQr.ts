/**
 * What kind of beanies code is this, and what do we say when it is the wrong one?
 *
 * ⚠️ WHY THIS EXISTS. beanies draws THREE square black-and-white codes — a device-approval
 * code, an invite/sign-in link, and the printed recovery kit — and asks people to point a
 * camera at them in three different places. Scanning the wrong one is not an edge case, it
 * is the obvious mistake. Before this, the error text lied about it: `parseInviteLink`
 * returns null for an approval URL, so the cold surface said "check it copied fully" about
 * a link that had copied perfectly.
 *
 * ⚠️ THE MESSAGE IS ONE-DIMENSIONAL, ON PURPOSE. What a person needs to hear is a property
 * of WHAT THEY SCANNED, not of where they scanned it: "that's the code a signed-out device
 * shows" is true at every call site. Keying the copy on (found × expected) would be a 3×5
 * matrix maintained in three components, growing to 4×6 with the next code type, with
 * nothing failing when a cell is missed. One `Record<QrKind, string>` instead — exhaustive,
 * so TypeScript refuses to compile when a kind is added and the table is not filled.
 */
import { readHashMarker, APPROVAL_LINK_HASH, KIT_LINK_HASH } from '@/services/auth/deepLinks';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { parseInviteLink } from '@/services/crypto/inviteService';

export type QrKind = 'approval' | 'invite' | 'kit' | 'beanies-url-unknown' | 'not-beanies';

export type BeaniesQr =
  | { kind: 'approval'; key: string }
  | { kind: 'invite'; url: string }
  | { kind: 'kit'; code: string }
  | { kind: 'beanies-url-unknown' }
  | { kind: 'not-beanies' };

/** Our own links, wherever they were minted. Matches the bridge's origin, not the current one. */
const BEANIES_HOSTS = ['app.beanies.family', 'beanies.family'];

/**
 * Is this one of ours?
 *
 * ⚠️ IN DEV, THE APP'S OWN CODES ARE ON `localhost`. `DeviceApprovalRequest` builds its QR
 * from `shareableOrigin()`, which returns the real origin off production — so a
 * canonical-hosts-only check made both scanners reject beanies' own codes on a dev server
 * and on any preview host, which is precisely why this could not be exercised locally. The
 * extra origin is gated on DEV so it can never widen the production allowlist.
 */
function isBeaniesOrigin(url: URL): boolean {
  // Production rule, and it never relaxes: https + a canonical host.
  if (url.protocol === 'https:' && BEANIES_HOSTS.includes(url.hostname)) return true;
  // Dev exception, and it is an EXACT origin match — not a looser protocol rule. Allowing
  // `http:` on the canonical hosts would have made `http://app.beanies.family/...` pass,
  // which is the scheme-downgrade this check exists to refuse.
  return import.meta.env.DEV && url.origin === window.location.origin;
}

/**
 * Classify a decoded QR payload.
 *
 * Deliberately does NOT parse an invite's query string — that belongs to the one consumer
 * that already knows how (`useBeaniesLinkSubmit`), and duplicating its nine-key
 * reconstruction here is exactly the drift this module exists to prevent.
 */
export function classifyBeaniesQr(text: string): BeaniesQr {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'not-beanies' };

  /**
   * ⚠️ ORIGIN FIRST, AND THE MARKER MUST BE IN THE FRAGMENT.
   *
   * An earlier version ran `readHashMarker` over the WHOLE payload before looking at the
   * host, and `readHashMarker` is a bare `indexOf`. So `https://evil.example/x?y=beanies-
   * approve=KEY` — or the bare string `beanies-approve=KEY` — classified as an approval.
   * That mattered more here than anywhere else: a key from this classifier is delivered as
   * `in-app-scan`, which is the ONE transport the provenance interstitial skips. A QR on a
   * poster or in an email would have landed the victim straight on a live fingerprint panel
   * with no warning, while `main.ts` and `inboundLinkBridge` were both being hardened to
   * require exactly this. The promoted route must not be the weak one.
   */
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'not-beanies' };
  }
  if (!isBeaniesOrigin(url)) return { kind: 'not-beanies' };

  // `!== null`, not truthiness: `readHashMarker` returns '' for a present-but-empty marker
  // (a truncated link), and that is a beanies code we recognise and cannot use — not an
  // invite, and not somebody else's URL.
  const approval = readHashMarker(url.hash, APPROVAL_LINK_HASH);
  if (approval !== null) {
    return approval ? { kind: 'approval', key: approval } : { kind: 'beanies-url-unknown' };
  }

  const kit = readHashMarker(url.hash, KIT_LINK_HASH);
  if (kit !== null) {
    return kit ? { kind: 'kit', code: kit } : { kind: 'beanies-url-unknown' };
  }

  // ⚠️ ASK THE REAL PARSER. A hand-rolled `has('fam') || pathname === '/join'` was stricter
  // than `parseInviteLink`, which also accepts hash-routed links and the `f=`/`code=`
  // aliases — so the camera said "that's the wrong code" about a link that works when
  // pasted two inches lower on the same screen. One parser, one answer.
  if (parseInviteLink(trimmed) !== null) return { kind: 'invite', url: trimmed };

  return { kind: 'beanies-url-unknown' };
}

/**
 * The translation key explaining what was scanned, for when it is not what was wanted.
 *
 * Exhaustive by construction: adding a `QrKind` without adding its line is a compile error,
 * which is the whole point — a missing message here surfaces as a silent dead end.
 */
const WRONG_CODE_MESSAGE: Record<QrKind, UIStringKey> = {
  approval: 'qrScan.wrongCodeApproval',
  invite: 'qrScan.wrongCodeInvite',
  kit: 'qrScan.wrongCodeKit',
  'beanies-url-unknown': 'qrScan.wrongCodeUnknown',
  'not-beanies': 'qrScan.notBeanies',
};

export function wrongCodeMessageKey(found: QrKind): UIStringKey {
  return WRONG_CODE_MESSAGE[found];
}
