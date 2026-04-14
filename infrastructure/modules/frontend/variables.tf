variable "domain_name" {
  description = "Domain name for the website"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

variable "additional_distribution_arns" {
  description = "Extra CloudFront distribution ARNs that may read from this module's S3 bucket via OAC (used during Phase A to let app.beanies.family serve the same Vue build)"
  type        = list(string)
  default     = []
}
