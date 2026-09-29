output "identity_arn" {
  description = "ARN of the SES domain identity"
  value       = aws_sesv2_email_identity.domain.arn
}

output "mail_from_domain" {
  description = "Custom MAIL FROM domain (bounce return path)"
  value       = local.mail_from_domain
}
