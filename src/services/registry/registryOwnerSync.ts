/**
 * Keeps the registry row's owner (`ownerMemberId` / `ownerEmail`) in line with the pod's owner.
 * See `~/projects/beanies-ops/docs/plans/2026-10-06-registry-owner-sync.md`.
 *
 * The registry Lambda changes the owner fields ONLY on a PUT carrying `ownerSync`, and only from
 * the registered owner on the canonical pointer (`owner.mjs`). This module is the one place that
 * sends one, in two cases:
 *
 *  - EMAIL SYNC (`drift`). Once the session's authoritative load AND a registry answer for the
 *    active family are both known: if I am the pod's owner, the registry names me, and my real
 *    email differs from the registry's, send one PUT (same id, so the Lambda answers
 *    `email-synced`). Checked once per owner state per session (owner id, owner email, me), so a
 *    repeated registry GET never re-sends and an owner email edit gets exactly one more check.
 *    If I own the pod but the registry names someone else, log `not-owner` once and do nothing:
 *    only the registered owner may hand over, so that row needs the ops runbook.
 *  - TRANSFER (`transfer`). Right after this device transfers ownership: store a per-device
 *    marker, save the pod (so the file names the new owner first), then PUT. The Lambda answers
 *    `handover`, and the marker clears. If anything fails, the marker stays and the next session
 *    retries the save + PUT once, after its authoritative load, while the registry still names me.
 *
 * Imports no store: `syncStore` creates it and injects what it reads.
 */
import {
  addRegistryEntryObserver,
  type RegistryOwnerSyncReason,
  type RegistryWriteResult,
} from './registryService';
import { realEmail, sameAccount } from '@/utils/email';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';
import type { RegistryEntry } from '@/types/models';

export type RegistryOwnerSyncDetail =
  | 'email-synced'
  | 'refused'
  | 'not-owner'
  | 'transfer-synced'
  | 'transfer-pending'
  | 'transfer-cleared'
  | 'skipped'
  | 'marker-failed';

export interface RegistryOwnerSyncDeps {
  activeFamilyId(): string | null;
  /** The pod's owner, `null` unless exactly one member has `role: 'owner'`. */
  podOwner(): { id: string; email: string | null | undefined } | null;
  /** The signed-in member on this device. */
  me(): string | null;
  /**
   * The owner-sync PUT for `familyId`. `null` when nothing was learned (a transport failure,
   * already logged by `registerFamily` as `owner-sync-put-failed`, or a family switch).
   */
  write(familyId: string, reason: RegistryOwnerSyncReason): Promise<RegistryWriteResult | null>;
  /** A forced save of the pod (the transfer) to the family file; true once it landed. */
  save(): Promise<boolean>;
  log(
    detail: RegistryOwnerSyncDetail,
    level: 'info' | 'warn',
    extra?: { kind?: string; error?: unknown }
  ): void;
}

/** The `localStorage` key of a family's pending-transfer marker (value: the new owner's id). */
export const ownerTransferMarkerKey = (familyId: string): string =>
  `beanies.ownerTransferPending.${familyId}`;

/** True when the pod owner has a real email and the registry holds a different one. */
export function ownerEmailDiffers(
  podEmail: string | null | undefined,
  registryEmail: string | null | undefined
): boolean {
  const real = realEmail(podEmail);
  return real !== null && !sameAccount(real, registryEmail?.trim());
}

export function createRegistryOwnerSync(deps: RegistryOwnerSyncDeps) {
  let loadedFamilyId: string | null = null;
  let registry: {
    familyId: string;
    ownerMemberId: string | null;
    ownerEmail: string | null;
  } | null = null;
  /** Owner states already checked this session (at most one email PUT each). */
  const checked = new Set<string>();
  /** Families whose pending transfer was already looked at this session. */
  const transferChecked = new Set<string>();

  const LABEL = 'registry-owner-sync';

  function readMarker(familyId: string): string | null {
    const read = readStoredJson(ownerTransferMarkerKey(familyId), LABEL);
    return read.kind === 'ok' && typeof read.value === 'string' ? read.value : null;
  }

  function writeMarker(familyId: string, to: string | null): void {
    const key = ownerTransferMarkerKey(familyId);
    const res = to === null ? removeStoredJson(key, LABEL) : writeStoredJson(key, to, LABEL);
    if (!res.ok) {
      deps.log('marker-failed', 'warn', { kind: to === null ? 'remove' : 'set', error: res.error });
    }
  }

  /**
   * Save the pod (so the file names the new owner first), then hand the registry row to `to`.
   * The payload names the LIVE sole owner, so it is sent only while that is still `to`: the
   * save merges the remote file and may have brought in a different transfer.
   */
  async function saveThenSend(familyId: string, to: string): Promise<void> {
    let saved = false;
    try {
      saved = await deps.save();
    } catch (error) {
      deps.log('transfer-pending', 'warn', { kind: 'save-failed', error });
      return;
    }
    if (!saved) {
      deps.log('transfer-pending', 'warn', { kind: 'save-failed' });
      return;
    }
    if (deps.podOwner()?.id !== to) {
      deps.log('transfer-pending', 'warn', { kind: 'owner-changed' });
      return;
    }
    let result: RegistryWriteResult | null = null;
    try {
      result = await deps.write(familyId, 'transfer');
    } catch (error) {
      deps.log('transfer-pending', 'warn', { kind: 'put-failed', error });
      return;
    }
    if (result?.owner?.memberId === to) {
      writeMarker(familyId, null);
      deps.log('transfer-synced', 'info', { kind: result.outcome ?? 'handover' });
    } else {
      deps.log('transfer-pending', 'warn', {
        kind: result ? (result.outcome ?? 'unconfirmed') : 'no-result',
      });
    }
  }

  async function syncEmail(familyId: string): Promise<void> {
    try {
      const result = await deps.write(familyId, 'drift');
      if (!result) {
        // Transport failures are logged by `registerFamily`; this also covers a family switch.
        deps.log('skipped', 'info', { kind: 'no-result' });
        return;
      }
      const ok = result.outcome === 'email-synced' || result.outcome === 'unchanged';
      deps.log(ok ? 'email-synced' : 'refused', ok ? 'info' : 'warn', {
        kind: result.outcome ?? 'unconfirmed',
      });
    } catch (error) {
      deps.log('refused', 'warn', { kind: 'put-failed', error });
    }
  }

  /** A pending transfer from an earlier session: clear it, or retry its save + PUT once. */
  function checkPendingTransfer(familyId: string, owner: string | undefined, me: string | null) {
    // No sole owner yet (a merge mid-settle): decide on a later check, never drop the marker.
    if (!owner || transferChecked.has(familyId)) return;
    transferChecked.add(familyId);
    const to = readMarker(familyId);
    if (!to) return;
    if (owner !== to || registry?.ownerMemberId === to) {
      writeMarker(familyId, null);
      deps.log('transfer-cleared', 'info', { kind: owner !== to ? 'superseded' : 'registered' });
    } else if (me && registry?.ownerMemberId === me) {
      void saveThenSend(familyId, to);
    }
  }

  function check(): void {
    const familyId = deps.activeFamilyId();
    if (!familyId || loadedFamilyId !== familyId || registry?.familyId !== familyId) return;
    const owner = deps.podOwner();
    const me = deps.me();
    checkPendingTransfer(familyId, owner?.id, me);

    const key = `${familyId}|${owner?.id}|${owner?.email}|${me}`;
    if (checked.has(key)) return;
    checked.add(key);
    if (!owner) {
      deps.log('skipped', 'info', { kind: 'no-sole-owner' });
      return;
    }
    if (!me || owner.id !== me) return;
    if (registry.ownerMemberId !== me) {
      deps.log('not-owner', 'warn', { kind: 'registry-names-another-member' });
    } else if (ownerEmailDiffers(owner.email, registry.ownerEmail)) {
      void syncEmail(familyId);
    }
  }

  return {
    /** Start observing registry GETs. Returns the remover (pass it to `onScopeDispose`). */
    install: (): (() => void) =>
      addRegistryEntryObserver((entry: RegistryEntry) => {
        if (entry.familyId !== deps.activeFamilyId()) return;
        registry = {
          familyId: entry.familyId,
          ownerMemberId: entry.ownerMemberId ?? null,
          ownerEmail: entry.ownerEmail ?? null,
        };
        check();
      }),
    /** The pod for `familyId` finished its authoritative load this session. */
    onAuthoritativeLoad(familyId: string): void {
      loadedFamilyId = familyId;
      check();
    },
    /** The pod owner (id or email) or the signed-in member changed. */
    onOwnerChange: check,
    /** This device just transferred ownership of the active family to `to`. Never throws. */
    async onOwnershipTransferred(to: string): Promise<void> {
      const familyId = deps.activeFamilyId();
      if (!familyId) return;
      transferChecked.add(familyId); // handled here, not again on this session's load
      writeMarker(familyId, to);
      await saveThenSend(familyId, to);
    },
    /** Forget the session (sign-out, family switch). Markers stay: they are per device. */
    reset(): void {
      loadedFamilyId = null;
      registry = null;
      checked.clear();
      transferChecked.clear();
    },
  };
}

export type RegistryOwnerSync = ReturnType<typeof createRegistryOwnerSync>;
