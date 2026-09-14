# Phase 3 reference — infrastructure

Read this before running anything in Phase 3. The failure modes here are quiet: terraform will happily
produce a confident, wrong plan and apply it without complaint.

## The trap: a plan from an unsourced shell lies

`infrastructure/README.md` states it plainly, and it has bitten this project more than once:

> ⚠️ **Always `source ~/.beanies-tf.env` FIRST — a plan without it lies.** The secret-bearing variables fall
> back to their declared defaults when unset, so the plan renders your correct live values as changes it
> intends to make. It reads exactly like console drift, and applying it would overwrite the live secret with
> a default.

Two classes of secret variable, and only one of them is safe to forget:

| Variable shape | What happens if the env is not sourced |
| --- | --- |
| `sensitive`, **no default** | apply fails loudly. Safe. |
| `sensitive`, **has a default** | terraform **silently blanks the live value** and the apply succeeds. |

That second row is the whole problem. It happened on 2026-08-25 with `slack_error_webhook_url`, and again
across several plans in August where `content_fetch`'s `YOUTUBE_API_KEY` looked like drift and was not — the
shell simply had no `TF_VAR_youtube_api_key`.

**Why an agent hits this harder than a human does.** Each Bash tool call starts a fresh shell. Sourcing the
env in one call and running `terraform plan` in the next means the exports and the `beanies_tf_check`
function are gone by the time terraform runs. There is no error — just a wrong plan. This is why every
terraform invocation must happen inside a single script that sources first, and why the two scripts below
exist.

**If a plan shows an unexpected `~ environment { variables { ... } }` on a Lambda, suspect the env before
believing the diff.**

## The account guard

`beanies_tf_check` is a shell function defined **inside** `~/.beanies-tf.env`, not in the repo. It runs
`aws sts get-caller-identity` and refuses unless the account is `517040426968`.

Two adjacent traps:

- The filename is `~/.beanies-tf.env`. Not `~/.tfvars.env`.
- `~/.penelope-tf.env` is a different AWS account (`785130009771`). Sourcing it in a beanies shell points at
  the wrong account and the state backend will not be found.

The scripts fail hard if `beanies_tf_check` is undefined after sourcing, because that means the file sourced
was the wrong one or has drifted from `infrastructure/.beanies-tf.env.example`.

## The two scripts

**`scripts/infra/tf-plan.sh [terraform plan args]`**

1. Refuses if `~/.beanies-tf.env` is missing
2. Sources it, then refuses if `beanies_tf_check` is undefined
3. Runs `beanies_tf_check` (account + region + all declared vars present)
4. Runs `npm run check:log-retention` — every Lambda module must pin its log-group retention
5. `terraform init -input=false`
6. `terraform plan -input=false -out=tfplan.out` (+ any args you pass, e.g. `-target=module.ai_extract`)
7. Prints **every** non-no-op resource change, address by address

`terraform.auto.tfvars` is auto-loaded, so no `-var-file` is needed for prod.

**`scripts/infra/tf-apply.sh`**

Applies `infrastructure/tfplan.out` — the **saved** plan, not a fresh one. This matters: a bare
`terraform apply` re-plans against the world as it is now, so anything that changed since you read the plan
rides along unreviewed. Applying the saved file means what lands is byte-for-byte what was validated, and
terraform refuses the file outright if state has moved underneath it. The plan file is deleted after a
successful apply so a stale one cannot be applied later.

## The apply gate

Read **every** resource change the plan prints, not just the ones you were expecting. Then:

**Apply unattended only when every change is one the plan document called for.** Nothing else in the list.

**Stop and show greg the diff when any of these appear:**

- A resource the plan document does not mention
- Any `delete` or `replace` — including the `-/+` replace that looks like an update
- A `~ environment { variables }` change you did not intend (suspect the env first; see above)
- Any change to a module the work was not supposed to touch

An unexpected change is one of two things, and neither is yours to decide: someone's console edit that
terraform is about to silently revert, or a secret about to be blanked. `docs/lessons.md` carries the rule as
"read every resource change in a terraform plan, not just the intended target".

## Context worth knowing

- **No CI workflow runs terraform.** It is applied by hand, from greg's shell. There is no pipeline to catch
  a bad apply.
- **State** lives in S3 (`beanies-family-terraform-state`, key `prod/terraform.tfstate`, `ap-southeast-1`)
  with a DynamoDB lock table.
- **Modules**: `ai-extract`, `app-subdomain`, `content-fetch`, `frontend`, `oauth`, `registry`, `telemetry`,
  `web`. Lambda sources under `infrastructure/lambda/` (plus `alarm-slack`, which has code and tests but no
  module directory).
- **Three keys ship in the public client bundle** — `registry_api_key`, `log_ingest_api_key`,
  `ai_extract_api_key` — and must match the GitHub secrets `REGISTRY_API_KEY`,
  `BEANIES_LOG_INGEST_API_KEY`, `AI_EXTRACT_API_KEY` exactly. Re-keying only terraform leaves the deployed
  client on 401s with no local signal. If the work re-keys any of these, the GitHub secret is part of the
  same change, and it goes on the manual-test list.
- **Lambda code changes need `npm run test:lambda`** — `npm run validate` does not cover them.
- Frontend asset deploys (`aws s3 sync` + CloudFront invalidation) are **not** this skill's job. They belong
  to the deploy workflow, which is the only path that injects webhooks and analytics correctly.
