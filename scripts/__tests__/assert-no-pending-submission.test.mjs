/**
 * The pending-submission preflight.
 *
 * The part worth testing is the DECISION, not the HTTP: getting `judge` wrong either blocks
 * a good release (pending reported when there is none) or lets the 0.16 failure recur (a
 * pending submission waved through). The network shape is covered with an injected fetch.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  judge,
  fetchInProgressSubmissions,
  IN_PROGRESS_STATES,
} from '../deploy/assert-no-pending-submission.mjs';

const sub = (state, platform = 'IOS') => ({ attributes: { state, platform } });

describe('judge — the decision', () => {
  it('passes when there are no submissions at all', () => {
    expect(judge([], false)).toEqual({ ok: true, pending: [] });
  });

  it('passes when nothing is in an in-progress state', () => {
    // A completed or developer-rejected submission does not lock the version.
    const done = [sub('COMPLETE'), sub('CANCELING'), sub('READY_FOR_REVIEW')];
    expect(judge(done, false)).toEqual({ ok: true, pending: [] });
  });

  it.each(IN_PROGRESS_STATES)('BLOCKS on %s when replace was not requested', (state) => {
    const verdict = judge([sub(state)], false);
    expect(verdict.ok).toBe(false);
    expect(verdict.pending).toEqual([state]);
    // The message must name the flag that fixes it — the whole point is that the raw Apple
    // error ("relationship value is not acceptable") explains nothing.
    expect(verdict.message).toContain('replace_pending_submission');
  });

  it.each(IN_PROGRESS_STATES)('ALLOWS %s when replace was requested', (state) => {
    const verdict = judge([sub(state)], true);
    expect(verdict.ok).toBe(true);
    expect(verdict.note).toContain('will be cancelled');
  });

  it('warns about the queue cost specifically when replacing', () => {
    // Cancelling an IN_REVIEW submission is materially worse than cancelling a waiting one,
    // and the operator should see that in the log rather than discover it afterwards.
    expect(judge([sub('IN_REVIEW')], true).note).toContain('IN_REVIEW');
    expect(judge([sub('IN_REVIEW')], false).message).toContain('IN_REVIEW');
  });

  it('ignores malformed entries rather than throwing', () => {
    // A shape change at Apple must not crash a preflight that is meant to fail open.
    expect(judge([null, {}, { attributes: {} }, undefined], false)).toEqual({
      ok: true,
      pending: [],
    });
    expect(judge(undefined, false)).toEqual({ ok: true, pending: [] });
  });

  it('reports every pending state it found, not just the first', () => {
    const verdict = judge([sub('WAITING_FOR_REVIEW'), sub('IN_REVIEW')], false);
    expect(verdict.pending).toEqual(['WAITING_FOR_REVIEW', 'IN_REVIEW']);
  });
});

describe('IN_PROGRESS_STATES', () => {
  it('matches the states fastlane itself treats as in-progress', () => {
    // Copied from Spaceship::ConnectAPI::App#get_in_progress_review_submission (2.238.0).
    // If these ever diverge, the preflight predicts one thing and `reject_if_possible` does
    // another, which is worse than having no preflight.
    expect(IN_PROGRESS_STATES).toEqual(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES']);
  });
});

describe('fetchInProgressSubmissions', () => {
  it('filters by app, state and platform, and returns the data array', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [sub('IN_REVIEW')] }),
    }));

    const out = await fetchInProgressSubmissions({ appId: '123', token: 't', fetchImpl });

    expect(out).toHaveLength(1);
    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain('filter[app]=123');
    expect(url).toContain('filter[platform]=IOS');
    for (const state of IN_PROGRESS_STATES) expect(url).toContain(state);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer t');
  });

  it('throws on a non-2xx so the caller takes its fail-open path', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(fetchInProgressSubmissions({ appId: '1', token: 't', fetchImpl })).rejects.toThrow(
      /503/
    );
  });

  it('returns an empty array when Apple sends no data key', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await expect(
      fetchInProgressSubmissions({ appId: '1', token: 't', fetchImpl })
    ).resolves.toEqual([]);
  });
});
