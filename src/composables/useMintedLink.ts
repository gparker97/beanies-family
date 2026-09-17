import { ref } from 'vue';
import { generateInviteQR } from '@/utils/qrCode';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';
import { emitLinkMinted } from '@/services/telemetry/loginFlowEvents';

/**
 * The mint-a-link SEQUENCE, in one place: guard → mint → build the QR → surface the
 * failure.
 *
 * Two cards need this (the 15-minute device link and the 7-day magic link) and they had
 * ~90% identical bodies. The genuinely dangerous half is not the markup, it is the
 * ORDER and the refusals — in particular the rule that a link whose wrap never reached
 * the durable file must be WITHHELD rather than rendered, because a QR that cannot be
 * redeemed is worse than no QR: the person walks away believing they have a way back in.
 *
 * The caller supplies `mint`, which does its own crypto and publishing and returns
 * either a link or a translated error key. Everything after that is the same for both —
 * INCLUDING the telemetry, which lives here rather than in the cards so the two kinds
 * cannot drift into two event shapes for one funnel.
 */
export function useMintedLink(opts: {
  /** Which funnel this mint belongs to. Rides the already-allowlisted `kind` key. */
  kind: 'device' | 'magic';
  /**
   * Returns the shareable URL, or a `uiStrings` key explaining why it could not plus the
   * `error_code` for the firehose. The caller does the crypto; it does not do telemetry.
   */
  mint: () => Promise<{ link: string } | { errorKey: string; errorCode: string }>;
  /** Telemetry surface for unexpected throws. */
  surface: string;
}) {
  const link = ref('');
  const qr = ref('');
  const isMinting = ref(false);
  /** A `uiStrings` key, or null. Render it — never discard it. */
  const errorKey = ref<string | null>(null);
  /** True when the link exists but its QR could not be drawn. */
  const qrUnavailable = ref(false);

  async function run(): Promise<void> {
    if (isMinting.value) return;
    isMinting.value = true;
    errorKey.value = null;
    qrUnavailable.value = false;
    link.value = '';
    qr.value = '';
    try {
      const result = await opts.mint();
      if ('errorKey' in result) {
        errorKey.value = result.errorKey;
        emitLinkMinted({ kind: opts.kind, ok: false, errorCode: result.errorCode });
        return;
      }
      link.value = result.link;
      emitLinkMinted({ kind: opts.kind, ok: true });
      try {
        qr.value = await generateInviteQR(result.link);
      } catch (e) {
        // ⚠️ DO NOT `catch { qr = '' }` AND MOVE ON. Both existing call sites did
        // exactly that — no log, no on-screen note — which means a silently missing QR
        // on the one screen whose entire job is "scan this". The link and its copy
        // button still work, so this degrades rather than fails, but it says so.
        qrUnavailable.value = true;
        logEvent({
          level: 'warn',
          surface: opts.surface,
          message: 'QR render failed; link shown without it',
          context: { action: 'qr_render_failed', kind: opts.kind },
          // Carry the cause. A "QR failed" line with no error is the same dead end as
          // the silent `catch { qr = '' }` this replaced, just one step further along.
          error: e,
        });
      }
    } catch (e) {
      // Keyed by kind: `deviceLink.mintFailed` existed and had no caller, so a device
      // link that threw told the user to "create one later in Settings" — while they
      // were already in Settings, looking at the card that creates them.
      errorKey.value = opts.kind === 'device' ? 'deviceLink.mintFailed' : 'magicLink.mintFailed';
      emitLinkMinted({ kind: opts.kind, ok: false, errorCode: 'mint-threw' });
      reportError({
        surface: opts.surface,
        message: 'link mint threw',
        severity: 'error',
        error: e,
      });
    } finally {
      isMinting.value = false;
    }
  }

  return { link, qr, isMinting, errorKey, qrUnavailable, run };
}
