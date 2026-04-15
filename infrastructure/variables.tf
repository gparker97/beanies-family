variable "aws_region" {
  description = "Primary AWS region"
  type        = string
  default     = "ap-southeast-1"
}

variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
  default     = "prod"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "beanies-family"
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "beanies.family"
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID for the domain"
  type        = string
  default     = "Z104262530APLWP19OU4P"
}

variable "registry_api_key" {
  description = "API key for the family registry service"
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret for token exchange"
  type        = string
  sensitive   = true
}

variable "site_verification_txt_records" {
  description = "TXT strings published at the apex for domain verification (Google Search Console, Bing Webmaster Tools, etc.). All entries merged into a single TXT record on beanies.family. These values are not sensitive — they're publicly readable via DNS."
  type        = list(string)
  default     = []
}
