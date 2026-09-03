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
    "https://beanies.family",         # apex (legacy / pre-cutover)
    "https://app.beanies.family",     # PWA subdomain (post-cutover primary)
    "capacitor://app.beanies.family", # Capacitor iOS native WebView — iosScheme stays `capacitor` (ADR-029; capacitor.config.ts)
    "http://localhost:5173",          # Vite dev server
    "http://localhost:4173",          # Vite preview server
  ]
}

variable "reserved_concurrency" {
  description = "Reserved concurrent executions for the ai-extract Lambda. Caps PARALLELISM; the per-route throttle in modules/registry caps VOLUME. Both are needed, and this one must not sit below what the throttle admits."
  type        = number
  # ⚠️ Sized to COVER the route throttle, not guessed. `POST /ai-extract` admits a sustained
  # 2 rps (modules/registry/main.tf), and this function's timeout is 29s, so an invocation can
  # hold a slot for the full 29 seconds: worst-case demand is 2 × 29 ≈ 58 concurrent, and
  # realistic demand at 8-15s Tinfoil latency is 16-30.
  #
  # An earlier revision set this to 10 by analogy with content-fetch's 5. That was WRONG and
  # would have been a self-inflicted denial of service: ten slots saturate well inside what
  # the throttle already permits, every further invoke is Lambda-throttled, and an
  # API-Gateway-generated error carries no CORS headers — so from a browser it surfaces as an
  # opaque network failure that classifies as `provider_error` and pages #beanies-errors. The
  # already-shipped IMAGE path would break, and the #83 limits do not touch that path at all.
  #
  # Do NOT lower this to "save money". Concurrency is free; only invocations are billable, and
  # the route throttle is what bounds those. Lowering it throttles a working feature while
  # bounding nothing.
  default = 60
}

variable "alerts_topic_arn" {
  description = "SNS topic ARN for alarms (from the content-fetch module). Empty disables alarm actions so a self-hoster without an address still gets a working apply."
  type        = string
  default     = ""
}
