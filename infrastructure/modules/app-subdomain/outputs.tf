output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for app.<apex>"
  value       = aws_cloudfront_distribution.app.id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN — pass this back to the frontend module via additional_distribution_arns so the shared S3 bucket policy grants access"
  value       = aws_cloudfront_distribution.app.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.app.domain_name
}

output "fqdn" {
  description = "Fully-qualified app subdomain"
  value       = "app.${var.apex_domain}"
}
