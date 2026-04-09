# Plan: Server-Side Stats Counters

## Context

Need persistent family/user counts in DynamoDB alongside Plausible events. Seed with current baseline, then increment/decrement going forward.

## Approach — Client-Driven, Minimal Lambda Change

Instead of modifying the existing PUT/DELETE family flow (which fires on every sync), drive counter updates from the client at the same points we already fire Plausible events — `signup` and `family_deleted`. This is simpler because:

- No need to detect "is this a new family vs re-registration" in the Lambda
- Reuses the existing `request()` helper and `_stats` as a reserved familyId
- Counter updates happen exactly once per signup/deletion (not on every sync)

### Flow:

- `authStore.signUp()` → already calls `window.plausible('signup')` → also call `registry.incrementStats()`
- `authStore.joinFamily()` → already calls `window.plausible('member_joined')` → also call `registry.incrementStats('users')`
- `SettingsPage handleDeleteFamilyPasswordConfirm()` → already calls `window.plausible('family_deleted')` → also call `registry.decrementStats()`

## Changes

### 1. Lambda: `infrastructure/lambda/registry/index.mjs`

Add `UpdateItemCommand` to import (line 5).

Relax UUID check for `_stats` (line 42):

```js
if (!familyId || (familyId !== '_stats' && !UUID_RE.test(familyId))) {
```

Add special handling for `_stats` in PUT (before existing PUT logic):

```js
if (familyId === '_stats') {
  const body = JSON.parse(event.body || '{}');
  const expr = body.field === 'users' ? 'ADD #u :v' : 'ADD families :v, #u :v';
  await client.send(
    new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ familyId: '_stats' }),
      UpdateExpression: expr,
      ExpressionAttributeNames: { '#u': 'users' },
      ExpressionAttributeValues: marshall({ ':v': body.delta || 1 }),
    })
  );
  return response(200, { success: true }, event);
}
```

Block DELETE on `_stats` (before existing DELETE logic):

```js
if (familyId === '_stats') return response(400, { error: 'Cannot delete stats' }, event);
```

### 2. Terraform: `infrastructure/modules/registry/main.tf`

Add `dynamodb:UpdateItem` to IAM policy (line 61, alongside existing actions).

### 3. Client: `src/services/registry/registryService.ts`

Add 3 functions reusing existing `request()` helper:

```ts
export async function getStats() { ... }        // GET _stats
export async function incrementStats(field?) { ... }  // PUT _stats { delta: 1 }
export async function decrementStats() { ... }  // PUT _stats { delta: -1 }
```

### 4. Wire up calls

- `src/stores/authStore.ts` signUp() — add `registry.incrementStats()` next to existing `window.plausible('signup')`
- `src/stores/authStore.ts` joinFamily() — add `registry.incrementStats('users')` next to existing `window.plausible('member_joined')`
- `src/pages/SettingsPage.vue` handleDeleteFamilyPasswordConfirm() — add `registry.decrementStats()` next to existing `window.plausible('family_deleted')`

### 5. Seed baseline (one-time CLI)

```bash
aws dynamodb scan --table-name beanies-registry-prod --select COUNT
aws dynamodb put-item --table-name beanies-registry-prod \
  --item '{"familyId":{"S":"_stats"},"families":{"N":"X"},"users":{"N":"Y"}}'
```

## Files Modified

- `infrastructure/lambda/registry/index.mjs` — stats handling in PUT/DELETE, UUID check relaxed
- `infrastructure/modules/registry/main.tf` — add UpdateItem permission
- `src/services/registry/registryService.ts` — add 3 functions (reuse existing `request()`)
- `src/stores/authStore.ts` — 2 one-liner calls (next to existing Plausible calls)
- `src/pages/SettingsPage.vue` — 1 one-liner call (next to existing Plausible call)

## Verification

1. Deploy Lambda + Terraform
2. Seed baseline via AWS CLI
3. Create new family → verify stats.families and stats.users incremented
4. Join family → verify only stats.users incremented
5. Delete family → verify both decremented
