/**
 * The crypto-and-URL half of minting a sign-in link, once.
 *
 * Four sites did this: the two Settings cards, the creation step's owner link, and the
 * join step's joiner link. The bodies were the same ~40 lines of key wrapping, monotonic
 * stamping, durable publishing and URL building — and the copies had already proved they
 * drift, because the SAME two bugs were found and fixed three separate times:
 *
 *   1. `envelope.familyId`, not `activeFamilyId`. An empty family context hands out a QR
 *      for a URL that parses nowhere, AFTER the overwrite has killed the working link.
 *   2. The STORE's provider, not the invite's. `parseUrl` defaults a missing `p=` to
 *      'local', so a joiner could get a permanent `p=local` link carrying a Drive fileId.
 *
 * Both are now impossible to fix in only two places.
 *
 * ⚠️ THIS SERVICE EMITS NOTHING. No `logEvent`, no `emitLinkMinted`, no `reportError`.
 * Telemetry belongs to the hosts: `useMintedLink` already owns it for the two cards, and
 * emitting from here as well would double-count the funnel. What callers get back is a
 * discriminated result; what they do about it is theirs.
 *
 * The dynamic `import()`s stay inside, as all four sites had them — that is what keeps
 * the crypto out of the login bundle.
 */
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { requireReauth } from '@/composables/useReauth';

/**
 * Why a link did or did not get a `login_hint`.
 *
 * Declared here rather than in the telemetry module because THIS file decides it;
 * `loginFlowEvents` type-imports it, which keeps the no-telemetry contract below visibly intact.
 */
export type HintReason = 'ok' | 'no-account' | 'unknown-member';

/**
 * Whether this mint must step up first.
 *
 * Three values for two behaviours, deliberately: the third value IS the documentation. A boolean
 * `alreadyProved: false` at the creation and join sites would be a lie — nothing was proved
 * there because there is nothing yet to prove against.
 */
export type GateMode = 'require' | 'already-proved' | 'not-applicable';

/** What every mint returns: a usable link, or a reason it was withheld. */
export type MintResult =
  { link: string; hint: HintReason } | { errorKey: string; errorCode: string };

/**
 * Narrow the store's provider to the two values a link may carry.
 *
 * Anything else (no provider yet, an unrecognised one) becomes `undefined` so
 * `buildInviteLink` omits `p=` rather than writing a value the redeeming client cannot
 * act on. All four original sites wrote this ternary out by hand.
 */
function linkProvider(): 'google_drive' | 'local' | undefined {
  const provider = useSyncStore().storageProviderType;
  return provider === 'google_drive' || provider === 'local' ? provider : undefined;
}

/**
 * THE ONLY SOURCE OF A `login_hint`, for every kind of link this file mints.
 *
 * ⚠️ `googleAccountEmail`, NEVER `email`. `FamilyMember.email` is documented as a user-editable
 * contact address "not required to match any specific external account" — it is whatever the
 * family typed for display. `googleAccountEmail` is the OAuth-bound identity, written only on
 * that member's own first successful consent and never overwritten silently. Hinting the wrong
 * address is worse than hinting none: Google pre-selects an account that cannot read the file,
 * which is the multi-account Picker confusion that took a day to diagnose in September.
 *
 * ⚠️ NEVER THROWS, AND NEVER REFUSES A MINT. A link with no `hint=` still works; the person just
 * gets the account chooser they get today. So a roster that has not hydrated, or an id that
 * matches nobody, degrades to a reason code rather than failing the mint.
 */
function resolveHint(memberId: string): { email?: string; reason: HintReason } {
  try {
    const member = useFamilyStore().members.find((m) => m.id === memberId);
    if (!member) return { reason: 'unknown-member' };
    const email = member.googleAccountEmail?.trim();
    return email ? { email, reason: 'ok' } : { reason: 'no-account' };
  } catch {
    // Pinia not active yet, or the roster mid-load. Not a failure worth surfacing to the user.
    return { reason: 'unknown-member' };
  }
}

/**
 * The step-up, shared by both mints.
 *
 * ⚠️ THE GATE LIVES HERE AND ITS DEFAULT IS ON, which is why `GateMode` has no default of its
 * own at the call sites. It started in `SignInCodeSheet`, which meant `DeviceLinkCard` in
 * Settings minted the BYTE-IDENTICAL full-family-key link with one tap and no proof at all — so
 * the gate only added friction to the honest path while the bypass sat two menus away. A
 * per-host gate is a gate the next host forgets. Defaulting to `'require'` means forgetting it
 * fails SAFE: a new caller gets the PIN prompt without knowing it asked for one.
 *
 * ⚠️ TWO SITES MUST OPT OUT, and they are not laziness. `ResumePodSetup` mints inside the
 * unclosable create-pod save step and `useJoinFlow` mints on the one screen a joiner ever sees
 * their link. At both, `requireReauth` would stack a PIN pad over a modal the user cannot close,
 * and where the member is unresolved it fails closed — so the link would be WITHHELD from
 * exactly the two flows whose whole job is to hand one over. They pass `'not-applicable'`.
 */
async function runGate(mode: GateMode): Promise<boolean> {
  if (mode !== 'require') return true;
  return requireReauth({
    titleKey: 'signInCode.title',
    reasonKey: 'signInCode.pinReason',
  });
}

/**
 * Mint a 15-minute DEVICE link: "both devices in hand, right now."
 *
 * The wrap goes into `inviteKeys` keyed by the token hash, so minting is ADDITIVE — it
 * revokes nothing, and a second mint does not kill the first link.
 */
export async function mintDeviceLink(opts: {
  /**
   * Whose Google account should the redeeming device be pointed at.
   *
   * ⚠️ NAMED `hintMemberId`, NOT `memberId`, AND THAT NAMING IS LOAD-BEARING. This link is
   * family-scoped: its wrap lands in `inviteKeys` under the token hash and identity comes from
   * whichever PIN is entered on arrival. The member is here ONLY to derive a `login_hint`.
   * Calling it `memberId` would invite a future reader to "fix" the deliberate `m=` suppression
   * below by forwarding it to `buildInviteLink`.
   *
   * Required rather than optional on purpose: making it mandatory is compiler-enforced coverage
   * that every mint site names a member, which is the precondition for the hint invariant.
   */
  hintMemberId: string;
  gate?: GateMode;
}): Promise<MintResult> {
  const syncStore = useSyncStore();

  const fk = syncStore.familyKey;
  if (!fk) return { errorKey: 'recovery.podNotOpen', errorCode: 'no_family_key' };

  // ⚠️ `envelope.familyId`, NOT `activeFamilyId` — the bug named in this file's own header,
  // which `mintMagicLink` avoided and this one did not. `buildInviteLink` writes `fam=`
  // unguarded and `parseInviteLink` returns null on an empty one, so a cleared family
  // context (a switch, or a restored session before rehydrate) produced a QR for a URL that
  // parses nowhere — AFTER a live 15-minute family-key wrap was already on Drive.
  const envelope = syncStore.envelope;
  if (!envelope) return { errorKey: 'recovery.podNotOpen', errorCode: 'no_envelope' };

  // ⚠️ GATE AFTER THE GUARDS, NOT BEFORE. Prompting for a PIN and then refusing because the pod
  // was never open makes the person prove themselves for nothing.
  if (!(await runGate(opts.gate ?? 'require'))) {
    return { errorKey: 'signInCode.notProved', errorCode: 'gate_declined' };
  }

  const hint = resolveHint(opts.hintMemberId);

  const {
    buildInviteLink,
    generateInviteToken,
    createInvitePackage,
    hashInviteToken,
    LINK_EXPIRY_MS,
  } = await import('@/services/crypto/inviteService');

  const token = generateInviteToken();
  const pkg = await createInvitePackage(fk, token, LINK_EXPIRY_MS);

  // R2-F15: a link whose key never reached the durable file cannot be redeemed inside its
  // 15-minute window — refuse to hand out a dead QR.
  const published = await syncStore.addInvitePackage(await hashInviteToken(token), pkg);
  if (!published) return { errorKey: 'deviceLink.publishFailed', errorCode: 'publish-failed' };

  return {
    link: buildInviteLink({
      familyId: envelope.familyId,
      provider: linkProvider(),
      fileName: syncStore.fileName ?? undefined,
      fileId: syncStore.driveFileId ?? undefined,
      token,
      linkMode: true,
      // ⚠️ `inviteeEmail` ONLY. NO `memberId` — see the prop's docblock. `buildInviteLink` writes
      // `m=` for ANY `memberId` it is given, but `parseInviteLink` reads `m=` only under `ml=1`.
      // A device link is `lk=1`, so a member id here would be a param nothing ever reads, while
      // still shipping an internal identifier in a URL people paste into chat.
      inviteeEmail: hint.email,
    }),
    hint: hint.reason,
  };
}

/**
 * Mint a 7-day MAGIC link for one member: the one you SAVE.
 *
 * The wrap goes into `memberLinkKeys` keyed by `memberId` under `newest-wins`, so minting
 * REPLACES that member's previous link. Callers must say so in their copy; the token is
 * deliberately never persisted, so a live link can never be re-shown and idempotence is
 * not available.
 *
 * `publishTimeoutMs` is a parameter rather than a constant because the join step
 * deliberately spends `CREDENTIAL_PUBLISH_TIMEOUT_MS` — its whole job is to hand over the
 * link and nothing waits behind it — while the creation and Settings mints deliberately
 * do not. Flattening that difference away would either stall an unclosable creation modal
 * or make the join step give up too early.
 */
export async function mintMagicLink(opts: {
  memberId: string;
  publishTimeoutMs?: number;
  /**
   * Defaults to `'require'` like the device mint, which is a CHANGE: this mint used to have no
   * gate at all while the shorter-lived one defaulted its gate on. That asymmetry was backwards
   * — this is the SEVEN-DAY credential — and it matters more now that a picker lets you mint one
   * for somebody else. `ResumePodSetup` and `useJoinFlow` must pass `'not-applicable'`; see
   * `runGate`.
   */
  gate?: GateMode;
}): Promise<MintResult> {
  const syncStore = useSyncStore();

  const fk = syncStore.familyKey;
  if (!fk || !opts.memberId) {
    return { errorKey: 'recovery.podNotOpen', errorCode: 'no_family_key' };
  }

  // Kept distinct from the key check. Two of the four original sites collapsed both into
  // `no_family_key`, which made "the pod is not open" and "the envelope has not staged"
  // indistinguishable in the firehose — different causes with different fixes.
  const envelope = syncStore.envelope;
  if (!envelope) return { errorKey: 'recovery.podNotOpen', errorCode: 'no_envelope' };

  // Gate after the guards, for the reason given on the device mint.
  if (!(await runGate(opts.gate ?? 'require'))) {
    return { errorKey: 'signInCode.notProved', errorCode: 'gate_declined' };
  }

  const hint = resolveHint(opts.memberId);

  const { mintMagicLinkPackage, buildMagicLinkUrl } = await import('@/services/auth/magicLink');

  // Monotonic: stamp strictly newer than the entry being replaced, or a fast clock on the
  // old one keeps the dead link alive through the merge.
  const { token, pkg } = await mintMagicLinkPackage(
    fk,
    envelope.keyId,
    syncStore.memberLinkCreatedAt(opts.memberId)
  );

  // Awaited and CHECKED. A link whose wrap never reached the durable file is a dead link;
  // withholding it is the whole point of the boolean.
  const published = await syncStore.setMemberLinkWrap(opts.memberId, pkg, opts.publishTimeoutMs);
  if (!published) return { errorKey: 'magicLink.mintFailed', errorCode: 'publish-failed' };

  return {
    link: buildMagicLinkUrl({
      // ⚠️ `envelope.familyId`, NOT `activeFamilyId` — see the header. The envelope is
      // non-null above and is the authority.
      familyId: envelope.familyId,
      // Unlike the device link, `m=` BELONGS here: `ml=1` is unusable without it, and
      // `parseInviteLink` reads it only under that flag.
      memberId: opts.memberId,
      provider: linkProvider(),
      fileName: syncStore.fileName ?? undefined,
      fileId: syncStore.driveFileId ?? undefined,
      token,
      inviteeEmail: hint.email,
    }),
    hint: hint.reason,
  };
}
