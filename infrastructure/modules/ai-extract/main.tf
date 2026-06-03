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
# Basic execution role only — the Lambda calls Tinfoil over HTTPS and writes to
# its own log group. No DynamoDB, no foreign-group access.

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

  environment {
    variables = {
      # Billable third-party credential — supplied via TF_VAR (sensitive), never committed.
      TINFOIL_API_KEY = var.tinfoil_api_key
      # Soft key the client sends (mirrors the registry/telemetry x-api-key pattern).
      AI_EXTRACT_API_KEY = var.ai_extract_api_key
      TINFOIL_API_BASE   = var.tinfoil_api_base
      TINFOIL_MODEL      = var.tinfoil_model
      CORS_ORIGINS       = join(",", var.cors_origins)
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
