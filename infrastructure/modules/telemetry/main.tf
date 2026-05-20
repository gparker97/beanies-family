terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

# ── CloudWatch Log Group (the telemetry sink) ────────────────────────────────
#
# This IS the durable diagnostic store. The telemetry Lambda's `console.log`
# lands here; Logs Insights queries filter `t = "beanlog"`. Declared explicitly
# (vs. letting Lambda auto-create it) so retention is pinned to 90 days instead
# of the 13-day Lambda default. The Lambda `depends_on` this so AWS doesn't
# auto-create the group with default retention first.

resource "aws_cloudwatch_log_group" "telemetry" {
  name              = "/aws/lambda/${var.app_name}-telemetry-${var.environment}"
  retention_in_days = var.log_retention_days

  tags = {
    Name        = "${var.app_name}-telemetry-logs"
    Environment = var.environment
  }
}

# ── IAM Role ─────────────────────────────────────────────────────────────────
# Basic execution role only — the Lambda writes solely to its own log group, so
# no extra policy (no PutLogEvents to a foreign group, no DynamoDB, etc.).

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-telemetry-lambda-${var.environment}"

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
    Name        = "${var.app_name}-telemetry-lambda"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda Function ──────────────────────────────────────────────────────────

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../../lambda/telemetry/index.mjs"
  output_path = "${path.module}/../../lambda/telemetry/lambda.zip"
}

resource "aws_lambda_function" "telemetry" {
  function_name    = "${var.app_name}-telemetry-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      LOG_INGEST_API_KEY = var.log_ingest_api_key
      CORS_ORIGINS       = join(",", var.cors_origins)
    }
  }

  # The explicit 90-day group must exist before the function so AWS doesn't
  # auto-create /aws/lambda/<fn> with the default 13-day retention.
  depends_on = [aws_cloudwatch_log_group.telemetry]

  tags = {
    Name        = "${var.app_name}-telemetry"
    Environment = var.environment
  }
}

# ── API Gateway route (on the shared API from the registry module) ───────────

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = var.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.telemetry.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_logs" {
  api_id    = var.api_gateway_id
  route_key = "POST /logs"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.telemetry.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_execution_arn}/*/*"
}
