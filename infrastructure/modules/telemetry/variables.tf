variable "app_name" {
  description = "Application name"
  type        = string
}

variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
}

variable "api_gateway_id" {
  description = "ID of the shared API Gateway HTTP API (from registry module)"
  type        = string
}

variable "api_gateway_execution_arn" {
  description = "Execution ARN of the shared API Gateway (from registry module)"
  type        = string
}

variable "api_domain_name" {
  description = "Custom domain of the shared API (from registry) — used to build the ingest URL output"
  type        = string
}

variable "log_ingest_api_key" {
  description = "Soft API key the client sends (x-api-key header or ?k= query) to the ingest endpoint"
  type        = string
  sensitive   = true
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the telemetry group"
  type        = number
  default     = 90
}

variable "cors_origins" {
  description = "Allowed CORS origins (mirrors the registry/oauth default — no root pass-through)"
  type        = list(string)
  default = [
    "https://beanies.family",         # apex (legacy / pre-cutover)
    "https://app.beanies.family",     # PWA subdomain (post-cutover primary)
    "capacitor://app.beanies.family", # Capacitor iOS native WebView — iosScheme stays `capacitor` (ADR-029; capacitor.config.ts)
    "http://localhost:5173",          # Vite dev server
    "http://localhost:4173",          # Vite preview server
  ]
}

variable "slack_error_webhook_url" {
  description = "Slack incoming-webhook URL for server-side escalation of build-integrity events. Same channel as the client's VITE_BEANIES_ERROR_WEBHOOK_URL (#beanies-errors). Optional — the Lambda logs loudly and continues when unset."
  type        = string
  default     = ""
  sensitive   = true
}
