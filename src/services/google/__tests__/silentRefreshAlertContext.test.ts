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

  it('hadRefreshToken=false short-circuits would-be-noise alerts (caller responsibility)', () => {
    // The builder itself does not branch — it surfaces the field; callers
    // (syncStore cold-start path, offlineQueue flush path) decide whether
    // to suppress based on `ctx.silent_refresh_had_refresh_token === false`.
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
});
