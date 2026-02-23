variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
}

variable "app_name" {
  description = "Application name prefix for resource naming"
  type        = string
}

variable "domain_name" {
  description = "API custom domain name (e.g., api.beanies.family)"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the parent domain"
  type        = string
}

variable "api_key" {
  description = "API key for authenticating registry requests"
  type        = string
  sensitive   = true
}

variable "cors_origin" {
  description = "Allowed CORS origin"
  type        = string
  default     = "https://beanies.family"
}
