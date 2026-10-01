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

# ── Billing Lambda (#95 Phase 5) ────────────────────────────────────────────
# The one place beanies.family talks to Stripe: Checkout Sessions, the claim that issues the
# plan token, Customer Portal sessions, and the webhook that lands subscription state in the
# table above. Zero-dependency Node (Stripe REST over fetch + HMAC), like every other Lambda.
#
# `local.mjs` and `README.md` are dev tooling (the local sandbox harness) and are excluded from
# the zip along with the tests.

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/billing"
  output_path = "${path.module}/billing-lambda.zip"
  excludes    = ["__tests__", "local.mjs", "README.md"]
}

resource "aws_cloudwatch_log_group" "billing" {
  name              = "/aws/lambda/${var.app_name}-billing-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "${var.app_name}-billing-logs"
    Environment = var.environment
  }
}

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-billing-lambda-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = {
    Name        = "${var.app_name}-billing-lambda-role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# The billing row: read (claim, portal, checkout) and UpdateItem (claim, webhook). Never
# PutItem, never DeleteItem: the grant matches the write discipline in the table header.
resource "aws_iam_role_policy" "billing_table" {
  name = "${var.app_name}-billing-table-${var.environment}"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
      Resource = [aws_dynamodb_table.billing.arn]
    }]
  })
}

# Checkout reads the registry row for `ownerEmail` (customer_email) and the tombstone, from the
# prod table or, for a dev origin, the DEV table where localhost families register. Read only;
# this Lambda never writes the registry.
resource "aws_iam_role_policy" "registry_read" {
  name = "${var.app_name}-billing-registry-read-${var.environment}"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem"]
      Resource = [var.registry_table_arn, var.registry_dev_table_arn]
    }]
  })
}

resource "aws_lambda_function" "billing" {
  function_name    = "${var.app_name}-billing-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  # Checkout is three Stripe calls (8 s timeout each, stripeApi.mjs) plus two DynamoDB reads;
  # 29 s is the most API Gateway allows and leaves the typed 502 reachable on a slow Stripe.
  timeout     = 29
  memory_size = 256

  # Covers the summed route throttles (4 routes x burst 5) with headroom for Stripe retries.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      BILLING_API_KEY       = var.api_key
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
      STRIPE_PRE_V1_COUPON  = var.stripe_pre_v1_coupon
      BILLING_TABLE_NAME    = aws_dynamodb_table.billing.name
      REGISTRY_TABLE_NAME     = var.registry_table_name
      REGISTRY_DEV_TABLE_NAME = var.registry_dev_table_name
      CORS_ORIGINS          = join(",", var.cors_origins)
      DEV_ORIGINS           = join(",", var.dev_origins)
    }
  }

  depends_on = [aws_cloudwatch_log_group.billing]

  tags = {
    Name        = "${var.app_name}-billing"
    Environment = var.environment
  }
}

# ── Routes on the shared API (from the registry module) ─────────────────────
# One integration, four routes, one permission. The per-route throttles live on the registry
# stage (`modules/registry/main.tf`, keyed by route_key string) with the other modules'.

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = var.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.billing.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "billing" {
  for_each = toset(["checkout-session", "claim", "portal-session", "webhook"])

  api_id    = var.api_gateway_id
  route_key = "POST /billing/${each.key}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.billing.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_execution_arn}/*/*"
}

# ── Alarms ──────────────────────────────────────────────────────────────────
# Two log prefixes are alarmed. `lambda/billing/alarms.mjs` declares the strings and
# `__tests__/alarms.test.mjs` asserts each appears here verbatim, so a drifted prefix fails CI
# rather than silently disarming the alarm. Patterns are quoted: a bare `[` is a field selector.

# A verified Stripe event whose subscription could not be re-read or written. The handler
# answered 500 so Stripe retries, but until it lands the family's plan state is wrong.
resource "aws_cloudwatch_log_metric_filter" "webhook_apply_failed" {
  name           = "${var.app_name}-billing-webhook-apply-failed-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.billing.name
  pattern        = "\"[billing] webhook_apply_failed\""

  metric_transformation {
    name          = "WebhookApplyFailed"
    namespace     = "${var.app_name}/billing"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "webhook_apply_failed" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-billing-webhook-apply-failed-${var.environment}"
  alarm_description = "A verified Stripe webhook could not be applied to the billing table (Stripe is retrying). Check STRIPE_SECRET_KEY, BILLING_TABLE_NAME and the Lambda's dynamodb:UpdateItem grant on ${aws_dynamodb_table.billing.name}; the failing event is in the log line."

  namespace           = aws_cloudwatch_log_metric_filter.webhook_apply_failed.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.webhook_apply_failed.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-billing-webhook-apply-failed"
    Environment = var.environment
  }
}

# Stripe unreachable, or a request we built that Stripe refused (a missing Price lookup_key,
# coupon or portal configuration). A family was shown "try again"; the action is in the line.
resource "aws_cloudwatch_log_metric_filter" "upstream_error" {
  name           = "${var.app_name}-billing-upstream-error-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.billing.name
  pattern        = "\"[billing] billing_upstream_error\""

  metric_transformation {
    name          = "UpstreamError"
    namespace     = "${var.app_name}/billing"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "upstream_error" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-billing-upstream-error-${var.environment}"
  alarm_description = "The billing Lambda could not complete a Stripe call (checkout, claim, portal or a webhook re-read). Check status.stripe.com, STRIPE_SECRET_KEY, and for a 4xx the Dashboard object named by the log line's action (Price lookup_key, PRE_V1 coupon, portal configuration)."

  namespace           = aws_cloudwatch_log_metric_filter.upstream_error.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.upstream_error.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-billing-upstream-error"
    Environment = var.environment
  }
}
