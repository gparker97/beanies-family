import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: vi.fn(() => ({ members: [{ role: 'owner', email: 'owner@example.com' }] })),
}));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: vi.fn(() => ({
    activeFamilyId: 'fam-uuid',
    activeFamilyName: 'Robinsons',
  })),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: vi.fn(() => ({
    storageProviderType: 'google_drive',
    saveFailureLevel: 'none',
    driveFileNotFound: false,
  })),
}));

// Spy the queue so we can assert what logEvent hands off, without exercising
// the real transport (that has its own suite).
const enqueueSpy = vi.fn();
vi.mock('../logQueue', () => ({
  enqueueLogEvent: (record: unknown) => enqueueSpy(record),
}));

import { logEvent, __resetLogEventRateLimitForTesting } from '../logEvent';
import * as diagnosticContext from '@/utils/diagnosticContext';

describe('logEvent', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetLogEventRateLimitForTesting();
    enqueueSpy.mockClear();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('VITE_BUILD_SHA', 'test-sha');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('enriches, redacts, and hands a finished record to the queue', () => {
    logEvent({ level: 'warn', surface: 'silent-refresh', message: 'refresh failed' });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const record = enqueueSpy.mock.calls[0][0];
    expect(record.level).toBe('warn');
    expect(record.surface).toBe('silent-refresh');
    expect(record.message).toBe('refresh failed');
    expect(typeof record.timestamp).toBe('string');
    expect(record.family_id).toBe('fam-uuid');
    expect(record.build_sha).toBe('test-sha');
  });

  it('never includes family_email or family_name (PII-free firehose) even though both exist', () => {
    logEvent({ level: 'info', surface: 's', message: 'm' });
    const record = enqueueSpy.mock.calls[0][0];
    // Both PII fields are gated behind includeEmail (the Slack path); the
    // firehose passes includeEmail:false and correlates by the random family_id.
    expect(record.family_email).toBeUndefined();
    expect(record.family_name).toBeUndefined();
    expect(record.family_id).toBe('fam-uuid');
  });

  it('drops non-allowlisted context keys', () => {
    logEvent({
      level: 'info',
      surface: 's',
      message: 'm',
      context: { action: 'retry', memberName: 'leaked', http_status: 503 },
    });
    const record = enqueueSpy.mock.calls[0][0];
    expect(record.action).toBe('retry');
    expect(record.http_status).toBe(503);
    expect(record.memberName).toBeUndefined();
  });

  it('attaches a trimmed stack when an Error is passed', () => {
    logEvent({ level: 'error', surface: 's', message: 'm', error: new Error('boom') });
    const record = enqueueSpy.mock.calls[0][0];
    expect(typeof record.stack).toBe('string');
    expect(record.stack).toContain('Error: boom');
  });

  it('never throws when enrichment fails', () => {
    vi.spyOn(diagnosticContext, 'enrichAndRedact').mockImplementationOnce(() => {
      throw new Error('pinia exploded');
    });
    expect(() => logEvent({ level: 'error', surface: 's', message: 'm' })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith('[telemetry] logEvent failed', expect.any(Error));
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('rate-limits identical events to 50 per window (runaway-loop guard)', () => {
    for (let i = 0; i < 60; i++) {
      logEvent({ level: 'warn', surface: 'loop', message: 'same message' });
    }
    expect(enqueueSpy).toHaveBeenCalledTimes(50);
  });

  it('rate-limit buckets nearly-identical messages together (normalized)', () => {
    for (let i = 0; i < 60; i++) {
      logEvent({ level: 'warn', surface: 'loop', message: `failed for record ${100000 + i}` });
    }
    // All collapse to "failed for record <id>" → capped at 50.
    expect(enqueueSpy).toHaveBeenCalledTimes(50);
  });
});
