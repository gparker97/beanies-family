environment    = "prod"
aws_region     = "ap-southeast-1"
domain_name    = "beanies.family"
hosted_zone_id = "Z104262530APLWP19OU4P"

# Apex TXT strings for domain verification. Safe to commit — publicly
# readable via DNS once applied. Add entries here for additional search
# engines (Bing, Yandex, etc.) as you verify more properties.
site_verification_txt_records = [
  "google-site-verification=LVmQNVWGix-5Phslce3sPP2SBggNf3S0jwLvFwxA4Vk",
]

# registry_api_key — pass via CLI or TF_VAR_registry_api_key env var (sensitive)
