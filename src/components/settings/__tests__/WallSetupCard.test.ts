/**
 * WallSetupCard — the wall's home in Settings.
 *
 * Two things are asserted here beyond "it renders". First, the device checklist
 * is exactly three lines and swaps its wording by platform, because the whole
 * point of putting it on the card (rather than only in the help article) was
 * that it stays a glanceable nudge rather than becoming homework. Second, the
 * help link goes through `openHelpArticle`, which is what carries the click
 * telemetry and the never-fail-silently wrapper.
 *
 * The card must NOT reach for `useWakeLock`: that composable acquires a real
 * screen lock on setup, so asking it a question from Settings would hold the
 * screen awake while someone reads their settings. There is a source-level
 * guard for that at the bottom, because it is the kind of regression a mount
 * test cannot see.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { pushMock, openHelpArticleMock, getDevicePlatformMock, isWakeLockSupportedMock } =
  vi.hoisted(() => ({
    pushMock: vi.fn(),
    openHelpArticleMock: vi.fn(),
    getDevicePlatformMock: vi.fn(() => 'ios'),
    isWakeLockSupportedMock: vi.fn(() => true),
  }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/sync/capabilities', () => ({
  getDevicePlatform: getDevicePlatformMock,
  isWakeLockSupported: isWakeLockSupportedMock,
}));
vi.mock('@/utils/helpLinks', () => ({
  openHelpArticle: openHelpArticleMock,
  HELP_PATHS: { wallSetup: 'getting-started/set-up-the-beanie-wall' },
}));

const member = { id: 'm1', pinHash: 'set' } as { id: string; pinHash?: string };
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: [member] }) }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ currentUser: { memberId: 'm1' } }),
}));

import WallSetupCard from '../WallSetupCard.vue';

const stubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button><slot /></button>' },
  BeanieFormModal: { template: '<div><slot /></div>' },
  PinSettings: true,
};

const render = () => mount(WallSetupCard, { global: { stubs } });

beforeEach(() => {
  vi.clearAllMocks();
  getDevicePlatformMock.mockReturnValue('ios');
  isWakeLockSupportedMock.mockReturnValue(true);
  member.pinHash = 'set';
});

describe('the device checklist', () => {
  it('is three lines, and no more, whatever the platform', () => {
    for (const platform of ['ios', 'android', 'other'] as const) {
      getDevicePlatformMock.mockReturnValue(platform);
      expect(render().findAll('li')).toHaveLength(3);
    }
  });

  it('names Guided Access on an Apple device', () => {
    getDevicePlatformMock.mockReturnValue('ios');
    expect(render().text()).toContain('wall.setup.tips.guidedAccess');
  });

  it('names screen pinning on an Android device', () => {
    getDevicePlatformMock.mockReturnValue('android');
    expect(render().text()).toContain('wall.setup.tips.screenPinning');
  });

  it('says the screen setting is the only thing keeping it on where wake lock is unsupported', () => {
    isWakeLockSupportedMock.mockReturnValue(false);
    const text = render().text();
    expect(text).toContain('wall.setup.tips.screenOnly');
    expect(text).not.toContain('wall.setup.tips.screenBacked');
  });

  it('softens that line to a backstop where the browser can hold the screen awake itself', () => {
    isWakeLockSupportedMock.mockReturnValue(true);
    const text = render().text();
    expect(text).toContain('wall.setup.tips.screenBacked');
    expect(text).not.toContain('wall.setup.tips.screenOnly');
  });
});

describe('the help link', () => {
  it('opens the wall setup article through the shared helper, tagged with this surface', async () => {
    const wrapper = render();
    await wrapper.get('[data-testid="wall-setup-help"]').trigger('click');

    expect(openHelpArticleMock).toHaveBeenCalledWith(
      'getting-started/set-up-the-beanie-wall',
      'wall-setup-card'
    );
  });

  it('is present even before the member has a PIN, because device setup is independent of it', () => {
    member.pinHash = undefined;
    expect(render().find('[data-testid="wall-setup-help"]').exists()).toBe(true);
  });
});

describe('the card does not take a wake lock just to ask about one', () => {
  it('never imports useWakeLock', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../WallSetupCard.vue'), 'utf8');
    // Strip comments before asserting: the card's own comments name the thing
    // they are explaining that it must NOT do. Same approach as pinIdentity.test.ts.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    // `useWakeLock()` acquires on setup via a `{ immediate: true }` watcher, so
    // importing it here would light up a real screen lock on a Settings visit.
    // The support predicate lives in `capabilities.ts` precisely to avoid this.
    expect(src).not.toContain('useWakeLock');
    expect(src).toContain('isWakeLockSupported');
  });
});
