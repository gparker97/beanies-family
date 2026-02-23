# Plan: DynamoDB Family-to-File Location Registry

> Date: 2026-02-23
> Related issues: #76

## Context

beanies.family is local-first — each family's data lives in an encrypted `.beanpod` file via the File System Access API. For magic link invites (#77) and file recovery, we need a lightweight cloud registry that maps `familyId → file location metadata`. This is the app's first backend service.

**User decisions:**

- Auth: API key for all operations (simple, no user identity needed)
- API pattern: API Gateway HTTP API v2 + Lambda
- API domain: `api.beanies.family`

## Approach

### 1. Terraform module: `infrastructure/modules/registry/`

Create a new Terraform module alongside the existing `frontend/` module.

**Resources:**

| Resource                      | Details                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| **DynamoDB table**            | `beanies-family-registry-prod`, PK = `familyId` (S), PAY_PER_REQUEST billing            |
| **Lambda function**           | `beanies-family-registry-prod`, Node.js 20.x runtime, handles GET/PUT/DELETE            |
| **API Gateway HTTP API v2**   | Routes: `GET /family/{familyId}`, `PUT /family/{familyId}`, `DELETE /family/{familyId}` |
| **ACM certificate**           | `api.beanies.family` (us-east-1 for API Gateway custom domain)                          |
| **API Gateway custom domain** | `api.beanies.family` with the ACM cert                                                  |
| **Route53 A record**          | `api.beanies.family` → API Gateway domain                                               |
| **IAM role**                  | Lambda execution role with DynamoDB read/write + CloudWatch Logs                        |
| **API key**                   | Stored in SSM Parameter Store, checked by Lambda (header: `x-api-key`)                  |

**DynamoDB item schema:**

```json
{
  "familyId": "uuid",
  "provider": "local",
  "fileId": null,
  "displayPath": "MyFamily.beanpod",
  "familyName": "The Smiths",
  "updatedAt": "2026-02-23T12:00:00Z"
}
```

**Module variables:** `environment`, `app_name`, `domain_name`, `hosted_zone_id`, `api_key` (sensitive)

**Module outputs:** `api_url`, `api_domain_name`, `dynamodb_table_name`, `lambda_function_name`

### 2. Lambda handler: `infrastructure/lambda/registry/index.mjs`

Single-file ESM handler (~80 lines), no bundler needed (uses AWS SDK v3 built into Lambda runtime).

```
GET    /family/{familyId}  → DynamoDB GetItem → 200 {item} | 404
PUT    /family/{familyId}  → DynamoDB PutItem → 200 {success}
DELETE /family/{familyId}  → DynamoDB DeleteItem → 200 {success}
```

- API key validation: checks `x-api-key` header against `REGISTRY_API_KEY` env var → 401 if mismatch
- CORS headers: `Access-Control-Allow-Origin: https://beanies.family`
- Input validation: familyId must be UUID format
- All errors return structured JSON `{ error: "message" }`

### 3. Client service: `src/services/registry/registryService.ts`

New service with three functions:

```typescript
async function lookupFamily(familyId: string): Promise<RegistryEntry | null>;
async function registerFamily(familyId: string, entry: RegistryEntry): Promise<void>;
async function removeFamily(familyId: string): Promise<void>;
```

- Uses `fetch()` with `x-api-key` header
- Reads config from `import.meta.env.VITE_REGISTRY_API_URL` and `VITE_REGISTRY_API_KEY`
- **Graceful degradation**: all calls are fire-and-forget / best-effort. Network failures are logged but never block the user. The app works fine without the registry.
- Type: `RegistryEntry` in `src/types/models.ts`

### 4. Sync store integration: `src/stores/syncStore.ts`

Two integration points (fire-and-forget, non-blocking):

1. **`configureSyncFile()`** — after successful file save, call `registerFamily()` with current familyId and file metadata
2. **`disconnect()`** — after clearing local state, call `removeFamily()` with current familyId

Both wrapped in try/catch with console.warn on failure. Never await in the critical path — use `.catch(() => {})` pattern.

### 5. Environment variables

Add to `.env.local` (prod values) and `.env.example`:

```
VITE_REGISTRY_API_URL=https://api.beanies.family
VITE_REGISTRY_API_KEY=<generated-api-key>
```

### 6. Deploy workflow update: `.github/workflows/deploy.yml`

Add build-time env var injection in the build step:

```yaml
- name: Build for production
  run: npm run build
  env:
    VITE_REGISTRY_API_URL: ${{ secrets.REGISTRY_API_URL }}
    VITE_REGISTRY_API_KEY: ${{ secrets.REGISTRY_API_KEY }}
```

## Files affected

| File                                           | Change                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| `infrastructure/main.tf`                       | Add `module "registry"` block                        |
| `infrastructure/outputs.tf`                    | Add registry outputs                                 |
| `infrastructure/variables.tf`                  | Add `registry_api_key` variable                      |
| `infrastructure/environments/prod.tfvars`      | Add registry API key reference                       |
| `infrastructure/modules/registry/main.tf`      | New — DynamoDB, Lambda, API GW, ACM, Route53, IAM    |
| `infrastructure/modules/registry/variables.tf` | New — module variables                               |
| `infrastructure/modules/registry/outputs.tf`   | New — module outputs                                 |
| `infrastructure/lambda/registry/index.mjs`     | New — Lambda handler                                 |
| `src/services/registry/registryService.ts`     | New — client-side registry service                   |
| `src/types/models.ts`                          | Add `RegistryEntry` interface                        |
| `src/stores/syncStore.ts`                      | Add fire-and-forget registry calls                   |
| `.env.example`                                 | Add `VITE_REGISTRY_API_URL`, `VITE_REGISTRY_API_KEY` |
| `.github/workflows/deploy.yml`                 | Inject registry env vars at build time               |

## Verification

1. **Terraform**: `cd infrastructure && terraform plan -var-file=environments/prod.tfvars` — verify resources look correct before applying
2. **Type check**: `npm run type-check` — no TS errors
3. **Unit test**: Add basic test for `registryService.ts` (mock fetch)
4. **Integration**: After `terraform apply`, test Lambda endpoints with curl
5. **E2E**: Existing E2E tests should still pass (registry calls are fire-and-forget, won't break offline flow)
6. **Graceful degradation**: Verify app works normally when registry is unreachable
