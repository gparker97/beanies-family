terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws, aws.us_east_1]
    }
  }
}

# ── S3 bucket for Astro build output ────────────────────────────────────────

resource "aws_s3_bucket" "web" {
  bucket = "${var.apex_domain}-web-${var.environment}"
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Condition = {
          StringEquals = {
            # The apex distribution reads from this bucket via OAC.
            "AWS:SourceArn" = var.additional_distribution_arns
          }
        }
      }
    ]
  })
}

# ── CloudFront Function: clean URL → .html rewriter ────────────────────────
# Astro emits flat .html files; S3 needs the exact path. This function runs
# on viewer-request and rewrites "/blog/foo" → "/blog/foo.html" etc.

resource "aws_cloudfront_function" "rewrite_to_html" {
  name    = "${replace(var.apex_domain, ".", "-")}-web-rewrite-to-html"
  runtime = "cloudfront-js-2.0"
  code    = file("${path.module}/functions/rewrite-to-html.js")
  comment = "Rewrite clean Astro URLs to their underlying .html paths before S3 lookup"
  publish = true
}

# ── CloudFront Function: apex-cutover (attached to apex distribution) ──────
# Combines apex 301 redirects (authenticated paths → app.<apex>; legacy
# /beanstalk* → /blog*) with the Astro URL rewriter. Single function because
# CloudFront allows only one viewer-request function per cache behavior.

resource "aws_cloudfront_function" "apex_cutover" {
  name    = "${replace(var.apex_domain, ".", "-")}-web-apex-cutover"
  runtime = "cloudfront-js-2.0"
  code    = file("${path.module}/functions/apex-cutover.js")
  comment = "301 PWA paths to app.<apex> + legacy /beanstalk redirects + Astro .html URL rewrite"
  publish = true
}

# ── CloudFront OAC ──────────────────────────────────────────────────────────
# Shared OAC for distributions reading from this bucket.

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.apex_domain}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# NOTE: The staging CloudFront distribution, ACM cert, Route53 records, and
# X-Robots-Tag response-headers policy were removed in Apr 2026. They were
# only needed pre-cutover for previewing the Astro site before the apex
# pointed at it. The apex distribution (in the frontend module) now serves
# all Astro content directly.
#
# If a staging/UAT environment is needed in the future, create a separate
# S3 bucket + distribution pair so it's truly isolated from production.
