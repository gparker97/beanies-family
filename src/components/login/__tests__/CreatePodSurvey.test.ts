/**
 * CreatePodSurvey — the skippable "how did you hear about us?" step. Resolves the
 * selection to a stable English Slack label (or free text / null), emits it via
 * `complete`, and logs only the answered/skipped OUTCOME (never the channel) to
 * telemetry. Must never block pod creation. See
 * docs/plans/2026-07-21-remove-invite-gate-create-welcome-modal.md.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));

import CreatePodSurvey from '../CreatePodSurvey.vue';

const stubs = { PageWelcomeSubtitle: { props: ['text'], template: '<p>{{ text }}</p>' } };

function render() {
  return mount(CreatePodSurvey, { global: { stubs } });
}

const lastComplete = (w: ReturnType<typeof render>) => {
  const events = w.emitted('complete');
  return events?.[events.length - 1]?.[0] as string | null | undefined;
};
const actionsLogged = () =>
  logEventMock.mock.calls.map((c) => (c[0] as { context?: { action?: string } }).context?.action);

beforeEach(() => {
  logEventMock.mockReset();
  sessionStorage.clear();
});

describe('CreatePodSurvey', () => {
  it('renders all options and logs shown on mount', () => {
    const w = render();
    expect(w.find('[data-testid="survey-opt-reddit"]').exists()).toBe(true);
    expect(w.find('[data-testid="survey-opt-ai"]').exists()).toBe(true);
    expect(w.find('[data-testid="survey-opt-other"]').exists()).toBe(true);
    expect(actionsLogged()).toContain('shown');
  });

  it('resolves a fixed option to its stable English Slack label + logs answered', async () => {
    const w = render();
    await w.get('[data-testid="survey-opt-reddit"]').trigger('click');
    await w.get('[data-testid="survey-finish"]').trigger('click');
    expect(lastComplete(w)).toBe('Reddit');
    expect(actionsLogged()).toContain('answered');
    // never leaks the channel into telemetry context
    expect(actionsLogged()).not.toContain('Reddit');
  });

  it('"somewhere else" reveals the free-text input and passes it verbatim', async () => {
    const w = render();
    expect(w.find('[data-testid="survey-other-input"]').exists()).toBe(false);
    await w.get('[data-testid="survey-opt-other"]').trigger('click');
    const input = w.get('[data-testid="survey-other-input"]');
    await input.setValue('  a coworker  ');
    await w.get('[data-testid="survey-finish"]').trigger('click');
    expect(lastComplete(w)).toBe('a coworker');
  });

  it('"somewhere else" with empty text resolves to null (skip)', async () => {
    const w = render();
    await w.get('[data-testid="survey-opt-other"]').trigger('click');
    await w.get('[data-testid="survey-finish"]').trigger('click');
    expect(lastComplete(w)).toBeNull();
    expect(actionsLogged()).toContain('skipped');
  });

  it('finishing with nothing selected completes as null', async () => {
    const w = render();
    await w.get('[data-testid="survey-finish"]').trigger('click');
    expect(lastComplete(w)).toBeNull();
    expect(actionsLogged()).toContain('skipped');
  });

  it('skip completes as null', async () => {
    const w = render();
    await w.get('[data-testid="survey-skip"]').trigger('click');
    expect(lastComplete(w)).toBeNull();
    expect(actionsLogged()).toContain('skipped');
  });

  it('tapping the selected option again clears it (single-select toggle)', async () => {
    const w = render();
    await w.get('[data-testid="survey-opt-google"]').trigger('click');
    await w.get('[data-testid="survey-opt-google"]').trigger('click');
    await w.get('[data-testid="survey-finish"]').trigger('click');
    expect(lastComplete(w)).toBeNull();
  });

  it.runIf(import.meta.env.DEV)('auto-skips under the e2e_auto_auth seam without logging', () => {
    sessionStorage.setItem('e2e_auto_auth', 'true');
    const w = render();
    expect(lastComplete(w)).toBeNull();
    expect(actionsLogged()).toHaveLength(0);
  });
});
