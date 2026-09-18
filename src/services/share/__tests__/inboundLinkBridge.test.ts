/**
 * The device-approval DELIVERY contract (0.21.3 regression).
 *
 * ⚠️ WHAT THESE TESTS EXIST TO STOP. 0.21.3 shipped device-to-device sign-in broken on
 * every native device: the bridge captured the approval key and navigated to `/welcome`,
 * expecting a `watch(() => route.fullPath, ...)` in App.vue to notice. But the person
 * scanning is SIGNED IN, so the router redirects `/welcome` to the Nook by name — and a
 * phone already sitting on `/nook` sees the identical path on both sides. The watcher
 * never fired, the key was orphaned, and the app "opened and did nothing".
 *
 * ⚠️ WHAT THESE TESTS CAN AND CANNOT OBSERVE — read before trusting a green run.
 *
 * They pin the BRIDGE's delivery contract. They do NOT observe the original defect, which
 * lived in App.vue's `watch(() => route.fullPath, ...)`: these fail against the pre-fix
 * code only because `installInboundLinkListener` had no second parameter then, which is a
 * weaker claim than it looks. A future change that reinstates route-inferred delivery in
 * App.vue, or deletes the delivery gate, would ship green past this whole file.
 *
 * That gap is real and is recorded rather than papered over. The App.vue half has no test
 * because nothing in this repo mounts App.vue; closing it properly means a harness that
 * does, which is tracked separately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addListener = vi.fn().mockResolvedValue({ remove: vi.fn() });
const getLaunchUrl = vi.fn().mockResolvedValue(null);
const logEvent = vi.fn();
const reportError = vi.fn();

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (...a: unknown[]) => addListener(...a),
    getLaunchUrl: () => getLaunchUrl(),
  },
}));
vi.mock('@/services/sync/capabilities', () => ({ isNative: () => true }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

import { installInboundLinkListener } from '../inboundLinkBridge';

const KEY = 'BOaLTESTPUBLICKEYvalue-_123';
const APPROVAL_URL = `https://app.beanies.family/welcome#beanies-approve=${KEY}`;

/** Fire the `appUrlOpen` handler the bridge registered, as Capacitor would on a warm open. */
async function fireWarm(url: string): Promise<void> {
  const handler = addListener.mock.calls.find((c) => c[0] === 'appUrlOpen')?.[1] as (p: {
    url: string;
  }) => void;
  expect(handler, 'the bridge must register an appUrlOpen listener').toBeTypeOf('function');
  handler({ url });
  await Promise.resolve();
}

function install() {
  const navigate = vi.fn();
  const onApprovalKey = vi.fn();
  installInboundLinkListener(navigate, onApprovalKey);
  return { navigate, onApprovalKey };
}

describe('inboundLinkBridge — device-approval delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLaunchUrl.mockResolvedValue(null);
    try {
      sessionStorage.clear();
    } catch {
      /* jsdom without storage — the bridge tolerates this too */
    }
  });

  it('BRIDGE CONTRACT: a warm open delivers the key WITHOUT relying on any navigation', async () => {
    const { onApprovalKey, navigate } = install();

    await fireWarm(APPROVAL_URL);

    // The assertion that matters. Pre-fix, the key reached a capture map and delivery
    // depended on `navigate` producing a route CHANGE — which it does not for a signed-in
    // device already on the Nook.
    expect(onApprovalKey).toHaveBeenCalledWith(KEY, 'warm');

    // Delivery must not be a side effect of navigating. `navigate` MUST have been called,
    // or the ordering assertion below is vacuously true and advertises coverage it does
    // not have.
    expect(navigate).toHaveBeenCalled();
    expect(onApprovalKey.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]
    );

    // The fragment must not ride along into the router: it carries the key.
    expect(navigate).toHaveBeenCalledWith('/welcome');
  });

  it('BRIDGE CONTRACT: a cold launch delivers the key even though getLaunchUrl resolves after install', async () => {
    let resolveLaunch: (v: { url: string }) => void = () => {};
    getLaunchUrl.mockReturnValue(
      new Promise<{ url: string }>((r) => {
        resolveLaunch = r;
      })
    );

    const { onApprovalKey } = install();
    // Nothing has arrived yet — this is the window in which the old one-shot read ran and
    // found nothing.
    expect(onApprovalKey).not.toHaveBeenCalled();

    resolveLaunch({ url: APPROVAL_URL });
    await vi.waitFor(() => expect(onApprovalKey).toHaveBeenCalledWith(KEY, 'cold-launch'));
  });

  it('CONTRACT: a consumer that throws is caught, reported, and does not wedge the next link', async () => {
    const navigate = vi.fn();
    const onApprovalKey = vi.fn().mockImplementationOnce(() => {
      throw new Error('sheet blew up');
    });
    installInboundLinkListener(navigate, onApprovalKey);

    await fireWarm(APPROVAL_URL);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'deep-link', severity: 'error' })
    );

    // The bridge must still be alive for the next scan.
    await fireWarm(APPROVAL_URL);
    expect(onApprovalKey).toHaveBeenCalledTimes(2);

    // And the throw must be reported, not merely caught.
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'deep-link',
        message: 'approval_key_dropped',
      })
    );
  });

  it('SECURITY: an approval marker on /join is IGNORED — only /welcome may carry one', async () => {
    const { onApprovalKey, navigate } = install();

    // A link someone TAPPED in a message, not a code they chose to scan. Honouring the
    // marker here would let an attacker-supplied public key raise the approval sheet over
    // a join flow, with only a fingerprint comparison the user has no reason to make.
    await fireWarm(`https://app.beanies.family/join?token=x#beanies-approve=${KEY}`);

    expect(onApprovalKey).not.toHaveBeenCalled();
    // And the key must NOT ride along into the URL just because we declined to read it.
    expect(navigate).toHaveBeenCalledWith('/join?token=x');
  });

  it('REGRESSION: a recovery-kit fragment is forwarded, not swallowed', async () => {
    const { navigate } = install();

    // The printed kit's QR is `/welcome#beanies-kit=<code>` and `/welcome` is a verified
    // App Link, so this bridge is the only route in. Dropping the whole fragment sent
    // someone restoring on a new device to a blank gate to hand-type their code.
    await fireWarm('https://app.beanies.family/welcome#beanies-kit=ABC123');

    expect(navigate).toHaveBeenCalledWith('/welcome#beanies-kit=ABC123');
  });

  it('SECURITY: a prefix that is not a path segment is rejected', async () => {
    const { onApprovalKey, navigate } = install();

    await fireWarm(`https://app.beanies.family/welcome-evil#beanies-approve=${KEY}`);

    expect(onApprovalKey).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('TELEMETRY: an empty approval marker is reported, not silently dropped', async () => {
    const { onApprovalKey } = install();

    await fireWarm('https://app.beanies.family/welcome#beanies-approve=');

    expect(onApprovalKey).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'deep-link',
        message: 'approval_key_dropped',
        context: expect.objectContaining({ error_code: 'empty-key' }),
      })
    );
  });

  it('SECURITY: a URL from the wrong origin delivers nothing and navigates nowhere', async () => {
    const { onApprovalKey, navigate } = install();

    await fireWarm(`https://evil.example.com/welcome#beanies-approve=${KEY}`);

    expect(onApprovalKey).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // A rejected URL must drive NO app state, including the launch-replay slot.
    expect(sessionStorage.getItem('beanies.launchUrlConsumed')).toBeNull();
  });

  it('SECURITY: a non-routable path delivers nothing, even on the right origin', async () => {
    const { onApprovalKey, navigate } = install();

    await fireWarm(`https://app.beanies.family/settings#beanies-approve=${KEY}`);

    expect(onApprovalKey).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('CONTRACT: a routable link with no approval marker still navigates and delivers no key', async () => {
    const { onApprovalKey, navigate } = install();

    await fireWarm('https://app.beanies.family/join?token=abc');

    expect(onApprovalKey).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/join?token=abc');
  });
});
