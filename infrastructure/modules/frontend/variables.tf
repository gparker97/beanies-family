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
