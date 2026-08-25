terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# content-fetch — the app's first user-controlled outbound request (#72).
#
# Deliberately its OWN Lambda rather than a mode on ai-extract. Fetching a
# user-supplied URL server-side is an SSRF vector, and it does not belong in the
# component that holds the Tinfoil API key. See the handler header for the full
# rationale (blast radius, security isolation, operational shape).
#
# THREE THINGS HERE DIFFER FROM modules/ai-extract, all load-bearing:
#
#   1. NO VPC ATTACHMENT (and there is deliberately no vpc_config block below).
#      This is a security control, not an omission. The SSRF guard pins the
#      resolved address to defeat DNS rebinding, but pinning is best-effort. The
#      real containment is that even a total bypass reaches nothing: no VPC means
#      no private network to pivot into, and Lambda has no EC2-style IMDS, so
#      169.254.169.254 yields nothing. DO NOT add a vpc_config here without
#      re-reading the guard's residual-risk note.
#
#   2. reserved_concurrent_executions + a per-route throttle. This endpoint is,
#      by construction, a semi-open web proxy: its only auth is the soft x-api-key
#      that ships in the public bundle. Concurrency caps PARALLELISM; the route
#      throttle (in modules/registry) caps VOLUME. Only the second bounds the
#      bill — a single-threaded attacker loops forever inside a concurrency
#      reservation. Both are needed; neither alone is sufficient.
#
#   3. timeout = 15, not 29. A page fetch that takes 15s is a dead host, not a
#      slow one. Holding a billed execution open for 29s waiting on a hostile or
#      broken server is pure cost.
# ─────────────────────────────────────────────────────────────────────────────

# ── CloudWatch Log Group ─────────────────────────────────────────────────────
# The Lambda logs ONLY structured refusal/outcome lines: a mode, a typed code and
# a sanitised hostname. Never a full URL, never page text, captions or recipe
# content — see the `safeHost` helper in index.mjs.

resource "aws_cloudwatch_log_group" "content_fetch" {
  name              = "/aws/lambda/${var.app_name}-content-fetch-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "${var.app_name}-content-fetch-logs"
    Environment = var.environment
  }
}

# ── IAM Role ─────────────────────────────────────────────────────────────────
# Logging and NOTHING else. This is the second half of the containment story in
# note (1) above: the blast radius of a successful SSRF is bounded by what these
# credentials can reach, and the answer is "its own log group". No DynamoDB, no
# S3, no sts:*, no secrets in the environment beyond its own soft key.

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-content-fetch-lambda-${var.environment}"

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
    Name        = "${var.app_name}-content-fetch-lambda"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda Function ──────────────────────────────────────────────────────────
# source_dir so the zip includes the dispatcher, the guard, the shared entity
# decoder and every mode. output_path lives in the module dir so the generated
# zip is never re-included in its own source.

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/content-fetch"
  output_path = "${path.module}/content-fetch-lambda.zip"
  # The test directory would otherwise ship to prod. Harmless but pointless.
  excludes = ["__tests__"]
}

resource "aws_lambda_function" "content_fetch" {
  function_name    = "${var.app_name}-content-fetch-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  # See note (3): a 15s page fetch is a dead host.
  timeout     = 15
  memory_size = 256

  # See note (2): caps parallelism. The route throttle caps volume.
  reserved_concurrent_executions = var.reserved_concurrency

  # NOTE: deliberately NO vpc_config. See note (1).

  environment {
    variables = {
      # Soft key the client sends (mirrors registry/telemetry/ai-extract).
      CONTENT_FETCH_API_KEY = var.content_fetch_api_key
      CORS_ORIGINS          = join(",", var.cors_origins)
      # Read-only, public-data, quota-limited: the weakest credential in the system, which is
      # why it is tolerable in the environment of the one Lambda that talks to the internet.
      YOUTUBE_API_KEY = var.youtube_api_key
    }
  }

  depends_on = [aws_cloudwatch_log_group.content_fetch]

  tags = {
    Name        = "${var.app_name}-content-fetch"
    Environment = var.environment
  }
}

# ── API Gateway route (on the shared API from the registry module) ───────────

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = var.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.content_fetch.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_content_fetch" {
  api_id    = var.api_gateway_id
  route_key = "POST /content-fetch"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.content_fetch.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_execution_arn}/*/*"
}

# ── Alerting ─────────────────────────────────────────────────────────────────
# An alarm with no `alarm_actions` changes colour in a console nobody opens. The module
# header calls the invocation alarm the signal that distinguishes "a family captured some
# recipes" from "someone found the endpoint" — that is only true if it reaches a person.
#
# These are the repo's first metric alarms, so there is no existing SNS topic to inherit.
# The subscription is created only when an address is supplied, so a self-hoster without one
# still gets working alarms (visible in CloudWatch) rather than a failed apply.

resource "aws_sns_topic" "alerts" {
  name = "${var.app_name}-content-fetch-alerts-${var.environment}"

  tags = {
    Name        = "${var.app_name}-content-fetch-alerts"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
  # NOTE: AWS emails a confirmation link on first create; the subscription stays
  # "PendingConfirmation" — and delivers nothing — until it is clicked.
}

# ── SNS → Slack forwarder ────────────────────────────────────────────────────
# Alarms land in #beanies-errors, the channel client errors already go to, reusing the SAME
# webhook the telemetry Lambda uses — no new secret to rotate.
#
# A Lambda rather than a direct SNS subscription because SNS cannot post to a Slack webhook:
# an HTTPS subscription sends SNS's own envelope (Slack wants `{"text": …}`) and requires a
# confirmation handshake a webhook will never perform. AWS Chatbot is the alternative but
# needs a Slack OAuth workspace install — a second integration to maintain for a job this
# does in forty lines.

resource "aws_cloudwatch_log_group" "alarm_slack" {
  count             = var.slack_error_webhook_url == "" ? 0 : 1
  name              = "/aws/lambda/${var.app_name}-alarm-slack-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "${var.app_name}-alarm-slack-logs"
    Environment = var.environment
  }
}

resource "aws_iam_role" "alarm_slack" {
  count = var.slack_error_webhook_url == "" ? 0 : 1
  name  = "${var.app_name}-alarm-slack-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = {
    Name        = "${var.app_name}-alarm-slack"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "alarm_slack_logs" {
  count      = var.slack_error_webhook_url == "" ? 0 : 1
  role       = aws_iam_role.alarm_slack[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "archive_file" "alarm_slack" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/alarm-slack"
  output_path = "${path.module}/alarm-slack-lambda.zip"
  # Same reason as content_fetch above: tests would otherwise ship into the Lambda that holds
  # the Slack webhook, and every test edit would change source_code_hash and show up as a
  # spurious republish in the plan.
  excludes = ["__tests__"]
}

resource "aws_lambda_function" "alarm_slack" {
  count            = var.slack_error_webhook_url == "" ? 0 : 1
  function_name    = "${var.app_name}-alarm-slack-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.alarm_slack[0].arn
  filename         = data.archive_file.alarm_slack.output_path
  source_code_hash = data.archive_file.alarm_slack.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      # The same webhook the telemetry Lambda posts client errors with.
      SLACK_ERROR_WEBHOOK_URL = var.slack_error_webhook_url
    }
  }

  depends_on = [aws_cloudwatch_log_group.alarm_slack]

  tags = {
    Name        = "${var.app_name}-alarm-slack"
    Environment = var.environment
  }
}

resource "aws_lambda_permission" "alarm_slack_sns" {
  count         = var.slack_error_webhook_url == "" ? 0 : 1
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alarm_slack[0].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts.arn
}

resource "aws_sns_topic_subscription" "slack" {
  count     = var.slack_error_webhook_url == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.alarm_slack[0].arn
}

# ── Alarms ───────────────────────────────────────────────────────────────────
# Volume abuse of a semi-open proxy is a COST event, not an error event: every
# request succeeds. So the alarm watches invocation VOLUME, which is the only
# signal that distinguishes "a family captured some recipes" from "someone found
# the endpoint". Throttles are alarmed separately — sustained throttling means
# the concurrency reservation is actually being hit.

resource "aws_cloudwatch_metric_alarm" "high_invocations" {
  alarm_name          = "${var.app_name}-content-fetch-high-invocations-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Invocations"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = var.invocation_alarm_threshold
  alarm_description   = "content-fetch invocations exceeded ${var.invocation_alarm_threshold}/hour — possible abuse of the semi-open proxy (its api key ships in the public bundle)."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.content_fetch.function_name
  }

  tags = {
    Name        = "${var.app_name}-content-fetch-invocations"
    Environment = var.environment
  }
}

# ── YouTube Data API health ──────────────────────────────────────────────────
# THE OUTAGE NOTHING WOULD HAVE CAUGHT.
#
# The Data API is the production path for every YouTube capture — YouTube blocks this
# Lambda's egress IP on both the watch page and the InnerTube endpoint, so there is no
# working fallback. When the key is revoked, restricted, or the free 10,000-unit daily quota
# runs out, 100% of YouTube captures fail at once.
#
# Left alone, that failure is invisible. The user is told "YouTube blocks apps from reading
# some videos — look in the description", the workaround usually works, so nobody reports it;
# and the Invocations alarm above stays quiet because the Lambda is being invoked normally,
# it is just failing. The only distinguishing signal is one log line, which is why the mode
# logs it at ERROR with a fixed prefix rather than folding it into the generic block message.
#
# Metric filter + alarm turns that line into something that pages #beanies-errors through the
# same SNS topic and forwarder as everything else.

resource "aws_cloudwatch_log_metric_filter" "youtube_api_failed" {
  name = "${var.app_name}-youtube-data-api-failed-${var.environment}"
  # Matches the exact prefix emitted by modes/youtube.mjs. Kept as a literal rather than a
  # pattern so a reword of the message breaks the filter loudly in review, instead of
  # silently matching nothing forever.
  pattern        = "[youtube] data-api FAILED"
  log_group_name = aws_cloudwatch_log_group.content_fetch.name

  metric_transformation {
    name          = "YoutubeDataApiFailures"
    namespace     = "beanies/content-fetch"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "youtube_api_failed" {
  alarm_name          = "${var.app_name}-youtube-data-api-failed-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  # Two periods, not one: a single failure can be a transient googleapis blip, and paging on
  # it would train the channel to be ignored. Two consecutive 5-minute windows with failures
  # is a real outage — quota, key or block — and every capture is failing meanwhile.
  evaluation_periods = 2
  metric_name        = "YoutubeDataApiFailures"
  namespace          = "beanies/content-fetch"
  period             = 300
  statistic          = "Sum"
  threshold          = 0
  alarm_description  = "YouTube Data API calls are failing — key revoked/restricted, daily quota exhausted, or googleapis unreachable. EVERY YouTube recipe capture is failing while this is firing, and the user-facing message blames YouTube, so nobody will report it. Check the quota in the GCP console first."
  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.alerts.arn]
  ok_actions         = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "${var.app_name}-youtube-data-api-failed"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "throttles" {
  alarm_name          = "${var.app_name}-content-fetch-throttles-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 3600
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "content-fetch is being throttled — either real demand outgrew the reservation, or abuse is hitting the ceiling. Both are worth a look."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.content_fetch.function_name
  }

  tags = {
    Name        = "${var.app_name}-content-fetch-throttles"
    Environment = var.environment
  }
}
