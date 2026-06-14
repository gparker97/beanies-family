/**
 * Per-member localStorage store — the shared spine behind `useInstallNudge`,
 * `useCommunityNudge`, and `useBeanTips`. Each of those is a module-singleton
 * holding state for the *current* family member, swapped on member change and
 * persisted to a per-member localStorage key with a strict no-silent-failure
 * contract (read/parse warn; writes warn + `reportError`).
 *
 * What's shared (and lived in triplicate before): the `${prefix}-${memberId}`
 * key, the getItem/JSON.parse/setItem try-catch scaffolding, the write-failure
 * reporting, and the `familyStore.currentMemberId` watch that loads/clears the
 * singleton. What stays per-store: schema validation + migration — that logic
 * is genuinely different per store, so each passes its own `fromParsed`.
 *
 * Usage (at MODULE scope so the singleton is shared across all `useX()` callers):
 *
 *   const store = createPerMemberStore<MyState>({ prefix, label, ... });
 *
 * then inside the composable's setup function:
 *
 *   store.useMemberSync();              // installs the member watch (caller lifecycle)
 *   store.state.value                   // read
 *   store.save(next)                    // persist for the current member
 *   store.memberId()                    // current member id (for guards)
 */
import { ref, watch, type Ref } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { reportError } from '@/utils/errorReporter';

export function perMemberKey(prefix: string, memberId: string): string {
  return `${prefix}-${memberId}`;
}

export type RawRead = { kind: 'missing' } | { kind: 'corrupt' } | { kind: 'ok'; value: unknown };

/**
 * Read + JSON-parse a per-member blob. Never throws.
 *   - missing key OR read error → `{ kind: 'missing' }` (read errors warn)
 *   - present but unparseable    → `{ kind: 'corrupt' }` (warns)
 *   - present + valid JSON        → `{ kind: 'ok', value }`
 * The caller owns schema validation of `value` and decides whether a corrupt
 * blob should be overwritten.
 */
export function readPerMemberRaw(prefix: string, memberId: string, label: string): RawRead {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(perMemberKey(prefix, memberId));
  } catch (err) {
    console.warn(`[${label}] localStorage read failed — using empty state`, err);
    return { kind: 'missing' };
  }
  if (!raw) return { kind: 'missing' };
  try {
    return { kind: 'ok', value: JSON.parse(raw) };
  } catch (err) {
    console.warn(`[${label}] localStorage parse failed — resetting`, err);
    return { kind: 'corrupt' };
  }
}

/**
 * Persist a per-member value. Never throws; on failure warns + `reportError`
 * (severity 'warning' — writes happen on background issuance ticks, not user
 * actions, so no toast).
 */
export function writePerMemberState(
  prefix: string,
  memberId: string,
  value: unknown,
  label: string,
  saveSurface: string,
  saveMessage: string
): void {
  try {
    localStorage.setItem(perMemberKey(prefix, memberId), JSON.stringify(value));
  } catch (err) {
    console.warn(`[${label}] localStorage write failed`, err);
    reportError({
      surface: saveSurface,
      message: saveMessage,
      error: err,
      severity: 'warning',
    });
  }
}

/**
 * The result of validating a parsed-JSON value: the normalized state, plus
 * whether it should be persisted immediately (used to overwrite a corrupt blob
 * or to land a schema migration so the next session reads the new shape).
 */
export interface FromParsedResult<T> {
  state: T;
  persist?: boolean;
}

export interface PerMemberStoreConfig<TState, TPersisted = TState> {
  /** localStorage key prefix; final key is `${prefix}-${memberId}`. */
  prefix: string;
  /** Log label, e.g. 'useInstallNudge' (appears in console warnings). */
  label: string;
  /** `reportError` surface for write failures, e.g. 'install-nudge-save'. */
  saveSurface: string;
  /** `reportError` message for write failures. */
  saveMessage: string;
  /** Fresh empty state factory. */
  empty: () => TState;
  /** Validate/migrate a parsed-JSON value into a valid state (+ persist hint). */
  fromParsed: (parsed: unknown) => FromParsedResult<TState>;
  /** Map state → persisted form (e.g. add a downgrade mirror). Default identity. */
  toPersisted?: (state: TState) => TPersisted;
  /**
   * Persist a fresh empty state when the stored blob is *corrupt* (unparseable).
   * Default false. (Schema-mismatch persistence is signalled via `fromParsed`.)
   */
  persistOnCorrupt?: boolean;
  /** Reset the singleton to empty on sign-out (no member). Default false. */
  clearOnSignOut?: boolean;
}

export interface PerMemberStore<TState> {
  /** The live, member-scoped state singleton. */
  state: Ref<TState>;
  /** The current family member id ('' when none). */
  memberId: () => string;
  /** Persist `next` for the current member (does NOT mutate `state`). */
  save: (next: TState) => void;
  /** Install the family-member watch. Call inside the composable's setup. */
  useMemberSync: () => void;
}

/**
 * Build a per-member store singleton. Call ONCE at module scope; share the
 * returned object across every `useX()` invocation of the owning composable.
 */
export function createPerMemberStore<TState, TPersisted = TState>(
  config: PerMemberStoreConfig<TState, TPersisted>
): PerMemberStore<TState> {
  const toPersisted = config.toPersisted ?? ((s: TState) => s as unknown as TPersisted);

  const state = ref<TState>(config.empty()) as Ref<TState>;
  let currentMemberId = '';

  function save(memberId: string, next: TState): void {
    writePerMemberState(
      config.prefix,
      memberId,
      toPersisted(next),
      config.label,
      config.saveSurface,
      config.saveMessage
    );
  }

  function load(memberId: string): TState {
    const read = readPerMemberRaw(config.prefix, memberId, config.label);
    if (read.kind === 'missing') return config.empty();
    if (read.kind === 'corrupt') {
      const fresh = config.empty();
      if (config.persistOnCorrupt) save(memberId, fresh);
      return fresh;
    }
    const { state: next, persist } = config.fromParsed(read.value);
    if (persist) save(memberId, next);
    return next;
  }

  return {
    state,
    memberId: () => currentMemberId,
    save: (next: TState) => save(currentMemberId, next),
    useMemberSync() {
      const familyStore = useFamilyStore();
      watch(
        () => familyStore.currentMemberId,
        (id) => {
          if (!id) {
            // Sign-out. Optionally clear so a prior member's state never leaks
            // into the next session before a new member id arrives.
            if (config.clearOnSignOut) {
              currentMemberId = '';
              state.value = config.empty();
            }
            return;
          }
          if (id !== currentMemberId) {
            currentMemberId = id;
            state.value = load(id);
          }
        },
        { immediate: true }
      );
    },
  };
}
