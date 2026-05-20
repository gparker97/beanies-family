output "lambda_function_name" {
  description = "Telemetry Lambda function name"
  value       = aws_lambda_function.telemetry.function_name
}

output "log_group_name" {
  description = "CloudWatch Logs group holding the diagnostic firehose (query via Logs Insights)"
  value       = aws_cloudwatch_log_group.telemetry.name
}

output "ingest_url" {
  description = "Fully-qualified ingest endpoint — set as the BEANIES_LOG_INGEST_URL GitHub repo VARIABLE"
  value       = "https://${var.api_domain_name}/logs"
}
