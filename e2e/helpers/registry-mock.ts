import { type Page, type Route } from '@playwright/test';

/**
 * Mock the family-registry HTTP API for E2E.
 *
 * Why this exists: the unified create flow (2026-06-26) promoted the registry
 * write inside `syncStore.createNewFile` from fire-and-forget to a CRITICAL
 * step — `registerFamilyOrThrow` THROWS if the registry is unreachable, because
 * the registry `fileId` is now the recovery anchor for `ResumePodSetup`'s
 * registry-first resume. The E2E config points the registry at the deliberately
 * unresolvable `https://e2e.registry.invalid`, so without this mock every create
 * flow throws `createPod.failedReasonRegister` ("couldn't reach our family
 * registry") and never reaches the members/Finish step — which red-lined the
 * entire suite from `b1a842fe` onward.
 *
 * We mock the real HTTP contract (`registryService.request` →
 * `<API_URL>/family/<familyId>`) rather than disabling the registry feature, so
 * `features.registry` stays true (invite-join's "registry configured but lookup
 * returns null → picker fallback" premise still holds) and the create flow runs
 * its REAL register step against a registry that simply works.
 *
 * Stateful in-memory store so a GET after a PUT within one test returns the
 * entry (matches a real registry); a GET for an unknown family returns 404, so
 * `lookupFamily` yields null — exactly what a genuinely-new create and the
 * join-flow degradation test both expect.
 */
export async function mockRegistry(page: Page): Promise<void> {
  const store = new Map<string, Record<string, unknown>>();

  await page.route('**/family/**', async (route: Route) => {
    const request = route.request();
    // Only intercept the registry's API calls (fetch/xhr). Never hijack a page
    // navigation or asset request that merely happens to contain "/family/".
    const resourceType = request.resourceType();
    if (resourceType !== 'fetch' && resourceType !== 'xhr') {
      await route.continue();
      return;
    }
    const method = request.method();
    // URL shape: <API_URL>/family/<familyId>
    const familyId = decodeURIComponent(request.url().split('/family/')[1] ?? '');

    if (method === 'GET') {
      const entry = store.get(familyId);
      if (!entry) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(entry),
      });
      return;
    }

    if (method === 'PUT' || method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (request.postDataJSON() as Record<string, unknown>) ?? {};
      } catch {
        // Non-JSON body — store an empty entry; the create flow only needs the
        // write to succeed, not the echoed contents.
      }
      store.set(familyId, { ...body, familyId, updatedAt: new Date(0).toISOString() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    if (method === 'DELETE') {
      store.delete(familyId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }

    await route.continue();
  });
}
