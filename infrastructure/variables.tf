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

variable "log_ingest_api_key" {
  description = "Soft API key the client sends to the telemetry ingest endpoint (POST /logs). In the public client bundle, so not a true secret, but kept as a Terraform sensitive var + GitHub secret to deter casual abuse."
  type        = string
  sensitive   = true
}

variable "tinfoil_api_key" {
  description = "Tinfoil inference API key for the AI document-extraction proxy (POST /ai-extract). Server-held, billable third-party credential — never in the client bundle. Supply via TF_VAR_tinfoil_api_key. See #133 / ADR-030."
  type        = string
  sensitive   = true
}

variable "ai_extract_api_key" {
  description = "Soft API key the client sends to the AI extraction proxy (POST /ai-extract). In the public client bundle, so not a true secret, but kept sensitive + a GitHub secret to deter casual abuse (mirrors log_ingest_api_key)."
  type        = string
  sensitive   = true
}

variable "site_verification_txt_records" {
  description = "TXT strings published at the apex for domain verification (Google Search Console, Bing Webmaster Tools, etc.). All entries merged into a single TXT record on beanies.family. These values are not sensitive — they're publicly readable via DNS."
  type        = list(string)
  default     = []
}

variable "alert_email" {
  description = "Address notified when a content-fetch abuse/throttle alarm fires. Optional — empty creates the topic with no subscription, so alarms still function and can be subscribed later."
  type        = string
  default     = ""
}

variable "content_fetch_api_key" {
  description = "Soft API key the client sends to the content-fetch proxy (x-api-key). Ships in the public bundle so it is not a true secret; set TF_VAR_content_fetch_api_key, and mirror it to the CONTENT_FETCH_API_KEY GitHub secret or the deployed client starts getting 401s."
  type        = string
  sensitive   = true
}

variable "slack_error_webhook_url" {
  description = "Slack incoming-webhook URL (#beanies-errors) used by the telemetry Lambda to escalate build-integrity events server-side. Set TF_VAR_slack_error_webhook_url; it is the same value as the BEANIES_ERROR_WEBHOOK_URL GitHub variable. Optional — unset means the Lambda logs the failure to CloudWatch and continues."
  type        = string
  default     = ""
  sensitive   = true
}

variable "youtube_api_key" {
  description = "YouTube Data API v3 key, passed to the content-fetch Lambda so recipe captures can read a video's title and description. Set TF_VAR_youtube_api_key. Optional — unset means YouTube links fail, since YouTube blocks the Lambda's egress IP on every unauthenticated route."
  type        = string
  default     = ""
  sensitive   = true
}

# ── Pricing and entitlement (#95) ────────────────────────────────────────────
# Both are launch CONFIG, not secrets, so they are set in terraform.auto.tfvars (committed), not
# via TF_VAR_*. Both have safe defaults, which is exactly the silent-revert shape described in
# .beanies-tf.env.example: set only in one shell's env, an apply from any other shell would
# quietly stop the launch trial clock (or switch enforcement off) and succeed. A committed
# value cannot be forgotten, and *.auto.tfvars outranks TF_VAR_* anyway.

variable "v1_launch_at" {
  description = "V1 launch instant, ISO-8601 (e.g. 2027-01-15T00:00:00Z). Empty means the launch-based 90-day trial clock has not started: a family with no subscription and no trialEndsAt override is `beta`. A subscription (`active`) and a per-family trialEndsAt override count before launch too. Once set, each remaining family's trial ends at max(registry createdAt, this) + 90 days. Set in terraform.auto.tfvars at launch, per docs/runbooks/pricing-launch.md (Phase 6)."
  type        = string
  default     = ""
}

variable "billing_enforce" {
  description = "Read-only enforcement switch. false = dry-run: the registry computes and returns entitlement with enforced=false, clients log would_block and take no action. true = a read_only family cannot write. Set in terraform.auto.tfvars; flip only after the soak, per the pricing launch runbook."
  type        = bool
  default     = false
}
