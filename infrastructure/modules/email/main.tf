# ── email — SES sending identity for beanies.family ──────────────────────────
# Added 2026-09-29 for the owner-email campaigns issue. This module is ONLY the
# sending identity: the domain, Easy DKIM, and a custom MAIL FROM subdomain.
#
# Coexists with Migadu, which owns the apex MX and the apex SPF
# ("v=spf1 include:spf.migadu.com -all"). Neither is touched here:
#   - DMARC passes on DKIM alignment (SES signs as d=beanies.family), and
#   - SPF alignment comes from bounce.beanies.family (relaxed alignment), whose
#     own MX + SPF point at SES, so the apex -all never sees SES mail.
# The existing _dmarc record (p=quarantine) is left as-is. The explicit MX on
# bounce.<apex> overrides the zone's wildcard MX (*.<apex> → Migadu) for that one
# name only.
#
# No configuration set, open tracking or click tracking: campaigns carry UTM
# tags only (privacy page promise). Bounce + complaint suppression is the
# account-level SES suppression list (already BOUNCE + COMPLAINT).

data "aws_region" "current" {}

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

resource "aws_route53_record" "dkim" {
  count = 3

  zone_id = var.hosted_zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

locals {
  mail_from_domain = "${var.mail_from_subdomain}.${var.domain_name}"
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = local.mail_from_domain
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.hosted_zone_id
  name    = local.mail_from_domain
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${data.aws_region.current.name}.amazonses.com"]
}

resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.hosted_zone_id
  name    = local.mail_from_domain
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com -all"]
}
