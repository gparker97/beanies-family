output "table_name" {
  description = "Billing DynamoDB table name. Read by the registry Lambda (entitlement) and, from Phase 4, ai-extract (allowance tier)."
  value       = aws_dynamodb_table.billing.name
}

output "table_arn" {
  description = "Billing DynamoDB table ARN, for the readers' dynamodb:GetItem grants."
  value       = aws_dynamodb_table.billing.arn
}
