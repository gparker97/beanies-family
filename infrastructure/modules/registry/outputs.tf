output "api_url" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.registry.api_endpoint
}

output "api_domain_name" {
  description = "Custom domain name for the API"
  value       = aws_apigatewayv2_domain_name.registry.domain_name
}

output "dynamodb_table_name" {
  description = "DynamoDB table name"
  value       = aws_dynamodb_table.registry.name
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.registry.function_name
}

output "api_gateway_id" {
  description = "API Gateway HTTP API ID (shared across modules)"
  value       = aws_apigatewayv2_api.registry.id
}

output "api_gateway_execution_arn" {
  description = "API Gateway execution ARN (shared across modules)"
  value       = aws_apigatewayv2_api.registry.execution_arn
}

output "dynamodb_table_arn" {
  description = "Registry table ARN, for the billing Lambda's read-only GetItem grant (#95 Phase 5)"
  value       = aws_dynamodb_table.registry.arn
}

output "dynamodb_dev_table_name" {
  description = "The DEV registry table (localhost origins register here), for the billing Lambda's dev-origin lookup"
  value       = aws_dynamodb_table.registry_dev.name
}

output "dynamodb_dev_table_arn" {
  description = "DEV registry table ARN, for the billing Lambda's read-only grant"
  value       = aws_dynamodb_table.registry_dev.arn
}
