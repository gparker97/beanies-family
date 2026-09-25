#!/usr/bin/env node
/**
 * THE GATE 3 PROOF: one real sealed extraction, end to end (#49, ADR-030).
 *
 * ADR-030 says Gate 3 "does not close again until a real sealed extraction has succeeded against
 * the live enclave", and nothing in CI can do that — the whole point is that it exercises the
 * live Tinfoil attestation, the real HPKE seal, our deployed Lambda, and the enclave's answer.
 * The previous attempt shipped a client that omitted `model` from the sealed body and failed
 * 100% of extractions, and every test passed, because the seal was mocked.
 *
 * So this script mirrors `managedProvider.run()` step for step, deliberately using the SAME
 * prompt builder the Lambda ships (`extractionPrompt.mjs`, kept byte-identical to the client's
 * by `extractionPromptDrift.test.ts`) and the SAME fingerprint function (`sourceFingerprint`),
 * so a pass here is evidence about the real contract rather than about this script.
 *
 * ⚠️ THIS COSTS REAL MONEY AND WRITES REAL DATA. One Tinfoil call, and one usage row against
 * whatever `--family` you pass. Default family id is obviously-a-test on purpose.
 *
 * Usage:
 *   node scripts/spikes/sealed-extraction.mjs [--family <id>] [--text "..."]
 *
 * Reads VITE_AI_EXTRACT_URL / VITE_AI_EXTRACT_API_KEY from .env.local.
 */
import { readFileSync } from 'node:fs';

import { Identity } from 'ehbp';
import { Verifier } from '@tinfoilsh/verifier';

import { EXTRACTION_TASKS } from '../../infrastructure/lambda/ai-extract/extractionPrompt.mjs';
import { sourceFingerprint } from '../../infrastructure/lambda/ai-extract/correctionGrant.mjs';

const ENCLAVE_URL = 'https://inference.tinfoil.sh';
const CONFIG_REPO = 'tinfoilsh/confidential-model-router';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  const next = i >= 0 ? args[i + 1] : undefined;
  // ⚠️ Not a truthiness test. `--family --text "…"` would otherwise take `--text` as the family
  // id and write a real DynamoDB usage row keyed on it.
  return next !== undefined && !next.startsWith('--') ? next : fallback;
};

const FAMILY_ID = arg('family', 'spike-sealed-extraction-do-not-bill');
const TEXT = arg(
  'text',
  "Ollie's class assembly is on Friday 3 October at 9:15am in the school hall. Parents welcome."
);

function env() {
  const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
  const read = (key) => {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(raw);
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : undefined;
  };
  const url = read('VITE_AI_EXTRACT_URL');
  const key = read('VITE_AI_EXTRACT_API_KEY');
  if (!url || !key) {
    console.error('Missing VITE_AI_EXTRACT_URL / VITE_AI_EXTRACT_API_KEY in .env.local');
    process.exit(1);
  }
  return { url, key };
}

const { url: PROXY_URL, key: PROXY_KEY } = env();

async function postToProxy(body) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': PROXY_KEY,
      origin: 'https://app.beanies.family',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: parsed };
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

// ── 1. Which model must go INSIDE the sealed body ────────────────────────────────────────────
// The enclave rejects a body with no `model`, and our proxy cannot add it to ciphertext. This is
// the exact field whose absence broke the first attempt.
step(1, 'asking the proxy which model to name (protocol: ehbp-config)');
const config = await postToProxy({ protocol: 'ehbp-config' });
if (config.status !== 200 || !config.body?.model) {
  console.error(
    `FAILED — the deployed Lambda does not answer the config probe (status ${config.status}).\n` +
      `Response: ${JSON.stringify(config.body)}\n` +
      'This almost certainly means the sealed arm is NOT DEPLOYED. Apply the ai-extract Lambda\n' +
      'with scripts/infra/tf-apply.sh first — deploy order is Lambda-first, always.'
  );
  process.exit(1);
}
const model = config.body.model;
console.log(`    model = ${model}`);

// ── 2. Verify the enclave, and take the key BOUND to that measurement ────────────────────────
step(2, 'verifying the SEV-SNP attestation against Tinfoil’s signed config repo');
const verifier = new Verifier({ serverURL: ENCLAVE_URL, configRepo: CONFIG_REPO });
const verified = await verifier.verify();
if (!verified?.hpkePublicKey) {
  console.error('FAILED — verification returned no hpkePublicKey. Nothing is safe to encrypt to.');
  process.exit(1);
}
console.log(`    hpkePublicKey = ${verified.hpkePublicKey.slice(0, 16)}…`);
console.log(`    measurement   = ${JSON.stringify(verified.measurement).slice(0, 80)}…`);

// ── 3. Build the prompt CLIENT-SIDE, through the shipped builder ─────────────────────────────
step(3, 'building the chat body through the shipped EXTRACTION_TASKS builder');
// The exact shape `index.mjs:267` builds — `kind` drives the builder, `text` the fingerprint.
const source = { kind: 'text', text: TEXT };
const todayIso = new Date().toISOString().slice(0, 10);
const messages = EXTRACTION_TASKS.share.buildMessages(source, todayIso);
const payload = { model, messages, temperature: 0 };
console.log(`    ${messages.length} messages, model present = ${Boolean(payload.model)}`);

// ── 4. Seal it ───────────────────────────────────────────────────────────────────────────────
step(4, 'sealing the body to the attested key (HPKE via ehbp)');
const identity = await Identity.fromPublicKeyHex(verified.hpkePublicKey);
const sealedReq = await identity.encryptRequestWithContext(
  new Request('https://enclave.invalid/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
);
const ciphertext = new Uint8Array(await sealedReq.request.arrayBuffer());
const ehbpHeaders = {};
for (const [n, v] of sealedReq.request.headers.entries()) if (/^ehbp-/i.test(n)) ehbpHeaders[n] = v;

const asText = new TextDecoder().decode(ciphertext);
if (asText.includes(TEXT.slice(0, 24))) {
  console.error('FAILED — the plaintext is readable in the "ciphertext". Refusing to send.');
  process.exit(1);
}
console.log(
  `    ${ciphertext.length} bytes, plaintext not present, headers: ${Object.keys(ehbpHeaders).join(', ')}`
);

// ── 5. Send it through OUR proxy ─────────────────────────────────────────────────────────────
step(5, 'POSTing the sealed envelope to the deployed Lambda');
const srcHash = sourceFingerprint(source);
const sent = await postToProxy({
  protocol: 'ehbp-1',
  familyId: FAMILY_ID,
  task: 'share',
  srcHash,
  ehbp: ehbpHeaders,
  contentType: sealedReq.request.headers.get('content-type') || 'application/json',
  sealed: Buffer.from(ciphertext).toString('base64'),
});
if (sent.status !== 200 || !sent.body?.sealed) {
  console.error(
    `FAILED — proxy returned ${sent.status}: ${JSON.stringify(sent.body)}\n` +
      'If this is `unknown_protocol`, the Lambda is older than this script.'
  );
  process.exit(1);
}
console.log(`    200, reply is sealed (${sent.body.sealed.length} b64 chars)`);

// ── 6. Open the reply ────────────────────────────────────────────────────────────────────────
step(6, 'opening the enclave’s reply');
const replyHeaders = new Headers();
for (const [n, v] of Object.entries(sent.body.ehbp || {})) replyHeaders.set(n, v);
const opener = await Identity.generate();
const plain = await opener.decryptResponseWithContext(
  new Response(Buffer.from(sent.body.sealed, 'base64'), { headers: replyHeaders }),
  sealedReq.context
);
const envelope = await plain.json();
const content = envelope?.choices?.[0]?.message?.content;
if (!content) {
  console.error(
    `FAILED — opened, but no choices[0].message.content: ${JSON.stringify(envelope).slice(0, 300)}`
  );
  process.exit(1);
}

console.log('\n─────────────────────────────────────────────────────────────');
console.log('GATE 3 PROOF: PASS');
console.log('  the document was encrypted to an ATTESTED enclave key on this device,');
console.log('  relayed as ciphertext by our own proxy, and answered by the enclave.');
console.log('─────────────────────────────────────────────────────────────');
console.log(`\nmodel said:\n${String(content).slice(0, 600)}`);
