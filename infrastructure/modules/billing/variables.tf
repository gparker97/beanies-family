variable "app_name" {
  description = "Application name prefix for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
}

# ── Phase 5: the billing Lambda ──────────────────────────────────────────────

variable "api_gateway_id" {
  description = "ID of the shared API Gateway HTTP API (from registry module)"
  type        = string
}

variable "api_gateway_execution_arn" {
  description = "Execution ARN of the shared API Gateway (from registry module)"
  type        = string
}

variable "api_domain_name" {
  description = "Custom domain of the shared API (from registry), for the endpoint URL output"
  type        = string
}

variable "api_key" {
  description = "Soft API key the client sends (x-api-key) on the three client routes. The REGISTRY key: the billing routes sit on the registry's API and the client already holds that key, so no new GitHub secret. The webhook route ignores it (signature-authenticated)."
  type        = string
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe secret key (sk_test_ in the sandbox, sk_live_ at launch). Server-held, billable. TF_VAR_stripe_secret_key."
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Signing secret (whsec_) of the Stripe webhook endpoint for /billing/webhook. Does not exist until the endpoint is created after the first apply; the Lambda answers 500 webhook_secret_unset until it is set. TF_VAR_stripe_webhook_secret."
  type        = string
  sensitive   = true
}

variable "stripe_pre_v1_coupon" {
  description = "Id of the 50%-forever coupon applied to pre_v1 families' Checkout Sessions (e.g. PRE_V1_50). Same id in sandbox and live."
  type        = string
  default     = "PRE_V1_50"
}

variable "registry_table_name" {
  description = "Registry table name; checkout reads ownerEmail and the tombstone"
  type        = string
}

variable "registry_table_arn" {
  description = "Registry table ARN, for the read-only GetItem grant"
  type        = string
}

variable "registry_dev_table_name" {
  description = "The registry's DEV table (localhost families register there); checkout from a dev origin looks the family up here"
  type        = string
}

variable "registry_dev_table_arn" {
  description = "Registry DEV table ARN, for the same read-only grant"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 90
}

variable "cors_origins" {
  description = "Origins the Lambda echoes in Access-Control-Allow-Origin (ADR-029). Web only: native never calls billing."
  type        = list(string)
  default     = ["https://app.beanies.family", "https://beanies.family", "http://localhost:5173", "http://localhost:4173"]
}

variable "dev_origins" {
  description = "Origins refused by checkout (403 dev_origin): this Lambda holds ONE key pair, and a localhost checkout against live keys would take real money. The local harness runs with DEV_ORIGINS empty instead."
  type        = list(string)
  default     = ["http://localhost:5173", "http://localhost:4173"]
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions. Must cover the summed route throttles."
  type        = number
  default     = 20
}

variable "alerts_topic_arn" {
  description = "SNS topic for the two alarms; empty disables them"
  type        = string
  default     = ""
}
