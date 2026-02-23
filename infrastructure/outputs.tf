# ── Frontend outputs ──────────────────────────────────────────────────────────

output "s3_bucket_name" {
  description = "S3 bucket for frontend assets"
  value       = module.frontend.s3_bucket_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = module.frontend.cloudfront_distribution_id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = module.frontend.cloudfront_domain_name
}

output "website_url" {
  description = "Website URL"
  value       = "https://${var.domain_name}"
}

# ── Registry outputs ──────────────────────────────────────────────────────────

output "registry_api_url" {
  description = "Registry API endpoint URL"
  value       = module.registry.api_url
}

output "registry_api_domain" {
  description = "Registry API custom domain"
  value       = module.registry.api_domain_name
}

output "registry_table_name" {
  description = "Registry DynamoDB table name"
  value       = module.registry.dynamodb_table_name
}

output "registry_lambda_name" {
  description = "Registry Lambda function name"
  value       = module.registry.lambda_function_name
}

