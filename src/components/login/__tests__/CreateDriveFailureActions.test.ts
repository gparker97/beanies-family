/**
 * The create-flow Drive failure's recovery stack: which recoveries render for a code on this
 * device, what each tap does, and the one tap event per recovery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CreateDriveFailureActions from '../CreateDriveFailureActions.vue';
import type { CreateDriveErrorCode } from '@/services/sync/createDriveErrors';

const h = vi.hoisted(() => ({
  localFiles: { value: false },
  logEvent: vi.fn(),
  openExternal: vi.fn(),
  openHelpArticle: vi.fn(),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/services/sync/capabilities', () => ({ canUseLocalFiles: () => h.localFiles.value }));
vi.mock('@/services/telemetry', () => ({ logEvent: h.logEvent }));
vi.mock('@/utils/openExternal', () => ({ openExternal: h.openExternal }));
vi.mock('@/utils/marketing', () => ({ MARKETING_URL: 'https://beanies.family' }));
vi.mock('@/utils/helpLinks', () => ({
  HELP_PATHS: { connectingGoogleDrive: 'getting-started/connecting-google-drive' },
  openHelpArticle: h.openHelpArticle,
}));

function factory(code: CreateDriveErrorCode, disabled = false) {
  return mount(CreateDriveFailureActions, { props: { code, disabled } });
}

/** The rendered recoveries, in order (the help link excluded). */
function rendered(wrapper: ReturnType<typeof factory>): string[] {
  return wrapper
    .findAll('[data-recovery]')
    .map((b) => b.attributes('data-recovery')!)
    .filter((a) => a !== 'help');
}

describe('CreateDriveFailureActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.localFiles.value = false;
  });

  it.each([
    ['drive-full', true, ['retry', 'chooseAccount', 'useLocal']],
    ['drive-full', false, ['retry', 'chooseAccount']],
    ['app-blocked', true, ['chooseAccount', 'useLocal']],
    ['app-blocked', false, ['chooseAccount', 'getApp']],
    ['unknown', true, ['retry', 'useLocal']],
    ['unknown', false, ['retry', 'getApp']],
    ['cancelled', false, ['retry']],
    ['popup-blocked', true, ['retry']],
    ['unsupported-browser', true, []],
  ] as const)('%s with local files %s renders %j', (code, local, expected) => {
    h.localFiles.value = local;
    expect(rendered(factory(code))).toEqual(expected);
  });

  // The append-and-dedup rule itself is table-tested in `createDriveErrors.test.ts`; this proves
  // only that the prop reaches it.
  it('passes alwaysOfferLocal through to the registry', () => {
    h.localFiles.value = true;
    const wrapper = mount(CreateDriveFailureActions, {
      props: { code: 'popup-blocked', alwaysOfferLocal: true },
    });
    expect(rendered(wrapper)).toEqual(['retry', 'useLocal']);
  });

  it('without alwaysOfferLocal, a code that omits useLocal does not gain it', () => {
    h.localFiles.value = true;
    expect(rendered(factory('popup-blocked'))).toEqual(['retry']);
  });

  it('never renders "use a local file" where local files do not work', () => {
    h.localFiles.value = false;
    for (const code of [
      'timeout',
      'consent-denied',
      'cancelled',
      'drive-full',
      'unknown',
    ] as const) {
      const wrapper = factory(code);
      expect(wrapper.find('[data-recovery="useLocal"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('storage.useLocalInstead');
    }
  });

  it('labels each recovery, Try again as the primary button', () => {
    h.localFiles.value = true;
    const wrapper = factory('drive-full');
    expect(wrapper.find('[data-recovery="retry"]').text()).toBe('action.tryAgain');
    expect(wrapper.find('[data-recovery="chooseAccount"]').text()).toBe(
      'join.recovery.signInDifferentAccount'
    );
    expect(wrapper.find('[data-recovery="useLocal"]').text()).toBe('storage.useLocalInstead');
    expect(wrapper.find('[data-recovery="retry"]').classes()).toContain('bg-primary-500');
    expect(wrapper.find('[data-recovery="chooseAccount"]').classes()).not.toContain(
      'bg-primary-500'
    );
  });

  it.each([
    ['retry', 'retry'],
    ['chooseAccount', 'chooseAccount'],
    ['useLocal', 'useLocal'],
  ] as const)('a %s tap emits %s and logs one tap event with the code', async (action, event) => {
    h.localFiles.value = true;
    const wrapper = factory('drive-full');

    await wrapper.find(`[data-recovery="${action}"]`).trigger('click');

    expect(wrapper.emitted(event)).toHaveLength(1);
    expect(h.logEvent).toHaveBeenCalledTimes(1);
    expect(h.logEvent).toHaveBeenCalledWith({
      level: 'info',
      surface: 'create-drive-failure',
      message: 'recovery tapped',
      context: { action, error_code: 'drive-full' },
    });
  });

  it('"Get the beanies app" opens the marketing download page and emits nothing', async () => {
    const wrapper = factory('unknown');

    await wrapper.find('[data-recovery="getApp"]').trigger('click');

    expect(wrapper.find('[data-recovery="getApp"]').text()).toBe('createPod.driveError.getApp');
    expect(h.openExternal).toHaveBeenCalledWith('https://beanies.family/download');
    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'getApp', error_code: 'unknown' } })
    );
    expect(Object.keys(wrapper.emitted())).not.toEqual(
      expect.arrayContaining(['retry', 'chooseAccount', 'useLocal'])
    );
  });

  it('always shows the help link, even with no recoveries, and opens the Drive article', async () => {
    const wrapper = factory('unsupported-browser');
    const help = wrapper.find('[data-recovery="help"]');
    expect(help.text()).toBe('createPod.driveError.help');

    await help.trigger('click');

    expect(h.openHelpArticle).toHaveBeenCalledWith(
      'getting-started/connecting-google-drive',
      'create-drive-failure'
    );
    // `openHelpArticle` logs its own `help_click`; no recovery tap here.
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('disables every recovery while the host is busy', () => {
    h.localFiles.value = true;
    const wrapper = factory('drive-full', true);
    for (const b of wrapper
      .findAll('button[data-recovery]')
      .filter((b) => b.attributes('data-recovery') !== 'help')) {
      expect(b.attributes('disabled')).toBeDefined();
    }
  });
});
