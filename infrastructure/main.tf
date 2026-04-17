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
  additional_distribution_arns  = [module.app_subdomain.cloudfront_distribution_arn]
  site_verification_txt_records = var.site_verification_txt_records

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

# ── web — Astro marketing site S3 bucket + CloudFront functions ─────────────
# Holds the Astro build output. The apex distribution (frontend module)
# serves this bucket via OAC.

module "web" {
  source = "./modules/web"

  apex_domain    = var.domain_name
  environment    = var.environment
  hosted_zone_id = var.hosted_zone_id

  # The apex distribution reads from this bucket via OAC.
  additional_distribution_arns = [module.frontend.cloudfront_distribution_arn]

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }
}

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

