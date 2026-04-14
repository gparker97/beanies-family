terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws, aws.us_east_1]
    }
  }
}

locals {
  staging_fqdn = "${var.staging_subdomain}.${var.apex_domain}"
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
            # Both the staging distribution and any sibling distributions
            # (e.g. the apex frontend distribution after Phase C cutover)
            # may read this bucket via OAC.
            "AWS:SourceArn" = concat(
              [aws_cloudfront_distribution.web.arn],
              var.additional_distribution_arns,
            )
          }
        }
      }
    ]
  })
}

# ── ACM certificate for staging subdomain ───────────────────────────────────

resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = local.staging_fqdn
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = local.staging_fqdn
    Environment = var.environment
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.web.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ── Response headers policy: X-Robots-Tag: noindex on staging ───────────────
# Prevents search engines from indexing the staging mirror as duplicate content.

resource "aws_cloudfront_response_headers_policy" "noindex" {
  # CloudFront policy names allow only alphanumerics, dashes, and underscores —
  # no dots. Replace dots in the apex with dashes.
  name    = "${replace(var.apex_domain, ".", "-")}-staging-noindex"
  comment = "Adds X-Robots-Tag: noindex to every response — only attached on staging"

  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}

# ── CloudFront Function: clean URL → .html rewriter ────────────────────────
# Astro emits flat .html files; S3 needs the exact path. This function runs
# on viewer-request and rewrites "/blog/foo" → "/blog/foo.html" etc.
# Currently attached to the staging distribution only.

resource "aws_cloudfront_function" "rewrite_to_html" {
  name    = "${replace(var.apex_domain, ".", "-")}-web-rewrite-to-html"
  runtime = "cloudfront-js-2.0"
  code    = file("${path.module}/functions/rewrite-to-html.js")
  comment = "Rewrite clean Astro URLs to their underlying .html paths before S3 lookup"
  publish = true
}

# ── CloudFront Function: apex-cutover (Phase C, attached to apex distribution) ──
# Combines apex 301 redirects (authenticated paths → app.<apex>; legacy
# /beanstalk* → /blog*) with the Astro URL rewriter. Single function because
# CloudFront allows only one viewer-request function per cache behavior.
# Authored now (Phase A prep) but only attached when the frontend module's
# viewer_request_function_arn variable is set during the cutover commit.

resource "aws_cloudfront_function" "apex_cutover" {
  name    = "${replace(var.apex_domain, ".", "-")}-web-apex-cutover"
  runtime = "cloudfront-js-2.0"
  code    = file("${path.module}/functions/apex-cutover.js")
  comment = "Phase C: 301 PWA paths to app.<apex> + legacy /beanstalk redirects + Astro .html URL rewrite"
  publish = true
}

# ── CloudFront distribution ─────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.apex_domain}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  # Staging-only for Phase A. At cutover, this distribution's aliases are
  # updated to [apex, www.apex] and this subdomain is removed.
  aliases     = [local.staging_fqdn]
  price_class = "PriceClass_100"
  comment     = "beanies.family Astro marketing site (${var.environment})"

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-astro"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-astro"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.noindex.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.rewrite_to_html.arn
    }

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # Long-cache hashed Astro assets (already have .js/.css/.png extensions —
  # no URL rewrite needed).
  ordered_cache_behavior {
    path_pattern               = "/_astro/*"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3-astro"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.noindex.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 31536000
    default_ttl = 31536000
    max_ttl     = 31536000
  }

  # Astro emits real 404s. No SPA fallback here — AI crawlers + search
  # engines should see actual HTTP status codes.
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  depends_on = [aws_acm_certificate_validation.web]
}

# ── Route53 alias for staging subdomain ─────────────────────────────────────

resource "aws_route53_record" "staging_a" {
  zone_id = var.hosted_zone_id
  name    = local.staging_fqdn
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "staging_aaaa" {
  zone_id = var.hosted_zone_id
  name    = local.staging_fqdn
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
