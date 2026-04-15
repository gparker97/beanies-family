terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Primary provider — ap-southeast-1 (Singapore)
provider "aws" {
  region = var.aws_region
}

# ACM certificates for CloudFront must be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

# ── Modules ──────────────────────────────────────────────────────────────────

module "frontend" {
  source = "./modules/frontend"

  domain_name    = var.domain_name
  environment    = var.environment
  hosted_zone_id = var.hosted_zone_id

  # Let the app.<apex> distribution (Phase A cutover prep for #167) read
  # from the same Vue S3 bucket via OAC.
  additional_distribution_arns = [module.app_subdomain.cloudfront_distribution_arn]

  # Phase C cutover (2026-04-15) — apex now serves Astro content from the
  # web bucket, with the merged apex-cutover CF function handling PWA-path
  # 301s (→ app.beanies.family), legacy /beanstalk* → /blog* redirects, and
  # Astro .html URL rewrites. SPA fallback off because Astro emits real 404s.
  origin_bucket_regional_domain_name = module.web.s3_bucket_regional_domain_name
  viewer_request_function_arn        = module.web.apex_cutover_function_arn
  enable_spa_fallback                = false

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

# ── app.beanies.family — PWA subdomain (added 2026-04-14 for #167) ──────────
# Serves the Vue PWA at app.<apex>, sharing the frontend module's S3 bucket
# via OAC. After the apex cutover, this becomes the sole home of the PWA.

module "app_subdomain" {
  source = "./modules/app-subdomain"

  apex_domain                        = var.domain_name
  environment                        = var.environment
  hosted_zone_id                     = var.hosted_zone_id
  origin_bucket_regional_domain_name = module.frontend.s3_bucket_regional_domain_name

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

# ── web — Astro marketing site (added 2026-04-14 for #167) ──────────────────
# Staging-only during Phase A (staging.<apex>). After cutover, this
# distribution's aliases become [apex, www.apex] and the apex distribution
# above is decommissioned.

module "web" {
  source = "./modules/web"

  apex_domain    = var.domain_name
  environment    = var.environment
  hosted_zone_id = var.hosted_zone_id

  # Pre-authorize the apex distribution to OAC-read this bucket. Pre-cutover
  # the apex distribution doesn't reach for it (origin is still the Vue
  # bucket); at Phase C cutover it starts serving Astro from here without
  # needing a separate bucket-policy update in the same apply.
  additional_distribution_arns = [module.frontend.cloudfront_distribution_arn]

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

# ────────────────────────────────────────────────────────────────────────────
# Phase C cutover — UNCOMMENT (and run terraform apply) to flip apex to Astro.
# See docs/runbooks/cutover-apex-to-astro.md for the full procedure.
#
# When uncommented, three things change on the apex distribution:
#   1. Origin swaps from the Vue S3 bucket to the Astro S3 bucket
#   2. The apex-cutover CloudFront Function is attached (PWA path 301s,
#      legacy /beanstalk redirects, Astro .html URL rewrites)
#   3. The SPA 403/404 → /index.html fallback is removed (Astro emits real
#      status codes)
#
# To activate, change `module "frontend"` above to:
#
#   module "frontend" {
#     ...existing args...
#     origin_bucket_regional_domain_name = module.web.s3_bucket_regional_domain_name
#     viewer_request_function_arn        = module.web.apex_cutover_function_arn
#     enable_spa_fallback                = false
#   }
#
# Then: terraform plan → review → apply. Single commit, single apply.
# ────────────────────────────────────────────────────────────────────────────

module "registry" {
  source = "./modules/registry"

  app_name       = var.app_name
  environment    = var.environment
  domain_name    = "api.${var.domain_name}"
  hosted_zone_id = var.hosted_zone_id
  api_key        = var.registry_api_key

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

module "oauth" {
  source = "./modules/oauth"

  app_name                  = var.app_name
  environment               = var.environment
  google_client_secret      = var.google_client_secret
  api_gateway_id            = module.registry.api_gateway_id
  api_gateway_execution_arn = module.registry.api_gateway_execution_arn
}

