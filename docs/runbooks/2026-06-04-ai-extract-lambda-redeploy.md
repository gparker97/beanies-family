# Runbook: Redeploy the `ai-extract` Lambda (#133)

> Date staged: 2026-06-04
> Why: `infrastructure/lambda/ai-extract/index.mjs` changed on `main` (commit `2c90d2c` — the
> 503/`upstream_unavailable` classification + diagnostic `code`s). The **deployed** Lambda still
> runs the old error handling. It also still runs the **old prompt** (no `categoryHint`), so this
> redeploy is what lights up the AI category hint on the managed/prod tier too (commit `7ff5a53`).
> This is the deliberately "app-first / Lambda-later" step from
> `docs/plans/2026-06-04-ai-wedge-feature-flag-and-fixes.md`.

## What this changes (and does NOT change)

Terraform builds the Lambda zip from `infrastructure/lambda/ai-extract/` via `archive_file` and
tracks it with `source_code_hash`. Because `index.mjs` (and `extractionPrompt.mjs`) changed, the
hash changed → `apply` updates the **Lambda code only**. The function's **env vars (keys) do NOT
change** — provided you supply the same existing values below. No API Gateway route, IAM, or DNS
change is expected.

## Prerequisites

- AWS CLI configured for the account that owns prod (the same creds you use for Terraform).
- Terraform >= 1.5, run from `infrastructure/`.
- The two **sensitive** values, supplied via env vars (they are kept OUT of tfvars on purpose):
  - `TF_VAR_tinfoil_api_key` — the Tinfoil inference key. Source: GitHub repo secret `TINFOIL_API_KEY`, or the Tinfoil dashboard.
  - `TF_VAR_ai_extract_api_key` — the soft client key. **Must match** the GitHub secret `AI_EXTRACT_API_KEY` (and the client `VITE_AI_EXTRACT_API_KEY`). Source: GitHub repo secret `AI_EXTRACT_API_KEY`.

> ⚠️ **The footgun.** If either `TF_VAR_*` is unset or wrong, Terraform sees the Lambda env var as
> changing (or prompts for it). Set BOTH to the current real values first, then the plan should show
> only the Lambda code changing. Always review the plan's "to destroy" count — it must be **0**.

## Steps

### 1. Export the two secrets in YOUR shell (do not paste them to me)

Run these yourself (e.g. via the `!` prefix in this session, or your own terminal). Replace the
placeholders with the real values:

```bash
export TF_VAR_tinfoil_api_key='<the real Tinfoil key>'
export TF_VAR_ai_extract_api_key='<the real AI_EXTRACT_API_KEY>'
```

### 2. Init + scoped, saved plan

```bash
cd infrastructure
terraform init
terraform plan -var-file=environments/prod.tfvars -target=module.ai_extract -out=ai-extract-redeploy.tfplan
```

`-target=module.ai_extract` limits the run to ONLY the AI-extract module, so even a stray
env/tfvars mismatch elsewhere can't touch DNS or other resources.

### 3. REVIEW the plan before applying

Expect roughly:

```
Plan: 0 to add, 1 to change, 0 to destroy.
  ~ module.ai_extract.aws_lambda_function.ai_extract
      ~ source_code_hash = "<old>" -> "<new>"
      ~ filename / last_modified ...
```

✅ Proceed only if: **0 to destroy**, and the change is the Lambda's `source_code_hash`/code.
🛑 STOP if: any `destroy`, or the `environment.variables` (TINFOIL_API_KEY / AI_EXTRACT_API_KEY /
CORS_ORIGINS) show as changing — that means a key value is wrong/empty. Fix step 1 and re-plan.

### 4. Apply the saved plan

```bash
terraform apply ai-extract-redeploy.tfplan
```

### 5. Post-deploy verification

- **Live extraction:** in the app (flag on), add an event from a photo. On success the new activity
  should now carry an inferred **category** (the model returns `categoryHint`, the client maps it).
- **Error path / observability:** if Tinfoil is healthy, you'll see a real result; if it 5xx's, the
  toast now reads "beanies AI is busy right now" (not the generic error), and CloudWatch shows the
  classified code:
  ```bash
  aws logs tail /aws/lambda/beanies-family-ai-extract-prod --since 10m --format short
  ```
  Look for `[ai-extract] ok ...` (success) or a classified `[ai-extract] upstream_unavailable status=503` line.

### 6. Cleanup

```bash
rm -f ai-extract-redeploy.tfplan
```

(The saved plan can contain rendered variable values — delete it after applying; it's already
`.gitignore`-covered as a `*.tfplan`, but don't leave it lying around.)
