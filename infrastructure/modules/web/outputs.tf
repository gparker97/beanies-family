output "s3_bucket_name" {
  description = "Name of the Astro content S3 bucket (used by the deploy-web workflow)"
  value       = aws_s3_bucket.web.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID serving the Astro build (staging during Phase A, apex after cutover)"
  value       = aws_cloudfront_distribution.web.id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN"
  value       = aws_cloudfront_distribution.web.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.web.domain_name
}

output "staging_fqdn" {
  description = "Staging subdomain (e.g. staging.beanies.family)"
  value       = "${var.staging_subdomain}.${var.apex_domain}"
}

output "s3_bucket_regional_domain_name" {
  description = "Regional domain name of the Astro S3 bucket — passed to the frontend module during Phase C cutover so the apex distribution serves Astro content."
  value       = aws_s3_bucket.web.bucket_regional_domain_name
}

output "apex_cutover_function_arn" {
  description = "ARN of the merged apex-cutover CloudFront Function (Phase C). Pass to the frontend module's viewer_request_function_arn variable when cutting over."
  value       = aws_cloudfront_function.apex_cutover.arn
}
