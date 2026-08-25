/* global process */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.test/abc';
const { handler } = await import('../index.mjs');

/**
 * The real fetch, captured once. Restoration is an afterEach rather than an inline
 * `restore()` call, because inline restoration is skipped when an assertion throws — one
 * failure then leaks a stubbed `globalThis.fetch` into every later test in the file, and the
 * "never throws" case leaks a permanently-REJECTING one, failing the rest of the suite for a
 * reason unrelated to them.
 */
const REAL_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = REAL_FETCH;
});

/** Capture what would be posted to Slack instead of posting it. */
function captureSlack() {
  const posts = [];
  globalThis.fetch = async (_url, opts) => {
    posts.push(JSON.parse(opts.body));
    return { ok: true, status: 200 };
  };
  // `restore` is kept so existing call sites read unchanged; the afterEach above is what
  // actually guarantees it.
  return { posts, restore: () => (globalThis.fetch = REAL_FETCH) };
}

const snsEvent = (message, subject = 'ALARM') => ({
  Records: [{ Sns: { Subject: subject, Message: JSON.stringify(message) } }],
});

describe('alarm → slack formatting', () => {
  test('an ALARM reads like an alarm, and names the alarm + why', async () => {
    const { posts, restore } = captureSlack();
    await handler(
      snsEvent({
        AlarmName: 'beanies-family-content-fetch-high-invocations-prod',
        NewStateValue: 'ALARM',
        AlarmDescription: 'content-fetch invocations exceeded 200/hour — possible abuse.',
        NewStateReason: 'Threshold Crossed: 1 datapoint [512.0] was greater than 200.0.',
      })
    );
    restore();
    assert.equal(posts.length, 1);
    const t = posts[0].text;
    assert.match(t, /🚨/);
    assert.match(t, /high-invocations-prod/);
    assert.match(t, /\*ALARM\*/);
    assert.match(t, /possible abuse/);
    assert.match(t, /512\.0/, 'the actual number matters more than the threshold');
  });

  test('a RECOVERY is posted too — a silent recovery teaches you to distrust the alarm', async () => {
    const { posts, restore } = captureSlack();
    await handler(snsEvent({ AlarmName: 'x-throttles-prod', NewStateValue: 'OK' }));
    restore();
    assert.match(posts[0].text, /✅/);
    assert.match(posts[0].text, /\*OK\*/);
  });

  test('a non-alarm message is forwarded, not dropped', async () => {
    // Something publishing to this topic is itself worth a human seeing.
    const { posts, restore } = captureSlack();
    await handler({ Records: [{ Sns: { Subject: 'manual test', Message: 'not json{' } }] });
    restore();
    assert.match(posts[0].text, /non-alarm message/);
    assert.match(posts[0].text, /manual test/);
  });

  test('handles every record in a batch', async () => {
    const { posts, restore } = captureSlack();
    await handler({
      Records: [
        { Sns: { Message: JSON.stringify({ AlarmName: 'a', NewStateValue: 'ALARM' }) } },
        { Sns: { Message: JSON.stringify({ AlarmName: 'b', NewStateValue: 'OK' }) } },
      ],
    });
    restore();
    assert.equal(posts.length, 2);
  });

  test('a failing Slack post NEVER throws', async () => {
    // SNS retries a failed invocation, so throwing on a flapping alarm would hammer both
    // SNS and the webhook. The log line is the fallback record.
    const real = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    await assert.doesNotReject(() => handler(snsEvent({ AlarmName: 'x', NewStateValue: 'ALARM' })));
    globalThis.fetch = real;
  });

  test('an empty event is a no-op, not a crash', async () => {
    await assert.doesNotReject(() => handler({}));
  });
});
