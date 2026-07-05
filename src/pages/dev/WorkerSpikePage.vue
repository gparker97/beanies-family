<script setup lang="ts">
/**
 * ADR-032 spike harness — dev-only, measurement only. NOT production.
 *
 * Runs the off-main-thread Automerge assumption test: builds a ~target-size doc
 * in a worker, then measures the MAIN-THREAD frame-gap (jank) while the worker
 * pushes the materialized collections back — chunked vs one-shot — plus a
 * CryptoKey-postMessage check and an entity-delta round-trip. Open on each
 * target device (esp. an iOS PWA) and hit Run. Record the numbers, then delete.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';

type Row = { label: string; value: string; warn?: boolean; good?: boolean };
const rows = ref<Row[]>([]);
const running = ref(false);
const targetCount = ref(5_000);
const status = ref('');
const ua = navigator.userAgent;

let worker: Worker | null = null;
let maxGap = 0;
let probing = false;
let lastFrame = performance.now();
let rafId = 0;

function frame() {
  const now = performance.now();
  if (probing) {
    const g = now - lastFrame;
    if (g > maxGap) maxGap = g;
  }
  lastFrame = now;
  rafId = requestAnimationFrame(frame);
}
onMounted(() => {
  rafId = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  worker?.terminate();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function push(label: string, value: string, opts: { warn?: boolean; good?: boolean } = {}) {
  rows.value = [...rows.value, { label, value, ...opts }];
}

function waitFor(type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const h = (e: MessageEvent) => {
      const d = e.data as Record<string, unknown>;
      if (d?.type === type || d?.type === 'error') {
        worker!.removeEventListener('message', h);
        resolve(d);
      }
    };
    worker!.addEventListener('message', h);
  });
}

async function withProbe<T>(
  fn: () => Promise<T>
): Promise<{ res: T; maxGapMs: number; wallMs: number }> {
  maxGap = 0;
  probing = true;
  const t0 = performance.now();
  const res = await fn();
  probing = false;
  return { res, maxGapMs: Math.round(maxGap), wallMs: Math.round(performance.now() - t0) };
}

async function run() {
  if (running.value) return;
  running.value = true;
  rows.value = [];
  try {
    worker = new Worker(
      new URL('../../services/automerge/worker/spike/spikeWorker.ts', import.meta.url),
      {
        type: 'module',
      }
    );
    // Surface worker-level failures (module-init / WASM-load errors) that would
    // otherwise hang the harness silently — the #1 cause of a stuck "Running…".
    worker.onerror = (ev) => {
      console.error('[spike] worker.onerror', ev);
      push('WORKER ERROR', ev.message || String(ev), { warn: true });
      status.value = '';
      worker?.terminate();
      worker = null;
      running.value = false;
    };
    worker.onmessageerror = () =>
      push('WORKER messageerror (serialization)', 'see console', { warn: true });

    const onProgress = (e: MessageEvent) => {
      const d = e.data as Record<string, unknown>;
      if (d?.type === 'progress') status.value = `Building doc… ${d.built}/${d.target} txns`;
    };
    worker.addEventListener('message', onProgress);
    status.value = 'Building doc…';
    worker.postMessage({ type: 'generate', targetCount: targetCount.value });
    const gen = (await Promise.race([
      waitFor('generated'),
      new Promise<Record<string, unknown>>((r) =>
        setTimeout(() => r({ type: 'error', message: 'generate timed out after 60s' }), 60_000)
      ),
    ])) as Record<string, unknown>;
    worker.removeEventListener('message', onProgress);
    status.value = '';
    if (!worker) return; // onerror already handled it
    if (gen.type === 'error') return push('Generate FAILED', String(gen.message), { warn: true });
    push(
      'Doc built',
      `${((gen.saveBytes as number) / 1_048_576).toFixed(2)} MB · ${gen.entityCount} txns`
    );
    push('Worker Automerge.load (off main)', `${gen.loadMs} ms`, { good: true });

    const base = await withProbe(() => sleep(600));
    push('Baseline frame gap (idle)', `${base.maxGapMs} ms`);

    worker.postMessage({ type: 'materializeChunked', chunkSize: 2000 });
    const chunked = await withProbe(() => waitFor('chunkDone'));
    const cg = chunked.maxGapMs;
    push('Chunked receive — MAX frame gap', `${cg} ms`, cg > 100 ? { warn: true } : { good: true });
    push('Chunked receive — wall', `${chunked.wallMs} ms · ${chunked.res.chunks} chunks`);
    push('Worker materialize', `${chunked.res.materializeMs} ms`);

    worker.postMessage({ type: 'materializeOneShot' });
    const oneshot = await withProbe(() => waitFor('oneShot'));
    push(
      'One-shot receive — MAX frame gap',
      `${oneshot.maxGapMs} ms`,
      oneshot.maxGapMs > 100 ? { warn: true } : {}
    );

    // Non-extractable AES-GCM key — mirrors the real family key posted to the worker.
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    worker.postMessage({ type: 'cryptoKeyTest', key, sampleBytes: 2_000_000 });
    const ck = await waitFor('cryptoKeyResult');
    if (ck.type === 'error') push('CryptoKey postMessage', `FAILED: ${ck.message}`, { warn: true });
    else
      push(
        'CryptoKey postMessage → encrypt/decrypt',
        ck.ok ? `ok · enc ${ck.encMs}ms / dec ${ck.decMs}ms` : 'MISMATCH',
        ck.ok ? { good: true } : { warn: true }
      );

    const t = performance.now();
    worker.postMessage({ type: 'deltaEcho', echoTs: t });
    await waitFor('deltaResult');
    push('Entity-delta round-trip (idle worker)', `${Math.round(performance.now() - t)} ms`, {
      good: true,
    });

    const pass = cg < 100 && ck.ok;
    push(
      'VERDICT',
      pass
        ? 'PASS — main thread stayed responsive; CryptoKey works'
        : 'REVIEW — see warnings above',
      pass ? { good: true } : { warn: true }
    );
  } catch (e) {
    push('Spike crashed', e instanceof Error ? e.message : String(e), { warn: true });
  } finally {
    worker?.terminate();
    worker = null;
    running.value = false;
  }
}
</script>

<template>
  <div
    style="
      color: #2c3e50;
      font-family: system-ui, sans-serif;
      margin: 0 auto;
      max-width: 760px;
      padding: 24px;
    "
  >
    <h1 style="font-size: 1.4rem; font-weight: 800; margin-bottom: 4px">ADR-032 worker spike</h1>
    <p style="color: #64748b; font-size: 0.85rem; margin-bottom: 16px">
      Off-main-thread Automerge assumption test. Run on each target device (esp. an iOS PWA). Record
      the numbers, then delete this page.
    </p>

    <div style="align-items: center; display: flex; gap: 10px; margin-bottom: 16px">
      <label style="font-size: 0.85rem">Transactions (count):</label>
      <input
        v-model.number="targetCount"
        type="number"
        min="1000"
        step="1000"
        style="border: 1px solid #cbd5e1; border-radius: 8px; padding: 4px 8px; width: 90px"
      />
      <button
        :disabled="running"
        style="
          background: linear-gradient(135deg, #f15d22, #e67e22);
          border: 0;
          border-radius: 10px;
          color: #fff;
          cursor: pointer;
          font-weight: 700;
          padding: 8px 18px;
        "
        @click="run"
      >
        {{ running ? 'Running…' : 'Run spike' }}
      </button>
    </div>

    <p
      v-if="status"
      style="color: #f15d22; font-size: 0.85rem; font-weight: 600; margin-bottom: 12px"
    >
      {{ status }}
    </p>

    <table v-if="rows.length" style="border-collapse: collapse; font-size: 0.88rem; width: 100%">
      <tbody>
        <tr v-for="(r, i) in rows" :key="i" style="border-bottom: 1px solid #eef2f7">
          <td style="color: #475569; padding: 8px 10px">{{ r.label }}</td>
          <td
            style="
              font-variant-numeric: tabular-nums;
              font-weight: 600;
              padding: 8px 10px;
              text-align: right;
            "
            :style="{ color: r.warn ? '#dc2626' : r.good ? '#15803d' : '#2c3e50' }"
          >
            {{ r.value }}
          </td>
        </tr>
      </tbody>
    </table>

    <p style="color: #94a3b8; font-size: 0.72rem; margin-top: 20px; word-break: break-all">
      {{ ua }}
    </p>
  </div>
</template>
