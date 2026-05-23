# ── IAM Role for OAuth Lambda ────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-oauth-lambda-${var.environment}"

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
    Name        = "${var.app_name}-oauth-lambda"
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
  source_file = "${path.module}/../../lambda/oauth/index.mjs"
  output_path = "${path.module}/../../lambda/oauth/lambda.zip"
}

resource "aws_lambda_function" "oauth" {
  function_name    = "${var.app_name}-oauth-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      GOOGLE_CLIENT_SECRET = var.google_client_secret
      CORS_ORIGIN          = join(",", var.cors_origins)
      NATIVE_REDIRECT_URIS = join(",", var.native_redirect_uris)
    }
  }

  tags = {
    Name        = "${var.app_name}-oauth"
    Environment = var.environment
  }
}

# ── API Gateway Routes (on shared API Gateway from registry) ─────────────────

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = var.api_gateway_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.oauth.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "oauth_token" {
  api_id    = var.api_gateway_id
  route_key = "POST /oauth/{provider}/token"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "oauth_refresh" {
  api_id    = var.api_gateway_id
  route_key = "POST /oauth/{provider}/refresh"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.oauth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_gateway_execution_arn}/*/*"
}
