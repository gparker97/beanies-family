import { ref, type Ref } from 'vue';
import { useFilePicker, type UseFilePickerBindings } from '@/composables/useFilePicker';
import { classifyBeaniesQr, wrongCodeMessageKey, type BeaniesQr } from '@/utils/beaniesQr';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';

/**
 * "Point the camera at a beanies code" — take one photo, decode it, say what it was.
 *
 * ⚠️ POINT-AND-SHOOT, NOT A VIEWFINDER. The OS camera takes a single photo and we decode the
 * file. There is still no `getUserMedia` anywhere in this repo and Android still does not
 * declare `CAMERA`; that position is unchanged and is worth keeping, because a live
 * viewfinder is a permission prompt, a permission-denied state and a preview surface, none
 * of which this feature needs.
 *
 * What DID change: the decoder behind it is now a ladder (`runQrLadder`), because a single
 * luma pass failed on roughly nine photos in ten — every code this app mints is Heritage
 * Orange, which halves the contrast jsQR thresholds on. `qrDecode.ts` explains that in full.
 * A continuous viewfinder would still read better than one photo, and if the ladder's
 * telemetry says it is not enough, THAT is the evidence to revisit the position above — not
 * a hunch.
 *
 * ⚠️ TWO CALL SITES ONLY — the cold surface's "Open Camera" and the signed-in profile
 * menu's "Scan a Code". Kit entry deliberately does NOT use this: it is a `<label>`-wrapped
 * input that also accepts the saved kit PDF, and `capture` was added there once and reverted
 * because it hides "Files" and makes that PDF unselectable. Pulling it in here would
 * re-import that regression and add a failure mode (`open()` returning false) that a
 * `<label>` cannot have.
 *
 * ⚠️ EVERY FAILURE SAYS SOMETHING. A camera button that opens nothing, or a decode that ends
 * in silence, is the exact outcome this composable exists to prevent — so `open()` returning
 * false is surfaced, all four decode reasons map to distinct copy, and scanning the right
 * product's WRONG code gets a directive message rather than "that didn't work".
 */
export interface QrCapture {
  /**
   * Bind to a hidden `<input type="file">` — BOTH of these, not just `bindings`.
   *
   * ⚠️ `useFilePicker.open()` does `inputRef.value?.click()`, so an input rendered with
   * `v-bind="bindings"` alone leaves the ref null and every `open()` returns false. That
   * shipped once and made both camera buttons taps that did nothing.
   */
  inputRef: Ref<HTMLInputElement | null>;
  bindings: UseFilePickerBindings;
  /** Open the camera. Sets `error` and returns false when the picker could not open. */
  open: () => boolean;
  /** Decoding in progress. */
  isBusy: Ref<boolean>;
  /** Human-readable failure, already translated. Cleared on the next attempt. */
  error: Ref<string | null>;
}

/**
 * ⚠️ THE OUTCOME COUNTERS LIVE IN `qrDecode.ts`, NOT HERE, because there is a THIRD caller
 * of the decoder (`LoadPodView`'s recovery-kit scan) that does not go through this
 * composable. Emitting from here covered two of three and left the printed-kit path — the
 * one where a Heritage Orange code is most likely to be photographed — silent on both
 * success and `no-code`. What stays here is the REPORT, because only this layer knows the
 * user-facing message it accompanies.
 *
 * ⚠️ ONE SURFACE FOR THE WHOLE SUBSYSTEM, AND IT IS NOT THE CALLER'S.
 *
 * This used to take a `surface` option, so the same decode reported as `login-flow` from the
 * cold panel and `deep-link` from the sign-in sheet. Rung ids cannot ride `kind` on
 * `deep-link`: that surface documents, in capitals, that `kind` carries ONE vocabulary (the
 * `DeliveryKind` values), after mixing marker constants onto it once already produced alerts
 * that silently blended transport buckets with marker buckets. Nor can the rung ride `detail`
 * on `login-flow`, where `detail` already carries `origin=`.
 *
 * A surface of its own gives the rung vocabulary a field to itself and makes one CloudWatch
 * filter isolate every decode in the app.
 */
const SURFACE = 'qr-decode';

export function useQrCapture(opts: {
  /**
   * Where the scan was started from, e.g. `profile-menu` or `cold-entry`. Rides `detail` as
   * `origin=<value>` so the two flows stay separable on one surface — the same idiom
   * `useMintedLink` uses. NOT a telemetry surface; see SURFACE above.
   */
  origin: string;
  /** What this caller can act on. Anything else gets a "that's the wrong code" message. */
  expect: BeaniesQr['kind'];
  /** Called with a classification this caller asked for. */
  onScanned: (result: BeaniesQr) => void;
}): QrCapture {
  const translation = useTranslationStore();
  const isBusy = ref(false);
  const error = ref<string | null>(null);

  async function handle(files: File[]): Promise<void> {
    const file = files[0];
    if (!file || isBusy.value) return;
    error.value = null;
    isBusy.value = true;
    try {
      const { decodeQrFromImageFile } = await import('@/utils/qrDecode');
      const decoded = await decodeQrFromImageFile(file, opts.origin);
      if (!decoded.ok) {
        error.value = translation.t(
          decoded.reason === 'no-code'
            ? 'qrScan.noCode'
            : decoded.reason === 'unsupported-device'
              ? 'qrScan.unsupportedDevice'
              : decoded.reason === 'decoder-unavailable'
                ? 'qrScan.decoderUnavailable'
                : 'qrScan.unreadableImage'
        );
        // `no-code` is the one reason that is the photo's fault rather than ours, so it is
        // not worth a REPORT on top of the counter. The other three are device or delivery
        // problems and carry a cause.
        if (decoded.reason !== 'no-code') {
          reportError({
            surface: SURFACE,
            message: 'qr decode failed',
            severity: 'warning',
            error: decoded.cause,
            context: {
              action: 'qr_decode_failed',
              error_code: decoded.reason,
              detail: `origin=${opts.origin};tried=${decoded.attempts.join(',') || 'none'}`,
            },
          });
        }
        return;
      }

      const classified = classifyBeaniesQr(decoded.data);
      if (classified.kind !== opts.expect) {
        // All three beanies codes are square black-and-white squares in the same product, so
        // scanning the wrong one is the obvious mistake, not an edge case. Say which one it
        // was rather than "that didn't work".
        error.value = translation.t(wrongCodeMessageKey(classified.kind));
        return;
      }
      opts.onScanned(classified);
    } catch (e) {
      // Nothing above should throw — the decoder returns a result rather than rejecting —
      // but a bare catch here would be the silent dead end this whole composable is about.
      error.value = translation.t('qrScan.unreadableImage');
      reportError({
        surface: SURFACE,
        message: 'qr capture threw',
        severity: 'warning',
        error: e,
        context: { action: 'qr_capture_threw' },
      });
    } finally {
      isBusy.value = false;
    }
  }

  const picker = useFilePicker({
    accept: 'image/*',
    capture: 'environment',
    onPick: (files) => handle(files),
  });

  function open(): boolean {
    // ⚠️ A decode is a dynamic import plus jsQR over a 1600px bitmap — a visible second or
    // two on a phone. Without this, tapping again mid-decode reopens the camera and the
    // second photo lands on the floor, which is the silent dead end this file exists to
    // prevent. Callers also disable their button, but the guard belongs here too.
    if (isBusy.value) {
      // Saying nothing here would be the same silent no-op the guard exists to prevent —
      // one call site disables its button, the other (a menu item) cannot.
      error.value = translation.t('qrScan.stillReading');
      return false;
    }
    error.value = null;
    const opened = picker.open();
    if (!opened) {
      // `useFilePicker` reports this itself, but its docblock is explicit that callers must
      // surface their own message — otherwise the flagship button is a tap that does nothing.
      error.value = translation.t('qrScan.pickerUnavailable');
    }
    return opened;
  }

  return { inputRef: picker.inputRef, bindings: picker.bindings, open, isBusy, error };
}
