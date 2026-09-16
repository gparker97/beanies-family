/**
 * A cold load must not FETCH the enclave crypto (#49).
 *
 * ⚠️ Deliberately NOT in `e2e/specs/` — `playwright.config.ts` has no `testIgnore`, so a file
 * there joins the CI matrix and counts against the ADR-007 budget (23 of a hard 25).
 *
 * `scripts/checkCryptoChunk.mjs` proves the crypto is not in the entry CHUNK, which is a
 * statement about the build. This proves the runtime consequence: a family who opens the app and
 * never touches a managed extraction never downloads the HPKE implementation or the attestation
 * verifier. Those are different claims, and `attestation.ts` asserts the second one.
 *
 *   npx playwright test -c playwright.design.config.ts --grep "cold load"
 */
import { expect, test } from '../../e2e/fixtures/test';
import { gotoRoot } from '../../e2e/helpers/navigation';

test('cold load fetches no enclave crypto', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));

  await gotoRoot(page);
  await page.waitForLoadState('networkidle');

  // Match how the chunks actually get named, not a guess at their contents: a request whose URL
  // mentions the crypto packages is one we did not want on a cold load.
  const cryptoRequests = requested.filter((u) => /ehbp|tinfoil|hpke/i.test(u));

  expect(
    cryptoRequests,
    `a cold load fetched enclave crypto:\n${cryptoRequests.join('\n')}`
  ).toEqual([]);

  // ⚠️ Guard against the guard being vacuous. If the page fetched almost nothing, the assertion
  // above is trivially true and proves nothing — which is exactly the failure mode that has bitten
  // this repo twice (a geometry harness passing on an empty grid, an avatar check finding no
  // avatars). A real cold load is dozens of requests.
  expect(
    requested.length,
    'the page barely loaded, so the check above measured nothing'
  ).toBeGreaterThan(20);
});
