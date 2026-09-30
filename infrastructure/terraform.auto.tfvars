# Non-sensitive Terraform variables, auto-loaded on every plan/apply (no -var-file flag needed).
#
# Sensitive credentials (TINFOIL_API_KEY, AI_EXTRACT_API_KEY) are NOT here — they stay in
# TF_VAR_* env vars at apply time. Only publicly-readable, durable config belongs in this file.
#
# site_verification_txt_records: the apex TXT record on beanies.family. These were previously
# supplied ad-hoc via a shell env var, so any apply from a shell missing it planned to DESTROY
# the live record (Google Search Console + Migadu email verification + SPF). Persisting them
# here makes Terraform the source of truth and prevents that footgun. Keep in sync with DNS.
site_verification_txt_records = [
  "google-site-verification=LVmQNVWGix-5Phslce3sPP2SBggNf3S0jwLvFwxA4Vk",
  "pinterest-site-verification=cc987067a09e9f8e0a9e782bbcc657ef",
  "hosted-email-verify=8uetlptp",
  "v=spf1 include:spf.migadu.com -all",
]

# Pricing and entitlement (#95). Committed here rather than exported as TF_VAR_* because all three
# have safe defaults: an env-only value would silently revert on an apply from a shell that
# lacks it (see .beanies-tf.env.example). Launch is a one-line reviewed change to this file.
#   v1_launch_at:    "" = no launch-based trial clock (families read beta unless subscribed or overridden). At launch, an ISO instant, e.g. "2027-01-15T00:00:00Z".
#   billing_enforce: false = dry-run (compute, report, never block). Flip after the soak.
#   ai_allowance_enforce: false = dry-run (every managed read is checked and allowance_would_deny
#                         logged, nothing refused). Flip LAST, after v1_launch_at and billing_enforce.
v1_launch_at         = ""
billing_enforce      = false
ai_allowance_enforce = false
