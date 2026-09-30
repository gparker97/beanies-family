terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ── Billing (#95) ────────────────────────────────────────────────────────────
# Phase 1 of docs/plans/2026-09-30-pricing-entitlement-read-only.md: the billing TABLE only.
# The billing Lambda, its log group and the four `/billing/*` routes on the shared API arrive in
# Phase 5, in this module, beside the table they own.
#
# Why billing state is its own table and not attributes on the registry row: the registry PUT
# rebuilds the whole row with a PutItem on every register, and its DELETE tombstones by rewriting
# it. Subscription state kept there would have to be preserved through both, and would race a
# Stripe webhook against every client PUT. Here nothing needs preserving: the registry Lambda only
# READS this table (GET arm, to compute `entitlement`), and a family's tombstone leaves its
# billing row alone.

# ── Billing table ────────────────────────────────────────────────────────────
# One item per family, hash key `familyId`, no sort key: a family has exactly one billing row, and
# a second item shape (an event ledger, say) would force every scan of this table to filter it
# forever. Three writers share the row with DISJOINT attributes (webhook: subscription fields;
# claim: token hash and ids; scripts/billing-cohort.mjs: cohort, trialEndsAt, planTokenHash), and
# every one of them writes with UpdateItem SET on its own attributes, never PutItem, which would
# erase the other two writers' fields.
#
# Settings follow the ai-extract usage table, for the same reason: this is BILLING EVIDENCE.
#
#   * point_in_time_recovery ON. There is no backfill path for a cohort or a claimed token.
#   * deletion_protection in prod. A stray `terraform destroy -target` would erase who paid.
#   * NO TTL. Unlike the usage table nothing here ages out; a lapsed family keeps its row so a
#     resubscribe finds its cohort and its Stripe customer.

resource "aws_dynamodb_table" "billing" {
  name         = "${var.app_name}-billing-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "familyId"

  attribute {
    name = "familyId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  # Environment-gated: the module is applied per environment, and an unconditional `true` makes
  # `terraform destroy` fail in any non-prod workspace with a console-only unblock.
  deletion_protection_enabled = var.environment == "prod"

  tags = {
    Name        = "${var.app_name}-billing"
    Environment = var.environment
  }
}
