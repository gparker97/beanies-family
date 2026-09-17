# Cold-device recovery: how to get a family back in without the kit

> Date: 2026-09-17
> Status: research, no decision taken
> Prompted by: the "email me my magic link" request (see `docs/prompts/2026-09/2026-09-17-second-device-friction.md`)
> Related: ADR-034 (PIN-first identity), ADR-030 (Tinfoil), ADR-021 (photo storage), ADR-019 (family key),
> tracker #77 (member revocation), #117 (key rotation)

## The problem, as measured

`src/services/auth/magicLink.ts:5-9` records the number that started this:

> "6 of the 22 real families created since telemetry began redeemed a recovery kit, every one on a
> cold device, and 5 of the 6 then replaced a PIN that worked. The kit had become the front door."

27% of families have had to find the printed kit, and five of those six then reset a PIN that was
working. They did not need recovery. They needed a way in. The kit is doing a job it was never
meant to do, and it is the single worst piece of friction in the product: a 32-character
Crockford-base32 code, transcribed by hand, from a PDF printed once months earlier.

The ask was: let someone type their email on the welcome screen, get a link, and be signed in.
Ideally a person should have to remember only (1) their PIN and (2) access to one other thing.

## Why the obvious version does not work

A 6-digit PIN is 10^6, about **19.9 bits**. Offline attack cost is exactly
`|dictionary| x cost(KDF)` and nothing else. Specops benchmarked Argon2id at roughly 490 H/s on
8x RTX 5090, which puts the whole 6-digit space at about **34 minutes**. PBKDF2 at 100k
iterations, which is what beanies uses today, is far cheaper to attack than that.

So any design where the PIN alone unwraps something an attacker can fetch is already broken.
This is not a matter of choosing a better KDF.

There is a second, beanies-specific trap. **For most families, "email access" and "Drive access"
are the same factor**, because the email is a Gmail account and the `.beanpod` lives in that same
account's Drive. Emailing a link that unwraps locally does not add a factor; it hands the whole
thing to anyone who has the Google account, and today a Google account compromise yields nothing
readable. That would be a straight downgrade.

Therefore: **the PIN can only carry weight if some party enforces a guess limit.**

## Why the PIN cannot help on a cold device today

`FamilyMember.pinHash` lives _inside_ the encrypted document (`src/types/models.ts:313-319`), so
it cannot be checked until the pod is already open. The PIN is a post-decryption identity gate,
not a key. The one place it does act as a key is `src/services/auth/deviceUnlock.ts`, where the
family key is wrapped under `HKDF(deviceSecret, salt, info = PIN)`: the entropy comes from a
256-bit per-device secret and the PIN is only HKDF `info`. Five wrong attempts destroy the wrap.

That construction is exactly the shape we want. Its only flaw is that the possession factor is
the device you just lost.

## The envelope today

Every unwrap route, with entropy and revocability (`src/types/syncFileV4.ts:110-165`):

| Route                               | KEK input                  | Entropy                | Expiry                                   | Revocable?                               |
| ----------------------------------- | -------------------------- | ---------------------- | ---------------------------------------- | ---------------------------------------- |
| `wrappedKeys`                       | user password, PBKDF2 100k | user-chosen, unchecked | none                                     | overwrite only; deletes do not propagate |
| `passkeyWrappedKeys`                | WebAuthn PRF, HKDF         | 256-bit                | none                                     | no; inert, nothing can create one        |
| `inviteKeys` (invite / device link) | 32-byte token              | 256-bit                | 24h / 15min, **client-side policy only** | no                                       |
| `recoveryKeys` (kit)                | 32-char base32             | **160-bit**            | none                                     | no; every kit ever made stays valid      |
| `memberLinkKeys` (magic link)       | 32-byte token              | 256-bit                | 7 days                                   | **yes**, the only one                    |
| `recoveryPassphrase`                | passphrase                 | strength-checked       | none                                     | overwrite only                           |

Two consequences worth carrying into any design:

- **Only `memberLinkKeys` is revocable**, because it is keyed by `memberId` and registered
  `newest-wins` in `ENVELOPE_KEY_DICTS`. Everything else merges by union and cannot express a
  deletion until #117 key rotation rebuilds the envelope under a new `keyId`. Any new dict must
  follow the `memberLinkKeys` pattern or it is permanently append-only.
- **A new family is born with `wrappedKeys: {}`.** There is no password at all; `createNewFile`
  refuses to write a pod whose owner has no `pinHash`. So the cold routes are the kit, the
  passphrase (opt-in), and the three token dicts.

## What the industry actually does

Seven systems examined at mechanism level. The pattern is unusually consistent.

**Everyone who defends a low-entropy secret puts the rate limiter in hardware, and sets it to 10.**
Apple Cloud Key Vault (10, published), WhatsApp Backup Key Vault (10, per Davies et al. CRYPTO
2023, written with WhatsApp engineering, not published by Meta), Google Cloud Key Vault (Titan
chips, strictly incrementing counter in firmware that cannot be updated without erasing the
chip), Signal SVR (10, `SecureValueRecovery.swift`). All of them decrement the counter _before_
the outcome is known, and all destroy rather than lock on exhaustion.

**But the products they actually shipped to ordinary people in 2025-26 are, without exception,
high-entropy codes the user holds themselves.** Signal Secure Backups: a 64-character recovery
key. WhatsApp: a 64-digit key option. Apple: a 28-character recovery key. 1Password: the Secret
Key, distributed as a printed Emergency Kit. That convergence is the most important finding in
the research, and the object they all converged on is structurally identical to our recovery kit.

**Both attempts at genuine multi-operator distributed trust collapsed in practice.** Signal's
SVR3, the best design in the corpus (SGX plus Nitro plus SEV-SNP across three clouds, published
at OSDI '24), was removed from Signal's clients across 2025; `main` today exposes only SGX
endpoints, and no commit message or blog post gives a reason. Juicebox (now X/XChat) has a
genuine threshold-OPRF construction, but per Matthew Green's June 2025 analysis all four "realms"
are operated by X, two software-only over TLS. Heterogeneous trust is easy to design and
apparently very hard to keep running.

**No commercial password manager ships OPAQUE.** Bitwarden's serious attempt (branch
`innovation/opaque`, opened 2025-03-17) was closed unmerged on 2026-03-04.

**RFC 9807 states the limit outright** (S10.11): a single-server aPAKE cannot protect a
low-entropy secret against an attacker who compromises that server. OPAQUE converts offline
attacks to online ones and gives precomputation resistance, but buys nothing post-compromise.

### Design rules taken from the corpus

1. Device-to-device approval is the primary path everywhere; the PIN is the degraded fallback.
   Apple's sponsorship circle, Signal's QR device linking, Bitwarden's login-with-device, Matrix
   cross-signing. All avoid the escrow entirely. Build that first.
2. Decrement the counter before you know the outcome. An interrupted session must burn an attempt.
3. Destroy rather than lock. Signal: "if there is a choice between 'lose the secret material
   forever' and 'store the secret material but potentially leak it', we'll choose the former."
4. The guess limit must be per **user**, not per **record**. The published WhatsApp weakness is
   exactly this: a dishonest server suppresses messages to force re-initialization and
   accumulates 10 guesses per historical init.
5. Name the two kinds of recovery distinctly in the UI. Proton's identity-recovery versus
   data-recovery confusion is the single largest source of user pain in the corpus: people reset
   their password and then find their data is gibberish.
6. Pre-position the recovery wrap at creation time. You cannot bolt it on after someone is locked
   out. Both 1Password and Bitwarden do this.
7. Separate "recover the key" from "take over the account". 1Password recovers vault keys while
   the user re-establishes their own credentials; Bitwarden Takeover hands over the account and
   strips 2FA. The first is far safer and reads far better.
8. Enforce any waiting period somewhere an attacker cannot skip it. CVE-2026-16751 is a live
   demonstration of a perfect key hierarchy dying to an unauthorized REST endpoint.

## Options rejected, and why

**Google Drive `appDataFolder` as the escrow.** Hidden from the user and from other apps, not
from Google. That is an ACL boundary, not a cryptographic one; Google's own encryption whitepaper
concedes that debugging and maintenance "might expose decrypted customer data to a trusted
employee". So a PIN-wrapped key there is a trivial offline attack for anyone with the Google
session. The operational objection is worse than the cryptographic one: appDataFolder is isolated
**per OAuth client ID with no migration path between client IDs**, and Google reserves the right
to revoke scopes "at any time without notice". Every family's key material would be hostage to
one Cloud project's standing. Confirming datapoint: WhatsApp had this exact option and declined
it, putting the backup in Drive and the key in Meta's own HSM fleet.

**The existing Tinfoil enclave.** Inference-only. The single endpoint beanies calls is
`/v1/chat/completions`, the config repo is `tinfoilsh/confidential-model-router`, and nothing
establishes that arbitrary workloads can be deployed there. Worse for an auth path: Tinfoil
rotates its enclave measurement and HPKE key on a cadence we do not control and are not told
about, and on 2026-07-01 retired a model with no notice, causing 503s until a same-day hotfix.
Acceptable when the blast radius is "AI extraction is down". Not acceptable when it is "nobody
can log in".

**AWS Nitro Enclaves.** Cannot run on Lambda; requires a long-running EC2 fleet (T-family
excluded, so the floor is c6g.large). $57 to $229/month versus about $1, plus a permanent
operational tax: every OS or kernel patch changes PCR0 and PCR1, and the KMS key policy compares
an exact SHA384 with no fuzzy match, so patching and deploying each become coordinated
key-policy migrations with no AWS-blessed runbook. And the property it is famous for, verifiable
code integrity, is void here because nobody outside beanies will ever check our PCR values, and
we ship unattested PWA JavaScript to the same users anyway. Hardening the server against
ourselves while shipping unsigned JS is theatre. Separately, in 2025 two sub-$1,000 DRAM
interposer attacks broke SGX attestation (WireTap) and both SGX and SEV-SNP (Battering RAM);
both vendors call physical attacks out of scope.

**Passkeys with the WebAuthn PRF extension.** Dead twice over. beanies retired the web
WebAuthn+PRF path in Phase 4 of ADR-034 as "fragile in four independent ways: PRF support,
extension evaluation timing, synced-credential drift, cache dependence", and `passkeyWrappedKeys`
is now inert with nothing able to create an entry. Independently, as of September 2026 Apple's
synced-passkey PRF is **not dependably stable across devices** and over hybrid transport has
historically returned a silently wrong value. The spec editor's own warning is that users delete
passkeys casually. PRF is a good second unlock and a poor only one.

**A threshold (t,n) protocol.** Do not build one. There is no CFRG or NIST track (the string
"threshold" does not appear in RFC 9497 at all; RFC 9807's threshold paragraphs both say "out of
scope"), so no spec and no test vectors. The canonical TOPPSS UC definition was found flawed and
fixed only in Asiacrypt 2024 (eprint 2024/1455); 2HashTDH does not meet the fixed definition and
must be replaced by 3HashTDH. A naive threshold PAKE can be strictly **worse** than single-server
OPAQUE on full compromise, because the adversary may reconstruct a plaintext password rather than
a salted hash; only an augmented construction (aPPSS / atPAKE) dominates both. And the practical
record is unforgiving: the BitForge CVEs extracted full keys in as few as 16 signatures, were a
pseudocode-level flaw affecting every GG18/GG20 implementation, and hit teams with cryptographers
and audit budgets. If two parties are wanted, use a **sequential double-wrap or 2-of-2 XOR**,
which is what AWS KMS External Key Store does ("neither AWS KMS nor the owner of the external key
material can decrypt double-encrypted ciphertext alone") and which has no interactive protocol to
deviate from.

## The asymmetry that makes this tractable for beanies

Signal needs an enclave because **Signal stores the ciphertext**. A compromised Signal server
holding a plain key share would have both halves.

beanies never possesses the `.beanpod`. The client talks to Google Drive directly; our Lambdas
never see it. So a key share sitting in plain DynamoDB under KMS is useless to an attacker who
breaches beanies alone, because there is nothing on our side to apply it to.

| Who is compromised   | What they get                   | Result                                         |
| -------------------- | ------------------------------- | ---------------------------------------------- |
| beanies alone        | a key share, no ciphertext      | nothing                                        |
| Google account alone | ciphertext plus the email proof | must guess the PIN online, rate-limited        |
| both, independently  | everything                      | compromised, but that is two separate breaches |

The one caveat against our own argument: the OAuth Lambda performs the Google token exchange, so
refresh tokens transit it. It has no datastore and no IAM to reach one (only
`AWSLambdaBasicExecutionRole`), and it sets `Cache-Control: no-store`, so nothing is retained.
But a future malicious code change could start capturing them, which would collapse the two-party
independence. That is the same trust already extended to the client JavaScript we ship.

## The proposal: a ladder, not a mechanism

The framing error was treating this as "how do we build an escrow". Everyone who has solved it
treats the escrow as rung three.

### Rung 1. Device-to-device approval

New device displays a short code; an already-signed-in family device approves it and re-wraps the
family key for the new device.

The piece we lack is direction. Today's device link (`lk=1`, 15 minutes, `inviteKeys`) is a
**push**: you must think ahead and mint it on the old device. The needed flow is a **pull**: the
locked-out device asks, and any signed-in device answers. Same crypto, opposite ergonomics.

Covers the majority of new-phone cases in any family with two adults or a second device. Nothing
remembered, no server holds anything, no promise changes. Cheapest to build and highest coverage.
Use an ephemeral asymmetric key plus a human-compared fingerprint, as Apple, Signal, Bitwarden and
Matrix all do.

### Rung 2. Family re-admit

"Ask your partner to let you back in." A pod-managing member approves a locked-out member from
their own signed-in device, which re-wraps the key for them after they set a new PIN.

This is Apple Recovery Contacts, the most elegant design in the corpus, and the shape matters
enormously. Apple's is a **blinded 2-of-2**: the contact holds a packet that is inert without a
provider-held key, so a phished or coerced contact yields nothing. The alternative shape
(1Password Recovery Groups, Bitwarden Emergency Access, Ente Legacy) makes the relative's key
alone sufficient, and one phished relative is game over.

A family app is the ideal setting for this and it is the rung no competitor can build as well.
Structural rules: pre-position the wrap at pod creation; require the locked-out party to act
first, so no material is released without their cooperation; and keep it "recover the key", never
"take over the account".

Does not cover single-adult pods, which fall through to rung 3 or 4.

### Rung 3. PIN plus email escrow

The original request, and the only rung that changes what we promise.

beanies holds a 256-bit secret per member. It is released only on **verified email control plus a
correct PIN**, with a hard attempt counter. The client then derives
`HKDF(serverSecret, salt, info = PIN)` and unwraps a new envelope dict entry, exactly mirroring
the shipped `deviceUnlock` construction with the server standing in for the device.

Build: plain Lambda plus DynamoDB conditional write plus KMS envelope encryption. **About
$1/month at any scale this decade**, and the registry already sits on the cold-start path, so the
plumbing exists.

Non-negotiables, from the corpus:

- Spend the attempt in a **single atomic conditional write, before the PIN is compared**. A
  read-then-write is a textbook TOCTOU. Include a client nonce in the condition so an SDK retry
  cannot double-count, and compare `expiresAt` server-side rather than relying on DynamoDB TTL,
  which is best-effort and leaves expired items readable.
- **Gate the counter behind a verified email OTP**, or the attempt budget becomes a griefing
  weapon: anyone knowing a victim's email could burn all ten attempts.
- **Per member, not per record**, per the WhatsApp weakness.
- **Blocklist common PINs at enrolment.** Within a ten-guess budget this is worth more
  real-world security than any of the infrastructure choices above.
- New dict must be `memberId`-keyed and `newest-wins`, or it will be unrevocable like every dict
  except `memberLinkKeys`.
- Single region. Global Tables are last-writer-wins and silently destroy the conditional-write
  guarantee.

### Rung 4. The recovery kit

Unchanged, and deliberately kept. Demoted from front door to genuine last resort.

This is the rung that makes the rest safe. Every serious design destroys the escrow record at ten
failed guesses rather than locking it, and the usual objection is that this permanently strands
people. It does not strand ours, because the kit is still underneath. **Keeping the kit is
precisely what licenses rung 3 to be aggressive.**

It is also, per the prior art, what every major vendor actually shipped. The goal was never to
delete it. The goal is that nobody has to go looking for it just because they bought a phone.

## Cost

| Option                           | Monthly                               | Verdict                                   |
| -------------------------------- | ------------------------------------- | ----------------------------------------- |
| Lambda + DynamoDB + KMS          | ~$1 (floor is the $1 CMK charge)      | recommended for rung 3                    |
| Cloudflare Durable Objects       | ~$0 to $5, inside included allowances | viable second trust domain if ever wanted |
| Nitro Enclaves (2 instances, HA) | $114 to $229                          | rejected                                  |
| CloudHSM (2-HSM HA pair)         | ~$2,716                               | absurd at this scale                      |

Prices from the AWS Price List API for `ap-southeast-1`, publication date 2026-09-10. Note that
failed conditional writes are billed, so a hostile client costs about $0.00000071 per guess; use
API Gateway throttling rather than WAF, which at $5/month plus $1/million would cost five times
the entire service.

## The promise change, stated honestly

Rungs 1, 2 and 4 require no change to anything we say publicly.

Rung 3 does. `src/content/help/security.ts:600` currently reads:

> "beanies is built so that nobody but your family, not even us, can open your data. That means
> there is no 'reset by email': we hold nothing that could unlock it."

That would become false. It would have to become something closer to Apple's claim: we hold one
piece, it is useless without your PIN and your file, and we allow ten guesses.

Worth knowing that the anti-escrow canon (Abelson, Anderson, Bellovin, Blaze, Diffie, Rivest,
Schneier, 1997) is friendlier here than its reputation suggests. Its S2 defines the pejorative
sense by covertness, absence of consent, and mandate, and S2.1 explicitly names user-chosen
secret-sharing as a legitimate option. A voluntary, visible, revocable split the user opted into
is not escrow by those authors' own criteria. What cannot be argued away is their S3.1 finding:
you have created a second path to the plaintext. That sentence belongs in the help centre.

`web/src/pages/privacy.astro` also needs correction regardless of this work. Line 30 claims "we
don't maintain user accounts, databases, or profiles on any server" and line 187 says the email is
"never transmitted to or stored on our servers", while the registry has stored `ownerEmail`
durably since 2026-04-12. Footnote 2 of `docs/runbooks/native-store-submission.md` already flags
this gap as unclosed.

## Findings worth acting on independently of all this

**Google revokes a refresh token that has gone unused for six months**, and past 100 live refresh
tokens per client it silently invalidates the oldest with no warning. Both are live properties of
beanies today. A family that uses the app seasonally can return to a dead Drive connection, which
is plausibly one reason the kit became the front door. This deserves its own tracker row.

**The Drive API terms** prohibit "backup of user or app content from a developer's app or project
to Drive" without Google's express prior written consent, while blessing Drive-to-local sync.
Ambiguous as applied to a user-initiated `.beanpod` save, and it arguably already describes what
beanies does. WhatsApp has a bespoke Google partnership for exactly this.

**`ownerEmail` is write-once in the registry but sourced from a user-editable profile field**
(`syncStore.ts:2734`), so the stored copy can silently diverge from the pod's copy with no path to
update it. Any feature keyed on it would mail some owners at an address they stopped using.

## Unverified, flagged

- Why Signal removed SVR3. The removal is beyond doubt; no source gives a motive.
- Google Cloud Key Vault's attempt count. The commonly cited "10" is unsourced; only Apple
  publishes its number.
- WhatsApp's limit of 10 comes from CRYPTO 2023, not from Meta.
- Whether Google Takeout excludes hidden app data, and whether re-authorising a client ID
  restores orphaned appDataFolder content. Secondary sourcing only.
- Whether re:Invent 2025 announced any Lambda or Fargate enclave support. Current docs show none.
- Whether Signal's SVR2/SVR3 are packaged for third-party reuse.

## Primary sources

Apple iCloud Keychain escrow security (10-attempt limit):
https://support.apple.com/guide/security/escrow-security-for-icloud-keychain-sec3e341e75d/web
Google Cloud Key Vault whitepaper:
https://developer.android.com/about/versions/pie/security/ckv-whitepaper
WhatsApp Encrypted Backups whitepaper (v2, May 2026):
https://www.whatsapp.com/security/WhatsApp_Security_Encrypted_Backups_Whitepaper.pdf
Signal SVR3 (OSDI '24): https://www.usenix.org/conference/osdi24/presentation/connell
RFC 9497 (OPRF) and RFC 9807 (OPAQUE), IRTF stream
Threshold PAKE with security against compromise of all servers: https://eprint.iacr.org/2024/1455
Password-Protected Threshold Signatures (aPPSS): https://eprint.iacr.org/2024/1469
1Password Secret Key / 2SKD: https://agilebits.github.io/security-design/apsk.html
Key-escrow risks (Abelson et al. 1997):
https://www.schneier.com/academic/paperfiles/paper-key-escrow.pdf
KeePass key-file doctrine: https://keepass.info/help/base/keys.html
DynamoDB conditional writes and atomic counters:
https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html
KMS attestation condition keys:
https://docs.aws.amazon.com/kms/latest/developerguide/conditions-attestation.html
Nitro Enclaves user guide: https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html
Trail of Bits on Nitro attestation and PCR reproducibility:
https://blog.trailofbits.com/2024/02/16/a-few-notes-on-aws-nitro-enclaves-images-and-attestation/
KMS External Key Store (sequential double encryption):
https://docs.aws.amazon.com/kms/latest/developerguide/keystore-external.html
Drive appDataFolder: https://developers.google.com/workspace/drive/api/guides/appdata
Google OAuth token expiration:
https://developers.google.com/identity/protocols/oauth2
Drive API terms: https://developers.google.com/workspace/drive/api/terms
