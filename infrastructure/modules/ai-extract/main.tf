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

resource "aws_iam_role_policy" "rate_table" {
  name = "${var.app_name}-ai-extract-rate-${var.environment}"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      # UpdateItem ONLY. The limiter increments and lets a ConditionExpression refuse; it
      # never reads a counter back, so anything more would be unused permission.
      Action   = ["dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.rate.arn
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
