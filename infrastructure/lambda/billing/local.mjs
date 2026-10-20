#!/usr/bin/env node
/* global process, Buffer */
/* eslint-disable no-console -- a dev-only CLI; its output IS the interface */
/**
 * Local harness for the billing Lambda (#95 Phase 5). DEV TOOLING, never packaged: the
 * module's `archive_file` excludes this file, and nothing in `index.mjs` imports it.
 *
 * WHY IT EXISTS: day-to-day sandbox testing uses the DEPLOYED sandbox lane
 * (`https://api.beanies.family/sandbox`, `module.billing_sandbox`, decided 2026-10-20), which
 * `.env` points `npm run dev` at. This harness is for iterating on `index.mjs` itself before a
 * deploy: the handler runs unchanged on the dev machine against the sandbox keys from
 * `~/.beanies-tf.env` and the same sandbox billing table the lane uses.
 *
 *   source ~/.beanies-tf.env
 *   npm run billing:local                          # http://localhost:8787
 *   stripe listen --forward-to localhost:8787/billing/webhook   # optional: webhooks to the harness
 *   VITE_BILLING_BASE_URL=http://localhost:8787 npm run dev
 *
 * It wraps `handler` in a synthetic API Gateway HTTP API v2 event, so what runs is the same
 * routing, auth and Stripe code as prod. Env mapping (all overridable):
 *   STRIPE_SECRET_KEY      <- BEANIES_STRIPE_SANDBOX_SECRET_KEY (never the TF_VAR_, which may be live)
 *   STRIPE_WEBHOOK_SECRET  <- BEANIES_STRIPE_SANDBOX_WEBHOOK_SECRET, or the `whsec_` `stripe listen` prints
 *   STRIPE_PRE_V1_COUPON   <- TF_VAR_stripe_pre_v1_coupon (default PRE_V1_50)
 *   BILLING_API_KEY        <- TF_VAR_registry_api_key (the dev client sends the registry key)
 *   BILLING_TABLE_NAME     <- beanies-family-billing-sandbox (the lane's table); never a -prod table
 *   STRIPE_MODE            <- sandbox (the deployed lane's guards: mode_mismatch, sandbox_origin,
 *                             live_family), on top of the harness's own live-key refusal below
 *   REGISTRY_DEV_TABLE_NAME<- beanies-family-registry-dev (localhost families live there; a
 *                             localhost checkout looks the family up here, as on the lane)
 *   REGISTRY_TABLE_NAME    <- beanies-family-registry-prod, READ ONLY, for one thing: the
 *                             `live_family` existence check, so a real pod opened on
 *                             `npm run dev` can never pick up a sandbox plan token here either
 *   (DEV_ORIGINS keeps its default: localhost checks out; any other origin is `sandbox_origin`.)
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
  // The SANDBOX pair by name (never the TF_VAR_ lines, which hold whatever prod runs on).
  env.STRIPE_SECRET_KEY ||= env.BEANIES_STRIPE_SANDBOX_SECRET_KEY || '';
  env.STRIPE_WEBHOOK_SECRET ||= env.BEANIES_STRIPE_SANDBOX_WEBHOOK_SECRET || '';
  env.STRIPE_PRE_V1_COUPON ||= env.TF_VAR_stripe_pre_v1_coupon || 'PRE_V1_50';
  env.BILLING_API_KEY ||= env.TF_VAR_registry_api_key || '';
  // NEVER the prod billing table: a sandbox claim or a forwarded sandbox webhook would write
  // `status=active` and `cus_test_` ids into a LIVE family's row. The default is the sandbox
  // lane's table (Terraform `module.billing_sandbox`), so the registry's dev-origin entitlement
  // read sees what the harness writes. The registry default is the dev table for the same reason.
  env.BILLING_TABLE_NAME ||= 'beanies-family-billing-sandbox';
  // Same guards and tables as the deployed sandbox lane (module.billing_sandbox). A localhost
  // checkout reads the DEV registry (registryDevTable), so a live family's ownerEmail never
  // reaches the sandbox as `customer_email`; the PROD registry is read only for `live_family`.
  env.STRIPE_MODE ||= 'sandbox';
  env.REGISTRY_DEV_TABLE_NAME ||= 'beanies-family-registry-dev';
  env.REGISTRY_TABLE_NAME ||= 'beanies-family-registry-prod';
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
      `[billing-local] missing ${missing.join(', ')}. Run: source ~/.beanies-tf.env, then npm run billing:local (see infrastructure/lambda/billing/README.md).`
    );
    process.exit(1);
  }
  if (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY)) {
    console.error(
      '[billing-local] refusing to run on a LIVE Stripe key: the harness is for the sandbox only.'
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
  if (process.env.REGISTRY_TABLE_NAME === process.env.REGISTRY_DEV_TABLE_NAME) {
    console.error(
      `[billing-local] REGISTRY_TABLE_NAME and REGISTRY_DEV_TABLE_NAME are both ${process.env.REGISTRY_TABLE_NAME}: the live_family check would read the dev table and refuse every family. Unset REGISTRY_TABLE_NAME (default: beanies-family-registry-prod, read only).`
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
