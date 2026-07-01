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

variable "tinfoil_api_key" {
  description = "Tinfoil inference API key (server-held; billable third-party credential)"
  type        = string
  sensitive   = true
}

variable "ai_extract_api_key" {
  description = "Soft API key the client sends (x-api-key) to the proxy. In the public bundle, so not a true secret, but kept sensitive + a GitHub secret to deter casual abuse."
  type        = string
  sensitive   = true
}

variable "tinfoil_api_base" {
  description = "Tinfoil OpenAI-compatible API base URL"
  type        = string
  default     = "https://inference.tinfoil.sh/v1"
}

variable "tinfoil_model" {
  description = "Tinfoil vision model id (must be multimodal + served on /v1/chat/completions)"
  type        = string
  # 2026-07-01: Tinfoil retired qwen3-vl-30b (removed from catalog → 503s). Switched to
  # gemma4-31b, their current multimodal chat model. Applied to prod via Lambda env hotfix
  # the same day; this default keeps Terraform in sync so the next apply doesn't revert it.
  default = "gemma4-31b"
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the ai-extract group"
  type        = number
  default     = 90
}

variable "cors_origins" {
  description = "Allowed CORS origins (mirrors registry/telemetry)"
  type        = list(string)
  default = [
    "https://beanies.family",     # apex (legacy / pre-cutover)
    "https://app.beanies.family", # PWA subdomain (post-cutover primary)
    "http://localhost:5173",      # Vite dev server
    "http://localhost:4173",      # Vite preview server
  ]
}
