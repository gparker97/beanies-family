variable "app_name" {
  description = "Application name"
  type        = string
}

variable "environment" {
  description = "Environment name (prod, dev)"
  type        = string
}

variable "google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
}

variable "api_gateway_id" {
  description = "ID of the shared API Gateway HTTP API (from registry module)"
  type        = string
}

variable "api_gateway_execution_arn" {
  description = "Execution ARN of the shared API Gateway (from registry module)"
  type        = string
}

variable "cors_origins" {
  description = "Allowed CORS origins"
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

variable "native_redirect_uris" {
  description = "Fixed native App Link / Universal Link OAuth redirect URIs (Capacitor). Not derivable from cors_origins — the native WebView origin is not the redirect host. See ADR-029."
  type        = list(string)
  default = [
    "https://beanies.family/oauth/native", # verified Android App Link
  ]
}
