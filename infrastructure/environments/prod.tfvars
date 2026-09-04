environment    = "prod"
aws_region     = "ap-southeast-1"
domain_name    = "beanies.family"
hosted_zone_id = "Z104262530APLWP19OU4P"

# Apex TXT records. Single record set, multiple strings. Safe to commit —
# all entries are publicly readable via DNS once applied. Includes search
# engine site verifications AND Migadu email setup (domain verify + SPF)
# since they all share the apex TXT record set in Route 53.
#
# DKIM lives at key1._domainkey.beanies.family (different subdomain → not here).
# DMARC lives at _dmarc.beanies.family (different subdomain → not here).
# ⚠️ MUST STAY IN SYNC WITH terraform.auto.tfvars.
#
# An explicit `-var-file=environments/prod.tfvars` OVERRIDES the auto-loaded
# terraform.auto.tfvars — it does not merge with it. So a record present there but missing
# here is planned for DESTRUCTION by every apply that passes this file, which is the documented
# footgun that auto.tfvars' own header describes. The Pinterest record was added to auto.tfvars
# and not here, so an apply with -var-file was one confirmation away from un-verifying the
# domain for Pinterest.
#
# Keep both lists identical, and keep them in sync with live DNS.
site_verification_txt_records = [
  "google-site-verification=LVmQNVWGix-5Phslce3sPP2SBggNf3S0jwLvFwxA4Vk",
  "pinterest-site-verification=cc987067a09e9f8e0a9e782bbcc657ef",
  "hosted-email-verify=8uetlptp",
  "v=spf1 include:spf.migadu.com -all",
]

# registry_api_key — pass via CLI or TF_VAR_registry_api_key env var (sensitive)
