/**
 * Registry owner sync (plan 2026-10-06-registry-owner-sync), with fakes and no store. The email
 * check: once both the authoritative load and a registry answer are known, the registered owner's
 * device sends one `drift` PUT when its real email differs from the registry's, once per owner
 * state per session. The transfer: marker, save, `transfer` PUT, marker cleared on handover, else
 * kept and retried once on a later session's load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegistryEntry } from '@/types/models';
import type { RegistryOwnerSyncReason, RegistryWriteResult } from '../registryService';

const h = vi.hoisted(() => ({ observers: new Set<(e: RegistryEntry) => void>() }));

vi.mock('../registryService', () => ({
  addRegistryEntryObserver: (fn: (e: RegistryEntry) => void) => {
    h.observers.add(fn);
    return () => h.observers.delete(fn);
  },
}));

import {
  createRegistryOwnerSync,
  ownerEmailDiffers,
  ownerTransferMarkerKey,
  type RegistryOwnerSyncDeps,
} from '../registryOwnerSync';

const FAM = 'fam-1';
const GREG = 'greg-id';
const JILL = 'jill-id';
const KEY = ownerTransferMarkerKey(FAM);
const setMarker = (to: string) => localStorage.setItem(KEY, JSON.stringify(to));
const marker = () => localStorage.getItem(KEY);

type WriteFn = (f: string, r: RegistryOwnerSyncReason) => Promise<RegistryWriteResult | null>;

const removers: Array<() => void> = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  removers.splice(0).forEach((r) => r());
});

function setup(
  opts: {
    owner?: { id: string; email: string | null } | null;
    me?: string | null;
    write?: WriteFn;
    save?: () => Promise<boolean>;
  } = {}
) {
  const state = {
    family: FAM as string | null,
    owner: opts.owner === undefined ? { id: GREG, email: 'greg@new.com' } : opts.owner,
    me: opts.me === undefined ? GREG : opts.me,
  };
  const write = vi.fn<WriteFn>(
    opts.write ??
      (async () => ({
        pointerAccepted: true,
        owner: { memberId: GREG, email: 'greg@new.com' },
        outcome: 'email-synced',
      }))
  );
  const save = vi.fn(opts.save ?? (async () => true));
  const log = vi.fn<RegistryOwnerSyncDeps['log']>();
  const sync = createRegistryOwnerSync({
    activeFamilyId: () => state.family,
    podOwner: () => state.owner,
    me: () => state.me,
    write,
    save,
    log,
  });
  removers.push(sync.install());
  return { sync, state, write, save, log };
}

function serve(ownerMemberId: string | null, ownerEmail: string | null, familyId = FAM): void {
  const entry = { familyId, provider: 'google_drive', ownerMemberId, ownerEmail } as RegistryEntry;
  for (const o of [...h.observers]) o(entry);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const logged = (log: ReturnType<typeof setup>['log']) =>
  log.mock.calls.map(([detail, level, extra]) => `${detail}:${level}:${extra?.kind ?? ''}`);

describe('ownerEmailDiffers', () => {
  it('compares a real pod email with the registry, case- and space-insensitively', () => {
    expect(ownerEmailDiffers('greg@new.com', 'greg@old.com')).toBe(true);
    expect(ownerEmailDiffers('greg@new.com', null)).toBe(true);
    expect(ownerEmailDiffers('Greg@New.com', ' greg@new.com ')).toBe(false);
  });

  it('never differs for a missing, invalid or placeholder pod email', () => {
    expect(ownerEmailDiffers(null, 'greg@old.com')).toBe(false);
    expect(ownerEmailDiffers('', 'greg@old.com')).toBe(false);
    expect(ownerEmailDiffers('not-an-email', 'greg@old.com')).toBe(false);
    expect(ownerEmailDiffers('1717171717@temp.beanies.family', 'greg@old.com')).toBe(false);
  });
});

describe('registryOwnerSync: email sync', () => {
  it('syncs when I own the pod, the registry names me and the email differs', async () => {
    const { sync, write, log } = setup();
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(FAM, 'drift');
    expect(logged(log)).toEqual(['email-synced:info:email-synced']);
  });

  it('waits for both the load and the registry answer, in either order', async () => {
    const a = setup();
    serve(GREG, 'greg@old.com');
    await settle();
    expect(a.write).not.toHaveBeenCalled(); // registry answer, no load yet
    a.sync.onAuthoritativeLoad(FAM);
    await settle();
    expect(a.write).toHaveBeenCalledTimes(1);
    removers.splice(0).forEach((r) => r());

    const b = setup();
    b.sync.onAuthoritativeLoad(FAM);
    await settle();
    expect(b.write).not.toHaveBeenCalled(); // load, no registry answer yet
    serve(GREG, 'greg@old.com');
    await settle();
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it('ignores a registry answer or a load for another family', async () => {
    const { sync, write } = setup();
    sync.onAuthoritativeLoad('fam-2');
    serve(GREG, 'greg@old.com');
    serve(GREG, 'greg@old.com', 'fam-2');
    await settle();
    expect(write).not.toHaveBeenCalled();
  });

  it('does nothing when already in sync', async () => {
    const { sync, write, log } = setup();
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'GREG@new.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('does nothing for a placeholder pod email', async () => {
    const { sync, write } = setup({ owner: { id: GREG, email: '1717@temp.beanies.family' } });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
  });

  it('does nothing on a device whose member is not the pod owner', async () => {
    const { sync, write, log } = setup({ me: JILL });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('does nothing with no single pod owner (two owners) or nobody signed in', async () => {
    const a = setup({ owner: null });
    a.sync.onAuthoritativeLoad(FAM);
    const b = setup({ me: null });
    b.sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(a.write).not.toHaveBeenCalled();
    expect(b.write).not.toHaveBeenCalled();
    expect(logged(a.log)).toEqual(['skipped:info:no-sole-owner']);
  });

  it('logs skipped no-sole-owner once per state, however often it is checked', async () => {
    const { sync, log } = setup({ owner: null });
    sync.onAuthoritativeLoad(FAM);
    for (let i = 0; i < 3; i++) serve(GREG, 'greg@old.com');
    sync.onOwnerChange();
    await settle();
    expect(logged(log)).toEqual(['skipped:info:no-sole-owner']);
  });

  it('logs not-owner once (never a handover) when I own the pod but the registry names another', async () => {
    const { sync, write, log } = setup();
    sync.onAuthoritativeLoad(FAM);
    serve(JILL, 'jill@x.com');
    serve(JILL, 'jill@x.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(logged(log)).toEqual(['not-owner:warn:registry-names-another-member']);
  });

  it('repeated registry GETs never re-send (no PUT storm), even after a refusal', async () => {
    const { sync, write, log } = setup({
      write: async () => ({
        pointerAccepted: true,
        owner: { memberId: GREG, email: 'greg@old.com' },
        outcome: 'refused-off-canonical',
      }),
    });
    sync.onAuthoritativeLoad(FAM);
    for (let i = 0; i < 5; i++) serve(GREG, 'greg@old.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual(['refused:warn:refused-off-canonical']);
  });

  it('logs refused as unconfirmed for a Lambda that returns no outcome; skipped for null', async () => {
    const a = setup({ write: async () => ({ pointerAccepted: true }) });
    a.sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(logged(a.log)).toEqual(['refused:warn:unconfirmed']);
    removers.splice(0).forEach((r) => r());

    const b = setup({ write: async () => null }); // transport failure, logged by registerFamily
    b.sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    expect(logged(b.log)).toEqual(['skipped:info:no-result']);
  });

  it('an owner email edit triggers exactly one more check', async () => {
    const { sync, state, write } = setup();
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com'); // in sync
    await settle();
    expect(write).not.toHaveBeenCalled();

    state.owner = { id: GREG, email: 'greg@newer.com' };
    sync.onOwnerChange();
    sync.onOwnerChange();
    serve(GREG, 'greg@new.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('an owner change before the load is known does nothing until it is', async () => {
    const { sync, write } = setup();
    serve(GREG, 'greg@old.com');
    sync.onOwnerChange();
    await settle();
    expect(write).not.toHaveBeenCalled();
  });

  it('reset() forgets the load, the registry answer and the checked states', async () => {
    const { sync, write } = setup();
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@old.com');
    await settle();
    sync.reset();
    serve(GREG, 'greg@old.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1); // no load since the reset
    sync.onAuthoritativeLoad(FAM);
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
  });
});

describe('registryOwnerSync: transfer', () => {
  const newOwner = { id: JILL, email: 'jill@x.com' }; // the roster after the transfer
  const handover: WriteFn = async () => ({
    pointerAccepted: true,
    owner: { memberId: JILL, email: 'jill@x.com' },
    outcome: 'handover',
  });
  const refused: WriteFn = async () => ({
    pointerAccepted: true,
    owner: { memberId: GREG, email: 'greg@new.com' },
    outcome: 'refused-off-canonical',
  });

  it('sets the marker, saves, then PUTs transfer; the handover clears the marker', async () => {
    const { sync, write, save, log } = setup({ owner: newOwner, write: handover });
    const setItem = vi.spyOn(localStorage, 'setItem');
    await sync.onOwnershipTransferred(JILL);
    expect(setItem).toHaveBeenCalledWith(KEY, JSON.stringify(JILL));
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(write.mock.invocationCallOrder[0]!);
    expect(write).toHaveBeenCalledWith(FAM, 'transfer');
    expect(marker()).toBeNull();
    expect(logged(log)).toEqual(['transfer-synced:info:handover']);
  });

  it('a failed save keeps the marker and sends nothing', async () => {
    const { sync, write, log } = setup({ owner: newOwner, save: async () => false });
    await sync.onOwnershipTransferred(JILL);
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBe(JSON.stringify(JILL));
    expect(logged(log)).toEqual(['transfer-pending:warn:save-failed']);
  });

  it('a refused or failed PUT keeps the marker', async () => {
    const a = setup({ owner: newOwner, write: refused });
    await a.sync.onOwnershipTransferred(JILL);
    expect(marker()).toBe(JSON.stringify(JILL));
    expect(logged(a.log)).toEqual(['transfer-pending:warn:refused-off-canonical']);

    const b = setup({ owner: newOwner, write: async () => null });
    await b.sync.onOwnershipTransferred(JILL);
    expect(marker()).toBe(JSON.stringify(JILL));
    expect(logged(b.log)).toEqual(['transfer-pending:warn:no-result']);
  });

  it('never throws: a throwing save or write is logged', async () => {
    const a = setup({
      owner: newOwner,
      save: async () => {
        throw new Error('drive down');
      },
    });
    await expect(a.sync.onOwnershipTransferred(JILL)).resolves.toBeUndefined();
    expect(logged(a.log)).toEqual(['transfer-pending:warn:save-failed']);

    const b = setup({
      owner: newOwner,
      write: async () => {
        throw new Error('boom');
      },
    });
    await expect(b.sync.onOwnershipTransferred(JILL)).resolves.toBeUndefined();
    expect(logged(b.log)).toEqual(['transfer-pending:warn:put-failed']);
  });

  it('a pending marker is retried ONCE on a later session while the registry names me', async () => {
    setMarker(JILL);
    // The later session: the roster shows Jill as owner, I (Greg) am still registered.
    const { sync, write, save, log } = setup({
      owner: { id: JILL, email: 'jill@x.com' },
      write: refused,
    });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    serve(GREG, 'greg@new.com');
    sync.onOwnerChange();
    await settle();
    expect(save).toHaveBeenCalledTimes(1); // the retry saves first
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(FAM, 'transfer');
    expect(marker()).toBe(JSON.stringify(JILL)); // refused again: kept for the next session
    expect(logged(log)).toEqual(['transfer-pending:warn:refused-off-canonical']);
  });

  it('the retry saves first, then PUTs; a failed save sends nothing and keeps the marker', async () => {
    setMarker(JILL);
    const { sync, write, save } = setup({
      owner: { id: JILL, email: 'jill@x.com' },
      write: handover,
    });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(save.mock.invocationCallOrder[0]!).toBeLessThan(write.mock.invocationCallOrder[0]!);
    removers.splice(0).forEach((r) => r());

    setMarker(JILL);
    const b = setup({ owner: { id: JILL, email: 'jill@x.com' }, save: async () => false });
    b.sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(b.write).not.toHaveBeenCalled();
    expect(marker()).toBe(JSON.stringify(JILL));
  });

  it('an owner change during the save sends no transfer and keeps the marker', async () => {
    let swap: () => void = () => {};
    const { sync, state, write, log } = setup({
      save: async () => {
        swap();
        return true;
      },
    });
    swap = () => {
      state.owner = { id: GREG, email: 'greg@new.com' }; // the merge brought a different owner
    };
    state.owner = { id: JILL, email: 'jill@x.com' };
    await sync.onOwnershipTransferred(JILL);
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBe(JSON.stringify(JILL));
    expect(logged(log)).toEqual(['transfer-pending:warn:owner-changed']);
  });

  it('a two-owner roster keeps the marker; a later sole-owner check still decides it', async () => {
    setMarker(JILL);
    const { sync, state, write, log } = setup({ owner: null, write: handover });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBe(JSON.stringify(JILL));

    state.owner = { id: JILL, email: 'jill@x.com' };
    sync.onOwnerChange();
    await settle();
    expect(write).toHaveBeenCalledWith(FAM, 'transfer');
    expect(marker()).toBeNull();
    expect(logged(log)).toContain('transfer-synced:info:handover');
  });

  it('a retried transfer that hands over clears the marker', async () => {
    setMarker(JILL);
    const { sync, write } = setup({
      owner: { id: JILL, email: 'jill@x.com' },
      write: handover,
    });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
    expect(marker()).toBeNull();
  });

  it('clears a marker the pod owner no longer matches (superseded)', async () => {
    setMarker(JILL);
    const { sync, write, log } = setup(); // the roster names Greg again
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBeNull();
    expect(logged(log)).toEqual(['transfer-cleared:info:superseded']);
  });

  it('clears a marker the registry already holds', async () => {
    setMarker(JILL);
    const { sync, write, log } = setup({ owner: { id: JILL, email: 'jill@x.com' } });
    sync.onAuthoritativeLoad(FAM);
    serve(JILL, 'jill@x.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBeNull();
    expect(logged(log)).toEqual(['transfer-cleared:info:registered']);
  });

  it('keeps the marker and sends nothing when the registry names neither me nor the target', async () => {
    setMarker(JILL);
    const { sync, write } = setup({ owner: { id: JILL, email: 'jill@x.com' } });
    sync.onAuthoritativeLoad(FAM);
    serve('someone-else', 'x@x.com');
    await settle();
    expect(write).not.toHaveBeenCalled();
    expect(marker()).toBe(JSON.stringify(JILL));
  });

  it('a transfer made this session is not retried by the same session', async () => {
    const { sync, write } = setup({ owner: newOwner, write: refused });
    sync.onAuthoritativeLoad(FAM);
    serve(GREG, 'greg@new.com');
    await sync.onOwnershipTransferred(JILL);
    serve(GREG, 'greg@new.com');
    await settle();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('marker storage that throws is logged, never thrown', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { sync, write, log } = setup({ owner: newOwner, write: handover });
    await sync.onOwnershipTransferred(JILL);
    expect(write).toHaveBeenCalledTimes(1);
    expect(logged(log)).toEqual(['marker-failed:warn:set', 'transfer-synced:info:handover']);
  });

  it('does nothing with no active family', async () => {
    const { sync, state, write, save } = setup();
    state.family = null;
    await sync.onOwnershipTransferred(JILL);
    expect(save).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
