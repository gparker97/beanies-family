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

  domain_name     = var.domain_name
  environment     = var.environment
  hosted_zone_id  = var.hosted_zone_id

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

