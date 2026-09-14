#!/usr/bin/env bash
#
# Produce a beanies.family terraform plan that can be trusted, and print it in full.
#
# WHY THIS SCRIPT EXISTS
# An agent driving terraform through a tool that starts a fresh shell per command
# cannot `source ~/.beanies-tf.env` in one call and run `terraform plan` in the
# next — the exports and the `beanies_tf_check` function are gone by then. The
# plan still succeeds, which is the dangerous part: the secret-bearing TF_VAR_*
# variables fall back to their declared defaults, so the plan renders your correct
# live values as changes it intends to make. It reads exactly like console drift,
# and applying it would overwrite a live secret with a default.
#
# So every terraform invocation has to live inside one shell that sourced the env
# first. That is this script.
#
# Usage:
#   scripts/infra/tf-plan.sh                        # whole stack
#   scripts/infra/tf-plan.sh -target=module.ai_extract
#
# Writes infrastructure/tfplan.out. Apply it with scripts/infra/tf-apply.sh, which
# applies THAT SAVED FILE — so what gets applied is exactly what you read here.

set -eo pipefail

ENV_FILE="${BEANIES_TF_ENV:-$HOME/.beanies-tf.env}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not found." >&2
  echo "Without it every secret TF_VAR falls back to a default and the plan lies." >&2
  echo "Create it from infrastructure/.beanies-tf.env.example (chmod 600)." >&2
  echo "Note the filename: .beanies-tf.env — not ~/.tfvars.env, not ~/.penelope-tf.env." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

# The wrong-account guard. beanies_tf_check is defined INSIDE the env file, so its
# absence means the file was sourced but is the wrong one (penelope's, say) or has
# drifted from the template.
if ! declare -f beanies_tf_check >/dev/null; then
  echo "FATAL: beanies_tf_check is not defined after sourcing $ENV_FILE." >&2
  echo "That env file is the wrong one or out of date. Expected beanies account 517040426968." >&2
  exit 1
fi

echo "── preflight ─────────────────────────────────────────────────────────────"
beanies_tf_check

echo
echo "── log retention (every Lambda module must pin its log group) ─────────────"
npm --prefix "$REPO_ROOT" run --silent check:log-retention

cd "$REPO_ROOT/infrastructure"

echo
echo "── terraform init ────────────────────────────────────────────────────────"
terraform init -input=false

echo
echo "── terraform plan ────────────────────────────────────────────────────────"
# terraform.auto.tfvars is auto-loaded; no -var-file needed for prod.
terraform plan -input=false -out=tfplan.out "$@"

echo
echo "── every resource change in this plan ────────────────────────────────────"
echo "Read ALL of these, not just the ones you expected. A change you did not put"
echo "there is either someone's console edit that terraform will silently revert,"
echo "or an unsourced-env secret about to be blanked."
echo
terraform show -json tfplan.out | python3 -c '
import json, sys
plan = json.load(sys.stdin)
changes = plan.get("resource_changes", [])
rows = []
for c in changes:
    actions = c.get("change", {}).get("actions", [])
    if actions == ["no-op"]:
        continue
    rows.append((("".join(a[0] for a in actions)).upper(), "/".join(actions), c.get("address", "?")))
if not rows:
    print("  (no changes — infrastructure matches the configuration)")
else:
    for _, act, addr in sorted(rows, key=lambda r: r[2]):
        print(f"  {act:<16} {addr}")
    print()
    print(f"  {len(rows)} resource change(s) total.")
'

echo
echo "── next ──────────────────────────────────────────────────────────────────"
echo "Saved: infrastructure/tfplan.out"
echo "Apply exactly this plan with:  scripts/infra/tf-apply.sh"
