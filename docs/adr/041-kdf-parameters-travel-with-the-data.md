# ADR-041: KDF parameters travel with the data

- **Status:** Accepted
- **Date:** 2026-10-07
- **Related:** Notion tracker #81 (raised by the #76 security review; merged with the pre-v1 data-layer audit's "passphrase KDF strength" item); amends ADR-003, ADR-014, ADR-019
- **Plan:** `docs/plans/2026-10-07-kdf-strength-and-passphrase-entropy.md` (private ops repo)
- **Implementation:** `src/services/crypto/kdfParams.ts`, `kdfWriteGate.ts`, `secretWrap.ts`, `src/services/appUpdate/updateFloorStore.ts`, `src/types/syncFileV4.ts`, `src/utils/passphraseStrength.ts`, `passphraseScorer.ts`

## Context

Six PBKDF2-SHA256 derivation sites each hardcoded an iteration count (five at 100,000, the device-unlock fallback at 210,000), and no stored record carried the count it was made with. OWASP's current figure for PBKDF2-HMAC-SHA256 is 600,000. The `.beanpod` is a durable, copyable file in the family's Google Drive whose `wrappedKeys` and `recoveryPassphrase` wraps sit in the clear, so a leaked copy is ground offline with no rate limit; the iteration count and the passphrase's entropy are the only two defences, and the family key never rotates.

The suggested passphrase was 4 words from a 256-word list (32 bits) and a typed phrase passed with 14 characters and 3 distinct tokens. Raising the count alone would have been a breaking change: a wrap written at 600,000 cannot be opened by a client that assumes 100,000, and the client has no way to know which it is looking at. The same gap would reappear the next time guidance moves.

## Decision

1. **One module owns every count and the one derivation.** `kdfParams.ts` exports `KDF_PROFILES` and the only `importKey('raw', …, 'PBKDF2')` call in the codebase (`derivePbkdf2Key` for AES-KW wraps, `derivePbkdf2Bits` for hashes and the device fallback). Profiles, with their reasons:
   - `secret` = 600,000: human-chosen secrets guarding an in-the-clear wrap (member passwords in `wrappedKeys`, the family recovery passphrase).
   - `docHash` = 100,000: `passwordHash` and `pinHash` inside the encrypted document. Iterations only matter once the family key is already lost, a 6-digit PIN cannot be protected by iterations at any count, and keeping the count and the `salt:hash` format means every shipped client keeps verifying them.
   - `highEntropy` = 100,000: recovery-kit codes (~160 bits) and invite, device-link and magic-link tokens (256 bits). Their entropy carries the load; the count is a latency choice.
   - `deviceFallback` = 210,000: the `hkdf+pbkdf2` device-unlock mode, unchanged.
2. **Every PBKDF2 wrap records its parameters.** `iterations?: number` is an additive optional field on `WrappedMemberKey` (hence `recoveryPassphrase`), `RecoveryKeyPackage` and `InviteKeyPackage`; absent means `LEGACY_ITERATIONS` (100,000). Readers always derive at the recorded count. Writers always record the count they used, whatever it is, so the next change is a constant bump. No `.beanpod` version bump: the envelope convention is additive-optional on `'4.0'`.
3. **New-cost writes are gated on the fleet floor.** `isKdfUpgradeGateOpen()` is true only when the persisted update floor (`promptBelowVersion` in `min-app-version.json`, now fetched on every platform and persisted to `localStorage`) is at least `KDF_READ_BOTH_SINCE`, the first app version that reads recorded parameters. Closed when unknown. While closed, `secret` wraps are written at 100,000 (and still record it). Raising the floor is therefore also the switch that turns 600,000 on, and the runbook only permits a raise once that build is live on both stores.
4. **Existing material upgrades lazily and silently.** After a successful password sign-in or passphrase unlock, with the gate open and the wrap below `secret`, the client re-wraps with the secret it has just verified: member wraps through the existing best-effort `rotateMemberPassword` path (surface `kdf-upgrade`), the passphrase through the same `writePassphraseWrap` Settings uses. Failures are logged and swallowed; the unlock already succeeded. Hashes are not upgraded (`docHash` is unchanged).
5. **The passphrase itself got stronger.** Suggestions are 6 words from the EFF long list (7,776 words, ~77 bits), sampled without modulo bias. Typed phrases are scored with zxcvbn (`@zxcvbn-ts/core` + `language-common`, lazy-loaded) with the family and member names as user inputs and the legacy 256-word list registered as a dictionary; a phrase under 10^12 guesses is refused with a reason. The scorer fails closed: if it cannot load, a typed phrase is not accepted and a suggestion still works. A passphrase that matches the legacy 4-word shape earns a one-time, non-blocking nudge to change it.

## Consequences

- **Old clients and the ping-pong.** While a device older than `KDF_READ_BOTH_SINCE` still signs in, its `signin-heal` cannot open a 600,000 member wrap, so it re-wraps at 100,000 and tombstones the strong wrap; the next sign-in on a current build upgrades it again. Each half-cycle adds one value-pinned tombstone to `revokedKeys` and one `passwordHash` re-hash. Nobody is locked out, and it stops as soon as that device updates. The alternating `wrap_upgrade upgraded` row for one `member_id_tail` is the signal.
- **The passphrase path on old builds is refused, not healed.** There is no passphrase heal, so once a 600,000 passphrase wrap exists an older device cannot open the pod by passphrase until it updates; it still opens by PIN, device wrap, member password, kit or magic link. Accepted because the gate only opens once the current build is on both stores.
- **Cold open latency.** A passphrase unlock derives once per member wrap and then the passphrase; those now run in parallel on WebCrypto's thread pool, so the cost is about one 600,000 derivation (~0.2 s desktop, 1 to 2 s expected on a low-end phone). Every derivation emits a `kdf_derive` row with its count, so the floor decision is made on fleet numbers, not estimates. A dev-only page at `/dev/kdf-benchmark` gives per-device figures.
- **The floor fetch moved to every platform** and `min-app-version.json` gained a CORS header and a one-hour edge TTL. The update prompt remains native-only.
- **The next raise is a constant bump and a floor raise.** `KDF_PROFILES.secret` changes in one file; everything already written keeps opening at its recorded count; the floor raise opens the upgrade.
- ADR-003, ADR-014 and ADR-019 still describe the algorithms correctly; their "100,000 iterations" figures are superseded by this record.
