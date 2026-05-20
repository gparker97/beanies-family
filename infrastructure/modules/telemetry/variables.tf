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
    "https://beanies.family",     # apex (legacy / pre-cutover)
    "https://app.beanies.family", # PWA subdomain (post-cutover primary)
    "http://localhost:5173",      # Vite dev server
    "http://localhost:4173",      # Vite preview server
  ]
}
