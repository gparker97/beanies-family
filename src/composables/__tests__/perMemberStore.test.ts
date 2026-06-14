// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';

// Reactive member id drives the store's member watch.
const memberId = ref('');

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMemberId() {
      return memberId.value;
    },
  }),
}));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({ reportError: (i: unknown) => reportError(i) }));

import {
  createPerMemberStore,
  perMemberKey,
  readPerMemberRaw,
  writePerMemberState,
} from '@/composables/perMemberStore';

interface Demo {
  schemaVersion: 1;
  count: number;
}
const empty = (): Demo => ({ schemaVersion: 1, count: 0 });

function fromParsed(parsed: unknown): { state: Demo; persist?: boolean } {
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (parsed as { count?: unknown }).count === 'number'
  ) {
    return { state: { schemaVersion: 1, count: (parsed as Demo).count } };
  }
  return { state: empty(), persist: true };
}

function makeStore(over: Partial<Parameters<typeof createPerMemberStore<Demo>>[0]> = {}) {
  return createPerMemberStore<Demo>({
    prefix: 'demo',
    label: 'demoStore',
    saveSurface: 'demo-save',
    saveMessage: 'localStorage write failed for demo',
    empty,
    fromParsed,
    ...over,
  });
}

beforeEach(() => {
  localStorage.clear();
  reportError.mockClear();
  memberId.value = '';
});

describe('perMemberKey', () => {
  it('joins prefix and member id', () => {
    expect(perMemberKey('demo', 'm1')).toBe('demo-m1');
  });
});

describe('readPerMemberRaw', () => {
  it('reports missing for an absent key', () => {
    expect(readPerMemberRaw('demo', 'm1', 'demoStore')).toEqual({ kind: 'missing' });
  });
  it('reports ok with the parsed value for valid JSON', () => {
    localStorage.setItem('demo-m1', JSON.stringify({ a: 1 }));
    expect(readPerMemberRaw('demo', 'm1', 'demoStore')).toEqual({ kind: 'ok', value: { a: 1 } });
  });
  it('reports corrupt and warns for unparseable JSON', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('demo-m1', '{not json');
    expect(readPerMemberRaw('demo', 'm1', 'demoStore')).toEqual({ kind: 'corrupt' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('writePerMemberState', () => {
  it('persists JSON under the per-member key', () => {
    writePerMemberState('demo', 'm1', { count: 3 }, 'demoStore', 'demo-save', 'msg');
    expect(JSON.parse(localStorage.getItem('demo-m1')!)).toEqual({ count: 3 });
  });
  it('warns + reportErrors (severity warning) on a write failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // happy-dom's localStorage methods aren't on Storage.prototype — spy on the
    // instance (mirrors the useBeanTips persistence-failure test).
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    writePerMemberState('demo', 'm1', { count: 3 }, 'demoStore', 'demo-save', 'msg');
    expect(warn).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'demo-save', severity: 'warning' })
    );
    setSpy.mockRestore();
    warn.mockRestore();
  });
});

describe('createPerMemberStore — member sync', () => {
  it('loads the member state on member change and exposes the id', async () => {
    localStorage.setItem('demo-m1', JSON.stringify({ schemaVersion: 1, count: 7 }));
    const store = makeStore();
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    expect(store.memberId()).toBe('m1');
    expect(store.state.value.count).toBe(7);
  });

  it('does NOT clear on sign-out by default (keeps prior member state)', async () => {
    localStorage.setItem('demo-m1', JSON.stringify({ schemaVersion: 1, count: 7 }));
    const store = makeStore();
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    memberId.value = '';
    await nextTick();
    expect(store.memberId()).toBe('m1');
    expect(store.state.value.count).toBe(7);
  });

  it('clears on sign-out when clearOnSignOut is set', async () => {
    localStorage.setItem('demo-m1', JSON.stringify({ schemaVersion: 1, count: 7 }));
    const store = makeStore({ clearOnSignOut: true });
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    memberId.value = '';
    await nextTick();
    expect(store.memberId()).toBe('');
    expect(store.state.value).toEqual(empty());
  });
});

describe('createPerMemberStore — load + persist semantics', () => {
  it('persists a fresh state on a schema-mismatch (fromParsed persist hint)', async () => {
    localStorage.setItem('demo-m1', JSON.stringify({ schemaVersion: 99 }));
    const store = makeStore();
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    expect(store.state.value).toEqual(empty());
    // Overwritten with the fresh shape so the next read is clean.
    expect(JSON.parse(localStorage.getItem('demo-m1')!)).toEqual(empty());
  });

  it('does NOT overwrite a corrupt blob unless persistOnCorrupt is set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('demo-m1', '{not json');
    const store = makeStore();
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    expect(store.state.value).toEqual(empty());
    expect(localStorage.getItem('demo-m1')).toBe('{not json'); // left as-is
    warn.mockRestore();
  });

  it('overwrites a corrupt blob when persistOnCorrupt is set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('demo-m1', '{not json');
    const store = makeStore({ persistOnCorrupt: true });
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    expect(JSON.parse(localStorage.getItem('demo-m1')!)).toEqual(empty());
    warn.mockRestore();
  });

  it('save() applies toPersisted', async () => {
    const store = createPerMemberStore<Demo, Demo & { mirror: number }>({
      prefix: 'demo',
      label: 'demoStore',
      saveSurface: 'demo-save',
      saveMessage: 'msg',
      empty,
      fromParsed,
      toPersisted: (s) => ({ ...s, mirror: s.count }),
    });
    store.useMemberSync();
    memberId.value = 'm1';
    await nextTick();
    store.save({ schemaVersion: 1, count: 5 });
    expect(JSON.parse(localStorage.getItem('demo-m1')!)).toEqual({
      schemaVersion: 1,
      count: 5,
      mirror: 5,
    });
  });
});
