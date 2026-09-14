#!/usr/bin/env bash
#
# Apply the terraform plan that was already produced and read by scripts/infra/tf-plan.sh.
#
# This applies the SAVED PLAN FILE, never a freshly computed one. That is the whole
# point: what gets applied is byte-for-byte what was reviewed. A fresh `terraform
# apply` would re-plan against whatever the world looks like now, so anything that
# changed since the review — including a concurrent console edit — would ride along
# unreviewed.
#
# It re-sources the env for the same reason tf-plan.sh does: a shell that did not
# source it has no secret TF_VARs, and terraform would blank live secret values that
# have declared defaults. Terraform does verify the saved plan against current state
# and will refuse a stale one, which is the behaviour you want.
#
# Usage:
#   scripts/infra/tf-apply.sh

set -eo pipefail

ENV_FILE="${BEANIES_TF_ENV:-$HOME/.beanies-tf.env}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAN_FILE="$REPO_ROOT/infrastructure/tfplan.out"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: $ENV_FILE not found. Refusing to apply." >&2
  exit 1
fi

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "FATAL: $PLAN_FILE not found." >&2
  echo "Run scripts/infra/tf-plan.sh first and read its output before applying." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if ! declare -f beanies_tf_check >/dev/null; then
  echo "FATAL: beanies_tf_check is not defined after sourcing $ENV_FILE. Refusing to apply." >&2
  exit 1
fi

echo "── preflight ─────────────────────────────────────────────────────────────"
beanies_tf_check

cd "$REPO_ROOT/infrastructure"

echo
echo "── applying the saved plan ───────────────────────────────────────────────"
terraform apply -input=false tfplan.out

echo
echo "── outputs ───────────────────────────────────────────────────────────────"
terraform output

# The plan is consumed. Leaving it on disk invites applying a stale one later.
rm -f tfplan.out
echo
echo "Applied. infrastructure/tfplan.out consumed and removed."
