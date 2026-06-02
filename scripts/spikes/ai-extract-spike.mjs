#!/usr/bin/env node
// Phase-1 extraction-quality gate harness for the private-AI wedge (ADR-030).
//
// Calls the Phala Cloud / RedPill confidential-inference API (OpenAI-compatible) with the SHIPPING
// extraction prompt against a folder of real invitation/itinerary/receipt images, validates the JSON,
// optionally scores against ground truth, and captures the per-response attestation header.
//
// This is a THROWAWAY validation harness, not production code. It answers one question per model:
// does the model reliably pull title/date/time/location from real images? We gate-test TWO open-weight
// vision models on Phala — qwen3-vl-30b (best documented quality) and gemma-3-27b (Google-origin, avoids
// the Alibaba optic) — and pick on evidence. If neither is good enough → switch the managed engine to
// Gemini Flash-Lite behind the same abstraction (the rest of the plan is unchanged).
//
// USAGE:
//   REDPILL_API_KEY=sk-... node scripts/spikes/ai-extract-spike.mjs <images-dir> [ground-truth.json]
//   # optionally override the models (comma-separated):
//   REDPILL_MODELS="phala/qwen3-vl-30b-a3b-instruct,phala/gemma-3-27b-it" REDPILL_API_KEY=sk-... node ...
//
// - <images-dir>: a folder of .jpg/.jpeg/.png/.webp images (use SYNTHETIC or NON-SENSITIVE samples —
//   this sends each image to a third-party API. Do NOT use real family data for the gate.)
// - [ground-truth.json] (optional): { "<filename>": { title, date, startTime, endTime, location } }
//   When provided, the harness scores per-field accuracy. Without it, it dumps extractions for review.
//
// No external deps — native fetch + fs only.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { buildExtractionMessages, REQUIRED_KEYS, PROMPT_VERSION } from './extractionPrompt.mjs';

// Provider-configurable: defaults to RedPill, override for Tinfoil etc.
//   RedPill: LLM_API_BASE=https://api.redpill.ai/v1  LLM_MODELS=phala/qwen3-vl-30b-a3b-instruct,phala/gemma-3-27b-it
//   Tinfoil: LLM_API_BASE=https://inference.tinfoil.sh/v1  LLM_MODELS=qwen3-vl-30b
const API_BASE = (process.env.LLM_API_BASE || 'https://api.redpill.ai/v1').replace(/\/+$/, '');
const API_URL = `${API_BASE}/chat/completions`;
const DEFAULT_MODELS = ['phala/qwen3-vl-30b-a3b-instruct', 'phala/gemma-3-27b-it'];
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function fail(msg) {
  console.error(`\n[ai-extract-spike] ${msg}\n`);
  process.exit(1);
}

const apiKey = process.env.LLM_API_KEY || process.env.REDPILL_API_KEY;
if (!apiKey) {
  fail(
    'Missing LLM_API_KEY (or REDPILL_API_KEY).\n' +
      '  LLM_API_KEY=sk-... node scripts/spikes/ai-extract-spike.mjs <images-dir> [ground-truth.json]\n' +
      `  (API base: ${API_BASE} — override with LLM_API_BASE; models via LLM_MODELS)`
  );
}

const imagesDir = process.argv[2];
if (!imagesDir || !existsSync(imagesDir)) {
  fail(
    `Images dir not found: ${imagesDir || '(none provided)'}. Pass a folder of .jpg/.png images.`
  );
}

const groundTruthPath = process.argv[3];
let groundTruth = null;
if (groundTruthPath) {
  try {
    groundTruth = JSON.parse(readFileSync(groundTruthPath, 'utf8'));
  } catch (e) {
    fail(`Could not read/parse ground-truth JSON at ${groundTruthPath}: ${e.message}`);
  }
}

const models = (process.env.LLM_MODELS || process.env.REDPILL_MODELS || DEFAULT_MODELS.join(','))
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const todayIso = new Date().toISOString().slice(0, 10);
const images = readdirSync(imagesDir).filter((f) => MIME[extname(f).toLowerCase()]);
if (images.length === 0) fail(`No .jpg/.jpeg/.png/.webp images in ${imagesDir}.`);

// Pre-read + encode each image once (reused across models).
const encoded = images.map((file) => {
  const b64 = readFileSync(join(imagesDir, file)).toString('base64');
  return { file, dataUrl: `data:${MIME[extname(file).toLowerCase()]};base64,${b64}` };
});

console.log(`\n[ai-extract-spike] api=${API_BASE} prompt=${PROMPT_VERSION} today=${todayIso}`);
console.log(
  `[ai-extract-spike] ${images.length} image(s) from ${imagesDir} · models: ${models.join(', ')}`
);

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
// title/location pass if one contains the other (model phrasing varies); date/time must match exactly.
function fieldMatch(field, got, want) {
  const g = norm(got);
  const w = norm(want);
  if (!w) return null; // no ground truth for this field → not scored
  if (field === 'title' || field === 'location') return g.includes(w) || w.includes(g);
  return g === w;
}

async function runModel(model) {
  console.log(`\n════════ ${model} ════════`);
  const scores = {
    title: [0, 0],
    date: [0, 0],
    startTime: [0, 0],
    endTime: [0, 0],
    location: [0, 0],
  };
  let parseFailures = 0;
  let requestFailures = 0;
  let attestationSeen = 0;

  for (const { file, dataUrl } of encoded) {
    let result;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: buildExtractionMessages(dataUrl, todayIso),
          temperature: 0,
        }),
      });
      if (!res.ok) {
        requestFailures++;
        const body = await res.text().catch(() => '');
        console.log(`✗ ${file}: HTTP ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
        continue;
      }
      if (res.headers.get('x-phala-receipt-sig') || res.headers.get('x-phala-compose-hash'))
        attestationSeen++;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      const jsonText = content
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
      result = JSON.parse(jsonText);
      const missing = REQUIRED_KEYS.filter((k) => !(k in result));
      if (missing.length) {
        parseFailures++;
        console.log(`✗ ${file}: JSON missing keys [${missing.join(', ')}]`);
        continue;
      }
    } catch (e) {
      parseFailures++;
      console.log(`✗ ${file}: ${e.message}`);
      continue;
    }

    const truth = groundTruth?.[file];
    if (truth) {
      const line = [];
      for (const f of Object.keys(scores)) {
        const m = fieldMatch(f, result[f], truth[f]);
        if (m === null) continue;
        scores[f][1]++;
        if (m) scores[f][0]++;
        line.push(`${f}:${m ? '✓' : '✗'}`);
      }
      console.log(`• ${file}  ${line.join('  ')}`);
      if (line.some((l) => l.endsWith('✗')))
        console.log(
          `    got: ${JSON.stringify({ title: result.title, date: result.date, startTime: result.startTime, location: result.location })}`
        );
    } else {
      console.log(`• ${file}  (no ground truth — review)`);
      console.log(
        `    ${JSON.stringify({ isEvent: result.isEvent, title: result.title, date: result.date, startTime: result.startTime, endTime: result.endTime, location: result.location })}`
      );
    }
  }

  console.log(
    `  ── ${model}: requests failed ${requestFailures} · parse/shape failures ${parseFailures} · attestation header ${attestationSeen}/${images.length}`
  );
  if (groundTruth) {
    let totalGot = 0,
      totalPoss = 0;
    for (const [f, [got, poss]] of Object.entries(scores)) {
      if (poss === 0) continue;
      totalGot += got;
      totalPoss += poss;
      console.log(`     ${f.padEnd(10)} ${got}/${poss}  (${Math.round((got / poss) * 100)}%)`);
    }
    if (totalPoss)
      console.log(
        `     ${'OVERALL'.padEnd(10)} ${totalGot}/${totalPoss}  (${Math.round((totalGot / totalPoss) * 100)}%)`
      );
  }
}

for (const model of models) {
  await runModel(model);
}

console.log('\n──────── done ────────');
console.log(
  groundTruth
    ? 'Compare per-model OVERALL %. Pick the stronger extractor (weigh Qwen quality vs Gemma origin-optics). Weak/erratic on both → switch managed engine to Gemini Flash-Lite.'
    : 'No ground-truth file supplied — extractions printed above for manual review. Add a ground-truth.json for scored accuracy.'
);
console.log('');
