output "s3_bucket_name" {
  description = "Name of the Astro content S3 bucket (used by the deploy-web workflow)"
  value       = aws_s3_bucket.web.id
}

output "s3_bucket_regional_domain_name" {
  description = "Regional domain name of the Astro S3 bucket — the apex distribution uses this as its origin."
  value       = aws_s3_bucket.web.bucket_regional_domain_name
}

output "apex_cutover_function_arn" {
  description = "ARN of the merged apex-cutover CloudFront Function. Handles PWA-path 301s, legacy /beanstalk redirects, and Astro .html URL rewrites."
  value       = aws_cloudfront_function.apex_cutover.arn
}
