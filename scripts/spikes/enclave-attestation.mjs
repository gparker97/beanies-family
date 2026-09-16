/**
 * Spike: verify the live Tinfoil enclave attestation and print the HPKE key we would
 * encrypt to. This is the ROOT OF TRUST for #49 (ADR-030 Gate 3), so it is kept rather
 * than thrown away: re-run it whenever the enclave, the config repo or the verifier
 * version changes, and before assuming verification still works.
 *
 *   node scripts/spikes/enclave-attestation.mjs
 *
 * CONFIG_REPO is TINFOIL'S repo, not ours. Its signed releases publish the expected
 * enclave measurement, which is what the attestation is checked against. Confirmed
 * 2026-09-16 against docs.tinfoil.sh and the live endpoint: the repo's latest release
 * carries `tinfoil.hash`, which is exactly what @tinfoilsh/verifier's bundle.js fetches.
 *
 * Measured 2026-09-16: VERIFY OK, releaseTag v0.0.150, enclaveHost inference.tinfoil.sh,
 * result carries { measurement, tlsPublicKeyFingerprint, hpkePublicKey }.
 */
import { Verifier } from '@tinfoilsh/verifier';

const CONFIG_REPO = 'tinfoilsh/confidential-model-router';
const SERVER = 'https://inference.tinfoil.sh';

const v = new Verifier({ serverURL: SERVER, configRepo: CONFIG_REPO });
try {
  const res = await v.verify();
  console.log('VERIFY OK');
  console.log('  keys on result:', Object.keys(res).join(', '));
  console.log(
    '  hpkePublicKey:',
    res.hpkePublicKey ? String(res.hpkePublicKey).slice(0, 32) + '...' : '(absent)'
  );
  console.log(
    '  tlsPublicKey :',
    res.tlsPublicKey ? String(res.tlsPublicKey).slice(0, 32) + '...' : '(absent)'
  );
  const doc = v.getVerificationDocument?.();
  if (doc) console.log('  doc steps:', JSON.stringify(doc).slice(0, 300));
} catch (e) {
  console.log('VERIFY FAILED:', e?.constructor?.name, e?.message);
}
