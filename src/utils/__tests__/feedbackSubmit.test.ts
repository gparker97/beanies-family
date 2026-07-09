import { describe, it, expect, vi, beforeEach } from 'vitest';

const slackPostMock = vi.fn();
const reportErrorMock = vi.fn();

vi.mock('@/utils/slackNotify', () => ({
  slackPost: (...args: unknown[]) => slackPostMock(...args),
}));
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportErrorMock(...args),
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
});

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
  it('posts to the feedback webhook with scope "feedback"', () => {
    submitFeedback({ score: 8 });
    expect(slackPostMock).toHaveBeenCalledTimes(1);
    const [, payload, scope] = slackPostMock.mock.calls[0];
    expect(payload).toHaveProperty('text');
    expect(scope).toBe('feedback');
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('does not throw and reports a warning (without the raw feedback) if slackPost throws', () => {
    slackPostMock.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => submitFeedback({ score: 2, answer: 'SECRET_FEEDBACK_XYZ' })).not.toThrow();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    const [arg] = reportErrorMock.mock.calls[0];
    expect(arg.severity).toBe('warning');
    expect(arg.surface).toBe('feedback-submit');
    // The raw feedback text must never reach the error/telemetry pipeline.
    expect(JSON.stringify(arg)).not.toContain('SECRET_FEEDBACK_XYZ');
  });
});
