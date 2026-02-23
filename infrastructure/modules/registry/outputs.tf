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
