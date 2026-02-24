terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws, aws.us_east_1]
    }
  }
}

# ── DynamoDB Table ────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "registry" {
  name         = "${var.app_name}-registry-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "familyId"

  attribute {
    name = "familyId"
    type = "S"
  }

  tags = {
    Name        = "${var.app_name}-registry"
    Environment = var.environment
  }
}

# ── IAM Role for Lambda ──────────────────────────────────────────────────────

resource "aws_iam_role" "lambda" {
  name = "${var.app_name}-registry-lambda-${var.environment}"

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
    Name        = "${var.app_name}-registry-lambda"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "dynamodb-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:DeleteItem",
      ]
      Resource = aws_dynamodb_table.registry.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Lambda Function ──────────────────────────────────────────────────────────

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/../../lambda/registry/index.mjs"
  output_path = "${path.module}/../../lambda/registry/lambda.zip"
}

resource "aws_lambda_function" "registry" {
  function_name    = "${var.app_name}-registry-${var.environment}"
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      TABLE_NAME       = aws_dynamodb_table.registry.name
      REGISTRY_API_KEY = var.api_key
      CORS_ORIGIN      = join(",", var.cors_origins)
    }
  }

  tags = {
    Name        = "${var.app_name}-registry"
    Environment = var.environment
  }
}

# ── API Gateway HTTP API v2 ──────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "registry" {
  name          = "${var.app_name}-registry-${var.environment}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_origins
    allow_methods = ["GET", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "x-api-key"]
    max_age       = 86400
  }

  tags = {
    Name        = "${var.app_name}-registry"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.registry.id
  name        = "$default"
  auto_deploy = true

  tags = {
    Name        = "${var.app_name}-registry-default"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.registry.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.registry.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_family" {
  api_id    = aws_apigatewayv2_api.registry.id
  route_key = "GET /family/{familyId}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "put_family" {
  api_id    = aws_apigatewayv2_api.registry.id
  route_key = "PUT /family/{familyId}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "delete_family" {
  api_id    = aws_apigatewayv2_api.registry.id
  route_key = "DELETE /family/{familyId}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.registry.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.registry.execution_arn}/*/*"
}

# ── Custom Domain ────────────────────────────────────────────────────────────

resource "aws_acm_certificate" "api" {
  # Regional API Gateway endpoints need certs in the same region (not us-east-1)
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "${var.app_name}-api-cert"
    Environment = var.environment
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = var.hosted_zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

resource "aws_apigatewayv2_domain_name" "registry" {
  domain_name = var.domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.api.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = {
    Name        = "${var.app_name}-api"
    Environment = var.environment
  }
}

resource "aws_apigatewayv2_api_mapping" "registry" {
  api_id      = aws_apigatewayv2_api.registry.id
  domain_name = aws_apigatewayv2_domain_name.registry.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api" {
  name    = var.domain_name
  type    = "A"
  zone_id = var.hosted_zone_id

  alias {
    name                   = aws_apigatewayv2_domain_name.registry.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.registry.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
