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

variable "staging_subdomain" {
  description = "Subdomain used for Astro staging deploys pre-cutover. After the apex cutover this distribution becomes the apex distribution (aliases are updated at that time)."
  type        = string
  default     = "staging"
}

variable "additional_distribution_arns" {
  description = "Extra CloudFront distribution ARNs that may read from this module's S3 bucket via OAC. Used during Phase C cutover to let the apex distribution serve the Astro build from this bucket."
  type        = list(string)
  default     = []
}
