output "table_name" {
  description = "Billing DynamoDB table name. Read by the registry Lambda (entitlement) and, from Phase 4, ai-extract (allowance tier)."
  value       = aws_dynamodb_table.billing.name
}

output "table_arn" {
  description = "Billing DynamoDB table ARN, for the readers' dynamodb:GetItem grants."
  value       = aws_dynamodb_table.billing.arn
}

output "lambda_function_name" {
  description = "Billing Lambda function name"
  value       = aws_lambda_function.billing.function_name
}

output "webhook_url" {
  description = "The URL to register as the Stripe webhook endpoint (docs/runbooks/pricing-launch.md)"
  value       = "https://${var.api_domain_name}/billing/webhook"
}
