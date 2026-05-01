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
site_verification_txt_records = [
  "google-site-verification=LVmQNVWGix-5Phslce3sPP2SBggNf3S0jwLvFwxA4Vk",
  "hosted-email-verify=8uetlptp",
  "v=spf1 include:spf.migadu.com -all",
]

# registry_api_key — pass via CLI or TF_VAR_registry_api_key env var (sensitive)
