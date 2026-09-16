terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ── CloudWatch Log Group ─────────────────────────────────────────────────────
# Explicit group so retention is pinned (vs. the 13-day Lambda default). The
# Lambda logs ONLY structured success/error lines with the `[ai-extract]` prefix
# — never document bytes or model content (ADR-030, zero-retention).

resource "aws_cloudwatch_log_group" "ai_extract" {
  name              = "/aws/lambda/${var.app_name}-ai-extract-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "${var.app_name}-ai-extract-logs"
    Environment = var.environment
  }
}

# ── IAM Role ─────────────────────────────────────────────────────────────────
# Basic execution + ONE DynamoDB action on ONE table (#83). The comment here used to say
# "no DynamoDB"; that is now false, and the grant below is deliberately as narrow as the
# limiter needs — `UpdateItem` only (never GetItem, Query or Scan), on the rate table only.
# The limiter never reads a counter back, so read access would be permission it cannot use.

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-ai-extract-lambda-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Name        = "${var.app_name}-ai-extract-lambda"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Rate-limit state (#83) ───────────────────────────────────────────────────
# One item per (identifier, hourly bucket), created by a conditional UpdateItem and reaped by
# TTL. PAY_PER_REQUEST because the traffic is spiky and tiny: no capacity to plan, nothing to
# pay for while idle.
#
# There is no GSI and no sort key ON PURPOSE. The window is a FIXED hourly bucket embedded in
# the partition key, which is what lets the whole limit be one atomic UpdateItem — a rolling
# window would need per-key timestamp lists, a read-modify-write and a race. See rateLimit.mjs
# for the trade this accepts (worst case 2× the limit across a bucket boundary).

resource "aws_dynamodb_table" "rate" {
  name         = "${var.app_name}-ai-rate-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  # Windows reap themselves. Without this the table grows forever with items that stopped
  # meaning anything an hour after they were written.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = {
    Name        = "${var.app_name}-ai-rate"
    Environment = var.environment
  }
}

# ── Usage meter (the magic-bean count) ───────────────────────────────────────────────────────
# One item per (family, UTC day), created by an unconditional UpdateItem. Unlike the rate table
# above this is BILLING EVIDENCE, which is why the two deliberately diverge on three settings —
# do not "reconcile" them:
#
#   * TTL ~400 days, not one hour. A monthly plan is billed on this; an hourly bucket is not.
#   * point_in_time_recovery ON. There is no backfill path — a lost row is a lost fact.
#   * deletion_protection in prod. A stray `terraform destroy -target` would erase the meter.
#
# Sort key, unlike the rate table, because week and month must be RANGE QUERIES rather than a
# second counter to keep in step. The item carries exactly three attributes — `n` (reads
# charged), `c` (free corrections) and `expires_at`. A fourth counter is a new attribute here,
# never a second item shape: `pull_ai_usage.mjs` scans and sums on the `d#` sort-key grammar.

resource "aws_dynamodb_table" "usage" {
  name         = "${var.app_name}-ai-usage-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  # Environment-gated: the module is applied per environment, and an unconditional `true` makes
  # `terraform destroy` fail in any non-prod workspace with a console-only unblock.
  deletion_protection_enabled = var.environment == "prod"

  tags = {
    Name        = "${var.app_name}-ai-usage"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "rate_table" {
  name = "${var.app_name}-ai-extract-rate-${var.environment}"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # UpdateItem ONLY, on both tables. The limiter increments and lets a ConditionExpression
      # refuse; the meter increments unconditionally. NEITHER reads a counter back — usage is
      # read by `/beanies-metrics` with a human's credentials, not by this function — so
      # anything more would be unused permission.
      Action = ["dynamodb:UpdateItem"]
      Resource = [
        aws_dynamodb_table.rate.arn,
        aws_dynamodb_table.usage.arn,
      ]
    }]
  })
}

# ── Lambda Function ──────────────────────────────────────────────────────────
# source_dir (not source_file) so the zip includes BOTH index.mjs and the
# drift-pinned extractionPrompt.mjs. output_path lives in the module dir so the
# generated zip is never re-included in its own source.

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/ai-extract"
  output_path = "${path.module}/ai-extract-lambda.zip"
}

resource "aws_lambda_function" "ai_extract" {
  function_name    = "${var.app_name}-ai-extract-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  # Vision inference is multi-second; allow headroom under the API GW 30s ceiling.
  timeout     = 29
  memory_size = 256

  # Caps parallelism, and therefore the worst-case simultaneous Tinfoil spend, independently
  # of the per-family/per-IP request limits. See the variable for why this is not 5.
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      # Billable third-party credential — supplied via TF_VAR (sensitive), never committed.
      TINFOIL_API_KEY = var.tinfoil_api_key
      # Soft key the client sends (mirrors the registry/telemetry x-api-key pattern).
      AI_EXTRACT_API_KEY = var.ai_extract_api_key
      TINFOIL_API_BASE   = var.tinfoil_api_base
      TINFOIL_MODEL      = var.tinfoil_model
      CORS_ORIGINS       = join(",", var.cors_origins)
      # UNSET is a supported configuration, not a fault: `checkLimits` returns immediately and
      # logs nothing, which is what keeps the existing handler test suite (every case a POST)
      # from attempting a real DynamoDB call per test.
      RATE_TABLE = aws_dynamodb_table.rate.name
      # Same supported-no-op posture as RATE_TABLE: unset ⇒ `countUsage` returns immediately and
      # logs nothing, which is what keeps the handler suite off a real DynamoDB call per test.
      USAGE_TABLE = aws_dynamodb_table.usage.name
      # The free-correction kill switch. UNSET means grants are neither issued nor consumed,
      # silently - so the Lambda half ships dormant ahead of the client that uses it, and a
      # production problem is a terraform variable rather than a rollback.
      CORRECTION_GRANTS = var.correction_grants_enabled ? "1" : ""
    }
  }

  depends_on = [aws_cloudwatch_log_group.ai_extract]

  tags = {
    Name        = "${var.app_name}-ai-extract"
    Environment = var.environment
  }
}

# ── API Gateway route (on the shared API from the registry module) ───────────

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = var.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai_extract.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_ai_extract" {
  api_id    = var.api_gateway_id
  route_key = "POST /ai-extract"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_extract.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_execution_arn}/*/*"
}

# ── Alerting ─────────────────────────────────────────────────────────────────
# The limiter FAILS OPEN when DynamoDB is unavailable — deliberately, because silently
# refusing would take down every extraction including the image path this feature does not
# otherwise touch. That choice is only safe if somebody finds out, so the fail-open log line
# gets a metric filter and an alarm.
#
# Gated on a topic ARN being supplied, mirroring the reasoning in content-fetch: a self-hoster
# without one still gets a working apply and a visible alarm, just no notification.

resource "aws_cloudwatch_log_metric_filter" "rate_store_unavailable" {
  name           = "${var.app_name}-ai-extract-rate-store-unavailable-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.ai_extract.name
  # ⚠️ Matches the exact prefix `rateLimit.mjs` logs on its fail-open path. Changing that
  # string means changing this pattern in the same commit, or the alarm silently stops firing.
  pattern = "\"[ai-extract] rate-limit store unavailable\""

  metric_transformation {
    name      = "RateStoreUnavailable"
    namespace = "${var.app_name}/ai-extract"
    value     = "1"
    # Without this the metric reports NO DATA between failures rather than 0, and the alarm
    # sits in INSUFFICIENT_DATA instead of OK.
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "rate_store_unavailable" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-ai-extract-rate-store-unavailable-${var.environment}"
  alarm_description = "The ai-extract rate limiter could not reach DynamoDB and allowed requests through unthrottled. Check the ${aws_dynamodb_table.rate.name} table and the Lambda's dynamodb:UpdateItem permission."

  namespace           = aws_cloudwatch_log_metric_filter.rate_store_unavailable.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.rate_store_unavailable.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-ai-extract-rate-store-unavailable"
    Environment = var.environment
  }
}

# ── Meter integrity ──────────────────────────────────────────────────────────
# Two filters, because the two failures mean different things and need different responses.
# ⚠️ Both patterns are the EXACT prefixes `countUsage.mjs` exports. `meter.test.mjs` reads this
# file and asserts they match, so a drifted prefix is a test failure rather than an alarm that
# quietly stopped firing — which is indistinguishable from one with nothing to report.

resource "aws_cloudwatch_log_metric_filter" "usage_count_failed" {
  name           = "${var.app_name}-ai-extract-usage-count-failed-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.ai_extract.name
  pattern        = "\"[ai-extract] usage-count write failed\""

  metric_transformation {
    name          = "UsageCountFailed"
    namespace     = "${var.app_name}/ai-extract"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "usage_count_failed" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-ai-extract-usage-count-failed-${var.environment}"
  alarm_description = "A magic-bean read succeeded but was NOT counted. Usage is under-reported and an allowance built on it would be wrong. Check the ${aws_dynamodb_table.usage.name} table and the Lambda's dynamodb:UpdateItem permission."

  namespace           = aws_cloudwatch_log_metric_filter.usage_count_failed.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.usage_count_failed.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-ai-extract-usage-count-failed"
    Environment = var.environment
  }
}

# A read the Lambda could not attribute to a family. Expected at a low rate from old cached
# bundles; a RISING rate means the client-side no-family fence has been breached. This is the
# only signal that catches it, because a skipped count writes no row at all and is therefore
# invisible to the metrics unattributed bucket, which can only see hashes that fail to join.
# Threshold is higher than the write-failure alarm: a trickle is the expected steady state.

resource "aws_cloudwatch_log_metric_filter" "usage_count_skipped" {
  name           = "${var.app_name}-ai-extract-usage-count-skipped-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.ai_extract.name
  pattern        = "\"[ai-extract] usage-count skipped\""

  metric_transformation {
    name          = "UsageCountSkipped"
    namespace     = "${var.app_name}/ai-extract"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "usage_count_skipped" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-ai-extract-usage-count-skipped-${var.environment}"
  alarm_description = "Magic-bean reads are arriving with no family id and going uncounted. A few are expected from old cached bundles; a sustained rate means the client-side no_family fence has been breached and reads are free."

  namespace           = aws_cloudwatch_log_metric_filter.usage_count_skipped.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.usage_count_skipped.metric_transformation[0].name
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-ai-extract-usage-count-skipped"
    Environment = var.environment
  }
}

# The one correction refusal that means the FEATURE is broken rather than someone probing it.
# `missing`, `spent` and `same_kind` are all expected in normal operation; `different_source`
# means the banner is offering a correction the server will refuse - the client and the server
# disagree about what document was read, so every correction is charged while the UI promises
# it is free.

resource "aws_cloudwatch_log_metric_filter" "correction_source_mismatch" {
  name           = "${var.app_name}-ai-extract-correction-mismatch-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.ai_extract.name
  pattern        = "\"[ai-extract] correction refused reason=different_source\""

  metric_transformation {
    name          = "CorrectionSourceMismatch"
    namespace     = "${var.app_name}/ai-extract"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "correction_source_mismatch" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-ai-extract-correction-mismatch-${var.environment}"
  alarm_description = "Free corrections are being refused because the client re-sent a different document than the grant was issued for. Families are being charged for corrections the UI promises are free."

  namespace           = aws_cloudwatch_log_metric_filter.correction_source_mismatch.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.correction_source_mismatch.metric_transformation[0].name
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-ai-extract-correction-mismatch"
    Environment = var.environment
  }
}

# The one correction refusal that means someone is PROBING THE METER, rather than the feature
# being broken (different_source, above) or a user being ordinary (spent, expired).
#
# `different_size` fires when a grant is spent against a document of a materially different size
# to the one it was earned on, with a `srcHash` that matches anyway. On the sealed arm `srcHash`
# is client-supplied, so matching it while the size differs means it was forged - which is the
# cheap-buys-expensive trade the byte band exists to prevent: pay for a 40-character text read,
# then "correct" it with an eight-page PDF for free.
#
# Without this filter the condition caught the attempt and then dropped the evidence into an
# unalarmed log line, indistinguishable from a user who left a review modal open past the hour.
#
# Threshold is 3, LOWER than the 5 used for different_source, and the reason is that the expected
# steady state here is exactly zero rather than a trickle. The measurement is deterministic for a
# genuine re-read: the legacy arm measures the source's own length, and the sealed arm a
# ciphertext whose only variation between the paid read and the correction is the hint threaded
# into the prompt - about 0.07% of a ~14KB body, against a 5% band. So a handful in an hour is
# not noise to be tuned out; it is someone trying the door.

resource "aws_cloudwatch_log_metric_filter" "correction_size_mismatch" {
  name           = "${var.app_name}-ai-extract-correction-size-${var.environment}"
  log_group_name = aws_cloudwatch_log_group.ai_extract.name
  pattern        = "\"[ai-extract] correction refused reason=different_size\""

  metric_transformation {
    name          = "CorrectionSizeMismatch"
    namespace     = "${var.app_name}/ai-extract"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "correction_size_mismatch" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name        = "${var.app_name}-ai-extract-correction-size-${var.environment}"
  alarm_description = "A correction grant was spent against a differently-sized document with a matching source hash. On the sealed arm that hash is client-supplied, so this is a forged fingerprint - the cheap-buys-expensive meter bypass. Check the family_hash in the log line."

  namespace           = aws_cloudwatch_log_metric_filter.correction_size_mismatch.metric_transformation[0].namespace
  metric_name         = aws_cloudwatch_log_metric_filter.correction_size_mismatch.metric_transformation[0].name
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [var.alerts_topic_arn]
  ok_actions    = [var.alerts_topic_arn]

  tags = {
    Name        = "${var.app_name}-ai-extract-correction-size"
    Environment = var.environment
  }
}

# A reservation without a Throttles alarm is a ceiling nobody finds out about. The sibling
# module states the reasoning (modules/content-fetch/main.tf): "either real demand outgrew the
# reservation, or abuse is hitting the ceiling. Both are worth a look." That applies with more
# force here, because THIS function's ceiling can only be reached by the already-shipped image
# path — which the #83 rate limits deliberately do not cover.
resource "aws_cloudwatch_metric_alarm" "throttles" {
  count = var.alerts_topic_arn == "" ? 0 : 1

  alarm_name          = "${var.app_name}-ai-extract-throttles-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ai-extract is being throttled — its concurrency reservation is saturated, so extractions are failing for every family. Either real demand outgrew var.reserved_concurrency, or something is flooding the endpoint. Note the image path is NOT covered by the per-family/per-IP limits."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alerts_topic_arn]
  ok_actions          = [var.alerts_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.ai_extract.function_name
  }

  tags = {
    Name        = "${var.app_name}-ai-extract-throttles"
    Environment = var.environment
  }
}
