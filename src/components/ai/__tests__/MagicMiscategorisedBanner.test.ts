/**
 * "not right?" — the free correction, offered from inside a review modal.
 *
 * Two things here are worth a test each because both fail SILENTLY: whether the banner is
 * offered at all (an over-eager one promises free and the server refuses; a missing one removes
 * the feature from the families we are not even paying for), and the ORDER of its handler —
 * busy, then consent, then close the host, then ingest.
 */
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import MagicMiscategorisedBanner from '@/components/ai/MagicMiscategorisedBanner.vue';
import type { ShareKind } from '@/types/magicPayload';

const requestConsent = vi.fn();
const ingestInAppSource = vi.fn();
const refuseIfBusy = vi.fn();
const showToast = vi.fn();
let tier = 'managed';

vi.mock('@/composables/useAiCapability', () => ({
  useAiCapability: () => ({ tier: ref(tier) }),
}));
vi.mock('@/composables/useDocumentConsent', () => ({
  useDocumentConsent: () => ({ requestConsent: () => requestConsent() }),
}));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
/** Every kind routes and every reader is on, unless a case says otherwise. */
let readersOn = true;
vi.mock('@/composables/useMagicReader', () => ({
  isReaderEnabled: () => readersOn,
  readerForShareKind: (k: string) => ({ event: 'photo', travel: 'document', recipe: 'recipe' })[k],
}));

vi.mock('@/composables/useSharedDocumentIngest', () => ({
  IN_APP_ENV: { surface: 'magic-beans-capture', origin: 'in-app' },
  ingestInAppSource: (...args: unknown[]) => ingestInAppSource(...args),
  refuseIfBusy: (...args: unknown[]) => refuseIfBusy(...args),
}));

const PREPARED = { kind: 'images' as const, imageDataUrls: ['data:image/jpeg;base64,AAA'] };

function makeEnv(correction?: { source: typeof PREPARED; token?: string }) {
  return { sourceFile: null, ...(correction ? { correction } : {}) };
}

function mountBanner(env: ReturnType<typeof makeEnv>, from: ShareKind = 'travel') {
  return mount(MagicMiscategorisedBanner, {
    props: { env, from },
    global: {
      stubs: {
        ChoiceModal: {
          name: 'ChoiceModal',
          props: ['open', 'title', 'options', 'layer'],
          emits: ['select', 'close'],
          template: '<div />',
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tier = 'managed';
  readersOn = true;
  refuseIfBusy.mockReturnValue(false);
  requestConsent.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('when the correction is offered at all', () => {
  it('offers it on the managed tier only with a grant in hand', () => {
    expect(mountBanner(makeEnv({ source: PREPARED, token: 'tok' })).text()).toContain(
      'ai.correct.action'
    );
    // No grant means the server will charge. Promising free here would be a promise we cannot
    // keep, on the one surface whose entire copy is about it being free.
    expect(mountBanner(makeEnv({ source: PREPARED })).text()).toBe('');
  });

  it('offers it to BYOK families, who have no grant and need none', () => {
    tier = 'byok';
    // Their reads cost us nothing, so there is nothing to exempt. Gating on the token alone
    // would silently remove the feature from exactly the families we are not paying for.
    expect(mountBanner(makeEnv({ source: PREPARED })).text()).toContain('ai.correct.action');
  });

  it('offers nothing when the model was never invoked', () => {
    // A `jsonld` or `titleOnly` link answers from the page itself — never counted, never
    // granted, nothing to re-read. The absent banner there is correct, not a missing feature.
    expect(mountBanner(makeEnv()).text()).toBe('');
  });

  it('offers nothing when no reader is left to offer', () => {
    // The spine's reader gate runs AFTER the model answers, so a kind with its flag off would
    // spend the grant, get a correct answer, and throw it away. Here the user has NAMED the
    // kind, so it can be checked in advance for free — and a picker with nothing in it is a
    // dead tap, so the banner itself stands down.
    readersOn = false;
    expect(mountBanner(makeEnv({ source: PREPARED, token: 'tok' })).text()).toBe('');
  });

  it('never offers the kind beanies already chose', () => {
    const w = mountBanner(makeEnv({ source: PREPARED, token: 'tok' }), 'recipe');
    const options = w.findComponent({ name: 'ChoiceModal' }).props('options') as Array<{
      id: string;
    }>;
    expect(options.map((o) => o.id)).toEqual(['event', 'travel']);
  });
});

describe('the handler order', () => {
  const open = () => mountBanner(makeEnv({ source: PREPARED, token: 'tok' }));

  it('refuses while another capture is in flight, before asking for anything', async () => {
    refuseIfBusy.mockReturnValue(true);
    const w = open();

    await w.find('button').trigger('click');

    expect(w.findComponent({ name: 'ChoiceModal' }).props('open')).toBe(false);
    expect(requestConsent).not.toHaveBeenCalled();
  });

  it('closes the host BEFORE starting the correction', async () => {
    const w = open();
    await w.find('button').trigger('click');

    await w.findComponent({ name: 'ChoiceModal' }).vm.$emit('select', 'recipe');
    await flushPromises();

    // Leaving the host mounted stacks two review modals and routes underneath an open one —
    // and the whole point of the correction is that the open one is the wrong modal.
    expect(w.emitted('close')).toHaveLength(1);
    expect(ingestInAppSource).toHaveBeenCalledTimes(1);
    expect(ingestInAppSource.mock.calls[0][0]).toMatchObject({
      kind: 'correction',
      from: 'travel',
      to: 'recipe',
    });
  });

  it('mints a FRESH consent grant rather than replaying one', async () => {
    const w = open();
    await w.find('button').trigger('click');
    await w.findComponent({ name: 'ChoiceModal' }).vm.$emit('select', 'recipe');
    await flushPromises();

    // Same document, but a new user action on a different surface: one prompt answers for
    // exactly one document, and a grant stashed and replayed is what ADR-030 forbids.
    expect(requestConsent).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all when consent is declined, and stays offered', async () => {
    requestConsent.mockResolvedValue(null);
    const w = open();
    await w.find('button').trigger('click');
    await w.findComponent({ name: 'ChoiceModal' }).vm.$emit('select', 'recipe');
    await flushPromises();

    expect(ingestInAppSource).not.toHaveBeenCalled();
    expect(w.emitted('close')).toBeUndefined();
    // The grant is only ever consumed server-side, so a decline costs the family nothing.
    expect(w.text()).toContain('ai.correct.action');
  });

  it('opens its picker ABOVE a modal, not level with one', async () => {
    // `RecipeFormModal` is itself z-[60] at its meal-editor mount; at equal specificity source
    // order alone would decide whether the picker is visible.
    expect(open().findComponent({ name: 'ChoiceModal' }).props('layer')).toBe('top');
  });
});
