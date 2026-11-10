/* global Buffer */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERROR_CODES,
  STATUS_FOR_CODE,
  corsHeaders,
  errorResponse,
  isRealDate,
  jsonResponse,
  readJsonBody,
  safeEqual,
  softKeyOk,
} from '../http.mjs';
import * as viaHandler from '../createHandler.mjs';
import { MAX_SUBSCRIBE_BYTES } from '../alerts.mjs';
import { MAX_WEBHOOK_BYTES } from '../webhook.mjs';

const ORIGINS = ['https://app.beanies.family', 'capacitor://app.beanies.family'];

describe('readJsonBody', () => {
  test('per-route limits: proxy 1 KB, subscribe 2 KB, webhook 64 KB', () => {
    const body = (n) => JSON.stringify({ pad: 'x'.repeat(n) });
    assert.equal(readJsonBody({ body: body(1100) }, viaHandler.MAX_BODY_BYTES).code, 'too_large');
    assert.equal(readJsonBody({ body: body(1100) }, MAX_SUBSCRIBE_BYTES).ok, true);
    assert.equal(readJsonBody({ body: body(2100) }, MAX_SUBSCRIBE_BYTES).code, 'too_large');
    assert.equal(readJsonBody({ body: body(60_000) }, MAX_WEBHOOK_BYTES).ok, true);
    assert.equal(readJsonBody({ body: body(70_000) }, MAX_WEBHOOK_BYTES).code, 'too_large');
  });

  test('base64 bodies decode; the size guard counts decoded bytes', () => {
    const raw = JSON.stringify({ flight: 'SQ318' });
    const ok = readJsonBody(
      { body: Buffer.from(raw).toString('base64'), isBase64Encoded: true },
      1024
    );
    assert.deepEqual(ok, { ok: true, body: { flight: 'SQ318' } });
    const big = Buffer.from(JSON.stringify({ p: 'y'.repeat(900) })).toString('base64');
    assert.equal(readJsonBody({ body: big, isBase64Encoded: true }, 512).code, 'too_large');
  });

  test('non-JSON, arrays, null and scalars are bad_request; an empty body is {}', () => {
    for (const b of ['{', '[1]', 'null', '42', '"x"']) {
      assert.deepEqual(readJsonBody({ body: b }, 1024), { ok: false, code: 'bad_request' }, b);
    }
    assert.deepEqual(readJsonBody({}, 1024), { ok: true, body: {} });
  });
});

describe('responses and checks', () => {
  test('CORS echoes an allowed origin, else the first', () => {
    assert.equal(
      corsHeaders({ headers: { origin: ORIGINS[1] } }, ORIGINS)['Access-Control-Allow-Origin'],
      ORIGINS[1]
    );
    assert.equal(
      corsHeaders({ headers: { origin: 'https://evil.example' } }, ORIGINS)[
        'Access-Control-Allow-Origin'
      ],
      ORIGINS[0]
    );
    assert.equal(corsHeaders({}, ORIGINS)['Access-Control-Allow-Origin'], ORIGINS[0]);
  });

  test('jsonResponse / errorResponse', () => {
    assert.deepEqual(jsonResponse(204, null, {}), { statusCode: 204, headers: {}, body: '' });
    const res = errorResponse('subscription_full', {}, { x: 1 });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(JSON.parse(res.body), {
      error: STATUS_FOR_CODE.subscription_full.message,
      code: 'subscription_full',
      x: 1,
    });
  });

  test('safeEqual: equal, unequal, length mismatch, nullish', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, 'x'), false);
    assert.equal(safeEqual(undefined, undefined), true);
  });

  test('softKeyOk refuses everyone when the key is unset', () => {
    assert.equal(softKeyOk({ headers: { 'x-api-key': 'k' } }, 'k'), true);
    assert.equal(softKeyOk({ headers: { 'x-api-key': 'k' } }, ''), false);
    assert.equal(softKeyOk({ headers: {} }, undefined), false);
  });

  test('isRealDate', () => {
    assert.equal(isRealDate('2026-12-13'), true);
    assert.equal(isRealDate('2026-02-30'), false);
    assert.equal(isRealDate('2026-1-3'), false);
  });

  test('the Phase 2 codes and their statuses; createHandler re-exports the one table', () => {
    const want = {
      not_found: 404,
      alert_token_rejected: 401,
      subscription_full: 409,
      alerts_unavailable: 503,
      webhook_rejected: 401,
      bad_platform: 400,
      bad_token: 400,
      bad_codes: 400,
    };
    for (const [code, status] of Object.entries(want))
      assert.equal(STATUS_FOR_CODE[code].status, status, code);
    assert.equal(viaHandler.STATUS_FOR_CODE, STATUS_FOR_CODE);
    assert.equal(viaHandler.ERROR_CODES, ERROR_CODES);
  });
});
