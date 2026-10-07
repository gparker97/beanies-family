<script setup lang="ts">
// DEV-ONLY (#81): times the production PBKDF2 primitive on a real device.
import { computed, ref } from 'vue';
import { derivePbkdf2Key, KDF_PROFILES, LEGACY_ITERATIONS } from '@/services/crypto/kdfParams';

// The sweep: every profile's count, the legacy count, and a midpoint, deduped and sorted,
// so the page always measures the counts the app actually uses.
const COUNTS = [
  ...new Set([
    LEGACY_ITERATIONS,
    ...Object.values(KDF_PROFILES),
    Math.round((KDF_PROFILES.deviceFallback + KDF_PROFILES.secret) / 2),
  ]),
].sort((a, b) => a - b);
const RUNS = 3;
const SECRET = new TextEncoder().encode('kdf-benchmark-secret');

interface Stat {
  median: number;
  min: number;
  max: number;
}

const members = ref(4);
const adults = ref(2);
const busy = ref(false);
const error = ref('');
const results = ref<Record<number, Stat>>({});
const parallel = ref<{ members: number; ms: number } | null>(null);
const copied = ref(false);

const ua = navigator.userAgent;
const cores = navigator.hardwareConcurrency;

async function timeOne(iterations: number): Promise<number> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const t0 = performance.now();
  // `untracked`: the production primitive, but no `kdf_derive` row pollutes the fleet data.
  await derivePbkdf2Key(SECRET, salt, { profile: 'secret', iterations }, { untracked: true });
  return performance.now() - t0;
}

function stat(samples: number[]): Stat {
  const s = [...samples].sort((a, b) => a - b);
  return { median: s[Math.floor(s.length / 2)]!, min: s[0]!, max: s[s.length - 1]! };
}

async function guarded(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const runSuite = () =>
  guarded(async () => {
    const out: Record<number, Stat> = {};
    for (const count of COUNTS) {
      const samples: number[] = [];
      for (let i = 0; i < RUNS; i++) samples.push(await timeOne(count));
      out[count] = stat(samples);
      results.value = { ...out };
    }
  });

const runParallel = () =>
  guarded(async () => {
    const n = Math.max(1, Math.floor(members.value));
    const t0 = performance.now();
    await Promise.all(Array.from({ length: n }, () => timeOne(KDF_PROFILES.secret)));
    parallel.value = { members: n, ms: performance.now() - t0 };
  });

const ms = (v: number) => `${Math.round(v)} ms`;

// Cold open derives every member's wrap in parallel, so one derivation's time is the floor
// (+1 for the unwrap); the wall pad checks adults sequentially at the docHash count.
const coldOpenEstimate = computed(() => {
  const m = results.value[KDF_PROFILES.secret]?.median;
  return m === undefined ? null : m + 1;
});
const wallPadEstimate = computed(() => {
  const m = results.value[KDF_PROFILES.docHash]?.median;
  return m === undefined ? null : Math.max(1, Math.floor(adults.value)) * m;
});

const json = computed(() =>
  JSON.stringify(
    {
      ua,
      cores,
      results: Object.fromEntries(
        Object.entries(results.value).map(([c, s]) => [
          c,
          { median: s.median, min: s.min, max: s.max },
        ])
      ),
      parallel600k: parallel.value,
      timestamp: new Date().toISOString(),
    },
    null,
    2
  )
);
const showJson = ref(false);

async function copyJson() {
  try {
    await navigator.clipboard.writeText(json.value);
    copied.value = true;
    showJson.value = false;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    showJson.value = true;
  }
}
</script>

<template>
  <main class="bg-surface-ground dark:text-ink min-h-screen px-4 py-6 text-gray-900">
    <div class="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 class="font-outfit dark:text-ink text-3xl font-semibold text-gray-900">KDF benchmark</h1>
      <p class="dark:text-ink-soft text-base text-gray-600">
        Times the production PBKDF2 primitive on this device (untracked: nothing is logged). Run it
        on iPhone Safari and Pixel Chrome via <code>npm run dev -- --host</code>.
      </p>

      <section class="bg-surface-raised border-line rounded-2xl border p-4">
        <h2 class="font-outfit dark:text-ink text-xl font-semibold text-gray-900">This device</h2>
        <p class="dark:text-ink-soft mt-2 text-sm break-words text-gray-600">{{ ua }}</p>
        <p class="dark:text-ink-soft text-sm text-gray-600">Cores: {{ cores }}</p>
        <p class="dark:text-ink-faint mt-1 text-xs text-gray-500">
          Profiles: {{ Object.keys(KDF_PROFILES).join(', ') }}
        </p>
      </section>

      <section class="bg-surface-raised border-line rounded-2xl border p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-outfit dark:text-ink text-xl font-semibold text-gray-900">
            Suite ({{ RUNS }} runs per count)
          </h2>
          <button
            class="bg-primary-500 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            :disabled="busy"
            @click="runSuite"
          >
            {{ busy ? 'counting beans...' : 'Run suite' }}
          </button>
        </div>
        <table class="mt-3 w-full text-left text-sm">
          <thead class="dark:text-ink-soft text-gray-600">
            <tr>
              <th class="py-1">Iterations</th>
              <th>Median</th>
              <th>Min</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in COUNTS" :key="c" class="border-line border-t">
              <td class="py-1">{{ c.toLocaleString() }}</td>
              <template v-if="results[c]">
                <td>{{ ms(results[c]!.median) }}</td>
                <td class="dark:text-ink-soft text-gray-600">{{ ms(results[c]!.min) }}</td>
                <td class="dark:text-ink-soft text-gray-600">{{ ms(results[c]!.max) }}</td>
              </template>
              <td v-else colspan="3" class="dark:text-ink-faint text-gray-500">not run</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="bg-surface-raised border-line rounded-2xl border p-4">
        <h2 class="font-outfit dark:text-ink text-xl font-semibold text-gray-900">
          Model a family
        </h2>
        <div class="mt-2 flex gap-4">
          <label class="dark:text-ink-soft flex flex-col gap-1 text-sm text-gray-600">
            Members
            <input
              v-model.number="members"
              type="number"
              min="1"
              class="bg-surface-ground dark:text-ink border-line w-24 rounded-lg border px-2 py-1 text-gray-900"
            />
          </label>
          <label class="dark:text-ink-soft flex flex-col gap-1 text-sm text-gray-600">
            Adults
            <input
              v-model.number="adults"
              type="number"
              min="1"
              class="bg-surface-ground dark:text-ink border-line w-24 rounded-lg border px-2 py-1 text-gray-900"
            />
          </label>
        </div>
        <ul class="dark:text-ink mt-3 flex flex-col gap-1 text-sm text-gray-900">
          <li>
            Cold open by passphrase (members derive in parallel, one 600k median + 1 ms):
            <strong>{{
              coldOpenEstimate === null ? 'run suite first' : ms(coldOpenEstimate)
            }}</strong>
          </li>
          <li>
            Wall PIN pad worst case (adults x docHash, sequential, at the measured
            {{ KDF_PROFILES.docHash.toLocaleString() }} median):
            <strong>{{
              wallPadEstimate === null ? 'run suite first' : ms(wallPadEstimate)
            }}</strong>
          </li>
          <li>
            Measured parallel {{ parallel?.members ?? members }} x 600k:
            <strong>{{ parallel ? ms(parallel.ms) : 'not run' }}</strong>
          </li>
        </ul>
        <button
          class="border-line dark:text-ink mt-3 rounded-xl border px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50"
          :disabled="busy"
          @click="runParallel"
        >
          {{ busy ? 'counting beans...' : 'Run parallel 600k' }}
        </button>
      </section>

      <p v-if="error" class="text-primary-500 dark:text-accent-lift text-sm">{{ error }}</p>

      <section class="flex flex-col gap-2">
        <button
          class="border-line dark:text-ink self-start rounded-xl border px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50"
          :disabled="busy"
          @click="copyJson"
        >
          {{ copied ? 'Copied' : 'Copy JSON' }}
        </button>
        <pre
          v-if="showJson"
          class="bg-surface-raised border-line dark:text-ink overflow-x-auto rounded-2xl border p-3 text-xs text-gray-900"
          >{{ json }}</pre>
      </section>
    </div>
  </main>
</template>
