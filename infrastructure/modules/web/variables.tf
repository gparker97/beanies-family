variable "apex_domain" {
  description = "Apex domain (e.g. beanies.family)"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the apex domain"
  type        = string
}

variable "additional_distribution_arns" {
  description = "CloudFront distribution ARNs that may read from this module's S3 bucket via OAC (e.g. the apex distribution)."
  type        = list(string)
  default     = []
}
