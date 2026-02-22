# Performance Considerations

> **Last updated:** 2026-02-22

beanies.family is a fully client-side, local-first application — all code runs in the browser with no backend server. This document covers the performance characteristics, known thresholds, and mitigation strategies for this architecture.

## Architecture Context

```
User Action → Vue Component → Pinia Store → IndexedDB
                                    ↓
                              Computed Props → Chart.js / DOM
                                    ↓
                              File Sync → Encrypted .beanpod File
```

Every operation in this pipeline runs on the browser's **main thread** (JavaScript is single-threaded). Long-running computations block the UI, causing jank, frozen interactions, or unresponsive pages. Understanding where the bottlenecks are — and at what scale — is key to keeping the app fast.

## Resource Boundaries

### IndexedDB Storage

| Factor             | Limit                  | Notes                                             |
| ------------------ | ---------------------- | ------------------------------------------------- |
| Per-origin quota   | ~50% of available disk | Browsers auto-manage; tens of GB on desktop       |
| Single record size | ~250MB                 | Practical limit; no concern for financial records |
| Total records      | Millions               | Performance degrades on queries, not storage      |

**Risk level: Very low.** Even 10 years of daily transactions produces ~50K records, well under 1MB of JSON data. IndexedDB storage is not a practical concern for this application.

### JavaScript Heap (Memory)

| Factor               | Limit                  | Notes                                               |
| -------------------- | ---------------------- | --------------------------------------------------- |
| Tab memory limit     | 1-4GB                  | Browser and OS dependent                            |
| Pinia store overhead | ~200 bytes/transaction | All active records held in memory via reactive refs |
| Vue reactivity proxy | 2-3x raw object size   | Every nested property wrapped in a Proxy            |

**Estimated memory footprint by scale:**

| Records | Raw data | With Vue reactivity | Concern?                     |
| ------- | -------- | ------------------- | ---------------------------- |
| 5K      | ~1MB     | ~3MB                | No                           |
| 50K     | ~10MB    | ~30MB               | No                           |
| 500K    | ~100MB   | ~300MB              | Yes — approaching tab limits |

**Risk level: Low.** A family generating 50K records over many years would use ~30MB, well within browser limits. Large bulk imports (e.g., importing 10 years of bank statements) could temporarily spike memory.

### CPU / Main Thread

This is the **most realistic bottleneck** for beanies.family. Operations that block the main thread:

| Operation                      | Complexity                      | When it hurts                    |
| ------------------------------ | ------------------------------- | -------------------------------- |
| Net worth history replay       | O(n) over all transactions      | 10K+ transactions                |
| Sorting/filtering lists        | O(n log n)                      | 10K+ visible records             |
| Currency conversion (bulk)     | O(n) with rate lookups          | Displaying all-account summaries |
| Chart.js rendering             | O(n) data points                | 500+ chart points                |
| Vue computed recomputation     | Cascading on dependency changes | Deep dependency chains           |
| File sync (.beanpod serialise) | O(n) over entire dataset        | 5MB+ file size                   |

**Risk level: Medium-term.** The `useNetWorthHistory` composable replays all transactions backwards on every period change. At 10K+ transactions with multiple currency conversions, this can cause noticeable jank (50-200ms blocking).

### File Sync (Read/Write)

| File size | Serialise time | Encrypt time | Write time | Total         |
| --------- | -------------- | ------------ | ---------- | ------------- |
| 500KB     | <10ms          | <10ms        | <50ms      | Imperceptible |
| 2MB       | ~20ms          | ~15ms        | ~100ms     | Slight delay  |
| 5MB       | ~50ms          | ~40ms        | ~200ms     | Noticeable    |
| 20MB      | ~200ms         | ~150ms       | ~500ms     | Disruptive    |

**Risk level: Medium-term.** The entire dataset is serialised as a single JSON blob. At 5MB+ (roughly 50K+ records with metadata), saves become perceptible. On mobile devices, these numbers are 2-3x worse.

### DOM / Rendering

| Factor               | Threshold    | Impact                          |
| -------------------- | ------------ | ------------------------------- |
| DOM nodes in a list  | 500+ rows    | Scroll jank, slow re-renders    |
| Chart.js data points | 500+ points  | Canvas rendering lag            |
| Reactive watchers    | 1000+ active | Memory + recomputation overhead |

**Risk level: Medium.** Transaction and account lists render all items currently. At 500+ visible rows, DOM overhead causes scroll jank even on fast hardware.

## Growth Timeline

Estimated thresholds for a typical family (2 adults, 2-3 accounts each, daily transactions):

| Timeframe   | Approx. records | File size   | Performance impact                   |
| ----------- | --------------- | ----------- | ------------------------------------ |
| Year 1-2    | < 3K            | < 300KB     | None                                 |
| Year 3-5    | 3K - 10K        | 300KB - 1MB | Minimal                              |
| Year 5-8    | 10K - 30K       | 1MB - 3MB   | Chart computation may lag            |
| Year 8-12   | 30K - 50K       | 3MB - 5MB   | List rendering, file sync noticeable |
| Year 12+    | 50K+            | 5MB+        | Multiple areas need attention        |
| Bulk import | 100K+ at once   | 10MB+       | Immediate concern                    |

## Mitigation Strategies

The strategies below are ordered by **impact and urgency** — items at the top should be implemented first.

---

### 1. Virtual Scrolling / Pagination for Lists

**Priority: High | Complexity: Low | Impact: High**

**Problem:** Rendering thousands of DOM nodes for transaction/account lists causes scroll jank and slow page loads.

**Solution:** Only render visible rows. Use virtual scrolling (renders ~20-50 DOM nodes regardless of list size) or simple pagination.

```ts
// Simple pagination approach
const PAGE_SIZE = 50;
const page = ref(1);

const visibleTransactions = computed(() =>
  filteredTransactions.value.slice(0, page.value * PAGE_SIZE)
);

// Load more on scroll or button click
function loadMore() {
  page.value++;
}
```

```ts
// Virtual scrolling approach (using vue-virtual-scroller)
// Only ~20 DOM nodes rendered at any time, regardless of list size
import { RecycleScroller } from 'vue-virtual-scroller';
```

**When to implement:** Before transaction lists exceed 500 items, or when any list rendering feels sluggish.

**Affected pages:** TransactionsPage, AccountsPage, RecurringItemsList

---

### 2. Computation Caching and Memoisation

**Priority: High | Complexity: Low | Impact: High**

**Problem:** `useNetWorthHistory` replays all transactions on every period change or currency switch. Vue's `computed()` recalculates whenever any dependency changes — even if the result would be the same.

**Solution:** Cache expensive computation results keyed by their inputs.

```ts
// Cache net worth computation by a composite key
const chartCache = new Map<string, NetWorthDataPoint[]>();

function getCacheKey(): string {
  return `${selectedPeriod.value}-${transactionsStore.transactions.length}-${settingsStore.baseCurrency}`;
}

const chartData = computed<NetWorthDataPoint[]>(() => {
  const key = getCacheKey();
  if (chartCache.has(key)) return chartCache.get(key)!;

  const result = computeNetWorthHistory(/* ... */);
  chartCache.set(key, result);

  // Evict old entries to prevent unbounded growth
  if (chartCache.size > 10) {
    const firstKey = chartCache.keys().next().value;
    if (firstKey) chartCache.delete(firstKey);
  }

  return result;
});
```

**When to implement:** When period switching on the dashboard feels sluggish (~100ms+ delay).

**Affected composables:** `useNetWorthHistory`, `useCurrencyDisplay` (bulk conversions)

---

### 3. Shallow Reactivity for Large Collections

**Priority: Medium | Complexity: Low | Impact: Medium**

**Problem:** Pinia's default `ref()` wraps every nested property in a Vue Proxy. For a 10K-item transaction array, this means 10K+ Proxy objects, each with recursive property interception.

**Solution:** Use `shallowRef` for large collections where individual item reactivity isn't needed.

```ts
// In Pinia store — before
const transactions = ref<Transaction[]>([]);

// After — only the array reference is reactive, not individual items
const transactions = shallowRef<Transaction[]>([]);

// IMPORTANT: must replace the entire array to trigger reactivity
function addTransaction(tx: Transaction) {
  transactions.value = [...transactions.value, tx];
}

// Item updates also require array replacement
function updateTransaction(id: string, updates: Partial<Transaction>) {
  transactions.value = transactions.value.map((t) => (t.id === id ? { ...t, ...updates } : t));
}
```

**Trade-off:** Individual item mutations don't trigger reactivity. Components must watch the array reference, not individual items. This is fine for list views but requires care in edit forms.

**When to implement:** When memory profiling shows excessive Proxy overhead (typically 50K+ records).

**Affected stores:** `transactionsStore`, `accountsStore`, `assetsStore`

---

### 4. Chart Data Downsampling

**Priority: Medium | Complexity: Low | Impact: Medium**

**Problem:** Chart.js performance and visual clarity both degrade past ~500 data points. The "All" period could produce thousands of points for long-running accounts.

**Solution:** Downsample to a maximum number of points using largest-triangle-three-buckets (LTTB) or simple interval sampling.

```ts
const MAX_CHART_POINTS = 200;

function downsample(data: NetWorthDataPoint[], maxPoints: number): NetWorthDataPoint[] {
  if (data.length <= maxPoints) return data;

  const step = (data.length - 2) / (maxPoints - 2);
  const result: NetWorthDataPoint[] = [data[0]!]; // Always keep first

  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(1 + i * step);
    result.push(data[idx]!);
  }

  result.push(data[data.length - 1]!); // Always keep last
  return result;
}
```

**When to implement:** When selecting "All" or "1Y" periods causes visible rendering delay.

**Affected components:** `NetWorthHeroCard`, future report charts

---

### 5. Web Workers for Heavy Computation

**Priority: Medium | Complexity: Medium | Impact: High**

**Problem:** Expensive operations (net worth replay, report generation, CSV import/export) block the main thread, freezing the UI.

**Solution:** Move heavy computation to a Web Worker. The worker runs on a separate thread and communicates via `postMessage`.

```ts
// workers/netWorthWorker.ts
self.onmessage = ({ data }) => {
  const { transactions, period, baseCurrency, rates, currentNetWorth } = data;
  const result = computeNetWorthHistory(transactions, period, baseCurrency, rates, currentNetWorth);
  self.postMessage(result);
};

// In composable
const worker = new Worker(new URL('../workers/netWorthWorker.ts', import.meta.url), {
  type: 'module',
});

function computeInWorker(params: WorkerParams): Promise<NetWorthDataPoint[]> {
  return new Promise((resolve) => {
    worker.onmessage = ({ data }) => resolve(data);
    worker.postMessage(params);
  });
}
```

**Trade-off:** Data must be serialisable (no Proxy objects, no functions). Must clone store data before posting to worker. Adds async complexity.

**When to implement:** When main-thread computations exceed 100ms (profile with `performance.now()` or Chrome DevTools).

**Best candidates:** Net worth history replay, CSV/data import parsing, report aggregation, bulk currency conversion

---

### 6. Incremental / Chunked File Sync

**Priority: Low | Complexity: Medium | Impact: Medium**

**Problem:** The entire dataset is serialised and encrypted as one JSON blob on every save. At 5MB+, this causes perceptible pauses.

**Solution A: Debounce saves** (simplest)

```ts
import { useDebounceFn } from '@vueuse/core';

// Save at most every 5 seconds, not on every mutation
const debouncedSave = useDebounceFn(saveToFile, 5000);
```

**Solution B: Delta/patch sync** (more complex)

```ts
// Only serialise and write changed entities
interface SyncDelta {
  updated: { store: string; records: unknown[] }[];
  deleted: { store: string; ids: string[] }[];
  timestamp: string;
}
```

**Solution C: Split file by entity type**

```ts
// Instead of one monolithic file, use separate files:
// family-data/accounts.json
// family-data/transactions.json
// family-data/settings.json
// Each file is smaller and can be saved independently
```

**When to implement:** When users report save delays or when file size exceeds 5MB.

---

### 7. Lazy Store Loading

**Priority: Low | Complexity: Low | Impact: Low-Medium**

**Problem:** All stores load their full dataset from IndexedDB on app startup, even if the user only visits the dashboard.

**Solution:** Load store data on-demand when the user navigates to a page that needs it.

```ts
// In store
const loaded = ref(false);

async function loadIfNeeded() {
  if (loaded.value) return;
  const data = await transactionRepository.getAll();
  transactions.value = data;
  loaded.value = true;
}

// In router guard
{
  path: '/transactions',
  component: TransactionsPage,
  beforeEnter: async () => {
    await useTransactionsStore().loadIfNeeded();
  },
}
```

**Trade-off:** Dashboard summary cards need data from multiple stores, so the dashboard route would still trigger most loads. Most beneficial for rarely-visited pages.

**When to implement:** When app startup time exceeds 1-2 seconds.

---

### 8. IndexedDB Query Optimisation

**Priority: Low | Complexity: Medium | Impact: Low**

**Problem:** Current repositories use `getAll()` and filter in JavaScript. At scale, this loads the entire table into memory for every query.

**Solution:** Use IndexedDB indexes and cursor-based queries to filter at the database level.

```ts
// Before — load all, filter in JS
const allTransactions = await db.getAll('transactions');
const filtered = allTransactions.filter((t) => t.accountId === accountId);

// After — use an index, only load matching records
const filtered = await db.getAllFromIndex('transactions', 'by-account', accountId);
```

```ts
// For date-range queries, use IDBKeyRange
const range = IDBKeyRange.bound(startDate, endDate);
const results = await db.getAllFromIndex('transactions', 'by-date', range);
```

**When to implement:** When `getAll()` calls take >50ms (profile in DevTools → Performance).

---

## Monitoring and Profiling

### Quick Performance Checks

Add lightweight timing to critical paths during development:

```ts
function timeExecution<T>(label: string, fn: () => T): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  if (elapsed > 50) {
    console.warn(`[perf] ${label}: ${elapsed.toFixed(1)}ms`);
  }
  return result;
}

// Usage
const chartData = timeExecution('netWorthHistory', () =>
  computeNetWorthHistory(transactions, period, rates)
);
```

### Browser DevTools

- **Chrome DevTools → Performance tab**: Record a session, look for long tasks (>50ms yellow bars)
- **Chrome DevTools → Memory tab**: Take heap snapshots, look for unexpected retention
- **Chrome DevTools → Application → IndexedDB**: Inspect database size and record counts
- **Lighthouse**: Run performance audits for overall page metrics

### Key Metrics to Watch

| Metric                         | Target  | Warning   | Action needed           |
| ------------------------------ | ------- | --------- | ----------------------- |
| Time to Interactive (TTI)      | < 2s    | 2-4s      | Lazy load stores        |
| Largest Contentful Paint (LCP) | < 2.5s  | 2.5-4s    | Optimise initial render |
| Computed prop execution        | < 16ms  | 16-100ms  | Add caching             |
| File sync write                | < 200ms | 200-500ms | Debounce / chunk        |
| List scroll FPS                | 60fps   | 30-60fps  | Virtual scrolling       |
| IndexedDB getAll()             | < 50ms  | 50-200ms  | Add indexes             |

## Summary

beanies.family's local-first architecture is well-suited for years of typical family use. The main performance risks are:

1. **Main thread blocking** from expensive computations (net worth replay, bulk currency conversion)
2. **DOM overload** from rendering large unvirtualised lists
3. **File sync latency** as the data file grows past 5MB

The mitigations are straightforward and can be implemented incrementally as the app's data grows. No architectural changes are needed — the current Vue + Pinia + IndexedDB stack scales well with these optimisations.

**Rule of thumb:** If any single operation takes more than 50ms, it's worth optimising. If it takes more than 200ms, users will notice. If it takes more than 1 second, it needs a loading indicator or should be moved to a Web Worker.
