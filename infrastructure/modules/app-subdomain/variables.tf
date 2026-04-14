variable "apex_domain" {
  description = "Apex domain (e.g. beanies.family). The subdomain is always app.<apex>."
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

variable "origin_bucket_regional_domain_name" {
  description = "Regional domain name of the S3 bucket that holds the Vue PWA build (shared with the apex distribution during Phase A, then becomes the sole consumer after cutover)"
  type        = string
}
