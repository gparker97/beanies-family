#!/usr/bin/env node
/* global process, Buffer */
/* eslint-disable no-console -- a dev-only CLI; its output IS the interface */
/**
 * Local harness for the billing Lambda (#95 Phase 5). DEV TOOLING, never packaged: the
 * module's `archive_file` excludes this file, and nothing in `index.mjs` imports it.
 *
 * WHY IT EXISTS: after the live-key flip, prod holds exactly one Stripe key pair. Sandbox
 * testing then happens here, on the dev machine, with the deployed handler running unchanged
 * against the sandbox keys from `~/.beanies-tf.env`. There is no second key set in prod or in
 * GitHub, on purpose (greg, 2026-10-01).
 *
 *   source ~/.beanies-tf.env
 *   npm run billing:local                          # http://localhost:8787
 *   stripe listen --forward-to localhost:8787/billing/webhook
 *   VITE_BILLING_BASE_URL=http://localhost:8787 npm run dev
 *
 * It wraps `handler` in a synthetic API Gateway HTTP API v2 event, so what runs is the same
 * routing, auth and Stripe code as prod. Env mapping (all overridable):
 *   STRIPE_SECRET_KEY      <- TF_VAR_stripe_secret_key
 *   STRIPE_WEBHOOK_SECRET  <- the `whsec_` that `stripe listen` prints (pass it explicitly)
 *   STRIPE_PRE_V1_COUPON   <- TF_VAR_stripe_pre_v1_coupon (default PRE_V1_50)
 *   BILLING_API_KEY        <- TF_VAR_registry_api_key (the dev client sends the registry key)
 *   BILLING_TABLE_NAME     <- REQUIRED, and never the prod table (see README: a sandbox table)
 *   REGISTRY_TABLE_NAME    <- beanies-family-registry-dev (localhost families live there)
 *   (DEV_ORIGINS keeps its default: the refusal only fires with a LIVE key, and the harness
 *    always runs with the sandbox key, so localhost checks out and reads the dev registry.)
 */

import { createServer } from 'node:http';

export const DEFAULT_PORT = 8787;

/** Translate a Node request (method, url, headers, body) into an HTTP API v2 proxy event. */
export function toLambdaEvent({ method, url, headers, body }) {
  const u = new URL(url, 'http://localhost');
  const lower = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined) continue;
    lower[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return {
    version: '2.0',
    rawPath: u.pathname,
    rawQueryString: u.search.slice(1),
    headers: lower,
    queryStringParameters: Object.keys(query).length ? query : undefined,
    requestContext: { http: { method: method.toUpperCase(), path: u.pathname } },
    body: body ?? '',
    isBase64Encoded: false,
  };
}

/** Write a Lambda `{ statusCode, headers, body }` result to a Node response. */
export function writeLambdaResult(res, result) {
  const status = result?.statusCode ?? 500;
  const headers = result?.headers ?? {};
  res.writeHead(status, headers);
  res.end(result?.body ?? '');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function applyLocalEnv(env = process.env) {
  env.STRIPE_SECRET_KEY ||= env.TF_VAR_stripe_secret_key || '';
  env.STRIPE_PRE_V1_COUPON ||= env.TF_VAR_stripe_pre_v1_coupon || 'PRE_V1_50';
  env.BILLING_API_KEY ||= env.TF_VAR_registry_api_key || '';
  // NEVER the prod billing table by default: after the live-key flip, a sandbox claim or a
  // forwarded sandbox webhook would write `status=active` and `cus_test_` ids into a LIVE
  // family's row. The harness needs its own table (README: one `create-table` line), named
  // explicitly. The registry default is the dev table for the same reason.
  env.BILLING_TABLE_NAME ||= '';
  // The DEV registry table (the one localhost origins already write to), never prod: a checkout
  // here would otherwise send a live family's ownerEmail to the sandbox as `customer_email`.
  env.REGISTRY_TABLE_NAME ||= 'beanies-family-registry-dev';
  env.CORS_ORIGINS ||= 'http://localhost:5173,http://localhost:4173';
  env.BILLING_LOCAL = '1';
  return env;
}

export async function startLocalServer({ port = DEFAULT_PORT, handler } = {}) {
  const h = handler ?? (await import('./index.mjs')).handler;
  const server = createServer(async (req, res) => {
    try {
      const body = await readBody(req);
      const result = await h(
        toLambdaEvent({ method: req.method, url: req.url, headers: req.headers, body })
      );
      writeLambdaResult(res, result);
    } catch (err) {
      console.error('[billing-local] handler threw', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'local harness: handler threw',
          detail: String(err?.message ?? err),
        })
      );
    }
  });
  await new Promise((resolve) => server.listen(port, resolve));
  return server;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  applyLocalEnv();
  const missing = ['STRIPE_SECRET_KEY', 'BILLING_API_KEY', 'BILLING_TABLE_NAME'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    console.error(
      `[billing-local] missing ${missing.join(', ')}. Run: source ~/.beanies-tf.env, then BILLING_TABLE_NAME=beanies-family-billing-sandbox npm run billing:local (see infrastructure/lambda/billing/README.md).`
    );
    process.exit(1);
  }
  if (
    /-prod$/.test(process.env.BILLING_TABLE_NAME) &&
    process.env.BILLING_LOCAL_ALLOW_PROD !== '1'
  ) {
    console.error(
      `[billing-local] refusing to run against ${process.env.BILLING_TABLE_NAME}: sandbox subscriptions would land in live families' rows. Use the sandbox table, or set BILLING_LOCAL_ALLOW_PROD=1 if you really mean it.`
    );
    process.exit(1);
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn(
      '[billing-local] STRIPE_WEBHOOK_SECRET unset: /billing/webhook will answer 400. Run `stripe listen --forward-to localhost:8787/billing/webhook` and export the whsec_ it prints.'
    );
  }
  const port = Number(process.env.BILLING_LOCAL_PORT || DEFAULT_PORT);
  await startLocalServer({ port });
  console.log(
    `[billing-local] billing Lambda on http://localhost:${port}  (sandbox key ${process.env.STRIPE_SECRET_KEY.slice(0, 8)}…, table ${process.env.BILLING_TABLE_NAME})`
  );
}
