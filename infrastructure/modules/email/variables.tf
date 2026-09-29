variable "domain_name" {
  description = "Apex domain SES sends as (From: ...@<domain_name>)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the domain"
  type        = string
}

variable "mail_from_subdomain" {
  description = "Custom MAIL FROM subdomain label. Bounces return here, and its SPF is separate from the apex SPF, which belongs to Migadu"
  type        = string
  default     = "bounce"
}
