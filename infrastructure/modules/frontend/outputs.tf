output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.frontend.id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN (used by sibling distributions to share the Vue S3 bucket via OAC)"
  value       = aws_cloudfront_distribution.frontend.arn
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket hosting the Vue SPA (shared with app.beanies.family distribution during Phase A)"
  value       = aws_s3_bucket.frontend.arn
}

output "s3_bucket_regional_domain_name" {
  description = "Regional domain name of the Vue SPA S3 bucket (used as origin by app.beanies.family distribution)"
  value       = aws_s3_bucket.frontend.bucket_regional_domain_name
}
