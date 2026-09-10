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
import type { BeanpodFileV4 } from '@/types/syncFileV4';

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
async function mountWith(env: BeanpodFileV4) {
  setActivePinia(createPinia());
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
async function renderColdSurface(env: BeanpodFileV4) {
  const { w, setup } = await mountWith(env);
  // `setupState` UNWRAPS refs, so these are plain reads/writes, not `.value`.
  const c = setup.caps as { password: boolean; kit: boolean; passphrase: boolean } | null;
  if (c && !c.password) {
    if (c.kit) setup.showKitEntry = true;
    else if (c.passphrase) setup.showKitEntry = false;
    else setup.formError = 'nothing can open this file';
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

  it('kit-born family: names no password ANYWHERE on the screen', async () => {
    // The offer was fixed first, but three strings kept saying "password" over an
    // envelope with no password wrap: the heading subtitle and the cold-arrival card.
    const w = await renderColdSurface(envelope({ recoveryKeys: { k1: kitWrap } }));
    expect(w.text().toLowerCase()).not.toContain('password');
  });

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
    const text = w.text().toLowerCase();
    expect(text).toContain('nothing can open this file');
    expect(w.findAll('input').length).toBe(0);
    // The honest message once, not twice: the kit form used to re-render `formError`.
    expect(text.split('nothing can open this file').length - 1).toBe(1);
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
