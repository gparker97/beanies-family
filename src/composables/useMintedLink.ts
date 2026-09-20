import { ref } from 'vue';
import { renderQr } from '@/utils/qrCode';
import { reportError } from '@/utils/errorReporter';
import {
  emitLinkMinted,
  emitLinkMintStarted,
  emitLinkMintReentered,
  mintDetail,
  type MintFacts,
} from '@/services/telemetry/loginFlowEvents';
import type { HintReason } from '@/services/auth/linkMint';
import { raceTimeout } from '@/utils/timing';
import { measureAsync } from '@/utils/perfTiming';

/**
 * The backstop on the whole mint.
 *
 * ⚠️ NOT A TUNING KNOB — IT IS THE THING THAT MAKES A HANG VISIBLE. The publish inside
 * `mint` now has its own 20s credential budget, so a healthy failure surfaces well before
 * this. This exists for the awaits that have NO bound and never will have one from here: a
 * lazy `import()` that never settles, a doc worker that fell back to unbounded inline mode, a
 * Drive token ladder joined mid-flight. greg watched this spinner run 45 seconds and then
 * reloaded the page, because nothing was ever going to stop it.
 */
const MINT_TIMEOUT_MS = 30_000;

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
  mint: () => Promise<
    { link: string; hint?: HintReason } | { errorKey: string; errorCode: string }
  >;
  /** Telemetry surface for unexpected throws. */
  surface: string;
  /**
   * The facts describing this mint, read at EACH emit rather than captured once at setup.
   *
   * ⚠️ A GETTER, NOT A STRING, AND THAT IS THE FIX FOR A REAL BUG. `target` changes at runtime
   * when the user picks a different member, so a value captured when the host mounted would
   * label every later event with the first target. Rides the already-allowlisted `detail` key.
   */
  facts: () => MintFacts;
  /**
   * A step-up to run BEFORE the watchdog starts. Return false to abandon without minting.
   *
   * ⚠️ THIS EXISTS BECAUSE A PIN PAD MUST NEVER BE INSIDE `raceTimeout`. When `mintMagicLink`
   * gained a default-on gate, the gate ran inside `opts.mint()` — which is raced against
   * `MINT_TIMEOUT_MS`. `raceTimeout` does NOT abort the underlying work (its own docblock says
   * so), so a person taking longer than 30 seconds to recall a 6-digit PIN got
   * "Couldn't create the magic link" AND an `error_code=mint-timeout`, while the real mint
   * carried on, accepted the PIN, and published a newest-wins wrap that REVOKED the link they
   * were already holding — the freshly minted token discarded, because nothing reads the late
   * resolution. Net: a false failure that destroys a working credential.
   *
   * Running it out here also keeps human typing latency out of `measureAsync('link.mint')`,
   * which otherwise reports every gated mint as a multi-second main-thread stall.
   *
   * `SignInCodeSheet` already used this shape by hand (gate in `showCode()`, then
   * `gate: 'already-proved'`); this makes it available to every host instead of one.
   */
  preflight?: () => Promise<boolean>;
}) {
  let mintGeneration = 0;
  const link = ref('');
  const qr = ref('');
  const isMinting = ref(false);
  /** A `uiStrings` key, or null. Render it — never discard it. */
  const errorKey = ref<string | null>(null);
  /** True when the link exists but its QR could not be drawn. */
  const qrUnavailable = ref(false);

  async function run(): Promise<void> {
    if (isMinting.value) {
      // ⚠️ ITS OWN EVENT, NOT A `link_minted` SETTLE. This guard is correct — two concurrent
      // mints would race the same envelope key — and returning quietly made "I tapped again
      // and nothing happened" invisible, which is exactly what a hung mint looks like from
      // the outside. But booking it as a SETTLE was worse than silence: the alarm is
      // `started - minted`, and a settle with no matching start drives that negative in
      // precisely the scenario the instrumentation exists to catch, since double-tapping is
      // what people do to a hung mint.
      emitLinkMintReentered({ kind: opts.kind, detail: mintDetail(opts.facts()) });
      return;
    }
    /**
     * ⚠️ A GENERATION, BECAUSE `raceTimeout` RACES AND CANNOT CANCEL. When the watchdog wins,
     * the real mint keeps running — and without this it comes back later and writes
     * `errorKey`, `link`, `qr` and `isMinting` over whatever the user is looking at by then,
     * which after a retry is a DIFFERENT mint. greg's own sequence makes that reachable:
     * hang, close, reopen, tap again. The loser's writes are discarded from here on.
     */
    const generation = ++mintGeneration;
    const isCurrent = () => generation === mintGeneration;

    /**
     * ⚠️ RUN-LOCAL, AND THAT IS THE WHOLE POINT. Whether a `login_hint` was attached is only
     * known once `opts.mint()` has returned, but `link_mint_started` fires BEFORE it. Holding
     * the hint anywhere the host could see it (a ref, or a field on `facts`) means the start
     * event reads the PREVIOUS mint's value — a stale field that looks real in CloudWatch.
     * Scoped here, the six emits that cannot know it simply omit it.
     */
    let hint: HintReason | undefined;

    isMinting.value = true;
    errorKey.value = null;
    qrUnavailable.value = false;
    link.value = '';
    qr.value = '';
    try {
      // ⚠️ BEFORE the started-event and before the race. A declined step-up is not a mint
      // attempt, so it must not enter the `started - minted` funnel either.
      if (opts.preflight) {
        const proceed = await opts.preflight();
        if (!isCurrent()) return;
        if (!proceed) {
          errorKey.value = 'signInCode.notProved';
          return;
        }
      }
      // The denominator this funnel has never had: `link_minted` only ever fired on SETTLE,
      // so a mint that hung emitted literally nothing and was indistinguishable from one
      // nobody started.
      emitLinkMintStarted({ kind: opts.kind, detail: mintDetail(opts.facts()) });
      const result = await measureAsync('link.mint', () =>
        raceTimeout(opts.mint(), MINT_TIMEOUT_MS)
      );
      if (!isCurrent()) return;
      if (result === undefined) {
        // The watchdog fired. Distinct from a clean refusal: nothing is known about whether
        // the publish landed, so the link is withheld exactly as it would be on a failure.
        // ⚠️ KEYED ON `kind`, like the catch below. Hardcoding the device string made the
        // MAGIC card — the surface this watchdog exists for — say "couldn't create the
        // device link", naming a credential the person was not creating.
        errorKey.value = opts.kind === 'device' ? 'deviceLink.mintFailed' : 'magicLink.mintFailed';
        emitLinkMinted({
          kind: opts.kind,
          ok: false,
          errorCode: 'mint-timeout',
          detail: mintDetail(opts.facts()),
        });
        return;
      }
      if ('errorKey' in result) {
        errorKey.value = result.errorKey;
        emitLinkMinted({
          kind: opts.kind,
          ok: false,
          errorCode: result.errorCode,
          detail: mintDetail(opts.facts()),
        });
        return;
      }
      link.value = result.link;
      // The ONE emit that can know the hint, because the mint has settled.
      hint = result.hint;
      emitLinkMinted({
        kind: opts.kind,
        ok: true,
        detail: mintDetail(opts.facts(), hint),
      });
      // The QR failure path lives in `renderQr` — one warn-log for every QR in the
      // product, rather than a `catch` per call site (two of which had no log at all).
      const drawn = await renderQr(result.link, { surface: opts.surface, kind: opts.kind });
      if (!isCurrent()) return;
      if ('dataUrl' in drawn) qr.value = drawn.dataUrl;
      else qrUnavailable.value = true;
    } catch (e) {
      if (!isCurrent()) return;
      // Keyed by kind: `deviceLink.mintFailed` existed and had no caller, so a device
      // link that threw told the user to "create one later in Settings" — while they
      // were already in Settings, looking at the card that creates them.
      errorKey.value = opts.kind === 'device' ? 'deviceLink.mintFailed' : 'magicLink.mintFailed';
      emitLinkMinted({
        kind: opts.kind,
        ok: false,
        errorCode: 'mint-threw',
        detail: mintDetail(opts.facts()),
      });
      reportError({
        surface: opts.surface,
        message: 'link mint threw',
        severity: 'error',
        error: e,
      });
    } finally {
      // Only OUR run may lower the flag. A losing race that clears it would stop the spinner
      // on a mint that is still going, and re-open the door this guard exists to hold shut.
      if (isCurrent()) isMinting.value = false;
    }
  }

  /**
   * Abandon whatever is in flight and unlock the guard.
   *
   * ⚠️ EXISTS SO CALLERS STOP POKING `isMinting`. `SignInCodeSheet` used to write
   * `isMinting.value = false` from its reopen watcher — reaching into this composable's
   * internals to undo a guard it does not own, with no generation bump, so the abandoned run
   * could still come back and write over the next one. Bumping the generation here is what
   * actually makes the old run harmless.
   */
  function cancel(): void {
    // ⚠️ SETTLE THE FUNNEL. A superseded run returns before any `emitLinkMinted`, and its own
    // watchdog can no longer fire either (its generation is stale by then) — so without this
    // the abandoned `link_mint_started` never gets a partner and books permanently as +1 on
    // `started - minted`. greg's exact sequence (hang, close, reopen, tap) would then be
    // indistinguishable from the hang that alarm exists to catch.
    if (isMinting.value) {
      emitLinkMinted({
        kind: opts.kind,
        ok: false,
        errorCode: 'mint-cancelled',
        // No hint here, and it is not an omission: `cancel()` lives outside `run()`, so the
        // run-local hint is out of scope by construction. A cancelled mint never settled, so
        // there is nothing to report.
        detail: mintDetail(opts.facts()),
      });
    }
    mintGeneration += 1;
    isMinting.value = false;
  }

  return {
    cancel,
    link,
    qr,
    isMinting,
    errorKey,
    qrUnavailable,
    run,
  };
}
