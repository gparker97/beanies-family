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

variable "cors_origins" {
  description = "Allowed CORS origins. Feeds BOTH the shared API Gateway cors_configuration (preflight for all routes, incl. /oauth/*) and the registry Lambda's CORS_ORIGIN."
  type        = list(string)
  default = [
    "https://beanies.family",         # apex (legacy / pre-cutover)
    "https://app.beanies.family",     # PWA subdomain (post-cutover primary)
    "capacitor://app.beanies.family", # Capacitor iOS native WebView — iosScheme stays `capacitor` (ADR-029; capacitor.config.ts)
    "https://localhost",              # Capacitor Android native WebView (ADR-029)
    "http://localhost:5173",          # Vite dev server
    "http://localhost:4173",          # Vite preview server
  ]
}

variable "dev_origins" {
  description = "Subset of cors_origins that should write to the dev DynamoDB table instead of the prod table. The Lambda routes by Origin header — see infrastructure/lambda/registry/index.mjs."
  type        = list(string)
  default = [
    "http://localhost:5173",
    "http://localhost:4173",
  ]
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for this module's log group. Never unset — an unset retention means logs are kept forever."
  type        = number
  default     = 90
}

# ── Entitlement (#95) ────────────────────────────────────────────────────────

variable "billing_table_name" {
  description = "Billing DynamoDB table (from the billing module). The GET arm reads it to compute `entitlement`; always the prod table, whatever the request Origin."
  type        = string
}

variable "billing_table_arn" {
  description = "Billing DynamoDB table ARN, for the Lambda's dynamodb:GetItem grant."
  type        = string
}

variable "v1_launch_at" {
  description = "V1 launch instant (ISO-8601, e.g. 2027-01-15T00:00:00Z). Empty means the launch-based trial clock has not started: families with no subscription and no trialEndsAt override are beta (subscriptions and overrides count before launch). Once set, those families' trials end max(createdAt, this) + 90 days."
  type        = string
  default     = ""
}

variable "billing_enforce" {
  description = "When false (dry-run), entitlement is computed and reported with enforced=false and no client acts on it. Flip only per the pricing launch runbook."
  type        = bool
  default     = false
}
