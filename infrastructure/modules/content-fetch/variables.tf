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
  description = "Custom domain of the shared API (from registry) — used to build the endpoint URL output"
  type        = string
}

variable "content_fetch_api_key" {
  description = "Soft API key the client sends (x-api-key). Ships in the public bundle, so it is NOT a true secret — it only deters casual abuse. The real bounds are the route throttle, the concurrency reservation and the per-request body/redirect/timeout caps."
  type        = string
  sensitive   = true
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions. Caps PARALLELISM for a semi-open proxy; the per-route throttle in modules/registry caps VOLUME. Both are needed — a single-threaded attacker loops forever inside a concurrency reservation."
  type        = number
  default     = 5
}

variable "invocation_alarm_threshold" {
  description = "Invocations per hour above which the abuse alarm fires. Family-scale capture is a handful per day, so this is deliberately low."
  type        = number
  default     = 200
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the content-fetch group"
  type        = number
  default     = 90
}

variable "cors_origins" {
  description = "Allowed CORS origins (mirrors registry/telemetry/ai-extract)"
  type        = list(string)
  default = [
    "https://beanies.family",         # apex (legacy / pre-cutover)
    "https://app.beanies.family",     # PWA subdomain (post-cutover primary)
    "capacitor://app.beanies.family", # Capacitor iOS native WebView (ADR-029)
    "http://localhost:5173",          # Vite dev server
    "http://localhost:4173",          # Vite preview server
  ]
}
