variable "domain_name" {
  description = "Domain name for the website"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID"
  type        = string
}

variable "additional_distribution_arns" {
  description = "Extra CloudFront distribution ARNs that may read from this module's S3 bucket via OAC (used during Phase A to let app.beanies.family serve the same Vue build)"
  type        = list(string)
  default     = []
}

# ── Phase C cutover variables (no-op until set) ─────────────────────────────
# When set, the apex distribution swaps from serving the Vue SPA out of this
# module's bucket to serving the Astro static site out of the web module's
# bucket, with the apex-cutover function attached for 301 redirects + URL
# rewrites. Defaults preserve current pre-cutover behavior.

variable "origin_bucket_regional_domain_name" {
  description = "Override the apex distribution's S3 origin (regional domain name). Defaults to this module's own bucket. Set to module.web.s3_bucket_regional_domain_name during Phase C cutover."
  type        = string
  default     = null
}

variable "viewer_request_function_arn" {
  description = "ARN of a CloudFront Function to attach to the apex distribution's default cache behavior (viewer-request). Used during Phase C to attach the apex-cutover function. Default: no function attached."
  type        = string
  default     = null
}

variable "enable_spa_fallback" {
  description = "Whether to emit 403/404 → /index.html custom error responses (needed for the Vue SPA's client-side router). Set to false during Phase C — Astro emits real status codes."
  type        = bool
  default     = true
}

variable "site_verification_txt_records" {
  description = "Apex TXT record values for domain verification (Google Search Console, Bing Webmaster, etc.). Each entry is a full TXT string like `google-site-verification=xxxx`. All entries are merged into a single TXT record at the apex name — Route53 supports multiple string values per record set."
  type        = list(string)
  default     = []
}
