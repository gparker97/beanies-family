import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock googleAuth's diagnostic getter; mock visibilityTracker's hidden-duration.
vi.mock('@/services/google/googleAuth', () => ({
  getLastSilentRefreshDiagnostics: vi.fn(),
}));
vi.mock('@/utils/visibilityTracker', () => ({
  getHiddenDurationMs: vi.fn(),
}));

import { getLastSilentRefreshDiagnostics } from '@/services/google/googleAuth';
import { getHiddenDurationMs } from '@/utils/visibilityTracker';
import { buildSilentRefreshAlertContext } from '../silentRefreshAlertContext';

const getDiagMock = getLastSilentRefreshDiagnostics as ReturnType<typeof vi.fn>;
const getHiddenMock = getHiddenDurationMs as ReturnType<typeof vi.fn>;

describe('buildSilentRefreshAlertContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all-null fields when no diagnostics + no hidden history', () => {
    getDiagMock.mockReturnValue(null);
    getHiddenMock.mockReturnValue(null);

    const ctx = buildSilentRefreshAlertContext();

    expect(ctx.silent_refresh_attempts).toBeNull();
    expect(ctx.silent_refresh_had_refresh_token).toBeNull();
    expect(ctx.silent_refresh_consecutive_failures).toBeNull();
    expect(ctx.page_hidden_for_ms).toBeNull();
    expect(ctx.refresh_token_age_ms).toBeNull();
    // `document.visibilityState` is present in happy-dom — value is 'visible'.
    expect(ctx.visibility_state).toBe('visible');
  });

  it('forwards diagnostics fields when available', () => {
    getDiagMock.mockReturnValue({
      attempts: [
        {
          attempt: 1,
          durationMs: 123,
          classification: 'network',
          errorName: 'TypeError',
          errorMessage: 'Failed to fetch',
        },
      ],
      hadRefreshToken: true,
      consecutiveFailures: 2,
      refreshTokenAgeMs: 60_000,
    });
    getHiddenMock.mockReturnValue(8500);

    const ctx = buildSilentRefreshAlertContext();

    expect(ctx.silent_refresh_attempts).toHaveLength(1);
    expect(ctx.silent_refresh_attempts?.[0].classification).toBe('network');
    expect(ctx.silent_refresh_had_refresh_token).toBe(true);
    expect(ctx.silent_refresh_consecutive_failures).toBe(2);
    expect(ctx.page_hidden_for_ms).toBe(8500);
    expect(ctx.refresh_token_age_ms).toBe(60_000);
  });

  it('refresh_token_age_ms is null when diagnostic field is undefined', () => {
    // refreshTokenAgeMs is optional on the interface — older diagnostics
    // captured before the field was added won't have it.
    getDiagMock.mockReturnValue({
      attempts: [],
      hadRefreshToken: true,
      consecutiveFailures: 1,
      // refreshTokenAgeMs omitted
    });
    getHiddenMock.mockReturnValue(null);

    const ctx = buildSilentRefreshAlertContext();
    expect(ctx.refresh_token_age_ms).toBeNull();
  });

  it('surfaces hadRefreshToken=false without branching (caller responsibility)', () => {
    // The builder itself does not branch — it surfaces the fields; callers
    // (syncStore cold-start path, offlineQueue flush path) decide whether to
    // suppress. NOTE: they must branch on `error_code`, NOT on
    // `silent_refresh_had_refresh_token` — see the `error_code` cases below.
    getDiagMock.mockReturnValue({
      attempts: [],
      hadRefreshToken: false,
      consecutiveFailures: 0,
    });
    getHiddenMock.mockReturnValue(0);

    const ctx = buildSilentRefreshAlertContext();
    expect(ctx.silent_refresh_had_refresh_token).toBe(false);
    expect(ctx.silent_refresh_attempts).toEqual([]);
  });

  describe('error_code discriminator', () => {
    // `hadRefreshToken: false` is produced BOTH by a user who never connected
    // Drive AND by every refresh after a revocation (the permanent branch
    // clears the stored token). Only `reason` can tell them apart.
    it.each([
      ['no-token-stored', 'silent-refresh:no-token-stored'],
      ['revoked', 'silent-refresh:revoked'],
      ['exhausted', 'silent-refresh:exhausted'],
    ] as const)('maps reason=%s onto error_code=%s', (reason, expected) => {
      getDiagMock.mockReturnValue({
        attempts: [],
        hadRefreshToken: false,
        consecutiveFailures: 0,
        reason,
      });
      getHiddenMock.mockReturnValue(0);

      expect(buildSilentRefreshAlertContext().error_code).toBe(expected);
    });

    it('is null when no diagnostics have been recorded', () => {
      getDiagMock.mockReturnValue(null);
      getHiddenMock.mockReturnValue(0);

      expect(buildSilentRefreshAlertContext().error_code).toBeNull();
    });

    it('carries refresh_token_age_ms alongside a revoked reason', () => {
      // This pairing is the whole point: the age at revocation is what
      // distinguishes an expiry clock from cap-eviction.
      getDiagMock.mockReturnValue({
        attempts: [],
        hadRefreshToken: true,
        consecutiveFailures: 0,
        reason: 'revoked',
        refreshTokenAgeMs: 604_800_000,
      });
      getHiddenMock.mockReturnValue(0);

      const ctx = buildSilentRefreshAlertContext();
      expect(ctx.error_code).toBe('silent-refresh:revoked');
      expect(ctx.refresh_token_age_ms).toBe(604_800_000);
    });
  });
});
