import { describe, it, expect, vi, beforeEach } from 'vitest';

const slackPostMock = vi.fn();
const reportErrorMock = vi.fn();
const logEventMock = vi.fn();

vi.mock('@/utils/slackNotify', () => ({
  slackPost: (...args: unknown[]) => slackPostMock(...args),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportErrorMock(...args),
}));
vi.mock('@/services/telemetry', () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}));
vi.mock('@/utils/diagnosticContext', () => ({
  getFullVersionLabel: () => 'v9.9 · abc123',
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({
    activeFamilyId: 'fam-123',
    activeFamilyName: 'The Parker Beanies',
  }),
}));

import { buildFeedbackText, submitFeedback } from '../feedbackSubmit';

beforeEach(() => {
  vi.resetAllMocks();
  // Default: the webhook is configured and the request leaves the device.
  slackPostMock.mockResolvedValue({ outcome: 'dispatched' });
});

/** Let the slackPost promise + its .then settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('buildFeedbackText', () => {
  it('includes score, band, comment, contact, and a diagnostic footer', () => {
    const text = buildFeedbackText({
      score: 9,
      answer: 'love it',
      contactName: 'Ada',
      contactEmail: 'ada@example.com',
    });
    expect(text).toContain('9/10 (promoter)');
    expect(text).toContain('love it');
    expect(text).toContain('Ada');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('v9.9 · abc123');
    expect(text).toContain('fam-123');
  });

  it('renders an em-dash placeholder for an empty comment and omits contact when absent', () => {
    const text = buildFeedbackText({ score: 3 });
    expect(text).toContain('3/10 (detractor)');
    expect(text).toContain('—');
    expect(text).not.toContain('Reply to:');
  });

  it('attaches the family name + id by default', () => {
    const text = buildFeedbackText({ score: 7 });
    expect(text).toContain('The Parker Beanies');
    expect(text).toContain('fam-123');
  });

  it('omits the family name + id when anonymous', () => {
    const text = buildFeedbackText({ score: 7, anonymous: true });
    expect(text).not.toContain('The Parker Beanies');
    expect(text).not.toContain('fam-123');
    expect(text).toContain('(anonymous)');
  });

  it('never contains financial-data markers', () => {
    const text = buildFeedbackText({ score: 5, answer: 'ok' });
    expect(text.toLowerCase()).not.toMatch(/balance|net worth|account number/);
  });
});

describe('submitFeedback', () => {
  it('posts to the feedback webhook with scope "feedback"', async () => {
    submitFeedback({ score: 8 });
    expect(slackPostMock).toHaveBeenCalledTimes(1);
    const [, payload, scope] = slackPostMock.mock.calls[0];
    expect(payload).toHaveProperty('text');
    expect(scope).toBe('feedback');
    await settle();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe('submitFeedback — delivery telemetry', () => {
  it('logs a dispatched outcome on the success path so a rate is measurable', async () => {
    submitFeedback({ score: 8 });
    await settle();
    expect(logEventMock).toHaveBeenCalledTimes(1);
    const [arg] = logEventMock.mock.calls[0];
    expect(arg.level).toBe('info');
    expect(arg.surface).toBe('feedback-submit');
    expect(arg.context).toEqual({ action: 'dispatched' });
    expect(arg.flush).toBe(true);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('pages critical when the webhook is unconfigured — the Aug 2026 silent-drop regression', async () => {
    slackPostMock.mockResolvedValue({ outcome: 'skipped_no_url' });
    submitFeedback({ score: 9 });
    await settle();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [arg] = reportErrorMock.mock.calls[0];
    expect(arg.severity).toBe('critical');
    expect(arg.surface).toBe('feedback-submit');
    expect(arg.context).toEqual({ action: 'dropped_no_webhook' });
  });

  it('pages critical when the POST fails at the network layer', async () => {
    slackPostMock.mockResolvedValue({ outcome: 'network_error', error: new Error('offline') });
    submitFeedback({ score: 4 });
    await settle();
    const [arg] = reportErrorMock.mock.calls[0];
    expect(arg.severity).toBe('critical');
    expect(arg.context).toEqual({ action: 'network_error' });
  });

  it('does not throw, and never leaks the raw feedback, when slackPost throws', async () => {
    slackPostMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => submitFeedback({ score: 2, answer: 'SECRET_FEEDBACK_XYZ' })).not.toThrow();
    await settle();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [arg] = reportErrorMock.mock.calls[0];
    expect(arg.severity).toBe('critical');
    expect(arg.surface).toBe('feedback-submit');
    expect(arg.context).toEqual({ action: 'build_error' });
    // The raw feedback text must never reach the error/telemetry pipeline.
    expect(JSON.stringify(arg)).not.toContain('SECRET_FEEDBACK_XYZ');
  });

  it('emits exactly one outcome event per submission', async () => {
    submitFeedback({ score: 7 });
    await settle();
    expect(logEventMock.mock.calls.length + reportErrorMock.mock.calls.length).toBe(1);
  });
});
