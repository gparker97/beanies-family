/**
 * LoadPodView — which credential surface an envelope actually renders.
 *
 * `coldCredentialSurface` is exhaustively unit-tested, but nothing tested the LINK
 * between that decision and this template. That link is where the reported bug lived:
 * the kit form's "Use password instead" was rendered unconditionally over an envelope
 * with no password wrap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import LoadPodView from '@/components/login/LoadPodView.vue';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import { getSourceText } from '@/services/translation/uiStrings';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/loginFlowEvents', () => ({
  emitEnvelopeCapabilitiesChanged: vi.fn(),
  emitProveMethodsResolved: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const wrap = { salt: 's', wrapped: 'w' };
const kitWrap = { salt: 's', wrapped: 'w', createdAt: 'c' };

function envelope(over: Partial<BeanpodFileV4>): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Beans',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'x',
    ...over,
  } as BeanpodFileV4;
}

/** Mount with `env` staged as the pending file, forced onto the decrypt surface. */
async function mountWith(env: BeanpodFileV4, beanie = true) {
  setActivePinia(createPinia());
  // ⚠️ Beanie mode is the store default (`translationStore.ts:38`), so a component test
  // that never touches it asserts the BEANIE overlay and never the shipped English. That
  // is not a detail: `loginV6.unlockNoPasswordHint` said "no password needed up front" in
  // `en` while its `beanie` value did not, so the "names no password anywhere" guard below
  // passed for months against a string that named a password to every English reader.
  useTranslationStore().setBeanieMode(beanie);
  const sync = useSyncStore();
  // @ts-expect-error — test seam: the store's staged envelope is what `caps` derives from.
  sync.pendingEncryptedFile = { envelope: env, fileName: 'f.beanpod' };

  const w = mount(LoadPodView, {
    global: {
      stubs: {
        GoogleDriveFilePicker: true,
        RecoveryKitLink: { template: '<a class="kit-link" />' },
        NoPodEmptyState: true,
        LoginChoiceCard: true,
        BeanieSpinner: true,
        Teleport: true,
      },
    },
  });
  const setup = (w.vm.$ as unknown as { setupState: Record<string, unknown> }).setupState;
  return { w, setup };
}

/** Reproduce the component's own routing for a cold envelope, then render it. */
async function renderColdSurface(env: BeanpodFileV4, beanie = true) {
  const { w, setup } = await mountWith(env, beanie);
  // `setupState` UNWRAPS refs, so these are plain reads/writes, not `.value`.
  const c = setup.caps as { password: boolean; kit: boolean; passphrase: boolean } | null;
  if (c && !c.password) {
    if (c.kit) setup.showKitEntry = true;
    else if (c.passphrase) setup.showKitEntry = false;
    else setup.formError = getSourceText('loginFlow.recoveryOnlyBody');
  }
  setup.showDecryptModal = true;
  await nextTick();
  await nextTick();
  return w;
}

describe('LoadPodView — cold credential surface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kit-born family: offers the kit code and NO password escape (the reported bug)', async () => {
    const w = await renderColdSurface(envelope({ recoveryKeys: { k1: kitWrap } }));
    const text = w.text().toLowerCase();
    expect(text).not.toContain('use password');
    expect(text).not.toContain('use a password');
  });

  it.each([true, false])(
    'kit-born family: names no password ANYWHERE on the screen (beanie=%s)',
    async (beanie) => {
      // The offer was fixed first, but several strings kept saying "password" over an
      // envelope with no password wrap. Checked in BOTH overlays: the English-only leak in
      // `unlockNoPasswordHint` survived precisely because this ran in beanie alone.
      const w = await renderColdSurface(envelope({ recoveryKeys: { k1: kitWrap } }), beanie);
      expect(w.text().toLowerCase()).not.toContain('password');
    }
  );

  it('legacy family: still offers the password field (the untested regression risk)', async () => {
    const w = await renderColdSurface(envelope({ wrappedKeys: { m1: wrap } }));
    expect(w.find('input[type="password"]').exists()).toBe(true);
    const text = w.text().toLowerCase();
    // The password wording is CORRECT here, and must survive the fix above.
    expect(text).toContain('your password decrypts this beanpod');
  });

  it('passphrase-only family: offers a field, never a Recovery Code box', async () => {
    const w = await renderColdSurface(envelope({ recoveryPassphrase: kitWrap }));
    expect(w.find('input[type="password"]').exists()).toBe(true);
    const text = w.text().toLowerCase();
    expect(text).not.toContain('recovery code');
    // Every string on the screen names the credential this family actually has.
    expect(text).toContain('family passphrase');
    expect(text).not.toContain('password');
  });

  it('passphrase-only family: names no password in ENGLISH either', async () => {
    const w = await renderColdSurface(envelope({ recoveryPassphrase: kitWrap }), false);
    expect(w.text().toLowerCase()).not.toContain('password');
  });

  it('legacy family WITH a passphrase: the one field names both credentials', async () => {
    // `tryUnwrapFamilyKey` tries the member wraps and THEN the passphrase, so both work
    // in this box. Labelling it "Password" made the passphrase a secret feature on the
    // one surface where it silently works.
    const w = await renderColdSurface(
      envelope({ wrappedKeys: { m1: wrap }, recoveryPassphrase: kitWrap })
    );
    expect(w.find('input[type="password"]').exists()).toBe(true);
    const text = w.text().toLowerCase();
    expect(text).toContain('password or family passphrase');
    // ...and it must not fall back to either single-credential wording.
    expect(text).toContain('either one decrypts this beanpod');
    expect(text).not.toContain('your password decrypts this beanpod');
  });

  it('all-false envelope: shows the honest message and NO credential field', async () => {
    const w = await renderColdSurface(envelope({}));
    // The acceptance criterion: "resolves to the degenerate terminal, NEVER the kit form".
    // ⚠️ Asserts the SHIPPED string, not a literal of the test's own. The earlier version
    // wrote 'nothing can open this file' into `formError` and then asserted on it, so it
    // would have stayed green if the real copy regressed or went missing entirely.
    const real = getSourceText('loginFlow.recoveryOnlyBody').toLowerCase();
    const text = w.text().toLowerCase();
    expect(text).toContain(real);
    expect(w.findAll('input').length).toBe(0);
    // The honest message once, not twice: the kit form used to re-render `formError`.
    expect(text.split(real).length - 1).toBe(1);
  });
});

describe('LoadPodView — the unlock screen describes step 1, not step 2', () => {
  const shapes = [
    ['kit-born', envelope({ recoveryKeys: { k1: kitWrap } })],
    ['legacy', envelope({ wrappedKeys: { m1: wrap } })],
    ['passphrase-only', envelope({ recoveryPassphrase: kitWrap })],
    ['both', envelope({ wrappedKeys: { m1: wrap }, recoveryPassphrase: kitWrap })],
  ] as const;

  it.each(shapes)('%s: the heading names the beanpod, never signing in', async (_n, env) => {
    const w = await renderColdSurface(env);
    const text = w.text().toLowerCase();
    expect(text).toContain('unlock my beanpod');
    // "Sign In to {family}" described step 2 while performing step 1.
    expect(text).not.toContain('sign in to beans');
  });

  it.each(shapes)('%s: the subtitle names the family and the next step', async (_n, env) => {
    const w = await renderColdSurface(env);
    const text = w.text().toLowerCase();
    expect(text).toContain("this decrypts beans's family data");
    expect(text).toContain("you'll sign in as a member");
  });

  it('the degenerate envelope promises no next step it cannot keep', async () => {
    const w = await renderColdSurface(envelope({}));
    expect(w.text().toLowerCase()).not.toContain("you'll sign in as a member");
  });
});

describe('LoadPodView — the file-loaded channel carries WHICH secret opened the pod', () => {
  /**
   * ⚠️ The gap that let the reported bug survive a fix. `file-loaded` used to be
   * `[source?: 'recovery']` — one token for two secrets — and `LoginPage` turned every
   * `'recovery'` into `'kit'`. So a family passphrase typed into this screen arrived at
   * the prove screen labelled a kit: told "you're in with your recovery kit", led with a
   * PIN reset, and admitted through a gate that is meant to accept the kit alone.
   *
   * Neither end's tests could see it: `ProveView.recoveryOpener.test.ts` sets the prop by
   * hand, and this file never emitted. The emit is the seam, so the emit is what to pin.
   */
  it('emits the opener verbatim, so nothing downstream has to guess', async () => {
    const { w, setup } = await mountWith(envelope({ recoveryPassphrase: kitWrap }));
    const finish = setup.finishLoaded as (o?: 'kit' | 'passphrase' | null) => Promise<void>;

    await finish('passphrase');
    await finish('kit');
    await finish(null);

    const payloads = (w.emitted('file-loaded') ?? []).map((a) => (a as unknown[])[0]);
    // Distinct values survive the hop. A channel that collapsed them would show
    // ['recovery', 'recovery', undefined] here.
    expect(payloads).toEqual(['passphrase', 'kit', null]);
  });
});
